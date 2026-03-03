import { loadConfig, writeAuthRevokedMarker, removeAuthRevokedMarker } from './config.js'
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
  ServerRequestWorkspace,
  ServerListCredentials,
  ServerAddCredential,
  ServerManageCredential,
  ServerRewindAgent,
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
  /** Called during graceful shutdown (before disposeAll). */
  onCleanup?: () => void
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
  let authRevoked = false
  let authPollTimer: ReturnType<typeof setInterval> | null = null

  /** Recover from auth-revoked state: update tokens, reconnect. */
  const recoverFromAuthRevoked = () => {
    authRevoked = false
    hasRefreshed = false
    connectionId++
    removeAuthRevokedMarker()

    if (authPollTimer) {
      clearInterval(authPollTimer)
      authPollTimer = null
    }

    wsClient.enableReconnect()
    wsClient.connect()
  }

  /** Enter auth-revoked state: keep agents alive, poll config for new tokens. */
  const enterAuthRevokedState = () => {
    if (authRevoked) return
    authRevoked = true
    log.warn('Auth revoked — entering recovery mode (agents stay alive)')
    writeAuthRevokedMarker(config.serverUrl)
    wsClient.close()

    let pollCount = 0
    let refreshing = false
    authPollTimer = setInterval(() => {
      pollCount++

      // Check 1: config file for new tokens (user re-logged in via CLI/TUI)
      const newConfig = loadConfig()
      if (!newConfig) return // Config deleted (user logged out) — keep waiting

      // If server URL changed, the user logged into a different server — restart
      if (newConfig.serverUrl !== config.serverUrl) {
        log.info('Server URL changed, restarting...')
        process.exit(0)
      }

      // New tokens detected in config — recover immediately
      if (newConfig.token !== tokenManager.accessToken) {
        log.info('New tokens detected, recovering...')
        tokenManager.updateTokens(newConfig)
        config.token = newConfig.token
        config.refreshToken = newConfig.refreshToken
        recoverFromAuthRevoked()
        return
      }

      // Check 2: every 6th poll (~30s), try to refresh with existing token.
      // Handles transient server downtime without requiring user re-login.
      if (pollCount % 6 === 0 && !refreshing) {
        refreshing = true
        tokenManager
          .refresh()
          .then(() => {
            if (!authRevoked) return // Already recovered via config check
            log.info('Token refresh succeeded, recovering...')
            recoverFromAuthRevoked()
          })
          .catch(() => {
            // Still failing — keep polling
          })
          .finally(() => {
            refreshing = false
          })
      }
    }, 5000)
    authPollTimer.unref()
  }

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
      connectionId++

      if (refreshingToken) {
        // A previous connection's token refresh is still in-flight.
        // Don't reset hasRefreshed — we're continuing the same auth cycle.
        const pending = refreshingToken
        refreshingToken = null
        const pendingConnId = connectionId
        pending.then(
          () => {
            if (pendingConnId !== connectionId) return
            // Refresh succeeded — authenticate with the new token.
            hasRefreshed = true
            authenticate(wsClient)
          },
          () => {
            if (pendingConnId !== connectionId) return
            // Refresh exhausted all retries — go straight to recovery.
            // No point authenticating with the old (invalid) token.
            enterAuthRevokedState()
          },
        )
      } else {
        // Clean reconnection (no pending refresh) — reset refresh state.
        hasRefreshed = false
        refreshingToken = null
        authenticate(wsClient)
      }
    },
    onMessage: async (msg) => {
      if (msg.type === 'server:gateway_auth_result') {
        if (msg.ok) {
          log.info('Authenticated successfully')
          refreshingToken = null
          removeAuthRevokedMarker()

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
                refreshingToken = null
                const errMsg = err instanceof Error ? err.message : String(err)
                log.error(`Token refresh failed: ${errMsg}`)

                // All refresh retries exhausted (6 retries, ~2 min) — enter
                // recovery mode regardless of error type. The auth-revoked
                // polling will periodically retry refresh to handle transient
                // server downtime without requiring user re-login.
                log.error('Entering recovery mode — waiting for re-login or server recovery')
                enterAuthRevokedState()
              },
            )
          } else {
            // No refresh token, refresh already attempted, or concurrent refresh
            // in flight — enter recovery mode instead of exiting.
            log.error(`Auth failed: ${msg.error}`)
            log.error('Session revoked — waiting for re-login')
            enterAuthRevokedState()
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
        msg.type === 'server:spawn_agent' ||
        msg.type === 'server:request_workspace' ||
        msg.type === 'server:list_credentials' ||
        msg.type === 'server:add_credential' ||
        msg.type === 'server:manage_credential' ||
        msg.type === 'server:rewind_agent'
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
            | ServerSpawnAgent
            | ServerRequestWorkspace
            | ServerListCredentials
            | ServerAddCredential
            | ServerManageCredential
            | ServerRewindAgent,
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
    if (authPollTimer) {
      clearInterval(authPollTimer)
      authPollTimer = null
    }
    removeAuthRevokedMarker()
    opts.onCleanup?.()
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
