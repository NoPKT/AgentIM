import { z } from 'zod'
import type { ServiceAgentProvider, ProviderRequest, ProviderResult } from './types.js'

const configSchema = z.object({
  apiKey: z.string().min(1),
  model: z.string().min(1).default('gen4_turbo'),
  duration: z.enum(['5', '10']).default('5'),
  ratio: z.enum(['16:9', '9:16', '1:1']).default('16:9'),
})

type Config = z.infer<typeof configSchema>

const BASE_URL = 'https://api.dev.runwayml.com/v1'

export const runwayProvider: ServiceAgentProvider = {
  meta: {
    type: 'runway',
    displayName: 'Runway Video Generation',
    category: 'video',
    configSchema,
    description: 'Generate videos from text prompts via Runway API',
  },

  async invoke(rawConfig: unknown, request: ProviderRequest): Promise<ProviderResult> {
    const config = configSchema.parse(rawConfig) as Config

    const response = await fetch(`${BASE_URL}/text_to_video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
        'X-Runway-Version': '2024-11-06',
      },
      body: JSON.stringify({
        model: config.model,
        promptText: request.prompt,
        duration: Number(config.duration),
        ratio: config.ratio,
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error')
      throw new Error(`Runway API error (${response.status}): ${errorText}`)
    }

    const data = (await response.json()) as { id?: string }

    if (!data.id) {
      throw new Error('Runway API returned no task ID')
    }

    return {
      kind: 'async',
      taskId: data.id,
      pollIntervalMs: 10_000, // poll every 10s
      maxWaitMs: 5 * 60 * 1000, // 5 minutes
      statusMessage: 'Generating video... This may take 1-3 minutes.',
    }
  },

  async poll(rawConfig: unknown, taskId: string): Promise<ProviderResult> {
    const config = configSchema.parse(rawConfig) as Config

    const response = await fetch(`${BASE_URL}/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'X-Runway-Version': '2024-11-06',
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      throw new Error(`Runway poll error (${response.status})`)
    }

    const data = (await response.json()) as {
      status?: string
      output?: string[]
      failure?: string
    }

    if (data.status === 'FAILED') {
      throw new Error(`Runway generation failed: ${data.failure ?? 'unknown'}`)
    }

    if (data.status === 'SUCCEEDED' && data.output?.length) {
      const timestamp = Date.now()
      return {
        kind: 'media',
        mediaType: 'video',
        url: data.output[0],
        mimeType: 'video/mp4',
        filename: `video-${timestamp}.mp4`,
        durationSeconds: Number(config.duration),
      }
    }

    // Still processing
    return {
      kind: 'async',
      taskId,
      pollIntervalMs: 10_000,
      maxWaitMs: 5 * 60 * 1000,
      statusMessage: `Video generation in progress (${data.status ?? 'processing'})...`,
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
