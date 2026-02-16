import { spawn, type ChildProcess } from 'node:child_process'
import {
  BaseAgentAdapter,
  type AdapterOptions,
  type ChunkCallback,
  type CompleteCallback,
  type ErrorCallback,
  type MessageContext,
} from './base.js'

export interface GenericAdapterOptions extends AdapterOptions {
  command: string
  args?: string[]
}

export class GenericAdapter extends BaseAgentAdapter {
  private process: ChildProcess | null = null
  private command: string
  private cmdArgs: string[]

  constructor(opts: GenericAdapterOptions) {
    super(opts)
    this.command = opts.command
    this.cmdArgs = opts.args ?? []
  }

  get type() {
    return 'generic' as const
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
    const args = [...this.cmdArgs, prompt]
    const proc = spawn(this.command, args, {
      cwd: this.workingDirectory,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
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
        onError(`Process exited with code ${code}`)
      }
    })

    proc.on('error', (err) => {
      this.isRunning = false
      this.process = null
      onError(err.message)
    })
  }

  stop() {
    if (this.process) {
      this.process.kill('SIGTERM')
      setTimeout(() => {
        if (this.process) this.process.kill('SIGKILL')
      }, 5000)
    }
  }

  dispose() {
    this.stop()
  }
}
