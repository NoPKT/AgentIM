import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

// Use dynamic imports with cache-busting to get a fresh module for each test,
// since the metrics module uses module-level state (Map singletons).

async function freshMetrics() {
  return import(`../../src/lib/metrics.js?t=${Date.now()}-${Math.random()}`)
}

describe('incCounter', () => {
  it('increments a counter by 1 by default', async () => {
    const m = await freshMetrics()
    m.incCounter('agentim_messages_total')
    m.incCounter('agentim_messages_total')
    const snap = m.getCountersSnapshot()
    assert.equal(snap['agentim_messages_total'], 2)
  })

  it('increments a counter by a custom delta', async () => {
    const m = await freshMetrics()
    m.incCounter('agentim_messages_total', undefined, 5)
    const snap = m.getCountersSnapshot()
    assert.equal(snap['agentim_messages_total'], 5)
  })

  it('creates separate keys for different label sets', async () => {
    const m = await freshMetrics()
    m.incCounter('agentim_ws_messages_total', { type: 'send' })
    m.incCounter('agentim_ws_messages_total', { type: 'send' })
    m.incCounter('agentim_ws_messages_total', { type: 'receive' })
    const snap = m.getCountersSnapshot()
    assert.equal(snap['agentim_ws_messages_total{type="send"}'], 2)
    assert.equal(snap['agentim_ws_messages_total{type="receive"}'], 1)
  })
})

describe('observeAgentDuration / observeHttpDuration', () => {
  it('records agent duration observations in histogram', async () => {
    const m = await freshMetrics()
    m.observeAgentDuration(0.5)
    m.observeAgentDuration(2.0)
    const snap = m.getHistogramsSnapshot()
    const hist = snap['agentim_agent_response_duration_seconds']?.['_']
    assert.ok(hist, 'histogram snapshot should exist')
    assert.equal(hist.count, 2)
    assert.ok(Math.abs(hist.sum - 2.5) < 0.001, 'sum should be 2.5')
  })

  it('records HTTP duration with method and path labels', async () => {
    const m = await freshMetrics()
    m.observeHttpDuration('GET', '/api/rooms', 0.01)
    const snap = m.getHistogramsSnapshot()
    const hist = snap['agentim_http_request_duration_seconds']
    assert.ok(hist, 'HTTP histogram should exist')
    // The key should contain method and path labels
    const key = 'method="GET",path="/api/rooms"'
    assert.ok(hist[key], `histogram entry for ${key} should exist`)
    assert.equal(hist[key].count, 1)
  })

  it('normalizes long IDs in path to /:id', async () => {
    const m = await freshMetrics()
    m.observeHttpDuration('GET', '/api/rooms/abc1234567890xyz/messages', 0.05)
    const snap = m.getHistogramsSnapshot()
    const hist = snap['agentim_http_request_duration_seconds']
    // The path should be normalized to replace the long ID segment
    const key = 'method="GET",path="/api/rooms/:id/messages"'
    assert.ok(hist[key], `histogram entry for ${key} should exist`)
  })

  it('increments correct buckets', async () => {
    const m = await freshMetrics()
    // 0.05 should fall into le=0.1 bucket for agent duration
    m.observeAgentDuration(0.05)
    const snap = m.getHistogramsSnapshot()
    const hist = snap['agentim_agent_response_duration_seconds']?.['_']
    assert.ok(hist)
    // Agent buckets: [0.1, 0.5, 1, 5, 10, 30, 60, 120]
    // 0.05 <= 0.1, so bucket index 0 should be 1, and all subsequent buckets too
    assert.equal(hist.counts[0], 1, 'le=0.1 bucket should have count 1')
    assert.equal(hist.counts[1], 1, 'le=0.5 bucket should also have count 1')
  })
})

describe('renderPrometheusMetrics', () => {
  it('returns empty string when no metrics are recorded', async () => {
    const m = await freshMetrics()
    const output = m.renderPrometheusMetrics()
    assert.equal(output, '')
  })

  it('renders counter metrics in Prometheus format', async () => {
    const m = await freshMetrics()
    m.incCounter('agentim_messages_total')
    m.incCounter('agentim_messages_total')
    const output = m.renderPrometheusMetrics()
    assert.ok(output.includes('# HELP agentim_messages_total'), 'should have HELP line')
    assert.ok(output.includes('# TYPE agentim_messages_total counter'), 'should have TYPE line')
    assert.ok(output.includes('agentim_messages_total 2'), 'should have counter value')
  })

  it('renders histogram metrics with _bucket, _sum, _count lines', async () => {
    const m = await freshMetrics()
    m.observeAgentDuration(1.5)
    const output = m.renderPrometheusMetrics()
    assert.ok(
      output.includes('# TYPE agentim_agent_response_duration_seconds histogram'),
      'should have histogram TYPE',
    )
    assert.ok(
      output.includes('agentim_agent_response_duration_seconds_bucket'),
      'should have _bucket lines',
    )
    assert.ok(
      output.includes('le="+Inf"'),
      'should have +Inf bucket',
    )
    assert.ok(
      output.includes('agentim_agent_response_duration_seconds_sum'),
      'should have _sum line',
    )
    assert.ok(
      output.includes('agentim_agent_response_duration_seconds_count'),
      'should have _count line',
    )
  })

  it('renders active rooms gauge when getter is set', async () => {
    const m = await freshMetrics()
    m.setActiveRoomsGetter(() => 42)
    // Need at least one metric or the rooms getter for non-empty output
    const output = m.renderPrometheusMetrics()
    assert.ok(output.includes('# TYPE agentim_active_rooms gauge'), 'should have gauge TYPE')
    assert.ok(output.includes('agentim_active_rooms 42'), 'should have gauge value')
  })

  it('output ends with newline when metrics exist', async () => {
    const m = await freshMetrics()
    m.incCounter('agentim_messages_total')
    const output = m.renderPrometheusMetrics()
    assert.ok(output.endsWith('\n'), 'output should end with newline')
  })
})

describe('getActiveRooms', () => {
  it('returns 0 when no getter is set', async () => {
    const m = await freshMetrics()
    assert.equal(m.getActiveRooms(), 0)
  })

  it('returns value from getter when set', async () => {
    const m = await freshMetrics()
    m.setActiveRoomsGetter(() => 7)
    assert.equal(m.getActiveRooms(), 7)
  })
})
