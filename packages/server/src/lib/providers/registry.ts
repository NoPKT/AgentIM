import type { ServiceAgentCategory } from '@agentim/shared'
import type { ServiceAgentProvider, ProviderMeta } from './types.js'
import { openaiChatProvider } from './openai-chat.js'
import { perplexityProvider } from './perplexity.js'
import { openaiImageProvider } from './openai-image.js'
import { elevenlabsProvider } from './elevenlabs.js'
import { runwayProvider } from './runway.js'
import { stabilityAudioProvider } from './stability-audio.js'
import { meshyProvider } from './meshy.js'

const providers = new Map<string, ServiceAgentProvider>()

export function registerProvider(provider: ServiceAgentProvider): void {
  providers.set(provider.meta.type, provider)
}

export function getProvider(type: string): ServiceAgentProvider | undefined {
  return providers.get(type)
}

export function listProviders(): ProviderMeta[] {
  return Array.from(providers.values()).map((p) => p.meta)
}

export function getProvidersByCategory(category: ServiceAgentCategory): ProviderMeta[] {
  return Array.from(providers.values())
    .filter((p) => p.meta.category === category)
    .map((p) => p.meta)
}

// Register all built-in providers
registerProvider(openaiChatProvider)
registerProvider(perplexityProvider)
registerProvider(openaiImageProvider)
registerProvider(elevenlabsProvider)
registerProvider(runwayProvider)
registerProvider(stabilityAudioProvider)
registerProvider(meshyProvider)
