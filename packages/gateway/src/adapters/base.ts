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
  isMentioned?: boolean
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
