import { loadConfig } from './config.js'
import { getDeviceInfo } from './device.js'
import { GatewayWsClient } from './ws-client.js'
import { AgentManager } from './agent-manager.js'
import { TokenManager } from './token-manager.js'
import { generateAgentName } from './name-generator.js'
import { createLogger } from './lib/logger.js'
import type { ServerSendToAgent, ServerStopAgent, ServerRemoveAgent, ServerRoomContext } from '@agentim/shared'

const log = createLogger('Wrapper')

/**
 * Run a single agent in wrapper mode.
 * Connects to the server, registers one agent, and waits for messages.
 */
export async function runWrapper(opts: {
  type: string
  name?: string
  workDir?: string
}): Promise<void> {
  const config = loadConfig()
  if (!config) {
    console.error('Not logged in. Run `agentim login` first.')
    process.exit(1)
  }

  const workDir = opts.workDir ?? process.cwd()
  const agentName = opts.name ?? generateAgentName(opts.type, workDir)

  const tokenManager = new TokenManager(config)
  const deviceInfo = getDeviceInfo()
  let agentManager: AgentManager
  let refreshingToken: Promise<void> | null = null
  // Track whether we already performed one token refresh this connection.
  // If auth fails *after* a successful refresh it is a permanent error
  // (e.g. gateway ID conflict, connection-limit) — not an expired-token issue.
  let hasRefreshed = false

  const authenticate = (wsClient: GatewayWsClient) => {
    wsClient.send({
      type: 'gateway:auth',
      token: tokenManager.accessToken,
      gatewayId: config.gatewayId,
      deviceInfo,
    })
  }

  const wsClient = new GatewayWsClient({
    url: config.serverUrl,
    onConnected: () => {
      // Reset per-connection refresh state on every new connection.
      refreshingToken = null
      hasRefreshed = false
      authenticate(wsClient)
    },
    onMessage: async (msg) => {
      if (msg.type === 'server:gateway_auth_result') {
        if (msg.ok) {
          log.info('Authenticated successfully')
          refreshingToken = null

          // On reconnect, re-register existing agent instead of creating a new one
          // to preserve room memberships that reference the old agent ID
          if (agentManager.listAgents().length > 0) {
            agentManager.reRegisterAll()
            log.info(`Re-registered existing agent: ${agentName}`)
          } else {
            const agentId = agentManager.addAgent({
              type: opts.type,
              name: agentName,
              workingDirectory: workDir,
            })
            log.info(`Agent registered: ${agentName} (${opts.type}) [${agentId}]`)
          }
          log.info(`Working directory: ${workDir}`)
          log.info('Waiting for messages... (Ctrl+C to quit)')
          wsClient.flushQueue()
        } else {
          // First failure: try a token refresh (guarded by lock + one-shot flag).
          // Second failure after a successful refresh: permanent error — exit.
          if (!refreshingToken && config.refreshToken && !hasRefreshed) {
            log.info('Auth failed, refreshing token...')
            refreshingToken = tokenManager.refresh().then(
              () => {
                hasRefreshed = true
                refreshingToken = null
                authenticate(wsClient)
              },
              (err: any) => {
                log.error(`Token refresh failed: ${err.message}`)
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
      } else if (msg.type === 'server:send_to_agent' || msg.type === 'server:stop_agent' || msg.type === 'server:remove_agent' || msg.type === 'server:room_context') {
        agentManager.handleServerMessage(msg as ServerSendToAgent | ServerStopAgent | ServerRemoveAgent | ServerRoomContext)
      }
    },
    onDisconnected: () => {
      log.warn('Connection lost, will reconnect...')
    },
  })

  agentManager = new AgentManager(wsClient)
  wsClient.connect()

  // Graceful shutdown
  const cleanup = async () => {
    log.info('Shutting down...')
    await agentManager.disposeAll()
    wsClient.close()
    process.exit(0)
  }

  process.on('SIGINT', () => cleanup())
  process.on('SIGTERM', () => cleanup())
}
