import type { ZodType } from 'zod'
import type { ServiceAgentCategory } from '@agentim/shared'

export interface ProviderMeta {
  /** Unique identifier, e.g. 'openai-chat', 'elevenlabs', 'runway' */
  type: string
  /** Display name */
  displayName: string
  /** Provider category */
  category: ServiceAgentCategory
  /** Zod schema for this provider's config */
  configSchema: ZodType
  /** Optional description */
  description?: string
}

export interface TextResult {
  kind: 'text'
  content: string
  citations?: string[]
  tokensUsed?: { input: number; output: number }
}

export interface MediaResult {
  kind: 'media'
  mediaType: 'image' | 'audio' | 'video' | '3d-model'
  url: string
  mimeType: string
  filename: string
  durationSeconds?: number
  caption?: string
  metadata?: Record<string, unknown>
}

export interface AsyncTaskResult {
  kind: 'async'
  taskId: string
  pollIntervalMs: number
  maxWaitMs: number
  statusMessage: string
}

export type ProviderResult = TextResult | MediaResult | AsyncTaskResult

export interface ProviderRequest {
  prompt: string
  senderName: string
  systemPrompt?: string
}

export interface ServiceAgentProvider {
  meta: ProviderMeta

  /** Send a request, return a result (sync providers return TextResult/MediaResult, async return AsyncTaskResult) */
  invoke(config: unknown, request: ProviderRequest): Promise<ProviderResult>

  /** Poll an async task status (only async providers need to implement this) */
  poll?(config: unknown, taskId: string): Promise<ProviderResult>

  /** Optional: validate whether config is valid / API key works */
  validateConfig?(config: unknown): Promise<{ valid: boolean; error?: string }>
}
