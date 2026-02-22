import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api.js'

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
    <svg width={width} height={height} className="inline-block">
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
  }>({
    clients: [],
    gateways: [],
    users: [],
    agents: [],
    heap: [],
    rss: [],
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
              <MemoryBar
                label={t('adminDashboard.rss')}
                used={metrics.process.rssBytes}
                total={metrics.process.rssBytes * 1.5}
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
