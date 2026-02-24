import { z } from 'zod'
import type { ServiceAgentProvider, ProviderRequest, ProviderResult } from './types.js'

const configSchema = z.object({
  apiKey: z.string().min(1),
  durationSeconds: z.number().min(1).max(300).default(30),
  outputFormat: z.enum(['mp3', 'wav']).default('mp3'),
})

type Config = z.infer<typeof configSchema>

const BASE_URL = 'https://api.stability.ai/v2beta'

export const stabilityAudioProvider: ServiceAgentProvider = {
  meta: {
    type: 'stability-audio',
    displayName: 'Stability Audio',
    category: 'music',
    configSchema,
    description: 'Generate music and audio from text prompts via Stability AI',
  },

  async invoke(rawConfig: unknown, request: ProviderRequest): Promise<ProviderResult> {
    const config = configSchema.parse(rawConfig) as Config

    // Stability Audio uses multipart/form-data
    const formData = new FormData()
    formData.append('prompt', request.prompt)
    formData.append('duration_seconds', String(config.durationSeconds))
    formData.append('output_format', config.outputFormat)

    const response = await fetch(`${BASE_URL}/audio/generate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: 'application/json',
      },
      body: formData,
      signal: AbortSignal.timeout(120_000), // 2 min timeout
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error')
      throw new Error(`Stability Audio API error (${response.status}): ${errorText}`)
    }

    const data = (await response.json()) as {
      id?: string
      audio?: string // base64 encoded audio
      status?: string
    }

    // If result is immediately available
    if (data.audio) {
      const mimeType = config.outputFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav'
      const timestamp = Date.now()
      return {
        kind: 'media',
        mediaType: 'audio',
        url: `data:${mimeType};base64,${data.audio}`,
        mimeType,
        filename: `music-${timestamp}.${config.outputFormat}`,
        durationSeconds: config.durationSeconds,
        caption: request.prompt.slice(0, 200),
      }
    }

    // Async mode
    if (data.id) {
      return {
        kind: 'async',
        taskId: data.id,
        pollIntervalMs: 5_000,
        maxWaitMs: 3 * 60 * 1000, // 3 minutes
        statusMessage: 'Generating music... This may take a minute.',
      }
    }

    throw new Error('Stability Audio API returned unexpected response')
  },

  async poll(rawConfig: unknown, taskId: string): Promise<ProviderResult> {
    const config = configSchema.parse(rawConfig) as Config

    const response = await fetch(`${BASE_URL}/audio/generate/${taskId}`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      throw new Error(`Stability Audio poll error (${response.status})`)
    }

    const data = (await response.json()) as {
      status?: string
      audio?: string
    }

    if (data.status === 'failed') {
      throw new Error('Stability Audio generation failed')
    }

    if (data.audio) {
      const mimeType = config.outputFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav'
      const timestamp = Date.now()
      return {
        kind: 'media',
        mediaType: 'audio',
        url: `data:${mimeType};base64,${data.audio}`,
        mimeType,
        filename: `music-${timestamp}.${config.outputFormat}`,
        durationSeconds: config.durationSeconds,
      }
    }

    return {
      kind: 'async',
      taskId,
      pollIntervalMs: 5_000,
      maxWaitMs: 3 * 60 * 1000,
      statusMessage: `Music generation in progress (${data.status ?? 'processing'})...`,
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
