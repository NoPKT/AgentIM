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
import { MAX_BUFFER_SIZE, type ParsedChunk } from '@agentim/shared'

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  private process: ChildProcess | null = null
  private buffer = ''

  constructor(opts: AdapterOptions) {
    super(opts)
  }

  get type() {
    return 'claude-code' as const
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

    const prompt = this.buildPrompt(content, context)
    const args = ['-p', prompt, '--output-format', 'stream-json', '--verbose']

    // Use safe env (sensitive vars stripped) + remove CLAUDECODE for nested sessions
    const env = getSafeEnv()
    delete env.CLAUDECODE
    const proc = spawn('claude', args, {
      cwd: this.workingDirectory,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    this.process = proc
    this.startProcessTimer(proc)

    proc.stdout?.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      if (this.buffer.length > MAX_BUFFER_SIZE) {
        this.clearProcessTimer()
        this.isRunning = false
        onError('Response too large')
        this.killProcess(proc)
        return
      }
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const event = JSON.parse(line)
          const chunk = this.parseEvent(event)
          if (chunk) {
            if (chunk.type === 'text') {
              fullContent += chunk.content
            }
            onChunk(chunk)
          }
        } catch {
          // Skip non-JSON lines
        }
      }
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) {
        onChunk({ type: 'error', content: text })
      }
    })

    proc.on('close', (code) => {
      this.clearProcessTimer()
      this.isRunning = false
      this.process = null
      proc.stdout?.removeAllListeners()
      proc.stderr?.removeAllListeners()

      if (this.timedOut) {
        onError('Process timed out')
        return
      }

      // Process remaining buffer
      if (this.buffer.trim()) {
        try {
          const event = JSON.parse(this.buffer)
          const chunk = this.parseEvent(event)
          if (chunk) {
            if (chunk.type === 'text') fullContent += chunk.content
            onChunk(chunk)
          }
        } catch {
          // Ignore
        }
      }

      if (code === 0) {
        onComplete(fullContent)
      } else if (code === null) {
        onError('Process killed by signal')
      } else {
        onError(`Process exited with code ${code}`)
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

  private parseEvent(event: any): ParsedChunk | null {
    // Claude Code stream-json format
    if (event.type === 'assistant' && event.message) {
      // Content block with text
      if (event.message.content) {
        for (const block of event.message.content) {
          if (block.type === 'text') {
            return { type: 'text', content: block.text }
          } else if (block.type === 'thinking') {
            return { type: 'thinking', content: block.thinking }
          } else if (block.type === 'tool_use') {
            return {
              type: 'tool_use',
              content: JSON.stringify(block, null, 2),
              metadata: { toolName: block.name, toolId: block.id },
            }
          } else if (block.type === 'tool_result') {
            return {
              type: 'tool_result',
              content:
                typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
              metadata: { toolId: block.tool_use_id },
            }
          }
        }
      }
    }

    // Content block delta (streaming)
    if (event.type === 'content_block_delta') {
      if (event.delta?.type === 'text_delta') {
        return { type: 'text', content: event.delta.text }
      }
      if (event.delta?.type === 'thinking_delta') {
        return { type: 'thinking', content: event.delta.thinking }
      }
    }

    // Result event — skip to avoid duplicating text already emitted by assistant events.
    // The fullContent is accumulated from assistant chunks and passed to onComplete.

    return null
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
