import type { ParsedChunk } from '@agentim/shared'
import { PERMISSION_TIMEOUT_MS } from '@agentim/shared'
import {
  BaseAgentAdapter,
  type AdapterOptions,
  type ChunkCallback,
  type CompleteCallback,
  type ErrorCallback,
  type MessageContext,
} from './base.js'
import { createLogger } from '../lib/logger.js'
import type {
  Query,
  SDKMessage,
  SDKSystemMessage,
  SDKAssistantMessage,
  SDKResultMessage,
  SDKPartialAssistantMessage,
  Options,
} from '@anthropic-ai/claude-agent-sdk'

const log = createLogger('ClaudeCode')

// Cache the dynamically imported query function to avoid repeated import() calls
let _cachedQueryFn: (typeof import('@anthropic-ai/claude-agent-sdk'))['query'] | null = null

export class ClaudeCodeAdapter extends BaseAgentAdapter {
  private sessionId?: string
  private currentQuery?: Query

  constructor(opts: AdapterOptions) {
    super(opts)
  }

  get type() {
    return 'claude-code' as const
  }

  async sendMessage(
    content: string,
    onChunk: ChunkCallback,
    onComplete: CompleteCallback,
    onError: ErrorCallback,
    context?: MessageContext,
  ) {
    if (this.isRunning) {
      onError('Agent is already processing a message')
      return
    }

    this.isRunning = true
    let fullContent = ''

    try {
      if (!_cachedQueryFn) {
        const mod = await import('@anthropic-ai/claude-agent-sdk')
        _cachedQueryFn = mod.query
      }
      const query = _cachedQueryFn

      const options: Options = {
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
        cwd: this.workingDirectory,
        env: Object.keys(this.env).length > 0 ? this.env : undefined,
      }

      if (this.permissionLevel === 'bypass') {
        options.permissionMode = 'bypassPermissions'
        options.allowDangerouslySkipPermissions = true
      } else {
        options.permissionMode = 'default'
        if (this.onPermissionRequest) {
          const requestPermission = this.onPermissionRequest
          options.canUseTool = async (toolName: string, toolInput: Record<string, unknown>) => {
            const { nanoid } = await import('nanoid')
            const requestId = nanoid()
            const result = await requestPermission({
              requestId,
              toolName,
              toolInput,
              timeoutMs: PERMISSION_TIMEOUT_MS,
            })
            if (result.behavior === 'allow') {
              return { behavior: 'allow' as const }
            }
            return { behavior: 'deny' as const, message: 'Permission denied by user' }
          }
        }
      }

      if (this.sessionId) {
        options.resume = this.sessionId
      }

      // systemPrompt is included by buildPrompt() via [System: ...] prefix,
      // so we do NOT set options.systemPrompt to avoid double injection.
      const prompt = this.buildPrompt(content, context)

      const response = query({ prompt, options })
      this.currentQuery = response

      for await (const message of response) {
        this.processMessage(message, onChunk, (text) => {
          fullContent += text
        })
      }

      this.isRunning = false
      this.currentQuery = undefined
      onComplete(fullContent)
    } catch (err: unknown) {
      this.isRunning = false
      this.currentQuery = undefined
      if ((err as Error).name === 'AbortError') {
        onComplete(fullContent || 'Interrupted')
      } else {
        const msg = err instanceof Error ? err.message : String(err)
        log.error(`ClaudeCode SDK error: ${msg}`)
        onError(msg)
      }
    }
  }

  private processMessage(
    message: SDKMessage,
    onChunk: ChunkCallback,
    appendText: (text: string) => void,
  ) {
    // Capture session ID from init message
    if (message.type === 'system' && 'subtype' in message && message.subtype === 'init') {
      const initMsg = message as SDKSystemMessage
      this.sessionId = initMsg.session_id
      log.info(`Session started: ${this.sessionId}`)
      return
    }

    // Process assistant messages with content blocks
    if (message.type === 'assistant') {
      const assistantMsg = message as SDKAssistantMessage
      if (assistantMsg.message?.content) {
        for (const block of assistantMsg.message.content) {
          const chunks = this.mapBlockToChunks(block)
          for (const chunk of chunks) {
            if (chunk.type === 'text') appendText(chunk.content)
            onChunk(chunk)
          }
        }
      }
      return
    }

    // Process streaming events for incremental text
    if (message.type === 'stream_event') {
      const streamMsg = message as SDKPartialAssistantMessage
      const event = streamMsg.event
      if ('delta' in event) {
        const delta = (event as { delta?: { type?: string; text?: string; thinking?: string } })
          .delta
        if (delta?.type === 'text_delta' && delta.text) {
          appendText(delta.text)
          onChunk({ type: 'text', content: delta.text })
        } else if (delta?.type === 'thinking_delta' && delta.thinking) {
          onChunk({ type: 'thinking', content: delta.thinking })
        }
      }
      return
    }

    // Extract result
    if (message.type === 'result') {
      const resultMsg = message as SDKResultMessage
      if ('result' in resultMsg && resultMsg.subtype === 'success') {
        // Result text is already accumulated from assistant messages
      }
      return
    }
  }

  private mapBlockToChunks(block: {
    type: string
    text?: string
    thinking?: string
    name?: string
    id?: string
    content?: unknown
    tool_use_id?: string
    input?: unknown
  }): ParsedChunk[] {
    switch (block.type) {
      case 'text':
        return [{ type: 'text', content: block.text ?? '' }]
      case 'thinking':
        return [{ type: 'thinking', content: block.thinking ?? '' }]
      case 'tool_use':
        return [
          {
            type: 'tool_use',
            content: JSON.stringify(
              { name: block.name, id: block.id, input: block.input },
              null,
              2,
            ),
            metadata: { toolName: block.name, toolId: block.id },
          },
        ]
      case 'tool_result':
        return [
          {
            type: 'tool_result',
            content:
              typeof block.content === 'string' ? block.content : JSON.stringify(block.content),
            metadata: { toolId: block.tool_use_id },
          },
        ]
      default:
        return []
    }
  }

  override getSlashCommands(): Array<{
    name: string
    description: string
    usage: string
    source: 'builtin' | 'skill'
  }> {
    const commands: Array<{
      name: string
      description: string
      usage: string
      source: 'builtin' | 'skill'
    }> = [
      {
        name: 'clear',
        description: 'Reset conversation session',
        usage: '/clear',
        source: 'builtin',
      },
      {
        name: 'compact',
        description: 'Compact conversation and reset session',
        usage: '/compact',
        source: 'builtin',
      },
    ]

    // Discover custom slash commands from .claude/commands/
    if (this.workingDirectory) {
      try {
        const { readdirSync } = require('fs')
        const { join } = require('path')
        const commandsDir = join(this.workingDirectory, '.claude', 'commands')
        const files: string[] = readdirSync(commandsDir).filter((f: string) => f.endsWith('.md'))
        for (const file of files) {
          const name = file.replace(/\.md$/, '')
          commands.push({
            name,
            description: `Custom command from .claude/commands/${file}`,
            usage: `/${name}`,
            source: 'skill',
          })
        }
      } catch {
        // Directory doesn't exist or not readable — skip
      }
    }

    return commands
  }

  override getMcpServers(): string[] {
    if (!this.workingDirectory) return []

    const { existsSync, readFileSync } = require('fs')
    const { join } = require('path')

    // Try .claude/settings.json first, then .claude.json
    const candidates = [
      join(this.workingDirectory, '.claude', 'settings.json'),
      join(this.workingDirectory, '.claude.json'),
    ]

    for (const filePath of candidates) {
      try {
        if (!existsSync(filePath)) continue
        const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
        const mcpServers = raw?.mcpServers
        if (mcpServers && typeof mcpServers === 'object') {
          return Object.keys(mcpServers)
        }
      } catch {
        // Malformed JSON or unreadable — skip
      }
    }

    return []
  }

  override getModel(): string | undefined {
    return this.env.ANTHROPIC_MODEL || this.env.CLAUDE_MODEL || undefined
  }

  override async handleSlashCommand(
    command: string,
    _args: string,
  ): Promise<{ success: boolean; message?: string }> {
    if (command === 'clear') {
      this.sessionId = undefined
      return { success: true, message: 'Session cleared' }
    }
    if (command === 'compact') {
      this.sessionId = undefined
      return { success: true, message: 'Session compacted (reset)' }
    }
    return { success: false, message: `Unknown command: ${command}` }
  }

  stop() {
    this.currentQuery?.interrupt()
    this.currentQuery = undefined
    this.sessionId = undefined
  }

  dispose() {
    this.currentQuery?.close()
    this.currentQuery = undefined
    this.sessionId = undefined
  }
}
