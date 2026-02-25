export { BaseAgentAdapter, type PermissionRequestCallback } from './base.js'
export { SpawnAgentAdapter, getSafeEnv } from './spawn-base.js'
export { ClaudeCodeAdapter } from './claude-code.js'
export { CodexAdapter } from './codex.js'
export { GeminiAdapter } from './gemini.js'
export { OpenCodeAdapter } from './opencode.js'
export { GenericAdapter, type GenericAdapterOptions } from './generic.js'

import type { AdapterOptions } from './base.js'
import { ClaudeCodeAdapter } from './claude-code.js'
import { CodexAdapter } from './codex.js'
import { GeminiAdapter } from './gemini.js'
import { OpenCodeAdapter } from './opencode.js'
import { GenericAdapter } from './generic.js'
import type { BaseAgentAdapter } from './base.js'
import { getCustomAdapter, getCustomAdaptersPath } from '../custom-adapters.js'

export function createAdapter(
  type: string,
  opts: AdapterOptions & { command?: string; args?: string[]; promptVia?: 'arg' | 'stdin' },
): BaseAgentAdapter {
  switch (type) {
    case 'claude-code':
      return new ClaudeCodeAdapter(opts)
    case 'codex':
      return new CodexAdapter(opts)
    case 'gemini':
      return new GeminiAdapter(opts)
    case 'opencode':
      return new OpenCodeAdapter(opts)
    case 'generic':
      return new GenericAdapter({
        ...opts,
        command: opts.command ?? 'echo',
        promptVia: opts.promptVia,
      })
    default: {
      const custom = getCustomAdapter(type)
      if (custom) {
        return new GenericAdapter({
          ...opts,
          command: custom.command,
          args: custom.args,
          promptVia: custom.promptVia,
          env: { ...custom.env, ...opts.env },
        })
      }
      throw new Error(
        `Unknown adapter type: ${type}. Check your custom adapters config at ${getCustomAdaptersPath()}`,
      )
    }
  }
}
