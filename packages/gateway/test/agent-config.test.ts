import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { agentConfigToEnv, type AgentAuthConfig } from '../src/agent-config.js'

describe('agentConfigToEnv', () => {
  it('claude-code subscription returns empty env (SDK handles OAuth)', () => {
    const config: AgentAuthConfig = { mode: 'subscription' }
    assert.deepEqual(agentConfigToEnv('claude-code', config), {})
  })

  it('gemini subscription sets GOOGLE_GENAI_USE_GCA for OAuth', () => {
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
