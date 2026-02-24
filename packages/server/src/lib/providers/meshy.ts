import { z } from 'zod'
import type { ServiceAgentProvider, ProviderRequest, ProviderResult } from './types.js'

const configSchema = z.object({
  apiKey: z.string().min(1),
  artStyle: z.enum(['realistic', 'cartoon', 'low-poly', 'sculpture', 'pbr']).default('realistic'),
  topology: z.enum(['quad', 'triangle']).default('quad'),
  targetPolycount: z.number().int().min(100).max(200_000).default(30_000),
})

type Config = z.infer<typeof configSchema>

const BASE_URL = 'https://api.meshy.ai/openapi/v2'

export const meshyProvider: ServiceAgentProvider = {
  meta: {
    type: 'meshy',
    displayName: 'Meshy 3D Generation',
    category: '3d',
    configSchema,
    description: 'Generate 3D models from text prompts via Meshy API',
  },

  async invoke(rawConfig: unknown, request: ProviderRequest): Promise<ProviderResult> {
    const config = configSchema.parse(rawConfig) as Config

    const response = await fetch(`${BASE_URL}/text-to-3d`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        mode: 'preview',
        prompt: request.prompt,
        art_style: config.artStyle,
        topology: config.topology,
        target_polycount: config.targetPolycount,
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error')
      throw new Error(`Meshy API error (${response.status}): ${errorText}`)
    }

    const data = (await response.json()) as { result?: string }

    if (!data.result) {
      throw new Error('Meshy API returned no task ID')
    }

    return {
      kind: 'async',
      taskId: data.result,
      pollIntervalMs: 10_000,
      maxWaitMs: 10 * 60 * 1000, // 10 minutes
      statusMessage: 'Generating 3D model... This may take 1-5 minutes.',
    }
  },

  async poll(rawConfig: unknown, taskId: string): Promise<ProviderResult> {
    const config = configSchema.parse(rawConfig) as Config

    const response = await fetch(`${BASE_URL}/text-to-3d/${taskId}`, {
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
      signal: AbortSignal.timeout(15_000),
    })

    if (!response.ok) {
      throw new Error(`Meshy poll error (${response.status})`)
    }

    const data = (await response.json()) as {
      status?: string
      model_urls?: { glb?: string; fbx?: string; obj?: string }
      thumbnail_url?: string
      task_error?: { message?: string }
    }

    if (data.status === 'FAILED') {
      throw new Error(`Meshy generation failed: ${data.task_error?.message ?? 'unknown'}`)
    }

    if (data.status === 'SUCCEEDED' && data.model_urls?.glb) {
      const timestamp = Date.now()
      return {
        kind: 'media',
        mediaType: '3d-model',
        url: data.model_urls.glb,
        mimeType: 'model/gltf-binary',
        filename: `model-${timestamp}.glb`,
        metadata: {
          thumbnailUrl: data.thumbnail_url,
          formats: data.model_urls,
        },
      }
    }

    return {
      kind: 'async',
      taskId,
      pollIntervalMs: 10_000,
      maxWaitMs: 10 * 60 * 1000,
      statusMessage: `3D model generation in progress (${data.status ?? 'processing'})...`,
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
