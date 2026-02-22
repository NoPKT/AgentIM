import {
  BaseAgentAdapter,
  type ChunkCallback,
  type CompleteCallback,
  type ErrorCallback,
  type MessageContext,
} from './base.js'

// Set to true once @google/gemini-cli-sdk is published to npm
const GEMINI_SDK_AVAILABLE = false

/**
 * Gemini adapter — SDK skeleton.
 * Will be activated once @google/gemini-cli-sdk is published to npm.
 */
export class GeminiAdapter extends BaseAgentAdapter {
  get type() {
    return 'gemini' as const
  }

  sendMessage(
    _content: string,
    _onChunk: ChunkCallback,
    _onComplete: CompleteCallback,
    onError: ErrorCallback,
    _context?: MessageContext,
  ) {
    if (!GEMINI_SDK_AVAILABLE) {
      onError(
        'Gemini SDK (@google/gemini-cli-sdk) is not yet published to npm. ' +
          'Gemini agent support will be enabled once the SDK is available. ' +
          'Follow https://github.com/anthropics/AgentIM for updates.',
      )
      return
    }

    // SDK mode code — to be enabled when GEMINI_SDK_AVAILABLE is set to true
    // const { GeminiCli } = await import('@google/gemini-cli-sdk')
    // ...
  }

  stop() {
    // No-op: SDK not yet available
  }

  dispose() {
    // No-op: SDK not yet available
  }
}
