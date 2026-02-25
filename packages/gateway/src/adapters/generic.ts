import { spawn, type ChildProcess } from 'node:child_process'
import { resolve as pathResolve } from 'node:path'
import { SpawnAgentAdapter, getSafeEnv } from './spawn-base.js'
import type {
  AdapterOptions,
  ChunkCallback,
  CompleteCallback,
  ErrorCallback,
  MessageContext,
} from './base.js'
import { MAX_BUFFER_SIZE } from '@agentim/shared'

const ABSOLUTE_TIMEOUT_MS = 30 * 60 * 1000 // 30 minutes — cannot be reset by data chunks
const STDERR_MAX_BUFFER_SIZE = 5 * 1024 * 1024 // 5 MB

/** Characters that are unsafe in command names (shell metacharacters / path traversal).
 * Parentheses are intentionally allowed because spawn() does not use a shell,
 * and legitimate paths such as C:\Program Files (x86)\... contain them. */
const UNSAFE_COMMAND_PATTERN = /[;&|`${}[\]<>!#~*?\n\r]/

/** Detects path traversal: commands that are purely relative paths walking upward via `..`.
 * Matches paths like `../foo`, `../../bin/sh`, `foo/../../etc/passwd`.
 * Does NOT reject absolute paths that happen to contain `..` segments — those are
 * resolved by the OS and are less exploitable when passed directly to spawn(). */
const PATH_TRAVERSAL_PATTERN = /(?:^|[\\/])\.\.(?:[\\/]|$)/

/** Check whether a path is absolute on either POSIX or Windows.
 * Covers `/usr/bin/cmd`, `C:\cmd.exe`, and `\\server\share` (UNC). */
function isAbsolutePath(p: string): boolean {
  return /^(?:[/\\]{1,2}|[A-Za-z]:[/\\])/.test(p)
}

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

    // Null bytes can truncate strings at the C level, leading to path confusion
    if (cmd.includes('\0')) {
      throw new Error('GenericAdapter: command must not contain null bytes')
    }

    // A leading dash could be interpreted as an option by the OS or parent process
    if (cmd.startsWith('-')) {
      throw new Error(
        'GenericAdapter: command must not start with a dash (possible option injection)',
      )
    }

    // Explicit newline check — also caught by UNSAFE_COMMAND_PATTERN, but kept
    // separate for a clearer error message and defense-in-depth
    if (/[\n\r]/.test(cmd)) {
      throw new Error('GenericAdapter: command must not contain newline characters')
    }

    if (UNSAFE_COMMAND_PATTERN.test(cmd)) {
      throw new Error(`GenericAdapter: command contains unsafe characters: "${cmd}"`)
    }

    // Reject paths that contain `..` traversal segments.
    // For relative paths, this prevents escaping the working directory.
    // For absolute paths, normalize first then reject if `..` changed the path
    // (e.g. /usr/bin/../../../etc/passwd resolves to /etc/passwd).
    if (PATH_TRAVERSAL_PATTERN.test(cmd)) {
      if (!isAbsolutePath(cmd)) {
        throw new Error(
          'GenericAdapter: relative command path must not contain ".." traversal segments',
        )
      }
      // Normalize the absolute path and use the resolved version
      const resolved = pathResolve(cmd)
      if (resolved !== cmd) {
        throw new Error(
          `GenericAdapter: absolute command path contains ".." segments — use the resolved path "${resolved}" instead`,
        )
      }
    }

    this.command = cmd
    this.cmdArgs = opts.args ?? []
    this.promptVia = opts.promptVia ?? 'stdin'
  }

  get type() {
    return 'generic' as const
  }

  // NOTE: sendMessage intentionally duplicates the spawn-and-stream logic from
  // SpawnAgentAdapter.spawnAndStream() rather than calling it. This is because
  // GenericAdapter supports delivering the prompt via stdin (`promptVia: 'stdin'`),
  // which requires `stdio[0]` to be 'pipe' instead of 'ignore' and an extra
  // write-then-close step after spawn. The base helper always sets stdin to
  // 'ignore', so reusing it would require either an awkward post-hoc stdin
  // override or adding stdin plumbing to the shared helper — both of which would
  // complicate the common case for other adapters that never need stdin.
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

    // Absolute timeout that cannot be reset by data chunks
    const absoluteTimer = setTimeout(() => {
      if (done) return
      this.timedOut = true
      this.clearProcessTimer()
      this.isRunning = false
      fail('Process exceeded absolute timeout (30 minutes)')
      this.killProcess(proc)
    }, ABSOLUTE_TIMEOUT_MS)
    absoluteTimer.unref()

    let stderrSize = 0

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
        clearTimeout(absoluteTimer)
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
      stderrSize += data.length
      if (stderrSize > STDERR_MAX_BUFFER_SIZE) {
        this.clearProcessTimer()
        clearTimeout(absoluteTimer)
        this.isRunning = false
        fail('Stderr output too large (exceeded 5MB)')
        this.killProcess(proc)
        return
      }
      const text = data.toString().trim()
      if (text) onChunk({ type: 'error', content: text })
      // Reset process timer on stderr activity (agent is still working)
      this.startProcessTimer(proc)
    })

    proc.on('close', (code) => {
      this.clearProcessTimer()
      clearTimeout(absoluteTimer)
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
      clearTimeout(absoluteTimer)
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
