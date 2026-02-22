import { spawn, type ChildProcess } from 'node:child_process'
import { MAX_BUFFER_SIZE, type ParsedChunk } from '@agentim/shared'
import {
  BaseAgentAdapter,
  type AdapterOptions,
  type ChunkCallback,
  type CompleteCallback,
  type ErrorCallback,
  type MessageContext,
} from './base.js'
import { getSafeEnv } from './spawn-base.js'
import { createLogger } from '../lib/logger.js'

const log = createLogger('Gemini')

const PROCESS_TIMEOUT_MS = Math.max(
  30_000,
  parseInt(process.env.AGENTIM_PROCESS_TIMEOUT_MS ?? '', 10) || 5 * 60 * 1000,
)

/**
 * Gemini adapter using spawn + --output-format stream-json + --resume for session persistence.
 * Will migrate to @google/gemini-cli-sdk when it's published to npm.
 */
export class GeminiAdapter extends BaseAgentAdapter {
  private process: ChildProcess | null = null
  private sessionId?: string
  private buffer = ''
  private timedOut = false
  private processTimer: ReturnType<typeof setTimeout> | null = null
  private killTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: AdapterOptions) {
    super(opts)
  }

  get type() {
    return 'gemini' as const
  }

  sendMessage(
    content: string,
    onChunk: ChunkCallback,
    onComplete: CompleteCallback,
    onError: ErrorCallback,
    context?: MessageContext,
  ) {
    if (this.isRunning) {
      onError('Agent is already processing a message')
      return
    }

    this.isRunning = true
    this.buffer = ''
    let fullContent = ''
    let done = false
    const complete = (c: string) => {
      if (done) return
      done = true
      onComplete(c)
    }
    const fail = (err: string) => {
      if (done) return
      done = true
      onError(err)
    }

    const prompt = this.buildPrompt(content, context)
    const args = ['-p', prompt, '--output-format', 'stream-json']

    // Resume session if we have one
    if (this.sessionId) {
      args.push('--resume', this.sessionId)
    }

    const env = getSafeEnv()
    const proc = spawn('gemini', args, {
      cwd: this.workingDirectory,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    this.process = proc
    this.startTimer(proc)

    proc.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      if (this.buffer.length > MAX_BUFFER_SIZE) {
        this.clearTimer()
        this.isRunning = false
        fail('Response too large')
        this.kill(proc)
        return
      }
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          // Capture session ID from init event
          if (event.type === 'system' && event.session_id) {
            this.sessionId = event.session_id
            log.info(`Gemini session: ${this.sessionId}`)
          }
          for (const chunk of this.parseEvent(event)) {
            if (chunk.type === 'text') fullContent += chunk.content
            onChunk(chunk)
          }
        } catch {
          // Non-JSON lines → treat as plain text
          if (line.trim()) {
            fullContent += line
            onChunk({ type: 'text', content: line })
          }
        }
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      if (done) return
      const text = data.toString().trim()
      if (text) onChunk({ type: 'error', content: text })
    })

    proc.on('close', (code) => {
      this.clearTimer()
      this.isRunning = false
      this.process = null
      proc.stdout?.removeAllListeners()
      proc.stderr?.removeAllListeners()

      // Process remaining buffer
      if (this.buffer.trim()) {
        try {
          const event = JSON.parse(this.buffer)
          for (const chunk of this.parseEvent(event)) {
            if (chunk.type === 'text') fullContent += chunk.content
            onChunk(chunk)
          }
        } catch {
          if (this.buffer.trim()) {
            fullContent += this.buffer
            onChunk({ type: 'text', content: this.buffer })
          }
        }
      }

      if (this.timedOut) {
        fail('Process timed out')
      } else if (code === 0) {
        complete(fullContent)
      } else if (code === null) {
        fail('Process killed by signal')
      } else {
        fail(`Gemini exited with code ${code}`)
      }
    })

    proc.on('error', (err) => {
      this.clearTimer()
      this.isRunning = false
      this.process = null
      proc.stdout?.removeAllListeners()
      proc.stderr?.removeAllListeners()
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        fail(
          'Command "gemini" not found. Please install Gemini CLI first: npm install -g @google/gemini-cli',
        )
      } else {
        fail(err.message)
      }
    })
  }

  private parseEvent(event: {
    type?: string
    content?: string
    text?: string
    message?: { content?: Array<{ type: string; text?: string }> }
  }): ParsedChunk[] {
    // Gemini stream-json emits various event types; extract text content
    if (event.type === 'text' || event.type === 'content') {
      const text = event.content ?? event.text ?? ''
      if (text) return [{ type: 'text', content: text }]
    }
    if (event.message?.content) {
      return event.message.content
        .filter((b) => b.type === 'text' && b.text)
        .map((b) => ({ type: 'text' as const, content: b.text! }))
    }
    return []
  }

  private startTimer(proc: ChildProcess) {
    this.clearTimer()
    this.timedOut = false
    this.processTimer = setTimeout(() => {
      this.timedOut = true
      proc.kill('SIGTERM')
      const escalate = setTimeout(() => {
        try {
          proc.kill('SIGKILL')
        } catch {}
      }, 5000)
      escalate.unref()
    }, PROCESS_TIMEOUT_MS)
  }

  private clearTimer() {
    if (this.processTimer) {
      clearTimeout(this.processTimer)
      this.processTimer = null
    }
  }

  private kill(proc: ChildProcess) {
    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }
    proc.kill('SIGTERM')
    this.killTimer = setTimeout(() => {
      try {
        proc.kill('SIGKILL')
      } catch {}
      this.killTimer = null
    }, 5000)
    this.killTimer.unref()
  }

  stop() {
    if (this.process) {
      this.kill(this.process)
    }
  }

  dispose() {
    this.stop()
    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }
    this.clearTimer()
    this.sessionId = undefined
  }
}
