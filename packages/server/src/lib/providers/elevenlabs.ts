import { z } from 'zod'
import type { ServiceAgentProvider, ProviderRequest, ProviderResult } from './types.js'

const configSchema = z.object({
  apiKey: z.string().min(1),
  voiceId: z.string().min(1).default('21m00Tcm4TlvDq8ikWAM'), // Rachel
  modelId: z.string().min(1).default('eleven_multilingual_v2'),
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
  outputFormat: z
    .enum(['mp3_44100_128', 'mp3_22050_32', 'pcm_16000', 'pcm_24000'])
    .default('mp3_44100_128'),
})

type Config = z.infer<typeof configSchema>

export const elevenlabsProvider: ServiceAgentProvider = {
  meta: {
    type: 'elevenlabs',
    displayName: 'ElevenLabs Text-to-Speech',
    category: 'audio',
    configSchema,
    description: 'Convert text to natural-sounding speech via ElevenLabs',
  },

  async invoke(rawConfig: unknown, request: ProviderRequest): Promise<ProviderResult> {
    const config = configSchema.parse(rawConfig) as Config

    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${config.voiceId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': config.apiKey,
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text: request.prompt,
        model_id: config.modelId,
        voice_settings: {
          stability: config.stability,
          similarity_boost: config.similarityBoost,
        },
        output_format: config.outputFormat,
      }),
      signal: AbortSignal.timeout(60_000),
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error')
      throw new Error(`ElevenLabs API error (${response.status}): ${errorText}`)
    }

    // ElevenLabs returns raw audio bytes. Convert to a blob URL for internal handling.
    const audioBuffer = await response.arrayBuffer()
    const base64 = Buffer.from(audioBuffer).toString('base64')
    const mimeType = config.outputFormat.startsWith('mp3') ? 'audio/mpeg' : 'audio/wav'
    const ext = config.outputFormat.startsWith('mp3') ? 'mp3' : 'wav'
    const timestamp = Date.now()

    return {
      kind: 'media',
      mediaType: 'audio',
      url: `data:${mimeType};base64,${base64}`,
      mimeType,
      filename: `speech-${timestamp}.${ext}`,
      caption: request.prompt.slice(0, 200),
    }
  },

  async validateConfig(rawConfig: unknown) {
    try {
      const config = configSchema.parse(rawConfig) as Config
      const response = await fetch('https://api.elevenlabs.io/v1/voices', {
        headers: { 'xi-api-key': config.apiKey },
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
