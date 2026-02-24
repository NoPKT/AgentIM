import { z } from 'zod'
import type { ServiceAgentProvider, ProviderRequest, ProviderResult } from './types.js'

const configSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1).default('sonar'),
  systemPrompt: z.string().max(10_000).optional(),
  maxTokens: z.number().int().min(1).max(100_000).default(4096),
})

type Config = z.infer<typeof configSchema>

export const perplexityProvider: ServiceAgentProvider = {
  meta: {
    type: 'perplexity',
    displayName: 'Perplexity Search',
    category: 'search',
    configSchema,
    description: 'AI-powered search with citations via Perplexity API',
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
    apiMessages.push({ role: 'user', content: request.prompt })

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
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
      throw new Error(`Perplexity API error (${response.status}): ${errorText}`)
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      citations?: string[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }

    const content = data.choices?.[0]?.message?.content ?? ''

    return {
      kind: 'text',
      content,
      citations: data.citations,
      tokensUsed: data.usage
        ? { input: data.usage.prompt_tokens ?? 0, output: data.usage.completion_tokens ?? 0 }
        : undefined,
    }
  },

  async validateConfig(rawConfig: unknown) {
    try {
      configSchema.parse(rawConfig)
      return { valid: true }
    } catch (err) {
      return { valid: false, error: (err as Error).message }
    }
  },
}
