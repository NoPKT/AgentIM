import type { ParsedChunk } from '@agentim/shared'
import {
  BaseAgentAdapter,
  type AdapterOptions,
  type ChunkCallback,
  type CompleteCallback,
  type ErrorCallback,
  type MessageContext,
} from './base.js'
import { createLogger } from '../lib/logger.js'
import type { Codex, Thread, ThreadItem } from '@openai/codex-sdk'

const log = createLogger('Codex')

export class CodexAdapter extends BaseAgentAdapter {
  private codex?: Codex
  private thread?: Thread
  private threadId?: string | null

  constructor(opts: AdapterOptions) {
    super(opts)
  }

  get type() {
    return 'codex' as const
  }

  private async ensureCodex() {
    if (!this.codex) {
      const { Codex: CodexClass } = await import('@openai/codex-sdk')
      this.codex = new CodexClass({
        apiKey: this.env.OPENAI_API_KEY || this.env.CODEX_API_KEY || undefined,
        baseUrl: this.env.OPENAI_BASE_URL || undefined,
      })
    }
  }

  private async ensureThread() {
    await this.ensureCodex()
    if (!this.thread) {
      const approvalPolicy = this.permissionLevel === 'bypass' ? 'never' : 'on-request'
      if (this.threadId) {
        this.thread = this.codex!.resumeThread(this.threadId)
        log.info(`Resumed Codex thread: ${this.threadId}`)
      } else {
        this.thread = this.codex!.startThread({
          workingDirectory: this.workingDirectory,
          approvalPolicy,
        })
        log.info(`Started new Codex thread (approvalPolicy=${approvalPolicy})`)
      }
    }
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
      await this.ensureThread()
      const prompt = this.buildPrompt(content, context)
      const { events } = await this.thread!.runStreamed(prompt)

      for await (const event of events) {
        // Capture thread ID
        if (event.type === 'thread.started') {
          this.threadId = event.thread_id
          log.info(`Codex thread ID: ${this.threadId}`)
          continue
        }

        // Note: Codex SDK handles permissions via approvalPolicy parameter.
        // Interactive approval is managed internally by the SDK.

        if (event.type === 'item.completed') {
          const chunks = this.mapItemToChunks(event.item)
          for (const chunk of chunks) {
            if (chunk.type === 'text') fullContent += chunk.content
            onChunk(chunk)
          }
        }

        if (event.type === 'turn.failed') {
          this.isRunning = false
          onError(event.error.message)
          return
        }

        if (event.type === 'error') {
          this.isRunning = false
          onError(event.message)
          return
        }
      }

      this.isRunning = false
      onComplete(fullContent)
    } catch (err: unknown) {
      this.isRunning = false
      const msg = err instanceof Error ? err.message : String(err)
      log.error(`Codex SDK error: ${msg}`)
      onError(msg)
    }
  }

  private mapItemToChunks(item: ThreadItem): ParsedChunk[] {
    switch (item.type) {
      case 'agent_message':
        return [{ type: 'text', content: item.text }]
      case 'reasoning':
        return [{ type: 'thinking', content: item.text }]
      case 'command_execution':
        return [
          {
            type: 'tool_use',
            content: `$ ${item.command}\n${item.aggregated_output}`,
            metadata: { toolName: 'command', toolId: item.id },
          },
        ]
      case 'file_change':
        return [
          {
            type: 'tool_result',
            content: item.changes.map((c) => `${c.kind}: ${c.path}`).join('\n'),
            metadata: { toolId: item.id },
          },
        ]
      case 'mcp_tool_call':
        return [
          {
            type: 'tool_use',
            content: JSON.stringify(
              { server: item.server, tool: item.tool, arguments: item.arguments },
              null,
              2,
            ),
            metadata: { toolName: `${item.server}:${item.tool}`, toolId: item.id },
          },
        ]
      case 'web_search':
        return [
          {
            type: 'tool_use',
            content: `Web search: ${item.query}`,
            metadata: { toolName: 'web_search', toolId: item.id },
          },
        ]
      case 'error':
        return [{ type: 'error', content: item.message }]
      case 'todo_list':
        return [
          {
            type: 'text',
            content: item.items.map((t) => `${t.completed ? '✅' : '⬜'} ${t.text}`).join('\n'),
          },
        ]
      default:
        return []
    }
  }

  stop() {
    log.info('Codex stop requested')
  }

  dispose() {
    this.thread = undefined
    this.threadId = undefined
    this.codex = undefined
  }
}
