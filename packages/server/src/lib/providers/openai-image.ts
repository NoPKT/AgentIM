import { z } from 'zod'
import type { ServiceAgentProvider, ProviderRequest, ProviderResult } from './types.js'
import { isPrivateUrl } from './media-storage.js'

const configSchema = z.object({
  baseUrl: z.string().url().default('https://api.openai.com/v1'),
  apiKey: z.string().min(1),
  model: z.string().min(1).default('gpt-image-1'),
  size: z.enum(['1024x1024', '1536x1024', '1024x1536', 'auto']).default('auto'),
  quality: z.enum(['low', 'medium', 'high', 'auto']).default('auto'),
})

type Config = z.infer<typeof configSchema>

export const openaiImageProvider: ServiceAgentProvider = {
  meta: {
    type: 'openai-image',
    displayName: 'OpenAI Image Generation',
    category: 'image',
    configSchema,
    description: 'Generate images via OpenAI Images API (GPT Image, DALL-E)',
  },

  async invoke(rawConfig: unknown, request: ProviderRequest): Promise<ProviderResult> {
    const config = configSchema.parse(rawConfig) as Config

    // SSRF prevention: block requests to private/internal networks
    if (isPrivateUrl(config.baseUrl)) {
      throw new Error('Base URL points to a private network (SSRF blocked)')
    }

    const response = await fetch(`${config.baseUrl}/images/generations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        prompt: request.prompt,
        n: 1,
        size: config.size,
        quality: config.quality,
      }),
      signal: AbortSignal.timeout(120_000), // image gen can be slow
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error')
      throw new Error(`OpenAI Image API error (${response.status}): ${errorText}`)
    }

    const data = (await response.json()) as {
      data?: Array<{ url?: string; revised_prompt?: string; b64_json?: string }>
    }

    const imageData = data.data?.[0]
    if (!imageData?.url && !imageData?.b64_json) {
      throw new Error('OpenAI Image API returned no image')
    }

    const url = imageData.url ?? `data:image/png;base64,${imageData.b64_json}`
    const timestamp = Date.now()

    return {
      kind: 'media',
      mediaType: 'image',
      url,
      mimeType: 'image/png',
      filename: `image-${timestamp}.png`,
      caption: imageData.revised_prompt,
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
