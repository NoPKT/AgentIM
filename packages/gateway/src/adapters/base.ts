import type { ParsedChunk, RoutingMode, RoomContext } from '@agentim/shared'

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

  constructor(opts: AdapterOptions) {
    this.agentId = opts.agentId
    this.agentName = opts.agentName
    this.workingDirectory = opts.workingDirectory
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
    return parts.join('\n\n')
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
