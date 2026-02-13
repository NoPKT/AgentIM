export { BaseAgentAdapter } from './base.js'
export { ClaudeCodeAdapter } from './claude-code.js'
export { CodexAdapter } from './codex.js'
export { GeminiAdapter } from './gemini.js'
export { CursorAdapter } from './cursor.js'
export { GenericAdapter, type GenericAdapterOptions } from './generic.js'

import type { AdapterOptions } from './base.js'
import { ClaudeCodeAdapter } from './claude-code.js'
import { CodexAdapter } from './codex.js'
import { GeminiAdapter } from './gemini.js'
import { CursorAdapter } from './cursor.js'
import { GenericAdapter } from './generic.js'
import type { BaseAgentAdapter } from './base.js'

export function createAdapter(type: string, opts: AdapterOptions & { command?: string; args?: string[] }): BaseAgentAdapter {
  switch (type) {
    case 'claude-code':
      return new ClaudeCodeAdapter(opts)
    case 'codex':
      return new CodexAdapter(opts)
    case 'gemini':
      return new GeminiAdapter(opts)
    case 'cursor':
      return new CursorAdapter(opts)
    case 'generic':
      return new GenericAdapter({ ...opts, command: opts.command ?? 'echo' })
    default:
      throw new Error(`Unknown adapter type: ${type}`)
  }
}
