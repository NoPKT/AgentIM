#!/usr/bin/env node
import { spawn as cpSpawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
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
import { prompt, promptPassword, promptSelect } from './interactive.js'
import { runWrapper } from './wrapper.js'
import { loadAgentConfig, agentConfigToEnv } from './agent-config.js'
import { runSetupWizard } from './setup-wizard.js'
import { createLogger } from './lib/logger.js'
import { printSecurityBanner } from './lib/security-banner.js'
import { listCustomAdapters, getCustomAdaptersPath } from './custom-adapters.js'
import {
  listDaemons,
  stopDaemon,
  removeDaemon,
  cleanStaleDaemons,
  writeDaemonInfo,
  readDaemonInfo,
} from './lib/daemon-manager.js'
import type {
  PermissionLevel,
  ServerSendToAgent,
  ServerStopAgent,
  ServerRemoveAgent,
  ServerRoomContext,
  ServerPermissionResponse,
} from '@agentim/shared'
import { CURRENT_PROTOCOL_VERSION } from '@agentim/shared'

const log = createLogger('Gateway')

/** Parse comma-separated env var names from --pass-env flag */
function parsePassEnv(raw?: string): string[] | undefined {
  if (!raw) return undefined
  const keys = raw
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean)
  return keys.length > 0 ? keys : undefined
}

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

      // Clear password from env immediately after reading
      delete process.env.AGENTIM_PASSWORD

      if (!serverUrl || !username || !password) {
        log.error('Server URL, username, and password are required.')
        process.exit(1)
      }

      // Validate URL format
      try {
        const parsed = new URL(serverUrl)
        if (!parsed.protocol.startsWith('http')) {
          log.error('Server URL must start with http:// or https://')
          process.exit(1)
        }
      } catch {
        log.error('Invalid server URL. Example: http://localhost:3000')
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

      log.info('Login successful!')
      log.info(`Gateway ID: ${gatewayId}`)
      log.info(`Config saved to: ${getConfigPath()}`)
    } catch (err: unknown) {
      log.error(`Login failed: ${err instanceof Error ? err.message : err}`)
      process.exit(1)
    }
  })

// ─── agentim logout ───

program
  .command('logout')
  .description('Clear saved credentials')
  .action(() => {
    clearConfig()
    log.info('Logged out. Credentials cleared.')
  })

// ─── agentim setup [agent-type] ───

program
  .command('setup [agent-type]')
  .description('Interactive setup wizard for agent credentials')
  .action(async (agentType) => {
    if (!agentType) {
      agentType = await promptSelect('Select agent type:', [
        { label: 'Claude Code', value: 'claude-code' },
        { label: 'Codex', value: 'codex' },
        { label: 'Gemini', value: 'gemini' },
      ])
    }
    await runSetupWizard(agentType)
  })

// ─── agentim claude [path] ───

program
  .command('claude [path]')
  .description('Start a Claude Code agent (background daemon)')
  .option('-n, --name <name>', 'Agent name')
  .option('-y, --yes', 'Bypass permission prompts (auto-approve all tool use)')
  .option('--foreground', 'Run in foreground instead of daemonizing')
  .option(
    '--pass-env <keys>',
    'Comma-separated env var names to whitelist through the security filter',
  )
  .option('--no-security-warning', 'Suppress the security warning banner')
  .action(async (path, opts) => {
    printSecurityBanner(!opts.securityWarning)
    const workDir = path ?? process.cwd()
    const name = opts.name ?? generateAgentName('claude-code', workDir)
    const permissionLevel: PermissionLevel = opts.yes ? 'bypass' : 'interactive'
    let agentConfig = loadAgentConfig('claude-code')
    if (!agentConfig) {
      log.info('No credentials configured for Claude Code.')
      log.info('Running setup wizard...')
      await runSetupWizard('claude-code')
      agentConfig = loadAgentConfig('claude-code')
    }
    const env = agentConfig ? agentConfigToEnv('claude-code', agentConfig) : {}
    const passEnv = parsePassEnv(opts.passEnv)
    if (opts.foreground) {
      await runWrapper({ type: 'claude-code', name, workDir, env, passEnv, permissionLevel })
    } else {
      spawnDaemon(name, 'claude-code', workDir, env, permissionLevel)
    }
  })

// ─── agentim codex [path] ───

program
  .command('codex [path]')
  .description('Start a Codex agent (background daemon)')
  .option('-n, --name <name>', 'Agent name')
  .option('-y, --yes', 'Bypass permission prompts (auto-approve all tool use)')
  .option('--foreground', 'Run in foreground instead of daemonizing')
  .option(
    '--pass-env <keys>',
    'Comma-separated env var names to whitelist through the security filter',
  )
  .option('--no-security-warning', 'Suppress the security warning banner')
  .action(async (path, opts) => {
    printSecurityBanner(!opts.securityWarning)
    const workDir = path ?? process.cwd()
    const name = opts.name ?? generateAgentName('codex', workDir)
    const permissionLevel: PermissionLevel = opts.yes ? 'bypass' : 'interactive'
    let agentConfig = loadAgentConfig('codex')
    if (!agentConfig) {
      log.info('No credentials configured for Codex.')
      log.info('Running setup wizard...')
      await runSetupWizard('codex')
      agentConfig = loadAgentConfig('codex')
    }
    const env = agentConfig ? agentConfigToEnv('codex', agentConfig) : {}
    const passEnv = parsePassEnv(opts.passEnv)
    if (opts.foreground) {
      await runWrapper({ type: 'codex', name, workDir, env, passEnv, permissionLevel })
    } else {
      spawnDaemon(name, 'codex', workDir, env, permissionLevel)
    }
  })

// ─── agentim gemini [path] ───

program
  .command('gemini [path]')
  .description('Start a Gemini CLI agent (background daemon)')
  .option('-n, --name <name>', 'Agent name')
  .option('-y, --yes', 'Bypass permission prompts (auto-approve all tool use)')
  .option('--foreground', 'Run in foreground instead of daemonizing')
  .option(
    '--pass-env <keys>',
    'Comma-separated env var names to whitelist through the security filter',
  )
  .option('--no-security-warning', 'Suppress the security warning banner')
  .action(async (path, opts) => {
    printSecurityBanner(!opts.securityWarning)
    const workDir = path ?? process.cwd()
    const name = opts.name ?? generateAgentName('gemini', workDir)
    const permissionLevel: PermissionLevel = opts.yes ? 'bypass' : 'interactive'
    let agentConfig = loadAgentConfig('gemini')
    if (!agentConfig) {
      log.info('No credentials configured for Gemini.')
      log.info('Running setup wizard...')
      await runSetupWizard('gemini')
      agentConfig = loadAgentConfig('gemini')
    }
    const env = agentConfig ? agentConfigToEnv('gemini', agentConfig) : {}
    const passEnv = parsePassEnv(opts.passEnv)
    if (opts.foreground) {
      await runWrapper({ type: 'gemini', name, workDir, env, passEnv, permissionLevel })
    } else {
      spawnDaemon(name, 'gemini', workDir, env, permissionLevel)
    }
  })

// ─── agentim daemon ───

program
  .command('daemon')
  .description('Start the gateway daemon (multi-agent mode)')
  .option(
    '-a, --agent <spec...>',
    'Agent spec: name:type[:workdir] (e.g., claude:claude-code:/path)',
  )
  .option('-y, --yes', 'Bypass permission prompts (auto-approve all tool use)')
  .option('--no-security-warning', 'Suppress the security warning banner')
  .action(async (opts) => {
    printSecurityBanner(!opts.securityWarning)
    const permissionLevel: PermissionLevel = opts.yes ? 'bypass' : 'interactive'
    const config = loadConfig()
    if (!config) {
      log.error('Not logged in. Run `agentim login` first.')
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
    // Unique ID for the current connection; prevents stale refresh callbacks
    // from affecting a newer connection.
    let connectionId = 0

    const authenticate = (wsClient: GatewayWsClient) => {
      wsClient.send({
        type: 'gateway:auth',
        token: tokenManager.accessToken,
        gatewayId: config.gatewayId,
        protocolVersion: CURRENT_PROTOCOL_VERSION,
        deviceInfo,
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
        } else if (
          msg.type === 'server:send_to_agent' ||
          msg.type === 'server:stop_agent' ||
          msg.type === 'server:remove_agent' ||
          msg.type === 'server:room_context' ||
          msg.type === 'server:permission_response'
        ) {
          agentManager.handleServerMessage(
            msg as
              | ServerSendToAgent
              | ServerStopAgent
              | ServerRemoveAgent
              | ServerRoomContext
              | ServerPermissionResponse,
          )
        }
      },
      onDisconnected: () => {
        log.warn('Connection lost, will reconnect...')
      },
    })

    agentManager = new AgentManager(wsClient, permissionLevel)

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

    process.on(
      'SIGINT',
      () => void cleanup().catch((e) => log.error(`Cleanup error: ${(e as Error).message}`)),
    )
    process.on(
      'SIGTERM',
      () => void cleanup().catch((e) => log.error(`Cleanup error: ${(e as Error).message}`)),
    )
    process.on(
      'SIGHUP',
      () => void cleanup().catch((e) => log.error(`Cleanup error: ${(e as Error).message}`)),
    )
    process.on('uncaughtException', (err) => {
      log.error(`Uncaught exception: ${err.message}`)
      void cleanup()
    })
    process.on('unhandledRejection', (reason) => {
      log.error(`Unhandled rejection: ${reason}`)
      void cleanup()
    })
  })

// ─── agentim list ───

program
  .command('list')
  .alias('ls')
  .description('List running agent daemons')
  .action(() => {
    cleanStaleDaemons()
    const daemons = listDaemons()
    if (daemons.length === 0) {
      log.info('No running agents.')
      return
    }

    console.log('\n  Name\t\t\tType\t\tPID\tAlive\tStarted')
    console.log('  ' + '─'.repeat(72))
    for (const d of daemons) {
      const started = new Date(d.startedAt).toLocaleString()
      const alive = d.alive ? 'yes' : 'no'
      console.log(`  ${d.name}\t${d.type}\t\t${d.pid}\t${alive}\t${started}`)
    }
    console.log()
  })

// ─── agentim stop <name> ───

program
  .command('stop <name>')
  .description('Gracefully stop a running agent daemon')
  .action((name) => {
    const ok = stopDaemon(name)
    if (ok) {
      log.info(`Agent "${name}" stopped.`)
    } else {
      log.error(`Failed to stop agent "${name}". It may not be running.`)
    }
  })

// ─── agentim rm <name> ───

program
  .command('rm <name>')
  .description('Stop and clean up an agent daemon')
  .action((name) => {
    removeDaemon(name)
    log.info(`Agent "${name}" removed.`)
  })

// ─── agentim status ───

program
  .command('status')
  .description('Show configuration status')
  .action(() => {
    const config = loadConfig()
    if (!config) {
      log.info('Not logged in. Run `agentim login` first.')
      return
    }
    log.info(`Server: ${config.serverUrl}`)
    log.info(`HTTP Base: ${config.serverBaseUrl}`)
    log.info(`Gateway ID: ${config.gatewayId}`)
    log.info(`Has refresh token: ${config.refreshToken ? 'yes' : 'no'}`)
    log.info(`Config: ${getConfigPath()}`)
  })

// ─── agentim adapters ───

program
  .command('adapters')
  .description('List all configured custom adapters')
  .action(() => {
    const adapters = listCustomAdapters()
    if (adapters.length === 0) {
      log.info('No custom adapters configured.')
      log.info(`Add custom adapters to: ${getCustomAdaptersPath()}`)
      return
    }

    console.log(`\n  Custom adapters (${getCustomAdaptersPath()}):\n`)
    console.log('  Name\t\t\tCommand\t\t\tDescription')
    console.log('  ' + '\u2500'.repeat(72))
    for (const adapter of adapters) {
      const cmd = adapter.args?.length
        ? `${adapter.command} ${adapter.args.join(' ')}`
        : adapter.command
      const desc = adapter.description ?? '(no description)'
      console.log(`  ${adapter.name}\t\t${cmd}\t\t${desc}`)
    }
    console.log()
  })

function registerAgents(agentManager: AgentManager, agentSpecs: string[]) {
  let invalidCount = 0
  for (const spec of agentSpecs) {
    // Split only first two colons to preserve Windows paths like C:\repo
    const firstColon = spec.indexOf(':')
    if (firstColon === -1) {
      log.warn(`Invalid agent spec "${spec}", expected name:type[:workdir]`)
      invalidCount++
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
    log.warn('No agents specified. Use --agent to add agents.')
    log.warn('Example: agentim daemon --agent claude:claude-code:/path/to/project')
  } else if (invalidCount === agentSpecs.length) {
    log.error('All agent specs are invalid. No agents registered.')
    process.exit(1)
  } else if (invalidCount > 0) {
    log.warn(`${invalidCount} of ${agentSpecs.length} agent spec(s) were invalid and skipped.`)
  }
}

/**
 * Spawn a detached daemon process for a single agent.
 * The parent (CLI) exits immediately after spawning.
 */
function spawnDaemon(
  name: string,
  type: string,
  workDir: string,
  agentEnv?: Record<string, string>,
  permissionLevel?: PermissionLevel,
) {
  const config = loadConfig()
  if (!config) {
    log.error('Not logged in. Run `agentim login` first.')
    process.exit(1)
  }

  // Check for existing daemon with same name
  const existing = readDaemonInfo(name)
  if (existing) {
    try {
      process.kill(existing.pid, 0)
      log.error(
        `Agent "${name}" is already running (PID ${existing.pid}). Use 'agentim stop ${name}' first.`,
      )
      process.exit(1)
    } catch {
      // Process is dead, clean up stale PID file
    }
  }

  // Create log directory and open log file for daemon output
  const logDir = join(homedir(), '.agentim', 'logs')
  mkdirSync(logDir, { recursive: true })
  const logFile = join(logDir, `${name}.log`)
  const logFd = openSync(logFile, 'a')

  const agentSpec = `${name}:${type}:${workDir}`
  const daemonArgs = [...process.execArgv, ...getEntryArgs(), 'daemon', '--agent', agentSpec]
  if (permissionLevel === 'bypass') {
    daemonArgs.push('--yes')
  }
  const child = cpSpawn(process.execPath, daemonArgs, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: workDir,
    env: { ...process.env, ...agentEnv },
  })

  child.unref()

  if (child.pid) {
    writeDaemonInfo({
      pid: child.pid,
      name,
      type,
      workDir,
      startedAt: new Date().toISOString(),
      gatewayId: config.gatewayId,
    })
    log.info(`Agent "${name}" (${type}) started in background (PID ${child.pid})`)
    log.info(`Working directory: ${workDir}`)
    log.info(`Log file: ${logFile}`)
    log.info(`Use 'agentim list' to see running agents`)
  } else {
    log.error('Failed to start daemon process')
    process.exit(1)
  }
}

/** Get the entry point arguments for re-spawning ourselves. */
function getEntryArgs(): string[] {
  // When running via tsx, process.argv[1] is the .ts file
  // When running built version, process.argv[1] is the .js file
  const entry = process.argv[1]
  if (!entry) return []
  return [entry]
}

program.parse()
