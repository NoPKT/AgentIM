#!/usr/bin/env node
import { program } from 'commander'
import { nanoid } from 'nanoid'
import { loadConfig, saveConfig, getConfigPath, wsUrlToHttpUrl } from './config.js'
import { getDeviceInfo } from './device.js'
import { GatewayWsClient } from './ws-client.js'
import { AgentManager } from './agent-manager.js'
import { TokenManager } from './token-manager.js'
import type { ServerSendToAgent, ServerStopAgent } from '@agentim/shared'

program
  .name('aim-gateway')
  .description('AgentIM Gateway - Bridge AI coding agents to AgentIM')
  .version('0.1.0')

program
  .command('login')
  .description('Login to AgentIM server and save credentials')
  .requiredOption('-s, --server <url>', 'Server URL (e.g., http://localhost:3000)')
  .requiredOption('-u, --username <username>', 'Username')
  .requiredOption('-p, --password <password>', 'Password')
  .action(async (opts) => {
    try {
      const serverBaseUrl = opts.server.replace(/\/+$/, '')
      const { accessToken, refreshToken } = await TokenManager.login(
        serverBaseUrl,
        opts.username,
        opts.password,
      )

      const gatewayId = loadConfig()?.gatewayId ?? nanoid()
      const wsUrl = serverBaseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws/gateway'

      saveConfig({
        serverUrl: wsUrl,
        serverBaseUrl,
        token: accessToken,
        refreshToken,
        gatewayId,
      })

      console.log(`Login successful!`)
      console.log(`Gateway ID: ${gatewayId}`)
      console.log(`Config saved to: ${getConfigPath()}`)
    } catch (err: any) {
      console.error(`Login failed: ${err.message}`)
      process.exit(1)
    }
  })

program
  .command('config')
  .description('Configure gateway connection (manual token)')
  .requiredOption('-s, --server <url>', 'Server WebSocket URL (e.g., ws://localhost:3000/ws/gateway)')
  .requiredOption('-t, --token <token>', 'Authentication token')
  .option('-r, --refresh-token <token>', 'Refresh token (enables auto-refresh)')
  .action((opts) => {
    const gatewayId = loadConfig()?.gatewayId ?? nanoid()
    saveConfig({
      serverUrl: opts.server,
      serverBaseUrl: wsUrlToHttpUrl(opts.server),
      token: opts.token,
      refreshToken: opts.refreshToken ?? '',
      gatewayId,
    })
    console.log(`Configuration saved to ${getConfigPath()}`)
    console.log(`Gateway ID: ${gatewayId}`)
  })

program
  .command('start')
  .description('Start the gateway and connect agents')
  .option('-a, --agent <spec...>', 'Agent spec: name:type[:workdir] (e.g., claude:claude-code:/path)')
  .action(async (opts) => {
    const config = loadConfig()
    if (!config) {
      console.error('No configuration found. Run `aim-gateway login` or `aim-gateway config` first.')
      process.exit(1)
    }

    const tokenManager = new TokenManager(config)
    const deviceInfo = getDeviceInfo()
    let agentManager: AgentManager
    let authRetried = false

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
        authRetried = false
        authenticate(wsClient)
      },
      onMessage: async (msg) => {
        if (msg.type === 'server:gateway_auth_result') {
          if (msg.ok) {
            console.log('[Gateway] Authenticated successfully')
            authRetried = false
            registerAgents(agentManager, opts.agent ?? [])
          } else {
            // Try refreshing token once
            if (!authRetried && config.refreshToken) {
              authRetried = true
              console.log('[Gateway] Auth failed, refreshing token...')
              try {
                await tokenManager.refresh()
                authenticate(wsClient)
              } catch (err: any) {
                console.error(`[Gateway] Token refresh failed: ${err.message}`)
                console.error('[Gateway] Please re-login: aim-gateway login ...')
                process.exit(1)
              }
            } else {
              console.error(`[Gateway] Auth failed: ${msg.error}`)
              console.error('[Gateway] Please re-login: aim-gateway login ...')
              process.exit(1)
            }
          }
        } else if (msg.type === 'server:send_to_agent' || msg.type === 'server:stop_agent') {
          agentManager.handleServerMessage(msg as ServerSendToAgent | ServerStopAgent)
        }
      },
      onDisconnected: () => {
        console.log('[Gateway] Connection lost, will reconnect...')
      },
    })

    agentManager = new AgentManager(wsClient)

    wsClient.connect()

    // Graceful shutdown
    const cleanup = () => {
      console.log('\n[Gateway] Shutting down...')
      agentManager.disposeAll()
      wsClient.close()
      process.exit(0)
    }

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
  })

program
  .command('status')
  .description('Show configuration status')
  .action(() => {
    const config = loadConfig()
    if (!config) {
      console.log('Not configured. Run `aim-gateway login` first.')
      return
    }
    console.log(`Server: ${config.serverUrl}`)
    console.log(`HTTP Base: ${config.serverBaseUrl}`)
    console.log(`Gateway ID: ${config.gatewayId}`)
    console.log(`Has refresh token: ${config.refreshToken ? 'yes' : 'no'}`)
    console.log(`Config: ${getConfigPath()}`)
  })

function registerAgents(agentManager: AgentManager, agentSpecs: string[]) {
  for (const spec of agentSpecs) {
    const parts = spec.split(':')
    if (parts.length < 2) {
      console.warn(`[Gateway] Invalid agent spec "${spec}", expected name:type[:workdir]`)
      continue
    }
    const [name, type, workdir] = parts
    agentManager.addAgent({
      name,
      type,
      workingDirectory: workdir,
    })
  }

  if (agentSpecs.length === 0) {
    console.log('[Gateway] No agents specified. Use --agent to add agents.')
    console.log('[Gateway] Example: aim-gateway start --agent claude:claude-code:/path/to/project')
  }
}

program.parse()
