import type { ParsedChunk, RoutingMode, RoomContext, PermissionLevel } from '@agentim/shared'
import { createLogger } from '../lib/logger.js'

const log = createLogger('Adapter')

const MAX_PROMPT_LENGTH = 200_000 // ~200KB cap to prevent oversized prompts

export type PermissionRequestCallback = (opts: {
  requestId: string
  toolName: string
  toolInput: Record<string, unknown>
  timeoutMs: number
}) => Promise<{ behavior: 'allow' | 'deny' }>

export interface AdapterOptions {
  agentId: string
  agentName: string
  workingDirectory?: string
  env?: Record<string, string>
  passEnv?: string[]
  permissionLevel?: PermissionLevel
  onPermissionRequest?: PermissionRequestCallback
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
  protected readonly env: Record<string, string>
  protected readonly passEnv?: Set<string>
  protected readonly permissionLevel: PermissionLevel
  protected readonly onPermissionRequest?: PermissionRequestCallback
  protected isRunning = false

  constructor(opts: AdapterOptions) {
    this.agentId = opts.agentId
    this.agentName = opts.agentName
    this.workingDirectory = opts.workingDirectory
    this.env = opts.env ?? {}
    this.passEnv = opts.passEnv?.length ? new Set(opts.passEnv) : undefined
    this.permissionLevel = opts.permissionLevel ?? 'interactive'
    this.onPermissionRequest = opts.onPermissionRequest
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
      log.warn(
        `Prompt truncated from ${prompt.length} to ${MAX_PROMPT_LENGTH} chars for agent ${this.agentName}`,
      )
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
  ): void | Promise<void>

  abstract stop(): void

  abstract dispose(): void

  get running(): boolean {
    return this.isRunning
  }
}
