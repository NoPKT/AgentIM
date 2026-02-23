import { spawn, type ChildProcess } from 'node:child_process'
import { SpawnAgentAdapter, getSafeEnv } from './spawn-base.js'
import type {
  AdapterOptions,
  ChunkCallback,
  CompleteCallback,
  ErrorCallback,
  MessageContext,
} from './base.js'
import { MAX_BUFFER_SIZE } from '@agentim/shared'

/** Characters that are unsafe in command names (shell metacharacters / path traversal).
 * Parentheses are intentionally allowed because spawn() does not use a shell,
 * and legitimate paths such as C:\Program Files (x86)\... contain them. */
const UNSAFE_COMMAND_PATTERN = /[;&|`${}[\]<>!#~*?\n\r]/

export interface GenericAdapterOptions extends AdapterOptions {
  command: string
  args?: string[]
  /** How to pass the prompt to the child process. Default: 'stdin' (safer, no length limit). */
  promptVia?: 'arg' | 'stdin'
}

export class GenericAdapter extends SpawnAgentAdapter {
  private process: ChildProcess | null = null
  private command: string
  private cmdArgs: string[]
  private promptVia: 'arg' | 'stdin'

  constructor(opts: GenericAdapterOptions) {
    super(opts)

    // Validate command path to prevent injection
    const cmd = opts.command.trim()
    if (!cmd) throw new Error('GenericAdapter: command must not be empty')
    if (UNSAFE_COMMAND_PATTERN.test(cmd)) {
      throw new Error(`GenericAdapter: command contains unsafe characters: "${cmd}"`)
    }

    this.command = cmd
    this.cmdArgs = opts.args ?? []
    this.promptVia = opts.promptVia ?? 'stdin'
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
    let done = false
    const complete = (content: string) => {
      if (done) return
      done = true
      onComplete(content)
    }
    const fail = (err: string) => {
      if (done) return
      done = true
      onError(err)
    }

    const prompt = this.buildPrompt(content, context)
    const useStdin = this.promptVia === 'stdin'
    const args = useStdin ? [...this.cmdArgs] : [...this.cmdArgs, prompt]
    const proc = spawn(this.command, args, {
      cwd: this.workingDirectory,
      env: { ...getSafeEnv(this.passEnv), ...this.env },
      stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    })

    this.process = proc
    this.startProcessTimer(proc)

    // Write prompt via stdin to avoid shell injection and argument length limits
    if (useStdin && proc.stdin) {
      proc.stdin.write(prompt)
      proc.stdin.end()
    }

    proc.stdout?.on('data', (data: Buffer) => {
      const text = data.toString()
      fullContent += text
      if (fullContent.length > MAX_BUFFER_SIZE) {
        this.clearProcessTimer()
        this.isRunning = false
        fail('Response too large')
        this.killProcess(proc)
        return
      }
      onChunk({ type: 'text', content: text })
      this.startProcessTimer(proc)
    })

    proc.stderr?.on('data', (data: Buffer) => {
      if (done) return
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
        fail('Process timed out')
      } else if (code === 0) {
        complete(fullContent)
      } else if (code === null) {
        fail('Process killed by signal')
      } else {
        fail(`Process exited with code ${code}`)
      }
    })

    proc.on('error', (err) => {
      this.clearProcessTimer()
      this.isRunning = false
      this.process = null
      proc.stdout?.removeAllListeners()
      proc.stderr?.removeAllListeners()
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        fail(
          `Command "${this.command}" not found. Please ensure it is installed and available in your PATH.`,
        )
      } else {
        fail(err.message)
      }
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
