import { writeDaemonStatus, removeDaemonStatus } from './daemon-manager.js'
import type { DaemonStatus } from './daemon-manager.js'
import type { BaseAgentAdapter } from '../adapters/index.js'
import { createLogger } from './logger.js'

const log = createLogger('StatusWriter')

const STATUS_INTERVAL_MS = 30_000

/**
 * Periodically writes daemon runtime status to disk so the TUI can read it.
 *
 * Wrapper mode: writes one `<name>.status.json` for the single agent.
 * Gateway mode: writes per-agent status files + a gateway-level entry.
 */
export class StatusWriter {
  private timer: ReturnType<typeof setInterval> | null = null
  private daemonName: string
  private adapters: ReadonlyMap<string, BaseAgentAdapter>

  constructor(daemonName: string, adapters: ReadonlyMap<string, BaseAgentAdapter>) {
    this.daemonName = daemonName
    this.adapters = adapters
  }

  start(): void {
    this.writeNow()
    this.timer = setInterval(() => this.writeNow(), STATUS_INTERVAL_MS)
    this.timer.unref()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    // Clean up status files
    removeDaemonStatus(this.daemonName)
    for (const [, adapter] of this.adapters) {
      removeDaemonStatus(adapter.agentName)
    }
  }

  writeNow(): void {
    try {
      if (this.adapters.size === 0) {
        // Gateway with no agents yet — write a simple online status
        const status: DaemonStatus = {
          costUSD: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          running: true,
          updatedAt: new Date().toISOString(),
        }
        writeDaemonStatus(this.daemonName, status)
        return
      }

      // Write per-agent status files
      for (const [agentId, adapter] of this.adapters) {
        const cost = adapter.getCostSummary()
        const status: DaemonStatus = {
          agentId,
          model: adapter.getModel(),
          costUSD: cost.costUSD,
          inputTokens: cost.inputTokens,
          outputTokens: cost.outputTokens,
          cacheReadTokens: cost.cacheReadTokens,
          thinkingMode: adapter.getThinkingMode(),
          effortLevel: adapter.getEffortLevel(),
          planMode: adapter.getPlanMode() || undefined,
          running: adapter.running,
          updatedAt: new Date().toISOString(),
        }
        writeDaemonStatus(adapter.agentName, status)
      }
    } catch (err) {
      log.warn(`Failed to write status: ${err instanceof Error ? err.message : err}`)
    }
  }
}
