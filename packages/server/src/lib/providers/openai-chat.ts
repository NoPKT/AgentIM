import { z } from 'zod'
import type { ServiceAgentProvider, ProviderRequest, ProviderResult } from './types.js'
import { isPrivateUrl } from './media-storage.js'

const configSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  model: z.string().min(1),
  systemPrompt: z.string().max(10_000).optional(),
  maxTokens: z.number().int().min(1).max(100_000).default(4096),
})

type Config = z.infer<typeof configSchema>

export const openaiChatProvider: ServiceAgentProvider = {
  meta: {
    type: 'openai-chat',
    displayName: 'OpenAI Chat',
    category: 'chat',
    configSchema,
    description: 'OpenAI-compatible chat completions API',
  },

  async invoke(rawConfig: unknown, request: ProviderRequest): Promise<ProviderResult> {
    const config = configSchema.parse(rawConfig) as Config

    const apiMessages: Array<{ role: string; content: string }> = []
    if (config.systemPrompt || request.systemPrompt) {
      apiMessages.push({
        role: 'system',
        content: config.systemPrompt ?? request.systemPrompt ?? '',
      })
    }
    apiMessages.push({ role: 'user', content: `[${request.senderName}]: ${request.prompt}` })

    // SSRF prevention: block requests to private/internal networks
    if (isPrivateUrl(config.baseUrl)) {
      throw new Error('Base URL points to a private network (SSRF blocked)')
    }

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: apiMessages,
        max_tokens: config.maxTokens,
      }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error')
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }

    const content = data.choices?.[0]?.message?.content ?? ''

    return {
      kind: 'text',
      content,
      tokensUsed: data.usage
        ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
        : undefined,
    }
  },

  async validateConfig(rawConfig: unknown) {
    try {
      const config = configSchema.parse(rawConfig) as Config
      // SSRF prevention: block requests to private/internal networks
      if (isPrivateUrl(config.baseUrl)) {
        return { valid: false, error: 'Base URL points to a private network (SSRF blocked)' }
      }
      const response = await fetch(`${config.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${config.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) {
        return { valid: false, error: `API returned ${response.status}` }
      }
      return { valid: true }
    } catch (err) {
      return { valid: false, error: (err as Error).message }
    }
  },
}
