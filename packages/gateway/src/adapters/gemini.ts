import type { ChildProcess } from 'node:child_process'
import {
  BaseAgentAdapter,
  type AdapterOptions,
  type ChunkCallback,
  type CompleteCallback,
  type ErrorCallback,
  type MessageContext,
} from './base.js'

export class GeminiAdapter extends BaseAgentAdapter {
  private process: ChildProcess | null = null

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
    const prompt = this.buildPrompt(content, context)
    const args = ['-p', prompt]

    const { proc } = this.spawnAndStream('gemini', args, {
      onChunk,
      onComplete: (fullContent) => {
        this.process = null
        onComplete(fullContent)
      },
      onError: (err) => {
        this.process = null
        onError(err)
      },
      exitLabel: 'Gemini',
    })

    this.process = proc
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
