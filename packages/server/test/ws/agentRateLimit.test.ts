import { describe, it, after } from 'node:test'
import assert from 'node:assert/strict'
import { stopAgentRateCleanup } from '../../src/ws/agentRateLimit.js'

after(async () => {
  stopAgentRateCleanup()
  // Close persistent connections opened by transitive imports (redis, db)
  const { closeRedis } = await import('../../src/lib/redis.js')
  const { closeDb } = await import('../../src/db/index.js')
  await closeRedis()
  await closeDb()
})

// We test the in-memory path indirectly via isAgentRateLimited (Redis disabled in test env)
describe('agentRateLimit (in-memory path)', () => {
  // Dynamic import to avoid module-level Redis connection
  async function getIsAgentRateLimited() {
    const mod = await import('../../src/ws/agentRateLimit.js')
    return mod.isAgentRateLimited
  }

  it('allows requests under the limit', async () => {
    const isAgentRateLimited = await getIsAgentRateLimited()
    const agentId = `test-agent-${Date.now()}-under`
    const window = 60
    const max = 5

    for (let i = 0; i < max; i++) {
      const limited = await isAgentRateLimited(agentId, window, max)
      assert.equal(limited, false, `request ${i + 1} should be allowed`)
    }
  })

  it('rejects requests over the limit', async () => {
    const isAgentRateLimited = await getIsAgentRateLimited()
    const agentId = `test-agent-${Date.now()}-over`
    const window = 60
    const max = 2

    await isAgentRateLimited(agentId, window, max)
    await isAgentRateLimited(agentId, window, max)
    const limited = await isAgentRateLimited(agentId, window, max)
    assert.equal(limited, true)
  })

  it('different agents are rate-limited independently', async () => {
    const isAgentRateLimited = await getIsAgentRateLimited()
    const agent1 = `test-agent-${Date.now()}-a1`
    const agent2 = `test-agent-${Date.now()}-a2`
    const window = 60
    const max = 1

    await isAgentRateLimited(agent1, window, max)
    const a1limited = await isAgentRateLimited(agent1, window, max)
    assert.equal(a1limited, true, 'agent1 should be rate limited')

    const a2limited = await isAgentRateLimited(agent2, window, max)
    assert.equal(a2limited, false, 'agent2 should not be rate limited')
  })
})
