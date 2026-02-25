#!/usr/bin/env node
import { spawn as cpSpawn } from 'node:child_process'
import { closeSync, mkdirSync, openSync, renameSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { Command, program } from 'commander'
import { nanoid } from 'nanoid'
import { loadConfig, saveConfig, getConfigPath, clearConfig } from './config.js'

const require = createRequire(import.meta.url)
const { version } = require('../package.json')
import { getSafeEnv } from './adapters/spawn-base.js'
import { TokenManager } from './token-manager.js'
import { generateAgentName } from './name-generator.js'
import { prompt, promptPassword, promptSelect } from './interactive.js'
import { runWrapper } from './wrapper.js'
import { loadAgentConfig, agentConfigToEnv } from './agent-config.js'
import { runSetupWizard } from './setup-wizard.js'
import { createLogger } from './lib/logger.js'
import { printSecurityBanner } from './lib/security-banner.js'
import { listCustomAdapters, getCustomAdaptersPath } from './custom-adapters.js'
import { createGatewaySession } from './gateway-session.js'
import {
  listDaemons,
  stopDaemon,
  removeDaemon,
  cleanStaleDaemons,
  writeDaemonInfo,
  readDaemonInfo,
  removeDaemonInfo,
} from './lib/daemon-manager.js'
import type { PermissionLevel } from '@agentim/shared'

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
        { label: 'OpenCode', value: 'opencode' },
        { label: 'Gemini (Coming Soon)', value: 'gemini' },
      ])
    }
    await runSetupWizard(agentType)
  })

// ─── Agent commands (claude, codex, opencode) ───

/** Map agent type to a display name for CLI descriptions and log messages. */
const AGENT_DISPLAY_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
}

/**
 * Register a CLI command for a specific agent type.
 * All agent commands share the same option set and action logic.
 */
function registerAgentCommand(
  parentProgram: Command,
  commandName: string,
  agentType: string,
  description: string,
) {
  parentProgram
    .command(`${commandName} [path]`)
    .description(description)
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
      const name = opts.name ?? generateAgentName(agentType, workDir)
      const permissionLevel: PermissionLevel = opts.yes ? 'bypass' : 'interactive'
      const displayName = AGENT_DISPLAY_NAMES[agentType] ?? agentType
      let agentConfig = loadAgentConfig(agentType)
      if (!agentConfig) {
        log.info(`No credentials configured for ${displayName}.`)
        log.info('Running setup wizard...')
        await runSetupWizard(agentType)
        agentConfig = loadAgentConfig(agentType)
      }
      const env = agentConfig ? agentConfigToEnv(agentType, agentConfig) : {}
      const passEnv = parsePassEnv(opts.passEnv)
      if (opts.foreground) {
        await runWrapper({ type: agentType, name, workDir, env, passEnv, permissionLevel })
      } else {
        spawnDaemon({ name, type: agentType, workDir, env, permissionLevel, passEnv })
      }
    })
}

registerAgentCommand(
  program,
  'claude',
  'claude-code',
  'Start a Claude Code agent (background daemon)',
)
registerAgentCommand(program, 'codex', 'codex', 'Start a Codex agent (background daemon)')
registerAgentCommand(program, 'opencode', 'opencode', 'Start an OpenCode agent (background daemon)')

// ─── agentim gemini [path] ───

program
  .command('gemini')
  .description('Start a Gemini CLI agent (coming soon — SDK not yet published)')
  .action(() => {
    log.info('Gemini CLI integration is coming soon. Stay tuned!')
    process.exit(0)
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

    const { start } = createGatewaySession({
      permissionLevel,
      onAuthenticated: (agentManager, isReconnect) => {
        if (isReconnect) {
          agentManager.reRegisterAll()
        } else {
          registerAgents(agentManager, opts.agent ?? [])
        }
      },
    })

    start()
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

    /* eslint-disable no-console -- CLI table output */
    console.log(
      `\n  ${'Name'.padEnd(40)}${'Type'.padEnd(14)}${'PID'.padEnd(8)}${'Alive'.padEnd(8)}Started`,
    )
    console.log('  ' + '─'.repeat(86))
    for (const d of daemons) {
      const started = new Date(d.startedAt).toLocaleString()
      const alive = d.alive ? 'Yes' : 'No'
      console.log(
        `  ${d.name.padEnd(40)}${(d.type || '?').padEnd(14)}${String(d.pid).padEnd(8)}${alive.padEnd(8)}${started}`,
      )
    }
    console.log()
    /* eslint-enable no-console */
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

    /* eslint-disable no-console -- CLI table output */
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
    /* eslint-enable no-console */
  })

function registerAgents(
  agentManager: import('./agent-manager.js').AgentManager,
  agentSpecs: string[],
) {
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
    // Detect Windows drive letter (e.g. "claude-code:C:\repo" → type="claude-code:C:\repo", no workdir)
    const isWindowsDrive =
      secondColon !== -1 &&
      secondColon === 1 &&
      (rest[secondColon + 1] === '\\' || rest[secondColon + 1] === '/')
    const type = secondColon === -1 || isWindowsDrive ? rest : rest.slice(0, secondColon)
    const workdir =
      secondColon === -1 || isWindowsDrive ? undefined : rest.slice(secondColon + 1) || undefined
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

const LOG_MAX_SIZE = 10 * 1024 * 1024 // 10 MB

/** Rotate a log file if it exceeds LOG_MAX_SIZE. Uses O_EXCL file lock to prevent race conditions. */
function rotateLogIfNeeded(logFile: string) {
  try {
    const stats = statSync(logFile)
    if (stats.size < LOG_MAX_SIZE) return
  } catch {
    return // File doesn't exist yet
  }

  const lockFile = logFile + '.lock'

  // Clean up stale lock files older than 60 seconds (orphaned from crashed processes)
  try {
    const lockStats = statSync(lockFile)
    if (Date.now() - lockStats.mtimeMs > 60_000) {
      log.warn(`Removing stale lock file: ${lockFile}`)
      unlinkSync(lockFile)
    }
  } catch {
    // Lock file doesn't exist — normal case
  }

  let lockFd: number | undefined
  try {
    // Atomic lock acquisition using O_EXCL (fails if lock already exists)
    lockFd = openSync(lockFile, 'wx')

    // Re-check size after acquiring lock (another process may have rotated)
    try {
      const stats = statSync(logFile)
      if (stats.size < LOG_MAX_SIZE) return
    } catch {
      return
    }

    const rotated = logFile + '.1'
    // Remove previous rotated file to prevent unbounded disk growth
    try {
      unlinkSync(rotated)
    } catch {
      // Previous rotated file may not exist
    }
    renameSync(logFile, rotated)
  } catch (err) {
    // EEXIST means another process is rotating — skip
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
      // Unexpected error
      console.error(`Log rotation failed: ${(err as Error).message}`)
    }
  } finally {
    if (lockFd !== undefined) {
      closeSync(lockFd)
      try {
        unlinkSync(lockFile)
      } catch {
        /* already cleaned up */
      }
    }
  }
}

/**
 * Spawn a detached daemon process for a single agent.
 * The parent (CLI) exits immediately after spawning.
 */
function spawnDaemon(opts: {
  name: string
  type: string
  workDir: string
  env?: Record<string, string>
  permissionLevel?: PermissionLevel
  passEnv?: string[]
}) {
  const { name, type, workDir, env: agentEnv, permissionLevel, passEnv } = opts
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

  // Atomically reserve the daemon name before spawning to prevent TOCTOU races.
  // Uses exclusive create ('wx' flag) so a parallel spawner with the same name
  // will fail with EEXIST rather than silently overwriting.
  const reservationInfo = {
    pid: process.pid, // placeholder — updated after spawn
    name,
    type,
    workDir,
    startedAt: new Date().toISOString(),
    gatewayId: config.gatewayId,
  }
  try {
    writeDaemonInfo(reservationInfo, true)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      log.error(
        `Agent "${name}" is already being started by another process. Use a different name or wait.`,
      )
      process.exit(1)
    }
    throw err
  }

  // Create log directory and open log file for daemon output
  const logDir = join(homedir(), '.agentim', 'logs')
  mkdirSync(logDir, { recursive: true })
  const logFile = join(logDir, `${name}.log`)
  rotateLogIfNeeded(logFile)
  const logFd = openSync(logFile, 'a')

  const agentSpec = `${name}:${type}:${workDir}`
  const daemonArgs = [...process.execArgv, ...getEntryArgs(), 'daemon', '--agent', agentSpec]
  if (permissionLevel === 'bypass') {
    daemonArgs.push('--yes')
  }
  // Build safe env, applying passEnv whitelist if provided
  const passEnvSet = passEnv?.length ? new Set(passEnv) : undefined
  const child = cpSpawn(process.execPath, daemonArgs, {
    detached: true,
    stdio: ['ignore', logFd, logFd],
    cwd: workDir,
    env: { ...getSafeEnv(passEnvSet), ...agentEnv },
  })

  child.unref()
  // Close log FD in parent — child process has inherited it
  closeSync(logFd)

  if (child.pid) {
    // Update the reservation with the actual child PID
    writeDaemonInfo({ ...reservationInfo, pid: child.pid })
    log.info(`Agent "${name}" (${type}) started in background (PID ${child.pid})`)
    log.info(`Working directory: ${workDir}`)
    log.info(`Log file: ${logFile}`)
    log.info(`Use 'agentim list' to see running agents`)
  } else {
    // Spawn failed — clean up the reservation
    removeDaemonInfo(name)
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
