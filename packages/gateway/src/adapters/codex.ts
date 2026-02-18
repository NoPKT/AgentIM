import { spawn, type ChildProcess } from 'node:child_process'
import {
  BaseAgentAdapter,
  type AdapterOptions,
  type ChunkCallback,
  type CompleteCallback,
  type ErrorCallback,
  type MessageContext,
  getSafeEnv,
} from './base.js'
import { MAX_BUFFER_SIZE } from '@agentim/shared'

export class CodexAdapter extends BaseAgentAdapter {
  private process: ChildProcess | null = null

  constructor(opts: AdapterOptions) {
    super(opts)
  }

  get type() {
    return 'codex' as const
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
    let fullContent = ''

    const prompt = this.buildPrompt(content, context)
    const args = ['-q', prompt]
    const proc = spawn('codex', args, {
      cwd: this.workingDirectory,
      env: getSafeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this.process = proc
    this.startProcessTimer(proc)

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      fullContent += text
      if (fullContent.length > MAX_BUFFER_SIZE) {
        this.clearProcessTimer()
        this.isRunning = false
        onError('Response too large')
        this.killProcess(proc)
        return
      }
      onChunk({ type: 'text', content: text })
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) onChunk({ type: 'error', content: text })
    })

    proc.on('close', (code) => {
      this.clearProcessTimer()
      this.isRunning = false
      this.process = null
      proc.stdout?.removeAllListeners()
      proc.stderr?.removeAllListeners()
      if (this.timedOut) {
        onError('Process timed out')
      } else if (code === 0) {
        onComplete(fullContent)
      } else if (code === null) {
        onError('Process killed by signal')
      } else {
        onError(`Codex exited with code ${code}`)
      }
    })

    proc.on('error', (err) => {
      this.clearProcessTimer()
      this.isRunning = false
      this.process = null
      proc.stdout?.removeAllListeners()
      proc.stderr?.removeAllListeners()
      onError(err.message)
    })
  }

  stop() {
    if (this.process) {
      this.killProcess(this.process)
    }
  }

  dispose() {
    this.stop()
    this.clearKillTimer()
    this.clearProcessTimer()
  }
}
