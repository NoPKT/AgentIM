import type { ChildProcess } from 'node:child_process'
import type { ParsedChunk, RoutingMode, RoomContext } from '@agentim/shared'

const PROCESS_TIMEOUT_MS = Math.max(
  30_000,
  parseInt(process.env.AGENTIM_PROCESS_TIMEOUT_MS ?? '', 10) || 5 * 60 * 1000,
) // default 5 minutes, minimum 30 seconds
const MAX_PROMPT_LENGTH = 200_000 // ~200KB cap to prevent oversized prompts

/**
 * Sensitive env var prefixes/names stripped before passing to child processes.
 * Prevents leaking DB credentials, JWT secrets, etc. to AI agent subprocesses.
 */
const SENSITIVE_ENV_KEYS = new Set([
  'DATABASE_URL',
  'REDIS_URL',
  'JWT_SECRET',
  'ADMIN_PASSWORD',
  'AGENTIM_PASSWORD',
  'AGENTIM_TOKEN',
  'ENCRYPTION_KEY',
  'SENTRY_DSN',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GITHUB_TOKEN',
  'GITHUB_APP_PRIVATE_KEY',
  'GITLAB_TOKEN',
  'NPM_TOKEN',
  'HUGGINGFACE_TOKEN',
  'HUGGINGFACE_API_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_PUBLISHABLE_KEY',
  'SLACK_BOT_TOKEN',
  'SLACK_APP_TOKEN',
  'SLACK_SIGNING_SECRET',
])

const SENSITIVE_ENV_PREFIXES = ['ROUTER_LLM_', 'AGENTIM_SECRET_', 'SECRET_', 'API_KEY_', 'STRIPE_', 'GITHUB_APP_']

/** Return a copy of process.env with sensitive variables removed. */
export function getSafeEnv(): Record<string, string | undefined> {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (
      SENSITIVE_ENV_KEYS.has(key) ||
      SENSITIVE_ENV_PREFIXES.some((p) => key.startsWith(p))
    ) {
      delete env[key]
    }
  }
  return env
}

export interface AdapterOptions {
  agentId: string
  agentName: string
  workingDirectory?: string
}

export interface MessageContext {
  roomId: string
  senderName: string
  routingMode?: RoutingMode
  conversationId?: string
  depth?: number
  roomContext?: RoomContext
}

export type ChunkCallback = (chunk: ParsedChunk) => void
export type CompleteCallback = (fullContent: string) => void
export type ErrorCallback = (error: string) => void

export abstract class BaseAgentAdapter {
  readonly agentId: string
  readonly agentName: string
  readonly workingDirectory?: string
  protected isRunning = false
  protected timedOut = false
  private processTimer: ReturnType<typeof setTimeout> | null = null
  private killTimer: ReturnType<typeof setTimeout> | null = null

  constructor(opts: AdapterOptions) {
    this.agentId = opts.agentId
    this.agentName = opts.agentName
    this.workingDirectory = opts.workingDirectory
  }

  /** Start a timeout that kills the process if it takes too long */
  protected startProcessTimer(proc: ChildProcess) {
    this.clearProcessTimer()
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

  protected clearProcessTimer() {
    if (this.processTimer) {
      clearTimeout(this.processTimer)
      this.processTimer = null
    }
  }

  /** Gracefully stop a child process with SIGTERM → SIGKILL escalation */
  protected killProcess(proc: ChildProcess) {
    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }
    proc.kill('SIGTERM')
    this.killTimer = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch {}
      this.killTimer = null
    }, 5000)
    this.killTimer.unref()
  }

  protected clearKillTimer() {
    if (this.killTimer) {
      clearTimeout(this.killTimer)
      this.killTimer = null
    }
  }

  abstract get type(): string

  /**
   * Build a contextual prompt by prepending room context and sender info.
   */
  protected buildPrompt(content: string, context?: MessageContext): string {
    const parts: string[] = []
    if (context?.roomContext?.systemPrompt) {
      parts.push(`[System: ${context.roomContext.systemPrompt}]`)
    }
    if (context?.senderName) {
      parts.push(`[From: ${context.senderName}]`)
    }
    parts.push(content)
    const prompt = parts.join('\n\n')
    if (prompt.length > MAX_PROMPT_LENGTH) {
      return prompt.slice(0, MAX_PROMPT_LENGTH) + '\n\n[...truncated]'
    }
    return prompt
  }

  abstract sendMessage(
    content: string,
    onChunk: ChunkCallback,
    onComplete: CompleteCallback,
    onError: ErrorCallback,
    context?: MessageContext,
  ): void

  abstract stop(): void

  abstract dispose(): void

  get running(): boolean {
    return this.isRunning
  }
}
