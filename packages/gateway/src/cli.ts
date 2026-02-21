#!/usr/bin/env node
import { createRequire } from 'node:module'
import { program } from 'commander'
import { nanoid } from 'nanoid'
import { loadConfig, saveConfig, getConfigPath, clearConfig, wsUrlToHttpUrl } from './config.js'
import { getDeviceInfo } from './device.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json')
import { GatewayWsClient } from './ws-client.js'
import { AgentManager } from './agent-manager.js'
import { TokenManager } from './token-manager.js'
import { generateAgentName } from './name-generator.js'
import { prompt, promptPassword } from './interactive.js'
import { runWrapper } from './wrapper.js'
import { createLogger } from './lib/logger.js'
import type {
  ServerSendToAgent,
  ServerStopAgent,
  ServerRemoveAgent,
  ServerRoomContext,
} from '@agentim/shared'

const log = createLogger('Gateway')

program
  .name('agentim')
  .description('AgentIM Gateway - Bridge AI coding agents to AgentIM')
  .version(version)

// ─── agentim login ───

program
  .command('login')
  .description('Login to AgentIM server (interactive or with flags)')
  .option('-s, --server <url>', 'Server URL (e.g., http://localhost:3000)')
  .option('-u, --username <username>', 'Username')
  .action(async (opts) => {
    try {
      let serverUrl = opts.server
      let username = opts.username
      // Password only accepted via env var or interactive input (never CLI args — visible in `ps`)
      let password = process.env.AGENTIM_PASSWORD

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
    } catch (err: unknown) {
      console.error(`Login failed: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }
  })

// ─── agentim logout ───

program
  .command('logout')
  .description('Clear saved credentials')
  .action(() => {
    clearConfig()
    console.log('Logged out. Credentials cleared.')
  })

// ─── agentim claude [path] ───

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

// ─── agentim codex [path] ───

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

// ─── agentim gemini [path] ───

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

// ─── agentim agent [path] ───

program
  .command('agent [path]')
  .description('Start a Cursor agent')
  .option('-n, --name <name>', 'Agent name')
  .action(async (path, opts) => {
    await runWrapper({
      type: 'cursor',
      name: opts.name,
      workDir: path,
    })
  })

// ─── agentim daemon ───

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
      console.error('Not logged in. Run `agentim login` first.')
      process.exit(1)
    }

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
            // On reconnect, re-register existing agents instead of creating new ones
            if (agentManager.listAgents().length > 0) {
              agentManager.reRegisterAll()
            } else {
              registerAgents(agentManager, opts.agent ?? [])
            }
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
                (err: unknown) => {
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
        } else if (
          msg.type === 'server:send_to_agent' ||
          msg.type === 'server:stop_agent' ||
          msg.type === 'server:remove_agent' ||
          msg.type === 'server:room_context'
        ) {
          agentManager.handleServerMessage(
            msg as ServerSendToAgent | ServerStopAgent | ServerRemoveAgent | ServerRoomContext,
          )
        }
      },
      onDisconnected: () => {
        log.warn('Connection lost, will reconnect...')
      },
    })

    agentManager = new AgentManager(wsClient)

    wsClient.connect()

    // Graceful shutdown
    let shuttingDown = false
    const cleanup = async () => {
      if (shuttingDown) return
      shuttingDown = true
      log.info('Shutting down...')
      try {
        await agentManager.disposeAll()
      } catch (err) {
        log.error(`Error during dispose: ${(err as Error).message}`)
      }
      wsClient.close()
      // Allow time for WS close frame to be sent before exiting
      setTimeout(() => process.exit(0), 2000).unref()
    }

    process.on('SIGINT', () => void cleanup())
    process.on('SIGTERM', () => void cleanup())
    process.on('SIGHUP', () => void cleanup())
    process.on('uncaughtException', (err) => {
      log.error(`Uncaught exception: ${err.message}`)
      void cleanup()
    })
    process.on('unhandledRejection', (reason) => {
      log.error(`Unhandled rejection: ${reason}`)
      void cleanup()
    })
  })

// ─── agentim status ───

program
  .command('status')
  .description('Show configuration status')
  .action(() => {
    const config = loadConfig()
    if (!config) {
      console.log('Not logged in. Run `agentim login` first.')
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
    // Split only first two colons to preserve Windows paths like C:\repo
    const firstColon = spec.indexOf(':')
    if (firstColon === -1) {
      log.warn(`Invalid agent spec "${spec}", expected name:type[:workdir]`)
      continue
    }
    const name = spec.slice(0, firstColon)
    const rest = spec.slice(firstColon + 1)
    const secondColon = rest.indexOf(':')
    const type = secondColon === -1 ? rest : rest.slice(0, secondColon)
    const workdir = secondColon === -1 ? undefined : rest.slice(secondColon + 1) || undefined
    agentManager.addAgent({
      name,
      type,
      workingDirectory: workdir,
    })
  }

  if (agentSpecs.length === 0) {
    log.info('No agents specified. Use --agent to add agents.')
    log.info('Example: agentim daemon --agent claude:claude-code:/path/to/project')
  }
}

program.parse()
