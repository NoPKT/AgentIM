import { nanoid } from 'nanoid'
import { generateAgentName } from './name-generator.js'
import { createGatewaySession } from './gateway-session.js'
import { StatusWriter } from './lib/status-writer.js'
import { writeDaemonInfo, readDaemonInfo } from './lib/daemon-manager.js'
import { createLogger } from './lib/logger.js'
import type { PermissionLevel } from '@agentim/shared'

const log = createLogger('Wrapper')

/**
 * Run a single agent in wrapper mode.
 * Connects to the server, registers one agent, and waits for messages.
 */
export async function runWrapper(opts: {
  type: string
  name?: string
  workDir?: string
  env?: Record<string, string>
  passEnv?: string[]
  permissionLevel?: PermissionLevel
}): Promise<void> {
  const workDir = opts.workDir ?? process.cwd()
  const agentName = opts.name ?? generateAgentName(opts.type, workDir)
  let statusWriter: StatusWriter | null = null

  const { start } = createGatewaySession({
    permissionLevel: opts.permissionLevel ?? 'interactive',
    gatewayId: nanoid(),
    exitOnEmpty: true,
    onAuthenticated: (am, isReconnect) => {
      if (isReconnect) {
        // On reconnect, re-register existing agent instead of creating a new one
        // to preserve room memberships that reference the old agent ID
        am.reRegisterAll()
        log.info(`Re-registered existing agent: ${agentName}`)
      } else {
        const agentId = am.addAgent({
          type: opts.type,
          name: agentName,
          workingDirectory: workDir,
          env: opts.env,
          passEnv: opts.passEnv,
        })
        log.info(`Agent registered: ${agentName} (${opts.type}) [${agentId}]`)

        // Persist agentId to daemon info if a PID file exists (daemon mode)
        const existing = readDaemonInfo(agentName)
        if (existing) {
          writeDaemonInfo({ ...existing, agentId })
        }
      }

      // Start status writer on first auth
      if (!statusWriter) {
        statusWriter = new StatusWriter(agentName, am.getAdapters())
        statusWriter.start()
      }

      log.info(`Working directory: ${workDir}`)
      log.info('Waiting for messages... (Ctrl+C to quit)')
    },
    onCleanup: () => {
      statusWriter?.stop()
    },
  })

  start()
}
