import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgentStore } from '../stores/agents.js'
import { getStatusConfig, getTypeConfig, agentGradients } from '../lib/agentConfig.js'
import { Button } from '../components/ui.js'
import { AgentInfoModal } from '../components/AgentInfoModal.js'
import { toast } from '../stores/toast.js'
import { AGENT_TYPES } from '@agentim/shared'
import type { Agent, AgentVisibility, Gateway } from '@agentim/shared'

export default function AgentsPage() {
  const { t } = useTranslation()
  const agents = useAgentStore((state) => state.agents)
  const gateways = useAgentStore((state) => state.gateways)
  const isLoading = useAgentStore((state) => state.isLoading)
  const loadError = useAgentStore((state) => state.loadError)
  const loadAgents = useAgentStore((state) => state.loadAgents)
  const loadGateways = useAgentStore((state) => state.loadGateways)

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  useEffect(() => {
    loadAgents()
    loadGateways()
  }, [loadAgents, loadGateways])

  if (isLoading && agents.length === 0) {
    return (
      <div
        data-testid="agents-loading"
        className="flex-1 overflow-y-auto scrollbar-thin bg-surface-secondary px-4 sm:px-6 py-6"
      >
        <div className="max-w-7xl mx-auto">
          <div className="mb-6 animate-pulse">
            <div className="h-8 w-32 bg-skeleton rounded" />
            <div className="mt-2 h-4 w-48 bg-surface-hover rounded" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-surface rounded-xl border border-border p-5 animate-pulse">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-skeleton" />
                  <div className="space-y-2">
                    <div className="h-4 w-24 bg-skeleton rounded" />
                    <div className="h-3 w-16 bg-surface-hover rounded" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-full bg-surface-hover rounded" />
                  <div className="h-3 w-2/3 bg-surface-hover rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (loadError && agents.length === 0) {
    return (
      <div
        data-testid="agents-error"
        className="flex-1 flex items-center justify-center bg-surface-secondary px-4"
      >
        <div className="text-center max-w-md">
          <svg
            className="mx-auto h-12 w-12 text-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-semibold text-text-primary">{t('common.loadFailed')}</h3>
          <Button onClick={loadAgents} className="mt-4">
            {t('common.retry')}
          </Button>
        </div>
      </div>
    )
  }

  if (agents.length === 0) {
    return (
      <div
        data-testid="agents-empty"
        className="flex-1 flex items-center justify-center bg-surface-secondary px-4"
      >
        <div className="text-center max-w-md">
          <svg
            className="mx-auto h-16 w-16 text-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-semibold text-text-primary">{t('agent.noAgents')}</h3>
          <p className="mt-2 text-sm text-text-secondary">{t('agent.noAgentsDesc')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin bg-surface-secondary px-4 sm:px-6 py-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-text-primary">{t('agent.agents')}</h1>
          <p className="mt-1 text-sm text-text-secondary">
            {t('agent.agentsConnected', { count: agents.length })}
          </p>
        </div>

        <div
          data-testid="agents-list"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
        >
          {agents.map((agent) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              onInfoClick={() => setSelectedAgentId(agent.id)}
            />
          ))}
        </div>

        <AgentInfoModal
          agentId={selectedAgentId}
          isOpen={!!selectedAgentId}
          onClose={() => setSelectedAgentId(null)}
          isOwner
        />

        {/* Gateways Section */}
        {gateways.length > 0 && (
          <div className="mt-10">
            <h2 className="text-xl font-bold text-text-primary mb-1">{t('agent.gateways')}</h2>
            <p className="text-sm text-text-secondary mb-4">
              {t('agent.gatewaysConnected', { count: gateways.length })}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {gateways.map((gw) => (
                <GatewayCard key={gw.id} gateway={gw} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function AgentCard({ agent, onInfoClick }: { agent: Agent; onInfoClick: () => void }) {
  const { t, i18n } = useTranslation()
  const updateAgentVisibility = useAgentStore((s) => s.updateAgentVisibility)

  const statusConfig = getStatusConfig(t)
  const typeConfig = getTypeConfig(t)

  const status = statusConfig[agent.status as keyof typeof statusConfig] || statusConfig.offline
  const type = typeConfig[agent.type] || typeConfig.generic
  const gradient = agentGradients[agent.type] || agentGradients.generic

  const isShared = agent.visibility === 'shared'

  const handleToggleVisibility = () => {
    const newVisibility: AgentVisibility = isShared ? 'private' : 'shared'
    updateAgentVisibility(agent.id, newVisibility)
  }

  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <button onClick={onInfoClick} className="flex items-center gap-3 min-w-0 text-left group">
          <div
            className={`w-10 h-10 shrink-0 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center`}
          >
            <span className="text-sm font-semibold text-white">
              {agent.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-text-primary truncate group-hover:text-accent transition-colors">
              {agent.name}
            </h3>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${type.color}`}
            >
              {type.label}
            </span>
          </div>
        </button>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 mb-4">
        <span className="relative flex h-2.5 w-2.5">
          {agent.status === 'online' && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          )}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${status.color}`} />
        </span>
        <span className="text-sm font-medium text-text-secondary">{status.label}</span>
      </div>

      {/* Details */}
      <div className="space-y-2 text-sm">
        {agent.workingDirectory && (
          <div>
            <dt className="text-text-muted text-xs font-medium mb-0.5">{t('agent.workingDir')}</dt>
            <dd
              className="text-text-primary truncate font-mono text-xs"
              title={agent.workingDirectory}
            >
              {agent.workingDirectory}
            </dd>
          </div>
        )}

        {agent.deviceInfo && (
          <div>
            <dt className="text-text-muted text-xs font-medium mb-0.5">{t('agent.device')}</dt>
            <dd className="text-text-primary truncate">
              {agent.deviceInfo.platform}{' '}
              {agent.deviceInfo.hostname && `· ${agent.deviceInfo.hostname}`}
            </dd>
          </div>
        )}

        {agent.capabilities && agent.capabilities.length > 0 && (
          <div>
            <dt className="text-text-muted text-xs font-medium mb-1">{t('agent.capabilities')}</dt>
            <dd className="flex flex-wrap gap-1">
              {agent.capabilities.map((cap) => (
                <span
                  key={cap}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                >
                  {cap}
                </span>
              ))}
            </dd>
          </div>
        )}

        {agent.lastSeenAt && (
          <div>
            <dt className="text-text-muted text-xs font-medium mb-0.5">{t('agent.lastSeen')}</dt>
            <dd className="text-text-primary">
              {new Date(agent.lastSeenAt).toLocaleString(i18n.language, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </dd>
          </div>
        )}
      </div>

      {/* Visibility Toggle */}
      <div className="mt-4 pt-3 border-t border-border">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-text-muted">{t('agent.visibility')}</span>
            <span
              className={`ml-2 text-xs font-medium ${isShared ? 'text-success-text' : 'text-text-muted'}`}
            >
              {isShared ? t('agent.visibilityShared') : t('agent.visibilityPrivate')}
            </span>
          </div>
          <button
            onClick={handleToggleVisibility}
            role="switch"
            aria-checked={isShared}
            aria-label={t('agent.visibility')}
            className={`relative inline-flex h-5 w-10 flex-shrink-0 items-center rounded-full transition-colors ${
              isShared ? 'bg-accent' : 'bg-surface-hover'
            }`}
            title={t('agent.visibilityDesc')}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                isShared ? 'translate-x-5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  )
}

function GatewayCard({ gateway }: { gateway: Gateway }) {
  const { t, i18n } = useTranslation()
  const deleteGateway = useAgentStore((s) => s.deleteGateway)
  const spawnAgent = useAgentStore((s) => s.spawnAgent)
  const loadAgents = useAgentStore((s) => s.loadAgents)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showSpawn, setShowSpawn] = useState(false)
  const [spawnType, setSpawnType] = useState<string>(AGENT_TYPES[0])
  const [spawnName, setSpawnName] = useState('')
  const [spawnWorkDir, setSpawnWorkDir] = useState('')
  const [spawning, setSpawning] = useState(false)

  const isOnline = !!gateway.connectedAt && !gateway.disconnectedAt

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteGateway(gateway.id)
      await loadAgents()
      toast.success(t('agent.gatewayDeleted'))
    } catch {
      toast.error(t('common.error'))
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const handleSpawn = async () => {
    if (!spawnName.trim()) return
    setSpawning(true)
    try {
      await spawnAgent(gateway.id, spawnType, spawnName.trim(), spawnWorkDir.trim() || undefined)
      toast.success(t('agent.spawnSuccess'))
      setShowSpawn(false)
      setSpawnName('')
      setSpawnWorkDir('')
    } catch (err) {
      toast.error((err as Error).message ?? t('agent.spawnFailed'))
    } finally {
      setSpawning(false)
    }
  }

  return (
    <div className="bg-surface rounded-xl border border-border shadow-sm p-5 hover:shadow-md transition-all duration-200">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-500 to-gray-700 flex items-center justify-center">
            <span className="text-sm font-semibold text-white">
              {gateway.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-text-primary truncate">{gateway.name}</h3>
            <div className="flex items-center gap-1.5">
              <span
                className={`w-2 h-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}
              />
              <span className="text-xs text-text-secondary">
                {isOnline ? t('common.online') : t('common.offline')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="space-y-2 text-sm">
        {gateway.deviceInfo && (
          <div>
            <dt className="text-text-muted text-xs font-medium mb-0.5">{t('agent.device')}</dt>
            <dd className="text-text-primary truncate">
              {gateway.deviceInfo.platform}{' '}
              {gateway.deviceInfo.hostname && `· ${gateway.deviceInfo.hostname}`}
            </dd>
          </div>
        )}

        {gateway.disconnectedAt && (
          <div>
            <dt className="text-text-muted text-xs font-medium mb-0.5">
              {t('agent.disconnectedAt')}
            </dt>
            <dd className="text-text-primary">
              {new Date(gateway.disconnectedAt).toLocaleString(i18n.language, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </dd>
          </div>
        )}
      </div>

      {/* Spawn Agent */}
      <div className="mt-4 pt-3 border-t border-border space-y-2">
        {showSpawn ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-text-secondary">{t('agent.spawnAgentDesc')}</p>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {t('agent.agentType')}
              </label>
              <select
                value={spawnType}
                onChange={(e) => setSpawnType(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {AGENT_TYPES.filter((t) => t !== 'generic').map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {t('agent.agentName')}
              </label>
              <input
                type="text"
                value={spawnName}
                onChange={(e) => setSpawnName(e.target.value)}
                placeholder="my-agent"
                className="w-full px-2 py-1.5 text-xs rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1">
                {t('agent.workingDir')}
              </label>
              <input
                type="text"
                value={spawnWorkDir}
                onChange={(e) => setSpawnWorkDir(e.target.value)}
                placeholder="/path/to/project"
                className="w-full px-2 py-1.5 text-xs rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowSpawn(false)}
                className="flex-1"
              >
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                onClick={handleSpawn}
                disabled={spawning || !spawnName.trim()}
                className="flex-1"
              >
                {t('agent.spawnAgent')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {isOnline && (
              <button
                onClick={() => setShowSpawn(true)}
                className="w-full px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors"
              >
                {t('agent.spawnAgent')}
              </button>
            )}
            {confirmDelete ? (
              <div className="space-y-2">
                <p className="text-xs text-text-secondary">{t('agent.confirmDeleteGateway')}</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setConfirmDelete(false)}
                    className="flex-1"
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="flex-1"
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="w-full px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              >
                {t('agent.deleteGateway')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
