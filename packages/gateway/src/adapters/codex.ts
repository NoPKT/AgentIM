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

  /**
   * Ensure a thread exists. On first call, starts a new thread because the
   * Codex SDK only provides the threadId via the 'thread.started' event
   * emitted during the first runStreamed() call. After that, threadId is
   * captured and subsequent calls (e.g. after stop()) will use resumeThread()
   * to continue the same conversation.
   *
   * Limitation: the SDK does not support pre-setting a threadId before the
   * first query, so true cross-process session resumption is not possible
   * unless the caller persists and injects threadId externally.
   */
  private async ensureThread() {
    await this.ensureCodex()
    if (!this.thread) {
      // Codex SDK limitation: the SDK does not expose a permission-request callback
      // or event in its streaming API. The only control is `approvalPolicy`:
      //   - 'never' = auto-approve all tool executions (bypass mode)
      //   - 'on-request' = SDK prompts for approval interactively (stdin-based)
      //
      // Unlike OpenCode (which emits 'permission.updated' SSE events that we relay
      // through AgentIM's permission system), the Codex SDK manages permissions
      // internally. In daemon mode this means 'on-request' may block on stdin —
      // callers should use 'bypass' permission level for headless operation.
      //
      // This cannot be fixed without upstream SDK changes (exposing a callback or
      // event for permission requests). Tracked as a known limitation.
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
    this.isRunning = false
    // Codex SDK doesn't expose a cancellation API on the Thread object,
    // so we discard the current thread to prevent further event processing.
    // threadId is preserved so ensureThread() can resume the conversation.
    this.thread = undefined
  }

  dispose() {
    this.isRunning = false
    this.thread = undefined
    this.threadId = undefined
    this.codex = undefined
  }
}
