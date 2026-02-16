import { loadConfig } from './config.js'
import { getDeviceInfo } from './device.js'
import { GatewayWsClient } from './ws-client.js'
import { AgentManager } from './agent-manager.js'
import { TokenManager } from './token-manager.js'
import { generateAgentName } from './name-generator.js'
import { createLogger } from './lib/logger.js'
import type { ServerSendToAgent, ServerStopAgent } from '@agentim/shared'

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
      refreshingToken = null
      authenticate(wsClient)
    },
    onMessage: async (msg) => {
      if (msg.type === 'server:gateway_auth_result') {
        if (msg.ok) {
          log.info('Authenticated successfully')
          refreshingToken = null

          // Register the single agent
          const agentId = agentManager.addAgent({
            type: opts.type,
            name: agentName,
            workingDirectory: workDir,
          })
          log.info(`Agent registered: ${agentName} (${opts.type}) [${agentId}]`)
          log.info(`Working directory: ${workDir}`)
          log.info('Waiting for messages... (Ctrl+C to quit)')
          wsClient.flushQueue()
        } else {
          // Try refreshing token once (with lock to prevent concurrent refreshes)
          if (!refreshingToken && config.refreshToken) {
            log.info('Auth failed, refreshing token...')
            refreshingToken = tokenManager.refresh().then(
              () => authenticate(wsClient),
              (err: any) => {
                log.error(`Token refresh failed: ${err.message}`)
                log.error('Please re-login: agentim login')
                process.exit(1)
              },
            )
          } else if (!config.refreshToken) {
            log.error(`Auth failed: ${msg.error}`)
            log.error('Please re-login: agentim login')
            process.exit(1)
          }
        }
      } else if (msg.type === 'server:send_to_agent' || msg.type === 'server:stop_agent') {
        agentManager.handleServerMessage(msg as ServerSendToAgent | ServerStopAgent)
      }
    },
    onDisconnected: () => {
      log.warn('Connection lost, will reconnect...')
    },
  })

  agentManager = new AgentManager(wsClient)
  wsClient.connect()

  // Graceful shutdown
  const cleanup = () => {
    log.info('Shutting down...')
    agentManager.disposeAll()
    wsClient.close()
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}
