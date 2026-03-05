import { type ExecSyncOptions, execSync } from 'node:child_process'
import { promptSelect, prompt, promptPassword } from './interactive.js'
import {
  listCredentials,
  addCredential,
  removeCredential,
  updateCredential,
  setDefaultCredential,
  readSubscriptionAuthData,
  type CredentialEntry,
} from './agent-config.js'
import { createLogger } from './lib/logger.js'

const log = createLogger('Credentials')

const AGENT_DISPLAY_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex',
  gemini: 'Gemini',
}

const LOGIN_COMMANDS: Record<string, { cmd: string; description: string }> = {
  'claude-code': {
    cmd: 'claude setup-token',
    description: 'Claude Code subscription login',
  },
  codex: {
    cmd: 'codex login',
    description: 'Codex subscription login',
  },
  gemini: {
    cmd: 'gemini auth login',
    description: 'Gemini subscription login',
  },
}

/**
 * Run the native subscription login command for an agent type.
 * Returns true on success, false on failure.
 */
function runSubscriptionLogin(agentType: string): boolean {
  const loginInfo = LOGIN_COMMANDS[agentType]
  if (!loginInfo) {
    log.error(`No subscription login command configured for agent type: ${agentType}`)
    return false
  }

  log.info(`Running: ${loginInfo.cmd}`)
  log.info('Please complete the login process in the prompt below...\n')

  try {
    const execOpts: ExecSyncOptions = { stdio: 'inherit' }
    execSync(loginInfo.cmd, execOpts)
    return true
  } catch (err) {
    log.error(`Login command failed: ${(err as Error).message}`)
    return false
  }
}

/** Mask an API key for display: show first 3 and last 4 chars. */
function maskApiKey(key: string): string {
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 3)}••••${key.slice(-4)}`
}

/**
 * Interactive TUI for managing credentials.
 * Used by `aim <type> token` command.
 */
export async function manageCredentials(agentType: string): Promise<void> {
  const displayName = AGENT_DISPLAY_NAMES[agentType] ?? agentType

  for (;;) {
    const creds = listCredentials(agentType)

    /* eslint-disable no-console -- interactive CLI output */
    console.log(`\n${displayName} Credentials:`)
    if (creds.length === 0) {
      console.log('  (none)')
    } else {
      for (let i = 0; i < creds.length; i++) {
        const c = creds[i]
        const def = c.isDefault ? ' [default]' : ''
        const mode = c.mode === 'api' ? `API Key, ${maskApiKey(c.apiKey ?? '')}` : 'Subscription'
        console.log(
          `  ${i + 1}) ${c.isDefault ? '[*] ' : '    '}${c.name.padEnd(16)}(${mode})${def}`,
        )
      }
    }
    console.log()
    /* eslint-enable no-console */

    const actions: { label: string; value: string }[] = [{ label: 'Add credential', value: 'add' }]
    if (creds.length > 0) {
      actions.push({ label: 'Delete credential', value: 'delete' })
      actions.push({ label: 'Rename credential', value: 'rename' })
      if (creds.length > 1) {
        actions.push({ label: 'Set default', value: 'default' })
      }
    }
    actions.push({ label: 'Exit', value: 'exit' })

    const action = await promptSelect('Actions:', actions)

    if (action === 'exit') break

    if (action === 'add') {
      await addCredentialInteractive(agentType)
    } else if (action === 'delete') {
      await deleteCredentialInteractive(agentType, creds)
    } else if (action === 'rename') {
      await renameCredentialInteractive(agentType, creds)
    } else if (action === 'default') {
      await setDefaultInteractive(agentType, creds)
    }
  }
}

/**
 * Interactive flow to add a new credential.
 * Used by both `aim <type> token` (add action) and `aim <type> login`.
 * Returns the created credential entry, or null if cancelled.
 */
export async function addCredentialInteractive(agentType: string): Promise<CredentialEntry | null> {
  const authMode = await promptSelect('Authentication method:', [
    { label: 'API Key', value: 'api' },
    { label: 'Subscription', value: 'subscription' },
  ])

  if (authMode === 'api') {
    const apiKey = await promptPassword('API Key: ')
    if (!apiKey) {
      log.error('API Key is required.')
      return null
    }

    const baseUrl = await prompt('Base URL (press Enter to skip): ')
    const model = await prompt('Model (press Enter to skip): ')
    const name = await prompt('Name for this credential: ')
    if (!name) {
      log.error('Name is required.')
      return null
    }

    const entry = addCredential(agentType, {
      name,
      mode: 'api',
      apiKey,
      baseUrl: baseUrl || undefined,
      model: model || undefined,
    })
    log.info(`Credential "${name}" added successfully!`)
    return entry
  } else {
    // Subscription mode — run the native login command
    const success = runSubscriptionLogin(agentType)
    if (!success) return null

    // Read the auth data that the CLI tool wrote during login
    const oauthData = readSubscriptionAuthData(agentType)

    const name = await prompt('Name for this credential: ')
    if (!name) {
      log.error('Name is required.')
      return null
    }

    const entry = addCredential(agentType, {
      name,
      mode: 'subscription',
      oauthData,
    })
    log.info(`Credential "${name}" added successfully!`)
    if (oauthData) {
      log.info('OAuth auth data captured and stored.')
    } else {
      log.warn('Could not read auth data from CLI — credential isolation may not work.')
    }
    return entry
  }
}

async function deleteCredentialInteractive(
  agentType: string,
  creds: CredentialEntry[],
): Promise<void> {
  const options = creds.map((c, i) => ({
    label: `${i + 1}) ${c.name}`,
    value: c.id,
  }))
  options.push({ label: 'Cancel', value: 'cancel' })

  const id = await promptSelect('Select credential to delete:', options)
  if (id === 'cancel') return

  const cred = creds.find((c) => c.id === id)
  if (!cred) return

  const confirm = await promptSelect(`Delete "${cred.name}"? This cannot be undone.`, [
    { label: 'Yes, delete', value: 'yes' },
    { label: 'Cancel', value: 'no' },
  ])
  if (confirm !== 'yes') return

  removeCredential(agentType, id)
  log.info(`Credential "${cred.name}" deleted.`)
}

async function renameCredentialInteractive(
  agentType: string,
  creds: CredentialEntry[],
): Promise<void> {
  const options = creds.map((c, i) => ({
    label: `${i + 1}) ${c.name}`,
    value: c.id,
  }))
  options.push({ label: 'Cancel', value: 'cancel' })

  const id = await promptSelect('Select credential to rename:', options)
  if (id === 'cancel') return

  const cred = creds.find((c) => c.id === id)
  if (!cred) return

  const newName = await prompt(`New name (current: "${cred.name}"): `)
  if (!newName) {
    log.error('Name is required.')
    return
  }

  updateCredential(agentType, id, { name: newName })
  log.info(`Credential renamed to "${newName}".`)
}

async function setDefaultInteractive(agentType: string, creds: CredentialEntry[]): Promise<void> {
  const options = creds.map((c, i) => ({
    label: `${i + 1}) ${c.name}${c.isDefault ? ' (current default)' : ''}`,
    value: c.id,
  }))
  options.push({ label: 'Cancel', value: 'cancel' })

  const id = await promptSelect('Select default credential:', options)
  if (id === 'cancel') return

  setDefaultCredential(agentType, id)
  const cred = creds.find((c) => c.id === id)
  log.info(`"${cred?.name}" is now the default credential.`)
}
