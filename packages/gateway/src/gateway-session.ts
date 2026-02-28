import { loadConfig } from './config.js'
import { getDeviceInfo } from './device.js'
import { GatewayWsClient } from './ws-client.js'
import { AgentManager } from './agent-manager.js'
import { TokenManager } from './token-manager.js'
import { createLogger } from './lib/logger.js'
import type {
  PermissionLevel,
  ServerSendToAgent,
  ServerStopAgent,
  ServerRemoveAgent,
  ServerRoomContext,
  ServerPermissionResponse,
  ServerAgentCommand,
  ServerQueryAgentInfo,
  ServerSpawnAgent,
} from '@agentim/shared'
import { CURRENT_PROTOCOL_VERSION, WS_ERROR_CODES } from '@agentim/shared'

const log = createLogger('GatewaySession')

export interface GatewaySessionOptions {
  permissionLevel: PermissionLevel
  /** Called after successful authentication. Return value indicates whether agents were already registered. */
  onAuthenticated: (agentManager: AgentManager, isReconnect: boolean) => void
  /** Override config's gatewayId (ephemeral per session). */
  gatewayId?: string
  /** Exit process when all agents are removed. */
  exitOnEmpty?: boolean
}

/**
 * Shared gateway session logic used by both the daemon command and wrapper mode.
 *
 * Encapsulates:
 * - Token refresh with connectionId protection against stale callbacks
 * - Authentication message handling (gateway:auth → server:gateway_auth_result)
 * - Message dispatch to AgentManager
 * - Graceful shutdown with signal handlers
 */
export function createGatewaySession(opts: GatewaySessionOptions): {
  wsClient: GatewayWsClient
  agentManager: AgentManager
  start: () => void
  cleanup: () => Promise<void>
} {
  const config = loadConfig()
  if (!config) {
    console.error('Not logged in. Run `agentim login` first.')
    process.exit(1)
  }

  const tokenManager = new TokenManager(config)
  const deviceInfo = getDeviceInfo()
  // Use ephemeral gatewayId if provided, otherwise fall back to config
  const gatewayId = opts.gatewayId ?? config.gatewayId
  // AgentManager is initialized after wsClient is created (circular dependency)
  // eslint-disable-next-line prefer-const
  let agentManager: AgentManager
  let refreshingToken: Promise<void> | null = null
  // Track whether we already performed one token refresh this connection.
  // If auth fails *after* a successful refresh it is a permanent error
  // (e.g. gateway ID conflict, connection-limit) — not an expired-token issue.
  let hasRefreshed = false
  // Unique ID for the current connection; prevents stale refresh callbacks
  // from affecting a newer connection.
  let connectionId = 0

  const authenticate = (wsClient: GatewayWsClient) => {
    wsClient.send({
      type: 'gateway:auth',
      token: tokenManager.accessToken,
      gatewayId,
      protocolVersion: CURRENT_PROTOCOL_VERSION,
      deviceInfo,
      ...(opts.exitOnEmpty ? { ephemeral: true } : {}),
    })
  }

  const wsClient = new GatewayWsClient({
    url: config.serverUrl,
    onConnected: () => {
      // Reset per-connection refresh state on every new connection.
      connectionId++
      refreshingToken = null
      hasRefreshed = false
      authenticate(wsClient)
    },
    onMessage: async (msg) => {
      if (msg.type === 'server:gateway_auth_result') {
        if (msg.ok) {
          log.info('Authenticated successfully')
          refreshingToken = null

          const isReconnect = agentManager.listAgents().length > 0
          opts.onAuthenticated(agentManager, isReconnect)

          wsClient.flushQueue()
        } else {
          // First failure: try a token refresh (guarded by lock + one-shot flag).
          // Second failure after a successful refresh: permanent error — exit.
          if (!refreshingToken && config.refreshToken && !hasRefreshed) {
            const refreshConnId = connectionId
            log.info('Auth failed, refreshing token...')
            refreshingToken = tokenManager.refresh().then(
              () => {
                // Only act if this is still the same connection
                if (refreshConnId !== connectionId) return
                hasRefreshed = true
                refreshingToken = null
                authenticate(wsClient)
              },
              (err: unknown) => {
                if (refreshConnId !== connectionId) return
                log.error(`Token refresh failed: ${err instanceof Error ? err.message : err}`)
                log.error('Please re-login: agentim login')
                process.exit(1)
              },
            )
          } else {
            // No refresh token, refresh already attempted, or concurrent refresh
            // in flight — treat as a permanent auth failure.
            log.error(`Auth failed: ${msg.error}`)
            log.error('Please re-login: agentim login')
            process.exit(1)
          }
        }
      } else if (msg.type === 'server:error') {
        if (msg.code === WS_ERROR_CODES.PROTOCOL_VERSION_MISMATCH) {
          log.error(
            '══════════════════════════════════════════════════════════════\n' +
              `  PROTOCOL VERSION MISMATCH — ${msg.message}\n` +
              '  Please update your AgentIM CLI: npm install -g agentim@latest\n' +
              '══════════════════════════════════════════════════════════════',
          )
          wsClient.disableReconnect()
          setTimeout(() => process.exit(1), 500).unref()
        } else {
          log.warn(`Server error: [${msg.code}] ${msg.message}`)
        }
      } else if (
        msg.type === 'server:send_to_agent' ||
        msg.type === 'server:stop_agent' ||
        msg.type === 'server:remove_agent' ||
        msg.type === 'server:room_context' ||
        msg.type === 'server:permission_response' ||
        msg.type === 'server:agent_command' ||
        msg.type === 'server:query_agent_info' ||
        msg.type === 'server:spawn_agent'
      ) {
        agentManager.handleServerMessage(
          msg as
            | ServerSendToAgent
            | ServerStopAgent
            | ServerRemoveAgent
            | ServerRoomContext
            | ServerPermissionResponse
            | ServerAgentCommand
            | ServerQueryAgentInfo
            | ServerSpawnAgent,
        )
      }
    },
    onDisconnected: () => {
      log.warn('Connection lost, will reconnect...')
    },
  })

  // Build onEmpty callback for single-agent (exitOnEmpty) mode
  const onEmpty = opts.exitOnEmpty
    ? () => {
        log.info('All agents removed, exiting...')
        void cleanup().then(() => process.exit(0))
      }
    : undefined

  agentManager = new AgentManager(wsClient, opts.permissionLevel, onEmpty)

  // Graceful shutdown
  let shuttingDown = false
  const CLEANUP_DEADLINE_MS = 15_000 // Hard limit for disposeAll()
  const cleanup = async () => {
    if (shuttingDown) return
    shuttingDown = true
    log.info('Shutting down...')
    try {
      await Promise.race([
        agentManager.disposeAll(),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('disposeAll timed out')), CLEANUP_DEADLINE_MS).unref(),
        ),
      ])
    } catch (err) {
      log.warn(`Error during agent disposal: ${err instanceof Error ? err.message : err}`)
    }
    wsClient.close()
    // Wait briefly for WS close frame to be sent before exiting
    setTimeout(() => process.exit(0), 2000).unref()
  }

  const start = () => {
    wsClient.connect()

    process.on(
      'SIGINT',
      () => void cleanup().catch((e) => log.warn(`Cleanup error: ${(e as Error).message}`)),
    )
    process.on(
      'SIGTERM',
      () => void cleanup().catch((e) => log.warn(`Cleanup error: ${(e as Error).message}`)),
    )
    process.on(
      'SIGHUP',
      () => void cleanup().catch((e) => log.warn(`Cleanup error: ${(e as Error).message}`)),
    )
    // Ignore SIGPIPE (broken pipe) — can occur when piping output to a
    // closed process (e.g. `agentim list | head`). Without this handler,
    // Node.js would throw an uncaught exception and crash.
    process.on('SIGPIPE', () => {
      // Intentionally ignored
    })
    process.on('uncaughtException', (err) => {
      log.error(`Uncaught exception: ${err.message}`)
      void cleanup().finally(() => process.exit(1))
    })
    process.on('unhandledRejection', (reason) => {
      log.error(`Unhandled rejection: ${reason}`)
      void cleanup().catch((e) => log.warn(`Cleanup error: ${(e as Error).message}`))
    })
  }

  return { wsClient, agentManager, start, cleanup }
}
