import { existsSync, readFileSync, readdirSync } from 'fs'
import { homedir } from 'node:os'
import { dirname, join } from 'path'
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

  // Runtime settings configurable via slash commands
  private thinkingConfig?:
    | { type: 'adaptive' }
    | { type: 'enabled'; budgetTokens?: number }
    | { type: 'disabled' }
  private effort?: 'low' | 'medium' | 'high' | 'max'
  private modelOverride?: string
  private lastModelUsage?: Record<
    string,
    {
      contextWindow: number
      maxOutputTokens: number
      costUSD: number
      inputTokens: number
      outputTokens: number
      cacheReadInputTokens: number
    }
  >

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

      // Ensure PATH includes the current node binary's directory so the SDK
      // can spawn `node` even when running as a daemon with a minimal PATH.
      const nodeDir = dirname(process.execPath)
      const currentPath = process.env.PATH || ''
      const env = {
        ...process.env,
        ...this.env,
        ...(currentPath.includes(nodeDir) ? {} : { PATH: `${nodeDir}:${currentPath}` }),
      }

      const options: Options = {
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
        cwd: this.workingDirectory,
        env,
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

      // Apply runtime settings from slash commands
      if (this.thinkingConfig) options.thinking = this.thinkingConfig
      if (this.effort) options.effort = this.effort
      if (this.modelOverride) options.model = this.modelOverride

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

    // Extract result — accumulate cost and token usage
    if (message.type === 'result') {
      const resultMsg = message as SDKResultMessage
      if (resultMsg.subtype === 'success') {
        this.accumulatedCostUSD += resultMsg.total_cost_usd ?? 0
        if (resultMsg.usage) {
          this.accumulatedInputTokens += resultMsg.usage.input_tokens ?? 0
          this.accumulatedOutputTokens += resultMsg.usage.output_tokens ?? 0
        }
        if (resultMsg.modelUsage) {
          this.lastModelUsage = {}
          for (const [model, usage] of Object.entries(resultMsg.modelUsage)) {
            this.lastModelUsage[model] = {
              contextWindow: usage.contextWindow,
              maxOutputTokens: usage.maxOutputTokens,
              costUSD: usage.costUSD,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              cacheReadInputTokens: usage.cacheReadInputTokens,
            }
            this.accumulatedCacheReadTokens += usage.cacheReadInputTokens ?? 0
          }
        }
      } else {
        // Error results still have cost data
        this.accumulatedCostUSD += resultMsg.total_cost_usd ?? 0
        if (resultMsg.usage) {
          this.accumulatedInputTokens += resultMsg.usage.input_tokens ?? 0
          this.accumulatedOutputTokens += resultMsg.usage.output_tokens ?? 0
        }
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
      {
        name: 'model',
        description: 'Switch model or list available models',
        usage: '/model [name]',
        source: 'builtin',
      },
      {
        name: 'think',
        description: 'Set thinking mode: adaptive, enabled[:budget], disabled',
        usage: '/think [mode]',
        source: 'builtin',
      },
      {
        name: 'effort',
        description: 'Set effort level: low, medium, high, max',
        usage: '/effort [level]',
        source: 'builtin',
      },
      {
        name: 'cost',
        description: 'Show accumulated cost and token usage',
        usage: '/cost',
        source: 'builtin',
      },
      {
        name: 'context',
        description: 'Show context window and model info',
        usage: '/context',
        source: 'builtin',
      },
    ]

    // Discover custom slash commands from .claude/commands/
    if (this.workingDirectory) {
      try {
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
    // Project-level configs take precedence, then global configs
    const candidates = [
      ...(this.workingDirectory
        ? [
            join(this.workingDirectory, '.claude', 'settings.json'),
            join(this.workingDirectory, '.claude.json'),
          ]
        : []),
      join(homedir(), '.claude', 'settings.json'),
      join(homedir(), '.claude.json'),
    ]

    // Merge MCP servers from all config files
    const allServers = new Set<string>()
    for (const filePath of candidates) {
      try {
        if (!existsSync(filePath)) continue
        const raw = JSON.parse(readFileSync(filePath, 'utf-8'))
        const mcpServers = raw?.mcpServers
        if (mcpServers && typeof mcpServers === 'object') {
          for (const key of Object.keys(mcpServers)) {
            allServers.add(key)
          }
        }
      } catch {
        // Malformed JSON or unreadable — skip
      }
    }

    return Array.from(allServers)
  }

  override getModel(): string | undefined {
    return this.modelOverride || this.env.ANTHROPIC_MODEL || this.env.CLAUDE_MODEL || undefined
  }

  override getThinkingMode(): string | undefined {
    if (!this.thinkingConfig) return undefined
    if (this.thinkingConfig.type === 'enabled' && 'budgetTokens' in this.thinkingConfig) {
      return `enabled:${this.thinkingConfig.budgetTokens}`
    }
    return this.thinkingConfig.type
  }

  override getEffortLevel(): string | undefined {
    return this.effort
  }

  override async handleSlashCommand(
    command: string,
    args: string,
  ): Promise<{ success: boolean; message?: string }> {
    switch (command) {
      case 'clear': {
        this.sessionId = undefined
        return { success: true, message: 'Session cleared' }
      }
      case 'compact': {
        this.sessionId = undefined
        return { success: true, message: 'Session compacted (reset)' }
      }
      case 'model': {
        const name = args.trim()
        if (!name) {
          const current = this.getModel() ?? '(default)'
          return {
            success: true,
            message: `Current model: ${current}\nUse /model <name> to switch`,
          }
        }
        this.modelOverride = name
        return { success: true, message: `Model set to: ${name}` }
      }
      case 'think': {
        const mode = args.trim().toLowerCase()
        if (!mode) {
          const current = this.thinkingConfig
            ? this.thinkingConfig.type === 'enabled' && 'budgetTokens' in this.thinkingConfig
              ? `enabled (budget: ${this.thinkingConfig.budgetTokens})`
              : this.thinkingConfig.type
            : '(default)'
          return {
            success: true,
            message: `Thinking mode: ${current}\nOptions: adaptive, enabled[:budget], disabled`,
          }
        }
        if (mode === 'adaptive') {
          this.thinkingConfig = { type: 'adaptive' }
          return { success: true, message: 'Thinking set to: adaptive' }
        }
        if (mode === 'disabled' || mode === 'off') {
          this.thinkingConfig = { type: 'disabled' }
          return { success: true, message: 'Thinking set to: disabled' }
        }
        if (mode.startsWith('enabled') || mode.startsWith('on')) {
          const budgetMatch = mode.match(/:(\d+)/)
          if (budgetMatch) {
            this.thinkingConfig = { type: 'enabled', budgetTokens: parseInt(budgetMatch[1], 10) }
            return {
              success: true,
              message: `Thinking set to: enabled (budget: ${budgetMatch[1]} tokens)`,
            }
          }
          this.thinkingConfig = { type: 'enabled' }
          return { success: true, message: 'Thinking set to: enabled' }
        }
        return {
          success: false,
          message: `Unknown thinking mode: ${mode}\nOptions: adaptive, enabled[:budget], disabled`,
        }
      }
      case 'effort': {
        const level = args.trim().toLowerCase()
        if (!level) {
          return {
            success: true,
            message: `Effort level: ${this.effort ?? '(default)'}\nOptions: low, medium, high, max`,
          }
        }
        const valid = ['low', 'medium', 'high', 'max'] as const
        if (!valid.includes(level as (typeof valid)[number])) {
          return {
            success: false,
            message: `Invalid effort level: ${level}\nOptions: low, medium, high, max`,
          }
        }
        this.effort = level as 'low' | 'medium' | 'high' | 'max'
        return { success: true, message: `Effort set to: ${level}` }
      }
      case 'cost': {
        const summary = this.getCostSummary()
        const lines = [
          'Session Cost Summary',
          `  Cost:         $${summary.costUSD.toFixed(4)}`,
          `  Input tokens:  ${summary.inputTokens.toLocaleString()}`,
          `  Output tokens: ${summary.outputTokens.toLocaleString()}`,
          `  Cache read:    ${summary.cacheReadTokens.toLocaleString()}`,
        ]
        return { success: true, message: lines.join('\n') }
      }
      case 'context': {
        const lines: string[] = ['Context Info']
        const model = this.getModel()
        if (model) lines.push(`  Model: ${model}`)
        if (this.lastModelUsage) {
          for (const [modelName, usage] of Object.entries(this.lastModelUsage)) {
            lines.push(`  ${modelName}:`)
            lines.push(`    Context window:  ${usage.contextWindow.toLocaleString()}`)
            lines.push(`    Max output:      ${usage.maxOutputTokens.toLocaleString()}`)
            lines.push(`    Input tokens:    ${usage.inputTokens.toLocaleString()}`)
            lines.push(`    Output tokens:   ${usage.outputTokens.toLocaleString()}`)
            lines.push(`    Cost:            $${usage.costUSD.toFixed(4)}`)
          }
        } else {
          lines.push('  No model usage data yet (send a message first)')
        }
        return { success: true, message: lines.join('\n') }
      }
      default:
        return { success: false, message: `Unknown command: ${command}` }
    }
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
