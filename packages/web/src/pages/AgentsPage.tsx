import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgentStore, type CredentialInfo } from '../stores/agents.js'
import {
  getStatusConfig,
  getTypeConfig,
  agentGradients,
  agentTypeIcons,
} from '../lib/agentConfig.js'
import { Button } from '../components/ui.js'
import { toast } from '../stores/toast.js'
import { wsClient } from '../lib/ws.js'
import { AGENT_TYPES } from '@agentim/shared'
import type { Agent, AgentVisibility, Gateway } from '@agentim/shared'
import { TrashIcon } from '../components/icons.js'

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
        <div className="max-w-4xl mx-auto">
          <div className="mb-6 animate-pulse">
            <div className="h-8 w-32 bg-skeleton rounded" />
            <div className="mt-2 h-4 w-48 bg-surface-hover rounded" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface rounded-lg border border-border p-3 animate-pulse flex items-center gap-3"
              >
                <div className="w-8 h-8 rounded-full bg-skeleton flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-4 w-32 bg-skeleton rounded" />
                  <div className="h-3 w-20 bg-surface-hover rounded" />
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

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin bg-surface-secondary px-4 sm:px-6 py-6">
      <div className="max-w-4xl mx-auto">
        {/* Agents Section */}
        {agents.length > 0 ? (
          <>
            <div className="mb-4">
              <h1 className="text-2xl font-bold text-text-primary">{t('agent.agents')}</h1>
              <p className="mt-1 text-sm text-text-secondary">
                {t('agent.agentsConnected', { count: agents.length })}
              </p>
            </div>

            <div data-testid="agents-list" className="space-y-1.5">
              {agents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  expanded={selectedAgentId === agent.id}
                  onToggle={() =>
                    setSelectedAgentId((prev) => (prev === agent.id ? null : agent.id))
                  }
                />
              ))}
            </div>
          </>
        ) : (
          <div data-testid="agents-empty" className="text-center py-12">
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
        )}

        {/* Gateways Section — always visible so users can spawn agents on daemon gateways */}
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

function AgentRow({
  agent,
  expanded,
  onToggle,
}: {
  agent: Agent
  expanded: boolean
  onToggle: () => void
}) {
  const { t, i18n } = useTranslation()
  const updateAgentVisibility = useAgentStore((s) => s.updateAgentVisibility)
  const deleteAgent = useAgentStore((s) => s.deleteAgent)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const statusConfig = getStatusConfig(t)
  const typeConfig = getTypeConfig(t)

  const status = statusConfig[agent.status as keyof typeof statusConfig] || statusConfig.offline
  const type = typeConfig[agent.type] || typeConfig.generic
  const gradient = agentGradients[agent.type] || agentGradients.generic

  const isShared = agent.visibility === 'shared'

  const handleToggleVisibility = (e: React.MouseEvent) => {
    e.stopPropagation()
    const newVisibility: AgentVisibility = isShared ? 'private' : 'shared'
    updateAgentVisibility(agent.id, newVisibility)
  }

  const handleDeleteConfirm = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setDeleting(true)
    try {
      await deleteAgent(agent.id)
      toast.success(t('agent.agentDeleted'))
    } catch {
      toast.error(t('common.error'))
    } finally {
      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  const deviceLabel = agent.deviceInfo
    ? `${agent.deviceInfo.platform}${agent.deviceInfo.hostname ? ` · ${agent.deviceInfo.hostname}` : ''}`
    : null

  return (
    <div className="bg-surface rounded-lg border border-border overflow-hidden transition-colors">
      {/* Header row */}
      <div
        className="px-3 py-2.5 flex items-center gap-3 hover:bg-surface-hover/50 cursor-pointer"
        onClick={onToggle}
      >
        {/* Status dot */}
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          {agent.status === 'online' && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          )}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${status.color}`} />
        </span>

        {/* Avatar (official brand icon) + Name */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          {(() => {
            const icon = agentTypeIcons[agent.type] || agentTypeIcons.generic
            return (
              <div
                className={`w-8 h-8 shrink-0 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center`}
              >
                <svg
                  className="w-4 h-4 text-white"
                  fill="currentColor"
                  viewBox={icon.viewBox || '0 0 24 24'}
                >
                  {icon.paths.map((d, idx) => (
                    <path key={idx} d={d} />
                  ))}
                </svg>
              </div>
            )
          })()}
          <span className="text-sm font-medium text-text-primary truncate">{agent.name}</span>
        </div>

        {/* Device info (hidden on small screens) */}
        {deviceLabel && (
          <span className="hidden md:inline text-xs text-text-muted truncate max-w-[200px]">
            {deviceLabel}
          </span>
        )}

        {/* Visibility toggle */}
        <button
          onClick={handleToggleVisibility}
          role="switch"
          aria-checked={isShared}
          aria-label={t('agent.visibility')}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
            isShared ? 'bg-accent' : 'bg-surface-hover'
          }`}
          title={isShared ? t('agent.visibilityShared') : t('agent.visibilityPrivate')}
        >
          <span
            className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
              isShared ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>

        {/* Delete button / confirm */}
        {confirmDelete ? (
          <div
            className="flex items-center gap-1 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleDeleteConfirm}
              disabled={deleting}
              className="px-2 py-1 text-xs font-medium text-danger-text bg-danger-subtle rounded hover:bg-danger-subtle/80 transition-colors disabled:opacity-50"
            >
              {t('common.confirm')}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setConfirmDelete(false)
              }}
              className="px-2 py-1 text-xs font-medium text-text-secondary bg-surface-hover rounded hover:bg-surface-hover/80 transition-colors"
            >
              {t('common.cancel')}
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setConfirmDelete(true)
            }}
            className="p-1.5 rounded-md text-text-muted/50 hover:text-danger-text hover:bg-surface-hover transition-colors flex-shrink-0"
            title={t('agent.deleteAgent')}
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        )}

        {/* Expand/collapse chevron */}
        <svg
          className={`w-4 h-4 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 bg-surface-secondary/50 space-y-3 text-sm">
          {/* Full name */}
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-xs text-text-muted shrink-0">{t('agent.agentName')}</span>
            <span className="text-xs font-medium text-text-primary break-all text-right">
              {agent.name}
            </span>
          </div>

          {/* Agent type */}
          <div className="flex items-baseline justify-between gap-4">
            <span className="text-xs text-text-muted shrink-0">{t('agent.agentType')}</span>
            <span
              className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium ${type.color}`}
            >
              {type.label}
            </span>
          </div>

          {/* Model */}
          {agent.model && (
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-xs text-text-muted shrink-0">{t('agentPanel.model')}</span>
              <span className="text-xs font-mono text-text-primary truncate">{agent.model}</span>
            </div>
          )}

          {/* Working directory */}
          {agent.workingDirectory && (
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-xs text-text-muted shrink-0">{t('agent.workingDir')}</span>
              <span
                className="text-xs font-mono text-text-primary truncate"
                title={agent.workingDirectory}
              >
                {agent.workingDirectory}
              </span>
            </div>
          )}

          {/* Device info */}
          {agent.deviceInfo && (
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-xs text-text-muted shrink-0">{t('agent.device')}</span>
              <span className="text-xs text-text-primary">
                {agent.deviceInfo.hostname || agent.deviceInfo.platform}
                {agent.deviceInfo.arch ? ` (${agent.deviceInfo.arch})` : ''}
              </span>
            </div>
          )}

          {/* Session cost */}
          {agent.sessionCostUSD != null && agent.sessionCostUSD > 0 && (
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-xs text-text-muted shrink-0">{t('agentPanel.cost')}</span>
              <span className="text-xs font-mono text-text-primary">
                ${agent.sessionCostUSD.toFixed(4)}
              </span>
            </div>
          )}

          {/* Last seen */}
          {agent.lastSeenAt && (
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-xs text-text-muted shrink-0">{t('agent.lastSeen')}</span>
              <span className="text-xs text-text-primary">
                {new Date(agent.lastSeenAt).toLocaleString(i18n.language, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          )}

          {/* Slash commands */}
          {agent.slashCommands && agent.slashCommands.length > 0 && (
            <div>
              <span className="text-xs text-text-muted">{t('agentPanel.slashCommands')}</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {agent.slashCommands.map((cmd) => (
                  <span
                    key={cmd.name}
                    className="px-1.5 py-0.5 text-[10px] font-mono bg-surface-hover rounded text-text-secondary"
                    title={cmd.description}
                  >
                    /{cmd.name}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function GatewayCard({ gateway }: { gateway: Gateway }) {
  const { t, i18n } = useTranslation()
  const deleteGateway = useAgentStore((s) => s.deleteGateway)
  const spawnAgent = useAgentStore((s) => s.spawnAgent)
  const loadAgents = useAgentStore((s) => s.loadAgents)
  const gatewayCredentials = useAgentStore((s) => s.gatewayCredentials)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showSpawn, setShowSpawn] = useState(false)
  const [showCredentials, setShowCredentials] = useState(false)
  const [spawnType, setSpawnType] = useState<string>(AGENT_TYPES[0])
  const [spawnName, setSpawnName] = useState('')
  const [spawnWorkDir, setSpawnWorkDir] = useState('')
  const [spawning, setSpawning] = useState(false)
  const [credentialSelection, setCredentialSelection] = useState<CredentialInfo[] | null>(null)
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('')

  const isOnline = !!gateway.connectedAt && !gateway.disconnectedAt

  // Load credentials when spawn form opens
  const credKey = `${gateway.id}:${spawnType}`
  const credentials = gatewayCredentials.get(credKey) ?? null

  useEffect(() => {
    if (showSpawn && isOnline) {
      wsClient.send({
        type: 'client:list_gateway_credentials',
        gatewayId: gateway.id,
        agentType: spawnType,
      })
    }
  }, [showSpawn, spawnType, gateway.id, isOnline])

  // Listen for credential selection required events from spawn results
  const handleCredentialRequired = useCallback(
    (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.gatewayId === gateway.id) {
        setCredentialSelection(detail.credentials)
        setSpawning(false)
      }
    },
    [gateway.id],
  )

  useEffect(() => {
    window.addEventListener('agentim:credential_selection_required', handleCredentialRequired)
    return () => {
      window.removeEventListener('agentim:credential_selection_required', handleCredentialRequired)
    }
  }, [handleCredentialRequired])

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
    setCredentialSelection(null)
    try {
      // If we have credentials loaded and there's more than one, include the selected credential
      const credId =
        credentials && credentials.length > 1 ? selectedCredentialId || undefined : undefined
      await spawnAgent(
        gateway.id,
        spawnType,
        spawnName.trim(),
        spawnWorkDir.trim() || undefined,
        credId,
      )
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

  const handleSpawnWithCredential = async (credentialId: string) => {
    if (!spawnName.trim()) return
    setSpawning(true)
    setCredentialSelection(null)
    try {
      await spawnAgent(
        gateway.id,
        spawnType,
        spawnName.trim(),
        spawnWorkDir.trim() || undefined,
        credentialId,
      )
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

      {/* Spawn Agent + Credentials */}
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

            {/* Credential selector — shown when multiple credentials exist */}
            {credentials && credentials.length > 1 && (
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  {t('credential.selectCredential')}
                </label>
                <select
                  value={selectedCredentialId}
                  onChange={(e) => setSelectedCredentialId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option value="">{t('credential.default')}</option>
                  {credentials.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} (
                      {c.mode === 'api'
                        ? t('credential.modeApi')
                        : t('credential.modeSubscription')}
                      ){c.isDefault ? ` [${t('credential.default')}]` : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {credentials && credentials.length === 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t('credential.noCredentials')}
              </p>
            )}

            {/* Credential selection required — returned from gateway */}
            {credentialSelection && (
              <div className="border border-amber-300 dark:border-amber-700 rounded-lg p-2 bg-amber-50 dark:bg-amber-900/20">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-2">
                  {t('credential.credentialRequired')}
                </p>
                <div className="space-y-1">
                  {credentialSelection.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => handleSpawnWithCredential(c.id)}
                      className="w-full text-left px-2 py-1.5 text-xs rounded border border-border bg-surface hover:bg-surface-hover transition-colors"
                    >
                      {c.name} (
                      {c.mode === 'api'
                        ? t('credential.modeApi')
                        : t('credential.modeSubscription')}
                      )
                    </button>
                  ))}
                </div>
              </div>
            )}

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
              <>
                <button
                  onClick={() => setShowSpawn(true)}
                  className="w-full px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors"
                >
                  {t('agent.spawnAgent')}
                </button>
                <button
                  onClick={() => setShowCredentials((v) => !v)}
                  className="w-full px-3 py-1.5 text-xs font-medium text-text-secondary bg-surface-hover/50 rounded-lg hover:bg-surface-hover transition-colors"
                >
                  {t('credential.title')}
                  <span className="ml-1 text-[10px]">{showCredentials ? '\u25B2' : '\u25BC'}</span>
                </button>
              </>
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

      {/* Credentials Management Panel */}
      {showCredentials && isOnline && <GatewayCredentialsPanel gatewayId={gateway.id} />}
    </div>
  )
}

function GatewayCredentialsPanel({ gatewayId }: { gatewayId: string }) {
  const { t } = useTranslation()
  const gatewayCredentials = useAgentStore((s) => s.gatewayCredentials)
  const addGatewayCredential = useAgentStore((s) => s.addGatewayCredential)
  const manageGatewayCredential = useAgentStore((s) => s.manageGatewayCredential)
  const refreshGatewayCredentials = useAgentStore((s) => s.refreshGatewayCredentials)

  const [credAgentType, setCredAgentType] = useState<string>(AGENT_TYPES[0])
  const [showAddForm, setShowAddForm] = useState(false)
  const [addName, setAddName] = useState('')
  const [addApiKey, setAddApiKey] = useState('')
  const [addBaseUrl, setAddBaseUrl] = useState('')
  const [addModel, setAddModel] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  const credKey = `${gatewayId}:${credAgentType}`
  const creds = gatewayCredentials.get(credKey) ?? null

  // Fetch credentials when agent type changes
  useEffect(() => {
    refreshGatewayCredentials(gatewayId, credAgentType)
  }, [gatewayId, credAgentType, refreshGatewayCredentials])

  // Listen for credential_updated events to refresh
  useEffect(() => {
    const handler = () => {
      refreshGatewayCredentials(gatewayId, credAgentType)
    }
    window.addEventListener('agentim:credential_updated', handler)
    return () => window.removeEventListener('agentim:credential_updated', handler)
  }, [gatewayId, credAgentType, refreshGatewayCredentials])

  const handleAdd = () => {
    if (!addName.trim() || !addApiKey.trim()) return
    addGatewayCredential(gatewayId, credAgentType, {
      name: addName.trim(),
      apiKey: addApiKey,
      baseUrl: addBaseUrl || undefined,
      model: addModel || undefined,
    })
    setAddName('')
    setAddApiKey('')
    setAddBaseUrl('')
    setAddModel('')
    setShowAddForm(false)
  }

  const handleRename = (credentialId: string) => {
    if (!renameValue.trim()) return
    manageGatewayCredential(gatewayId, credAgentType, credentialId, 'rename', renameValue.trim())
    setRenamingId(null)
    setRenameValue('')
  }

  const handleDelete = (credentialId: string) => {
    manageGatewayCredential(gatewayId, credAgentType, credentialId, 'delete')
    setConfirmDeleteId(null)
  }

  const handleSetDefault = (credentialId: string) => {
    manageGatewayCredential(gatewayId, credAgentType, credentialId, 'set_default')
  }

  return (
    <div className="mt-3 pt-3 border-t border-border">
      {/* Agent type tabs */}
      <div className="flex gap-1 mb-3">
        {AGENT_TYPES.filter((t) => t !== 'generic').map((type) => (
          <button
            key={type}
            onClick={() => setCredAgentType(type)}
            className={`px-2 py-1 text-[10px] font-medium rounded-md transition-colors ${
              credAgentType === type
                ? 'bg-accent text-white'
                : 'bg-surface-hover text-text-secondary hover:text-text-primary'
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Credential list */}
      {creds === null ? (
        <div className="text-xs text-text-muted animate-pulse py-2">Loading...</div>
      ) : creds.length === 0 ? (
        <p className="text-xs text-text-muted py-1">{t('credential.noCredentials')}</p>
      ) : (
        <div className="space-y-1.5">
          {creds.map((cred) => (
            <div
              key={cred.id}
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-surface-secondary/50 text-xs"
            >
              <div className="flex-1 min-w-0">
                {renamingId === cred.id ? (
                  <div className="flex gap-1">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(cred.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      autoFocus
                      className="flex-1 px-1.5 py-0.5 text-xs rounded border border-border bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                    />
                    <button
                      onClick={() => handleRename(cred.id)}
                      className="px-1.5 py-0.5 text-[10px] font-medium text-accent bg-accent/10 rounded hover:bg-accent/20"
                    >
                      OK
                    </button>
                  </div>
                ) : (
                  <>
                    <span className="font-medium text-text-primary truncate">{cred.name}</span>
                    <span className="ml-1.5 text-text-muted">
                      {cred.mode === 'api'
                        ? t('credential.modeApi')
                        : t('credential.modeSubscription')}
                    </span>
                    {cred.isDefault && (
                      <span className="ml-1.5 px-1 py-0.5 text-[9px] font-semibold bg-accent/10 text-accent rounded">
                        {t('credential.default')}
                      </span>
                    )}
                    {cred.baseUrl && (
                      <span className="ml-1.5 text-text-muted truncate" title={cred.baseUrl}>
                        {cred.baseUrl}
                      </span>
                    )}
                  </>
                )}
              </div>

              {renamingId !== cred.id && (
                <div className="flex gap-0.5 flex-shrink-0">
                  {!cred.isDefault && (
                    <button
                      onClick={() => handleSetDefault(cred.id)}
                      title={t('credential.setDefault')}
                      className="px-1.5 py-0.5 text-[10px] text-text-muted hover:text-accent transition-colors rounded hover:bg-surface-hover"
                    >
                      {t('credential.setDefault')}
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setRenamingId(cred.id)
                      setRenameValue(cred.name)
                    }}
                    title={t('credential.rename')}
                    className="px-1.5 py-0.5 text-[10px] text-text-muted hover:text-text-primary transition-colors rounded hover:bg-surface-hover"
                  >
                    {t('credential.rename')}
                  </button>
                  {confirmDeleteId === cred.id ? (
                    <div className="flex gap-0.5">
                      <button
                        onClick={() => handleDelete(cred.id)}
                        className="px-1.5 py-0.5 text-[10px] font-medium text-danger-text bg-danger-subtle rounded hover:bg-danger-subtle/80"
                      >
                        {t('common.confirm')}
                      </button>
                      <button
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-1.5 py-0.5 text-[10px] text-text-muted rounded hover:bg-surface-hover"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmDeleteId(cred.id)}
                      title={t('credential.delete')}
                      className="px-1.5 py-0.5 text-[10px] text-text-muted hover:text-red-500 transition-colors rounded hover:bg-surface-hover"
                    >
                      {t('credential.delete')}
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Subscription hint */}
      <p className="text-[10px] text-text-muted mt-2 italic">{t('credential.addViaCliHint')}</p>

      {/* Add credential form */}
      {showAddForm ? (
        <div className="mt-2 space-y-1.5 p-2 rounded-lg border border-border bg-surface-secondary/30">
          <div>
            <label className="block text-[10px] font-medium text-text-muted mb-0.5">
              {t('credential.name')}
            </label>
            <input
              type="text"
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder="my-api-key"
              className="w-full px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-text-muted mb-0.5">
              {t('credential.apiKey')}
            </label>
            <input
              type="password"
              value={addApiKey}
              onChange={(e) => setAddApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-text-muted mb-0.5">
              {t('credential.baseUrl')}
              <span className="ml-1 text-text-muted/50">(optional)</span>
            </label>
            <input
              type="text"
              value={addBaseUrl}
              onChange={(e) => setAddBaseUrl(e.target.value)}
              placeholder="https://api.example.com"
              className="w-full px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div>
            <label className="block text-[10px] font-medium text-text-muted mb-0.5">
              {t('credential.model')}
              <span className="ml-1 text-text-muted/50">(optional)</span>
            </label>
            <input
              type="text"
              value={addModel}
              onChange={(e) => setAddModel(e.target.value)}
              placeholder="claude-opus-4-6"
              className="w-full px-2 py-1 text-xs rounded border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>
          <div className="flex gap-1.5 pt-1">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                setShowAddForm(false)
                setAddName('')
                setAddApiKey('')
                setAddBaseUrl('')
                setAddModel('')
              }}
              className="flex-1"
            >
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={handleAdd}
              disabled={!addName.trim() || !addApiKey.trim()}
              className="flex-1"
            >
              {t('credential.add')}
            </Button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="mt-2 w-full px-2 py-1 text-[10px] font-medium text-accent bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors"
        >
          + {t('credential.add')}
        </button>
      )}
    </div>
  )
}
