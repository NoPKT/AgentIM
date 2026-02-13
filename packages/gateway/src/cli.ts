#!/usr/bin/env node
import { program } from 'commander'
import { nanoid } from 'nanoid'
import { loadConfig, saveConfig, getConfigPath } from './config.js'
import { getDeviceInfo } from './device.js'
import { GatewayWsClient } from './ws-client.js'
import { AgentManager } from './agent-manager.js'
import type { ServerSendToAgent, ServerStopAgent } from '@agentim/shared'

program
  .name('aim-gateway')
  .description('AgentIM Gateway - Bridge AI coding agents to AgentIM')
  .version('0.1.0')

program
  .command('config')
  .description('Configure gateway connection')
  .requiredOption('-s, --server <url>', 'Server WebSocket URL (e.g., ws://localhost:3000/ws/gateway)')
  .requiredOption('-t, --token <token>', 'Authentication token')
  .action((opts) => {
    const gatewayId = loadConfig()?.gatewayId ?? nanoid()
    saveConfig({
      serverUrl: opts.server,
      token: opts.token,
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
      console.error('No configuration found. Run `aim-gateway config` first.')
      process.exit(1)
    }

    const deviceInfo = getDeviceInfo()
    let agentManager: AgentManager

    const wsClient = new GatewayWsClient({
      url: config.serverUrl,
      onConnected: () => {
        // Authenticate
        wsClient.send({
          type: 'gateway:auth',
          token: config.token,
          gatewayId: config.gatewayId,
          deviceInfo,
        })
      },
      onMessage: (msg) => {
        if (msg.type === 'server:gateway_auth_result') {
          if (msg.ok) {
            console.log('[Gateway] Authenticated successfully')
            // Register agents after auth
            registerAgents(agentManager, opts.agent ?? [])
          } else {
            console.error(`[Gateway] Auth failed: ${msg.error}`)
            process.exit(1)
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
      console.log('Not configured. Run `aim-gateway config` first.')
      return
    }
    console.log(`Server: ${config.serverUrl}`)
    console.log(`Gateway ID: ${config.gatewayId}`)
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
