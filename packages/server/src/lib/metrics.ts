/**
 * Hand-written Prometheus metric collectors.
 * Follows the existing project style — no external library.
 */

// ─── Counters ───

const counters = new Map<string, number>()

export function incCounter(name: string, labels?: Record<string, string>, delta = 1) {
  const key = labels ? `${name}{${formatLabels(labels)}}` : name
  counters.set(key, (counters.get(key) ?? 0) + delta)
}

// ─── Histograms (simple bucket-based) ───

interface HistogramData {
  buckets: number[]
  counts: number[] // same length as buckets
  sum: number
  count: number
}

const histograms = new Map<string, Map<string, HistogramData>>()

function getOrCreateHistogram(name: string, labels: string, buckets: number[]): HistogramData {
  let metric = histograms.get(name)
  if (!metric) {
    metric = new Map()
    histograms.set(name, metric)
  }
  let data = metric.get(labels)
  if (!data) {
    data = { buckets, counts: new Array(buckets.length).fill(0), sum: 0, count: 0 }
    metric.set(labels, data)
  }
  return data
}

const AGENT_RESPONSE_BUCKETS = [0.1, 0.5, 1, 5, 10, 30, 60, 120]
const HTTP_DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

export function observeAgentDuration(durationSeconds: number) {
  const data = getOrCreateHistogram(
    'agentim_agent_response_duration_seconds',
    '',
    AGENT_RESPONSE_BUCKETS,
  )
  data.sum += durationSeconds
  data.count++
  for (let i = 0; i < data.buckets.length; i++) {
    if (durationSeconds <= data.buckets[i]) {
      data.counts[i]++
    }
  }
}

export function observeHttpDuration(method: string, path: string, durationSeconds: number) {
  // Normalize path to reduce cardinality: strip IDs
  const normalized = path.replace(/\/[a-zA-Z0-9_-]{10,}(?=\/|$)/g, '/:id')
  const labels = `method="${method}",path="${normalized}"`
  const data = getOrCreateHistogram(
    'agentim_http_request_duration_seconds',
    labels,
    HTTP_DURATION_BUCKETS,
  )
  data.sum += durationSeconds
  data.count++
  for (let i = 0; i < data.buckets.length; i++) {
    if (durationSeconds <= data.buckets[i]) {
      data.counts[i]++
    }
  }
}

// ─── Snapshot exports (for admin dashboard JSON API) ───

export interface HistogramSnapshot {
  buckets: number[]
  counts: number[]
  sum: number
  count: number
  avg: number
  p50: number
  p95: number
  p99: number
}

function computePercentile(data: HistogramData, pct: number): number {
  const target = Math.ceil(data.count * pct)
  if (target <= 0) return 0
  for (let i = 0; i < data.buckets.length; i++) {
    if (data.counts[i] >= target) return data.buckets[i]
  }
  return data.buckets[data.buckets.length - 1]
}

function toSnapshot(data: HistogramData): HistogramSnapshot {
  return {
    buckets: data.buckets,
    counts: data.counts,
    sum: data.sum,
    count: data.count,
    avg: data.count > 0 ? data.sum / data.count : 0,
    p50: computePercentile(data, 0.5),
    p95: computePercentile(data, 0.95),
    p99: computePercentile(data, 0.99),
  }
}

export function getCountersSnapshot(): Record<string, number> {
  const result: Record<string, number> = {}
  for (const [key, value] of counters) {
    result[key] = value
  }
  return result
}

export function getHistogramsSnapshot(): Record<string, Record<string, HistogramSnapshot>> {
  const result: Record<string, Record<string, HistogramSnapshot>> = {}
  for (const [name, metric] of histograms) {
    const entries: Record<string, HistogramSnapshot> = {}
    for (const [labels, data] of metric) {
      entries[labels || '_'] = toSnapshot(data)
    }
    result[name] = entries
  }
  return result
}

export function getActiveRooms(): number {
  return activeRoomsGetter ? activeRoomsGetter() : 0
}

// ─── Active rooms gauge ───

let activeRoomsGetter: (() => number) | undefined

export function setActiveRoomsGetter(fn: () => number) {
  activeRoomsGetter = fn
}

// ─── Render ───

function formatLabels(labels: Record<string, string>): string {
  return Object.entries(labels)
    .map(([k, v]) => `${k}="${v}"`)
    .join(',')
}

function renderHistogram(name: string, help: string): string[] {
  const metric = histograms.get(name)
  if (!metric || metric.size === 0) return []

  const lines: string[] = [`# HELP ${name} ${help}`, `# TYPE ${name} histogram`]

  for (const [labels, data] of metric) {
    const labelPrefix = labels ? `{${labels},` : '{'
    for (let i = 0; i < data.buckets.length; i++) {
      lines.push(`${name}_bucket${labelPrefix}le="${data.buckets[i]}"} ${data.counts[i]}`)
    }
    lines.push(`${name}_bucket${labelPrefix}le="+Inf"} ${data.count}`)
    const sumLabel = labels ? `{${labels}}` : ''
    lines.push(`${name}_sum${sumLabel} ${data.sum.toFixed(6)}`)
    lines.push(`${name}_count${sumLabel} ${data.count}`)
  }

  return lines
}

export function renderPrometheusMetrics(): string {
  const lines: string[] = []

  // Counters
  const countersByName = new Map<string, string[]>()
  for (const [key, value] of counters) {
    const name = key.includes('{') ? key.slice(0, key.indexOf('{')) : key
    if (!countersByName.has(name)) {
      countersByName.set(name, [])
    }
    countersByName.get(name)!.push(`${key} ${value}`)
  }

  const counterMeta: Record<string, string> = {
    agentim_messages_total: 'Total messages processed',
    agentim_ws_messages_total: 'Total WebSocket messages',
    agentim_api_errors_total: 'Total 5xx API errors',
  }

  for (const [name, entries] of countersByName) {
    if (counterMeta[name]) {
      lines.push(`# HELP ${name} ${counterMeta[name]}`)
      lines.push(`# TYPE ${name} counter`)
    }
    lines.push(...entries)
  }

  // Active rooms gauge
  if (activeRoomsGetter) {
    lines.push('# HELP agentim_active_rooms Number of rooms with at least one connected client')
    lines.push('# TYPE agentim_active_rooms gauge')
    lines.push(`agentim_active_rooms ${activeRoomsGetter()}`)
  }

  // Histograms
  lines.push(
    ...renderHistogram(
      'agentim_agent_response_duration_seconds',
      'Agent response duration in seconds',
    ),
  )
  lines.push(
    ...renderHistogram('agentim_http_request_duration_seconds', 'HTTP request duration in seconds'),
  )

  return lines.length > 0 ? lines.join('\n') + '\n' : ''
}
