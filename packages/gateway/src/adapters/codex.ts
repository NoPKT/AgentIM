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

// Prompt-based permission simulation for daemon mode.
// The Codex SDK does not expose a permission-request callback (unlike Claude Code's
// canUseTool), so we instruct the model itself to ask for approval before executing
// dangerous operations. The agentic loop naturally pauses: the model outputs a
// plan description (text turn), the user responds, and the model proceeds or stops.
const CODEX_PERMISSION_PREAMBLE = [
  '[AgentIM Permission Policy]',
  'Before executing any of the following operations, you MUST first describe your',
  'complete plan in a text message and wait for the user to approve:',
  '- Modifying, creating, or deleting files',
  '- Running shell commands that change system state (install, build, deploy, git push)',
  '- Accessing external services or APIs',
  '',
  'Workflow: (1) Describe exactly what you plan to do, (2) End your message and',
  'wait for the user to reply with approval, (3) Only execute after receiving',
  'explicit approval. If the user declines, suggest alternatives without executing.',
  '',
  'Read-only operations (reading files, searching, listing) do not require approval.',
].join('\n')

export class CodexAdapter extends BaseAgentAdapter {
  private codex?: Codex
  private thread?: Thread
  private threadId?: string | null
  /** Whether prompt-based permission simulation is active for this adapter. */
  private readonly promptPermission: boolean

  constructor(opts: AdapterOptions) {
    super(opts)
    // Enable prompt-based permissions when interactive mode is requested but the
    // SDK cannot support it natively (i.e. daemon mode / no TTY).
    this.promptPermission = this.permissionLevel === 'interactive' && !process.stdin.isTTY
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
      // Codex SDK limitation: no permission-request callback or event in its API.
      // The only control is `approvalPolicy`:
      //   - 'never'      = auto-approve all tool executions
      //   - 'on-request' = SDK prompts interactively via stdin (TTY only)
      //
      // In daemon mode (no TTY), 'on-request' blocks indefinitely on stdin, so we
      // always fall back to 'never'. To compensate, prompt-based permission
      // simulation injects instructions into the model prompt that make the AI ask
      // for user approval through the chat before executing dangerous operations.
      const isDaemonMode = !process.stdin.isTTY
      const approvalPolicy =
        this.permissionLevel === 'bypass' || isDaemonMode ? 'never' : 'on-request'
      if (isDaemonMode && this.permissionLevel !== 'bypass') {
        if (this.promptPermission) {
          log.info(
            [
              '',
              '╔══════════════════════════════════════════════════════════════════╗',
              '║  ℹ  CODEX DAEMON MODE — PROMPT-BASED PERMISSION ACTIVE         ║',
              '╠══════════════════════════════════════════════════════════════════╣',
              '║  No TTY detected. The Codex SDK auto-approves tool executions   ║',
              '║  (approvalPolicy="never"), but prompt-based permission is       ║',
              '║  enabled: the model is instructed to describe its plan and wait  ║',
              '║  for your approval before executing operations.                 ║',
              '║                                                                 ║',
              '║  Note: This is a soft safeguard — the model generally follows   ║',
              '║  the instruction but compliance is not guaranteed by the SDK.   ║',
              '╚══════════════════════════════════════════════════════════════════╝',
              '',
            ].join('\n'),
          )
        } else {
          log.warn(
            [
              '',
              '╔══════════════════════════════════════════════════════════════════╗',
              '║  ⚠  CODEX DAEMON MODE — AUTO-APPROVE ENABLED                   ║',
              '╠══════════════════════════════════════════════════════════════════╣',
              '║  No TTY detected. The Codex SDK requires interactive stdin for  ║',
              '║  permission prompts, so approvalPolicy has been set to "never"  ║',
              '║  (all tool executions will be auto-approved).                   ║',
              '║                                                                 ║',
              '║  To suppress this warning, launch the gateway with:             ║',
              '║    --permission-level bypass                                    ║',
              '╚══════════════════════════════════════════════════════════════════╝',
              '',
            ].join('\n'),
          )
        }
      }
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

  /**
   * Override buildPrompt to inject the permission preamble when prompt-based
   * permission simulation is active. The preamble instructs the model to
   * describe its plan and wait for user approval before executing operations.
   */
  protected override buildPrompt(content: string, context?: MessageContext): string {
    const base = super.buildPrompt(content, context)
    if (!this.promptPermission) return base
    // Prepend the permission preamble so it appears as a system-level instruction
    return `${CODEX_PERMISSION_PREAMBLE}\n\n${base}`
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
        // In daemon mode with interactive permission level, the model is prompted
        // to describe its plan and wait for user approval (see CODEX_PERMISSION_PREAMBLE).

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

  override getSlashCommands(): Array<{
    name: string
    description: string
    usage: string
    source: 'builtin' | 'skill'
  }> {
    return [
      {
        name: 'clear',
        description: 'Reset conversation thread',
        usage: '/clear',
        source: 'builtin',
      },
    ]
  }

  override async handleSlashCommand(
    command: string,
    _args: string,
  ): Promise<{ success: boolean; message?: string }> {
    if (command === 'clear') {
      this.thread = undefined
      this.threadId = undefined
      return { success: true, message: 'Thread cleared' }
    }
    return { success: false, message: `Unknown command: ${command}` }
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
