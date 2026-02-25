import { generateAgentName } from './name-generator.js'
import { createGatewaySession } from './gateway-session.js'
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

  const { start } = createGatewaySession({
    permissionLevel: opts.permissionLevel ?? 'interactive',
    onAuthenticated: (agentManager, isReconnect) => {
      if (isReconnect) {
        // On reconnect, re-register existing agent instead of creating a new one
        // to preserve room memberships that reference the old agent ID
        agentManager.reRegisterAll()
        log.info(`Re-registered existing agent: ${agentName}`)
      } else {
        const agentId = agentManager.addAgent({
          type: opts.type,
          name: agentName,
          workingDirectory: workDir,
          env: opts.env,
          passEnv: opts.passEnv,
        })
        log.info(`Agent registered: ${agentName} (${opts.type}) [${agentId}]`)
      }
      log.info(`Working directory: ${workDir}`)
      log.info('Waiting for messages... (Ctrl+C to quit)')
    },
  })

  start()
}
