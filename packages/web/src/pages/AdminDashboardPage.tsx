import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api.js'

interface HistogramSnapshot {
  buckets: number[]
  counts: number[]
  sum: number
  count: number
  avg: number
  p50: number
  p95: number
  p99: number
}

interface AdminMetrics {
  connections: {
    clients: number
    gateways: number
    onlineUsers: number
    connectedAgents: number
  }
  process: {
    uptimeSeconds: number
    heapUsedBytes: number
    rssBytes: number
  }
  activity?: {
    messagesTotal: Record<string, number>
    activeRooms: number
  }
  performance?: {
    agentResponse: Record<string, HistogramSnapshot>
    httpRequest: Record<string, HistogramSnapshot>
  }
  infrastructure?: {
    redisEnabled: boolean
  }
  timestamp: string
}

const MAX_HISTORY = 60

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatBytes(bytes: number): string {
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(1)} MB`
}

function formatDuration(seconds: number): string {
  if (seconds < 0.001) return '<1ms'
  if (seconds < 1) return `${(seconds * 1000).toFixed(0)}ms`
  return `${seconds.toFixed(2)}s`
}

/** Simple SVG sparkline chart */
function Sparkline({
  data,
  color,
  height = 32,
  width = 120,
}: {
  data: number[]
  color: string
  height?: number
  width?: number
}) {
  if (data.length < 2) return null

  const max = Math.max(...data, 1)
  const min = Math.min(...data, 0)
  const range = max - min || 1

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * width
      const y = height - ((v - min) / range) * (height - 4) - 2
      return `${x},${y}`
    })
    .join(' ')

  return (
    <svg width={width} height={height} className="inline-block" aria-hidden="true">
      <polyline fill="none" stroke={color} strokeWidth="1.5" points={points} />
    </svg>
  )
}

function MetricCard({
  label,
  value,
  history,
  color,
  subtitle,
}: {
  label: string
  value: string | number
  history?: number[]
  color: string
  subtitle?: string
}) {
  return (
    <div className="bg-surface rounded-xl border border-border p-4 flex flex-col gap-2">
      <div className="text-xs text-text-muted font-medium uppercase tracking-wide">{label}</div>
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-2xl font-bold text-text-primary">{value}</div>
          {subtitle && <div className="text-xs text-text-muted mt-0.5">{subtitle}</div>}
        </div>
        {history && history.length > 1 && <Sparkline data={history} color={color} />}
      </div>
    </div>
  )
}

function MemoryBar({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0
  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-text-muted font-medium uppercase tracking-wide">{label}</span>
        <span className="text-sm font-semibold text-text-primary">{formatBytes(used)}</span>
      </div>
      <div className="h-2 bg-surface-secondary rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e',
          }}
        />
      </div>
    </div>
  )
}

/** SVG bar chart for histogram buckets */
function BarChart({
  buckets,
  counts,
  color,
  height = 80,
  width = 320,
}: {
  buckets: number[]
  counts: number[]
  color: string
  height?: number
  width?: number
}) {
  const max = Math.max(...counts, 1)
  const barWidth = width / buckets.length - 2
  const padding = 16

  return (
    <svg width={width} height={height + padding} className="w-full">
      {buckets.map((bucket, i) => {
        const barHeight = (counts[i] / max) * height
        const x = i * (barWidth + 2) + 1
        const y = height - barHeight
        return (
          <g key={i}>
            <rect x={x} y={y} width={barWidth} height={barHeight} fill={color} rx={2} opacity={0.8}>
              <title>{`≤${bucket}s: ${counts[i]}`}</title>
            </rect>
            <text
              x={x + barWidth / 2}
              y={height + padding - 2}
              textAnchor="middle"
              className="fill-text-muted"
              fontSize={8}
            >
              {bucket >= 1 ? `${bucket}s` : `${bucket * 1000}ms`}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** Histogram card with bar chart + percentile stats */
function HistogramCard({
  title,
  snapshot,
  color,
  t,
}: {
  title: string
  snapshot: HistogramSnapshot | null
  color: string
  t: (key: string) => string
}) {
  if (!snapshot || snapshot.count === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-4">
        <div className="text-xs text-text-muted font-medium uppercase tracking-wide mb-2">
          {title}
        </div>
        <div className="text-sm text-text-muted">{t('adminDashboard.noData')}</div>
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="text-xs text-text-muted font-medium uppercase tracking-wide mb-3">
        {title}
      </div>
      <BarChart buckets={snapshot.buckets} counts={snapshot.counts} color={color} />
      <div className="grid grid-cols-4 gap-2 mt-3">
        <div className="text-center">
          <div className="text-xs text-text-muted">{t('adminDashboard.average')}</div>
          <div className="text-sm font-semibold text-text-primary">
            {formatDuration(snapshot.avg)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-text-muted">p50</div>
          <div className="text-sm font-semibold text-text-primary">
            {formatDuration(snapshot.p50)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-text-muted">p95</div>
          <div className="text-sm font-semibold text-text-primary">
            {formatDuration(snapshot.p95)}
          </div>
        </div>
        <div className="text-center">
          <div className="text-xs text-text-muted">p99</div>
          <div className="text-sm font-semibold text-text-primary">
            {formatDuration(snapshot.p99)}
          </div>
        </div>
      </div>
      <div className="text-xs text-text-muted mt-2 text-right">
        {t('adminDashboard.totalRequests')}: {snapshot.count}
      </div>
    </div>
  )
}

/** Table of slowest HTTP endpoints */
function EndpointTable({
  httpRequest,
  t,
}: {
  httpRequest: Record<string, HistogramSnapshot>
  t: (key: string) => string
}) {
  const entries = Object.entries(httpRequest)
    .filter(([, snap]) => snap.count > 0)
    .map(([labels, snap]) => {
      const match = labels.match(/path="([^"]+)"/)
      const endpoint = match ? match[1] : labels
      return { endpoint, avg: snap.avg, count: snap.count }
    })
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 5)

  if (entries.length === 0) {
    return (
      <div className="bg-surface rounded-xl border border-border p-4">
        <div className="text-xs text-text-muted font-medium uppercase tracking-wide mb-2">
          {t('adminDashboard.slowestEndpoints')}
        </div>
        <div className="text-sm text-text-muted">{t('adminDashboard.noData')}</div>
      </div>
    )
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-4">
      <div className="text-xs text-text-muted font-medium uppercase tracking-wide mb-3">
        {t('adminDashboard.slowestEndpoints')}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-text-muted">
            <th className="pb-2 font-medium">{t('adminDashboard.endpoint')}</th>
            <th className="pb-2 font-medium text-right">{t('adminDashboard.avgDuration')}</th>
            <th className="pb-2 font-medium text-right">{t('adminDashboard.totalRequests')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.endpoint} className="border-t border-border">
              <td className="py-1.5 text-text-primary font-mono text-xs">{e.endpoint}</td>
              <td className="py-1.5 text-text-primary text-right">{formatDuration(e.avg)}</td>
              <td className="py-1.5 text-text-muted text-right">{e.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AdminDashboardPage() {
  const { t } = useTranslation()
  const [metrics, setMetrics] = useState<AdminMetrics | null>(null)
  const [error, setError] = useState<string | null>(null)
  const historyRef = useRef<{
    clients: number[]
    gateways: number[]
    users: number[]
    agents: number[]
    heap: number[]
    rss: number[]
    messages: number[]
    wsMessages: number[]
    activeRooms: number[]
  }>({
    clients: [],
    gateways: [],
    users: [],
    agents: [],
    heap: [],
    rss: [],
    messages: [],
    wsMessages: [],
    activeRooms: [],
  })

  const fetchMetrics = useCallback(async () => {
    try {
      const data = await api.get<AdminMetrics>('/admin/metrics')
      if (data.ok && data.data) {
        setMetrics(data.data)
        setError(null)
        const h = historyRef.current
        const push = (arr: number[], val: number) => {
          arr.push(val)
          if (arr.length > MAX_HISTORY) arr.shift()
        }
        push(h.clients, data.data.connections.clients)
        push(h.gateways, data.data.connections.gateways)
        push(h.users, data.data.connections.onlineUsers)
        push(h.agents, data.data.connections.connectedAgents)
        push(h.heap, data.data.process.heapUsedBytes)
        push(h.rss, data.data.process.rssBytes)
        if (data.data.activity) {
          const counters = data.data.activity.messagesTotal
          const msgTotal = counters['agentim_messages_total'] ?? 0
          const wsTotal = counters['agentim_ws_messages_total'] ?? 0
          push(h.messages, msgTotal)
          push(h.wsMessages, wsTotal)
          push(h.activeRooms, data.data.activity.activeRooms)
        }
      } else {
        setError(data.error || 'Failed to fetch metrics')
      }
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    fetchMetrics()
    const interval = setInterval(fetchMetrics, 5000)
    return () => clearInterval(interval)
  }, [fetchMetrics])

  const h = historyRef.current

  // Extract aggregate agent response histogram
  const agentSnap =
    metrics?.performance?.agentResponse &&
    Object.values(metrics.performance.agentResponse).find((s) => s.count > 0)

  // Aggregate all HTTP histogram entries into one for the overview chart
  const httpEntries = metrics?.performance?.httpRequest
    ? Object.values(metrics.performance.httpRequest).filter((s) => s.count > 0)
    : []
  const httpAggSnap: HistogramSnapshot | null =
    httpEntries.length > 0
      ? httpEntries.reduce(
          (acc, s) => ({
            buckets: s.buckets,
            counts: s.counts.map((c, i) => (acc.counts[i] ?? 0) + c),
            sum: acc.sum + s.sum,
            count: acc.count + s.count,
            avg: 0,
            p50: 0,
            p95: 0,
            p99: 0,
          }),
          {
            buckets: httpEntries[0].buckets,
            counts: new Array(httpEntries[0].buckets.length).fill(0) as number[],
            sum: 0,
            count: 0,
            avg: 0,
            p50: 0,
            p95: 0,
            p99: 0,
          },
        )
      : null
  if (httpAggSnap && httpAggSnap.count > 0) {
    httpAggSnap.avg = httpAggSnap.sum / httpAggSnap.count
    // Approximate percentiles from aggregated cumulative counts
    for (const pctKey of ['p50', 'p95', 'p99'] as const) {
      const pct = pctKey === 'p50' ? 0.5 : pctKey === 'p95' ? 0.95 : 0.99
      const target = Math.ceil(httpAggSnap.count * pct)
      let found = httpAggSnap.buckets[httpAggSnap.buckets.length - 1]
      for (let i = 0; i < httpAggSnap.buckets.length; i++) {
        if (httpAggSnap.counts[i] >= target) {
          found = httpAggSnap.buckets[i]
          break
        }
      }
      httpAggSnap[pctKey] = found
    }
  }

  const messagesTotal = metrics?.activity?.messagesTotal?.['agentim_messages_total'] ?? 0
  const wsMessagesTotal = metrics?.activity?.messagesTotal?.['agentim_ws_messages_total'] ?? 0
  const activeRooms = metrics?.activity?.activeRooms ?? 0

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">{t('adminDashboard.title')}</h1>
          <p className="text-sm text-text-muted mt-1">{t('adminDashboard.description')}</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-danger-subtle border border-danger/20 rounded-lg text-sm text-danger-text">
            {error}
          </div>
        )}

        {metrics?.infrastructure?.redisEnabled === false && (
          <div className="mb-4 p-3 bg-warning-subtle border border-warning/20 rounded-lg text-sm text-warning-text">
            {t('adminDashboard.redisWarning')}
          </div>
        )}

        {metrics ? (
          <div className="space-y-4">
            {/* Connection metrics */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                label={t('adminDashboard.clientConnections')}
                value={metrics.connections.clients}
                history={h.clients}
                color="#3b82f6"
              />
              <MetricCard
                label={t('adminDashboard.gatewayConnections')}
                value={metrics.connections.gateways}
                history={h.gateways}
                color="#8b5cf6"
              />
              <MetricCard
                label={t('adminDashboard.onlineUsers')}
                value={metrics.connections.onlineUsers}
                history={h.users}
                color="#10b981"
              />
              <MetricCard
                label={t('adminDashboard.connectedAgents')}
                value={metrics.connections.connectedAgents}
                history={h.agents}
                color="#f59e0b"
              />
            </div>

            {/* Memory and uptime */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <MemoryBar
                label={t('adminDashboard.heapUsed')}
                used={metrics.process.heapUsedBytes}
                total={metrics.process.rssBytes}
              />
              <MetricCard
                label={t('adminDashboard.rss')}
                value={formatBytes(metrics.process.rssBytes)}
                history={h.rss}
                color="#ef4444"
              />
              <MetricCard
                label={t('adminDashboard.uptime')}
                value={formatUptime(metrics.process.uptimeSeconds)}
                color="#6366f1"
                subtitle={new Date(metrics.timestamp).toLocaleString()}
              />
            </div>

            {/* Memory sparklines */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <MetricCard
                label={`${t('adminDashboard.heapUsed')} (${t('adminDashboard.refreshInterval')})`}
                value={formatBytes(metrics.process.heapUsedBytes)}
                history={h.heap}
                color="#f97316"
              />
              <MetricCard
                label={`${t('adminDashboard.rss')} (${t('adminDashboard.refreshInterval')})`}
                value={formatBytes(metrics.process.rssBytes)}
                history={h.rss}
                color="#ef4444"
              />
            </div>

            {/* Message Activity */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <MetricCard
                label={t('adminDashboard.messagesTotal')}
                value={messagesTotal}
                history={h.messages}
                color="#06b6d4"
              />
              <MetricCard
                label={t('adminDashboard.wsMessagesTotal')}
                value={wsMessagesTotal}
                history={h.wsMessages}
                color="#8b5cf6"
              />
              <MetricCard
                label={t('adminDashboard.activeRooms')}
                value={activeRooms}
                history={h.activeRooms}
                color="#10b981"
              />
            </div>

            {/* Agent Performance */}
            <HistogramCard
              title={t('adminDashboard.agentPerformance')}
              snapshot={agentSnap ?? null}
              color="#f59e0b"
              t={t}
            />

            {/* HTTP Performance */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <HistogramCard
                title={t('adminDashboard.httpPerformance')}
                snapshot={httpAggSnap}
                color="#3b82f6"
                t={t}
              />
              <EndpointTable httpRequest={metrics.performance?.httpRequest ?? {}} t={t} />
            </div>
          </div>
        ) : (
          !error && (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            </div>
          )
        )}
      </div>
    </div>
  )
}
