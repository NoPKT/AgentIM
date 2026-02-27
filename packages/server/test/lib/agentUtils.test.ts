import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildAgentNameMap } from '../../src/lib/agentUtils.js'

describe('buildAgentNameMap', () => {
  it('returns empty map for empty input', () => {
    const result = buildAgentNameMap([])
    assert.equal(result.size, 0)
  })

  it('maps a single agent by name', () => {
    const agents = [{ name: 'claude', status: 'online' }]
    const result = buildAgentNameMap(agents)
    assert.equal(result.size, 1)
    assert.deepEqual(result.get('claude'), agents[0])
  })

  it('maps multiple agents with unique names', () => {
    const agents = [
      { name: 'claude', status: 'online' },
      { name: 'copilot', status: 'offline' },
      { name: 'gemini', status: 'online' },
    ]
    const result = buildAgentNameMap(agents)
    assert.equal(result.size, 3)
    assert.deepEqual(result.get('claude'), agents[0])
    assert.deepEqual(result.get('copilot'), agents[1])
    assert.deepEqual(result.get('gemini'), agents[2])
  })

  it('prefers online agent when duplicate names exist', () => {
    const offlineAgent = { name: 'claude', status: 'offline' }
    const onlineAgent = { name: 'claude', status: 'online' }
    const agents = [offlineAgent, onlineAgent]
    const result = buildAgentNameMap(agents)
    assert.equal(result.size, 1)
    assert.deepEqual(result.get('claude'), onlineAgent)
  })

  it('keeps online agent even if offline comes later', () => {
    const onlineAgent = { name: 'claude', status: 'online' }
    const offlineAgent = { name: 'claude', status: 'offline' }
    const agents = [onlineAgent, offlineAgent]
    const result = buildAgentNameMap(agents)
    assert.equal(result.size, 1)
    // Online was first, offline should NOT replace it
    assert.deepEqual(result.get('claude'), onlineAgent)
  })

  it('keeps first agent when both duplicates have the same non-online status', () => {
    const first = { name: 'claude', status: 'offline' }
    const second = { name: 'claude', status: 'offline' }
    const agents = [first, second]
    const result = buildAgentNameMap(agents)
    assert.equal(result.size, 1)
    // First one wins since neither is online
    assert.deepEqual(result.get('claude'), first)
  })

  it('handles mixed duplicates across multiple names', () => {
    const agents = [
      { name: 'claude', status: 'offline' },
      { name: 'copilot', status: 'online' },
      { name: 'claude', status: 'online' },
      { name: 'copilot', status: 'offline' },
    ]
    const result = buildAgentNameMap(agents)
    assert.equal(result.size, 2)
    // claude: offline then online → online wins
    assert.equal(result.get('claude')?.status, 'online')
    // copilot: online then offline → online remains
    assert.equal(result.get('copilot')?.status, 'online')
  })

  it('replaces non-online with online status', () => {
    const agents = [
      { name: 'claude', status: 'idle' },
      { name: 'claude', status: 'online' },
    ]
    const result = buildAgentNameMap(agents)
    assert.equal(result.get('claude')?.status, 'online')
  })
})
