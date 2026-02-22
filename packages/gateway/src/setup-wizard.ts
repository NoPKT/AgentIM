import { type ExecSyncOptions, execSync } from 'node:child_process'
import { promptSelect, prompt, promptPassword } from './interactive.js'
import { saveAgentConfig, type AgentAuthConfig } from './agent-config.js'
import { createLogger } from './lib/logger.js'

const log = createLogger('Setup')

const SUBSCRIPTION_LABELS: Record<string, string> = {
  'claude-code': 'Claude Max / Claude Pro',
  codex: 'ChatGPT Plus / ChatGPT Pro',
  gemini: 'Gemini Advanced',
}

const LOGIN_COMMANDS: Record<string, { cmd: string; description: string }> = {
  'claude-code': {
    cmd: 'npx claude setup-token',
    description: 'Claude Code subscription login',
  },
  codex: {
    cmd: 'npx codex login',
    description: 'Codex subscription login',
  },
  gemini: {
    cmd: 'gemini auth login',
    description: 'Gemini subscription login',
  },
}

export async function runSetupWizard(agentType: string): Promise<void> {
  const subscriptionLabel = SUBSCRIPTION_LABELS[agentType] ?? 'Subscription'

  const authMode = await promptSelect('Authentication method:', [
    { label: `Subscription (${subscriptionLabel})`, value: 'subscription' },
    { label: 'API Key', value: 'api' },
  ])

  if (authMode === 'subscription') {
    await handleSubscription(agentType)
  } else {
    await handleApiKey(agentType)
  }
}

async function handleSubscription(agentType: string): Promise<void> {
  const loginInfo = LOGIN_COMMANDS[agentType]
  if (!loginInfo) {
    log.error(`No subscription login command configured for agent type: ${agentType}`)
    return
  }

  log.info(`Running: ${loginInfo.cmd}`)
  log.info('Please complete the login process in the prompt below...\n')

  try {
    const execOpts: ExecSyncOptions = { stdio: 'inherit' }
    execSync(loginInfo.cmd, execOpts)
  } catch (err) {
    log.error(`Login command failed: ${(err as Error).message}`)
    log.error('You can retry with: agentim setup ' + agentType)
    return
  }

  const config: AgentAuthConfig = { mode: 'subscription' }
  saveAgentConfig(agentType, config)
  log.info(`\n${agentType} subscription authentication configured successfully!`)
}

async function handleApiKey(agentType: string): Promise<void> {
  const apiKey = await promptPassword('API Key: ')
  if (!apiKey) {
    log.error('API Key is required.')
    return
  }

  const baseUrl = await prompt('Base URL (press Enter to skip): ')
  const model = await prompt('Model (press Enter to skip): ')

  const config: AgentAuthConfig = {
    mode: 'api',
    apiKey,
    baseUrl: baseUrl || undefined,
    model: model || undefined,
  }

  saveAgentConfig(agentType, config)
  log.info(`\n${agentType} API authentication configured successfully!`)
}
