import { spawn, type ChildProcess } from 'node:child_process'
import { BaseAgentAdapter, type AdapterOptions, type ChunkCallback, type CompleteCallback, type ErrorCallback, type MessageContext } from './base.js'

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
    let fullContent = ''

    const args = ['-p', content]
    const proc = spawn('gemini', args, {
      cwd: this.workingDirectory,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.process = proc

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      fullContent += text
      onChunk({ type: 'text', content: text })
    })

    proc.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) onChunk({ type: 'error', content: text })
    })

    proc.on('close', (code) => {
      this.isRunning = false
      this.process = null
      if (code === 0 || code === null) {
        onComplete(fullContent)
      } else {
        onError(`Gemini exited with code ${code}`)
      }
    })

    proc.on('error', (err) => {
      this.isRunning = false
      this.process = null
      onError(err.message)
    })
  }

  stop() {
    this.process?.kill('SIGTERM')
  }

  dispose() {
    this.stop()
  }
}
