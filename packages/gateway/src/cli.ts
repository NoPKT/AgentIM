#!/usr/bin/env node
import { program } from 'commander'
import { nanoid } from 'nanoid'
import { loadConfig, saveConfig, getConfigPath, clearConfig, wsUrlToHttpUrl } from './config.js'
import { getDeviceInfo } from './device.js'
import { GatewayWsClient } from './ws-client.js'
import { AgentManager } from './agent-manager.js'
import { TokenManager } from './token-manager.js'
import { generateAgentName } from './name-generator.js'
import { prompt, promptPassword } from './interactive.js'
import { runWrapper } from './wrapper.js'
import { createLogger } from './lib/logger.js'
import type { ServerSendToAgent, ServerStopAgent } from '@agentim/shared'

const log = createLogger('Gateway')

program
  .name('aim')
  .description('AgentIM Gateway - Bridge AI coding agents to AgentIM')
  .version('0.1.0')

// ─── aim login ───

program
  .command('login')
  .description('Login to AgentIM server (interactive or with flags)')
  .option('-s, --server <url>', 'Server URL (e.g., http://localhost:3000)')
  .option('-u, --username <username>', 'Username')
  .option('-p, --password <password>', 'Password')
  .action(async (opts) => {
    try {
      let serverUrl = opts.server
      let username = opts.username
      let password = opts.password

      // Interactive prompts for missing values
      if (!serverUrl) {
        serverUrl = await prompt('Server URL (e.g., http://localhost:3000): ')
      }
      if (!username) {
        username = await prompt('Username: ')
      }
      if (!password) {
        password = await promptPassword('Password: ')
      }

      if (!serverUrl || !username || !password) {
        console.error('Server URL, username, and password are required.')
        process.exit(1)
      }

      // Validate URL format
      try {
        const parsed = new URL(serverUrl)
        if (!parsed.protocol.startsWith('http')) {
          console.error('Server URL must start with http:// or https://')
          process.exit(1)
        }
      } catch {
        console.error('Invalid server URL. Example: http://localhost:3000')
        process.exit(1)
      }

      const serverBaseUrl = serverUrl.replace(/\/+$/, '')
      const { accessToken, refreshToken } = await TokenManager.login(
        serverBaseUrl,
        username,
        password,
      )

      const gatewayId = loadConfig()?.gatewayId ?? nanoid()
      const wsUrl =
        serverBaseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws/gateway'

      saveConfig({
        serverUrl: wsUrl,
        serverBaseUrl,
        token: accessToken,
        refreshToken,
        gatewayId,
      })

      console.log('Login successful!')
      console.log(`Gateway ID: ${gatewayId}`)
      console.log(`Config saved to: ${getConfigPath()}`)
    } catch (err: any) {
      console.error(`Login failed: ${err.message}`)
      process.exit(1)
    }
  })

// ─── aim logout ───

program
  .command('logout')
  .description('Clear saved credentials')
  .action(() => {
    clearConfig()
    console.log('Logged out. Credentials cleared.')
  })

// ─── aim claude [path] ───

program
  .command('claude [path]')
  .description('Start a Claude Code agent')
  .option('-n, --name <name>', 'Agent name')
  .action(async (path, opts) => {
    await runWrapper({
      type: 'claude-code',
      name: opts.name,
      workDir: path,
    })
  })

// ─── aim codex [path] ───

program
  .command('codex [path]')
  .description('Start a Codex agent')
  .option('-n, --name <name>', 'Agent name')
  .action(async (path, opts) => {
    await runWrapper({
      type: 'codex',
      name: opts.name,
      workDir: path,
    })
  })

// ─── aim gemini [path] ───

program
  .command('gemini [path]')
  .description('Start a Gemini CLI agent')
  .option('-n, --name <name>', 'Agent name')
  .action(async (path, opts) => {
    await runWrapper({
      type: 'gemini',
      name: opts.name,
      workDir: path,
    })
  })

// ─── aim daemon ───

program
  .command('daemon')
  .description('Start the gateway daemon (multi-agent mode)')
  .option(
    '-a, --agent <spec...>',
    'Agent spec: name:type[:workdir] (e.g., claude:claude-code:/path)',
  )
  .action(async (opts) => {
    const config = loadConfig()
    if (!config) {
      console.error('Not logged in. Run `aim login` first.')
      process.exit(1)
    }

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
            registerAgents(agentManager, opts.agent ?? [])
            wsClient.flushQueue()
          } else {
            // Try refreshing token once (with lock to prevent concurrent refreshes)
            if (!refreshingToken && config.refreshToken) {
              log.info('Auth failed, refreshing token...')
              refreshingToken = tokenManager.refresh().then(
                () => authenticate(wsClient),
                (err: any) => {
                  log.error(`Token refresh failed: ${err.message}`)
                  log.error('Please re-login: aim login')
                  process.exit(1)
                },
              )
            } else if (!config.refreshToken) {
              log.error(`Auth failed: ${msg.error}`)
              log.error('Please re-login: aim login')
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
  })

// ─── aim status ───

program
  .command('status')
  .description('Show configuration status')
  .action(() => {
    const config = loadConfig()
    if (!config) {
      console.log('Not logged in. Run `aim login` first.')
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
      log.warn(`Invalid agent spec "${spec}", expected name:type[:workdir]`)
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
    log.info('No agents specified. Use --agent to add agents.')
    log.info('Example: aim daemon --agent claude:claude-code:/path/to/project')
  }
}

program.parse()
