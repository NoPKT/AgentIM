import { describe, it, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, rmSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import {
  agentConfigToEnv,
  prepareSubscriptionHome,
  type AgentAuthConfig,
} from '../src/agent-config.js'

const SUBSCRIPTION_HOMES_DIR = join(homedir(), '.agentim', 'subscription-homes')

describe('agentConfigToEnv', () => {
  it('claude-code subscription without oauthData returns empty env', () => {
    const config: AgentAuthConfig = { mode: 'subscription' }
    assert.deepEqual(agentConfigToEnv('claude-code', config), {})
  })

  it('gemini subscription without oauthData sets GOOGLE_GENAI_USE_GCA only', () => {
    const config: AgentAuthConfig = { mode: 'subscription' }
    assert.deepEqual(agentConfigToEnv('gemini', config), { GOOGLE_GENAI_USE_GCA: 'true' })
  })

  it('claude-code: apiKey maps to ANTHROPIC_API_KEY', () => {
    const config: AgentAuthConfig = { mode: 'api', apiKey: 'sk-test' }
    const env = agentConfigToEnv('claude-code', config)
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-test')
  })

  it('claude-code: baseUrl maps to ANTHROPIC_BASE_URL', () => {
    const config: AgentAuthConfig = { mode: 'api', baseUrl: 'https://custom.api' }
    const env = agentConfigToEnv('claude-code', config)
    assert.equal(env.ANTHROPIC_BASE_URL, 'https://custom.api')
  })

  it('claude-code: model maps to ANTHROPIC_MODEL', () => {
    const config: AgentAuthConfig = { mode: 'api', model: 'claude-3-opus' }
    const env = agentConfigToEnv('claude-code', config)
    assert.equal(env.ANTHROPIC_MODEL, 'claude-3-opus')
  })

  it('codex: apiKey maps to both OPENAI_API_KEY and CODEX_API_KEY', () => {
    const config: AgentAuthConfig = { mode: 'api', apiKey: 'sk-openai' }
    const env = agentConfigToEnv('codex', config)
    assert.equal(env.OPENAI_API_KEY, 'sk-openai')
    assert.equal(env.CODEX_API_KEY, 'sk-openai')
  })

  it('codex: baseUrl maps to OPENAI_BASE_URL', () => {
    const config: AgentAuthConfig = { mode: 'api', baseUrl: 'https://openai.custom' }
    const env = agentConfigToEnv('codex', config)
    assert.equal(env.OPENAI_BASE_URL, 'https://openai.custom')
  })

  it('codex: model maps to CODEX_MODEL', () => {
    const config: AgentAuthConfig = { mode: 'api', model: 'gpt-4o' }
    const env = agentConfigToEnv('codex', config)
    assert.equal(env.CODEX_MODEL, 'gpt-4o')
  })

  it('gemini: apiKey maps to GEMINI_API_KEY', () => {
    const config: AgentAuthConfig = { mode: 'api', apiKey: 'gk-test' }
    const env = agentConfigToEnv('gemini', config)
    assert.equal(env.GEMINI_API_KEY, 'gk-test')
  })

  it('gemini: baseUrl maps to GEMINI_BASE_URL', () => {
    const config: AgentAuthConfig = { mode: 'api', baseUrl: 'https://gemini.custom' }
    const env = agentConfigToEnv('gemini', config)
    assert.equal(env.GEMINI_BASE_URL, 'https://gemini.custom')
  })

  it('gemini: model maps to GEMINI_MODEL', () => {
    const config: AgentAuthConfig = { mode: 'api', model: 'gemini-pro' }
    const env = agentConfigToEnv('gemini', config)
    assert.equal(env.GEMINI_MODEL, 'gemini-pro')
  })

  it('unknown agent type returns empty env in api mode', () => {
    const config: AgentAuthConfig = { mode: 'api', apiKey: 'key' }
    assert.deepEqual(agentConfigToEnv('unknown-type', config), {})
  })

  it('partial config (only apiKey, no baseUrl/model) works', () => {
    const config: AgentAuthConfig = { mode: 'api', apiKey: 'sk-partial' }
    const env = agentConfigToEnv('claude-code', config)
    assert.equal(env.ANTHROPIC_API_KEY, 'sk-partial')
    assert.equal(env.ANTHROPIC_BASE_URL, undefined)
    assert.equal(env.ANTHROPIC_MODEL, undefined)
  })
})

describe('agentConfigToEnv subscription with oauthData', () => {
  const testCredId = 'test-cred-001'
  const testOAuthData = JSON.stringify({ access_token: 'tok_test', refresh_token: 'ref_test' })

  afterEach(() => {
    // Clean up test subscription home dirs
    for (const agentType of ['codex', 'claude-code', 'gemini']) {
      const dir = join(SUBSCRIPTION_HOMES_DIR, `${agentType}-${testCredId}`)
      if (existsSync(dir)) rmSync(dir, { recursive: true })
    }
  })

  it('codex subscription with oauthData sets HOME, does NOT set CODEX_API_KEY', () => {
    const config: AgentAuthConfig = { mode: 'subscription', oauthData: testOAuthData }
    const env = agentConfigToEnv('codex', config, testCredId)
    assert.ok(env.HOME, 'HOME should be set')
    assert.ok(env.HOME.includes(`codex-${testCredId}`))
    assert.equal(env.CODEX_API_KEY, undefined)
    assert.equal(env.OPENAI_API_KEY, undefined)
    // Verify auth file was written
    const authFile = join(env.HOME, '.codex', 'auth.json')
    assert.ok(existsSync(authFile), 'auth.json should exist in isolated home')
    assert.equal(readFileSync(authFile, 'utf-8'), testOAuthData)
  })

  it('claude-code subscription with oauthData sets HOME', () => {
    const config: AgentAuthConfig = { mode: 'subscription', oauthData: testOAuthData }
    const env = agentConfigToEnv('claude-code', config, testCredId)
    assert.ok(env.HOME, 'HOME should be set')
    assert.ok(env.HOME.includes(`claude-code-${testCredId}`))
    assert.equal(env.ANTHROPIC_API_KEY, undefined)
    // Verify auth file
    const authFile = join(env.HOME, '.claude.json')
    assert.ok(existsSync(authFile), '.claude.json should exist in isolated home')
  })

  it('gemini subscription with oauthData sets GEMINI_CLI_HOME (not HOME)', () => {
    const config: AgentAuthConfig = { mode: 'subscription', oauthData: testOAuthData }
    const env = agentConfigToEnv('gemini', config, testCredId)
    assert.ok(env.GEMINI_CLI_HOME, 'GEMINI_CLI_HOME should be set')
    assert.equal(env.HOME, undefined, 'HOME should NOT be set for Gemini')
    assert.equal(env.GOOGLE_GENAI_USE_GCA, 'true')
    // Verify auth file
    const authFile = join(env.GEMINI_CLI_HOME, '.gemini', 'oauth_creds.json')
    assert.ok(existsSync(authFile), 'oauth_creds.json should exist in isolated home')
  })

  it('codex subscription without credentialId does not set HOME', () => {
    const config: AgentAuthConfig = { mode: 'subscription', oauthData: testOAuthData }
    const env = agentConfigToEnv('codex', config)
    assert.equal(env.HOME, undefined, 'HOME should not be set without credentialId')
  })
})

describe('prepareSubscriptionHome', () => {
  const testCredId = 'prep-test-001'

  afterEach(() => {
    for (const agentType of ['codex', 'claude-code', 'gemini']) {
      const dir = join(SUBSCRIPTION_HOMES_DIR, `${agentType}-${testCredId}`)
      if (existsSync(dir)) rmSync(dir, { recursive: true })
    }
  })

  it('creates directory and writes auth file for codex', () => {
    const data = '{"tokens":{"access_token":"abc"}}'
    const homeDir = prepareSubscriptionHome('codex', testCredId, data)
    assert.ok(existsSync(homeDir))
    const content = readFileSync(join(homeDir, '.codex', 'auth.json'), 'utf-8')
    assert.equal(content, data)
  })

  it('creates directory and writes auth file for claude-code', () => {
    const data = '{"token":"abc"}'
    const homeDir = prepareSubscriptionHome('claude-code', testCredId, data)
    const content = readFileSync(join(homeDir, '.claude.json'), 'utf-8')
    assert.equal(content, data)
  })

  it('creates directory and writes auth file for gemini', () => {
    const data = '{"client_id":"goog"}'
    const homeDir = prepareSubscriptionHome('gemini', testCredId, data)
    const content = readFileSync(join(homeDir, '.gemini', 'oauth_creds.json'), 'utf-8')
    assert.equal(content, data)
  })

  it('returns homeDir even for unknown agent type', () => {
    const homeDir = prepareSubscriptionHome('unknown', testCredId, '{}')
    assert.ok(existsSync(homeDir))
    // Clean up
    rmSync(homeDir, { recursive: true })
  })
})
