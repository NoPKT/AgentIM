import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgentStore, type CredentialInfo } from '../stores/agents.js'
import {
  getStatusConfig,
  getTypeConfig,
  agentGradients,
  agentTypeIcons,
} from '../lib/agentConfig.js'
import { toast } from '../stores/toast.js'
import { wsClient } from '../lib/ws.js'
import { AGENT_TYPES } from '@agentim/shared'
import type { Agent, AgentVisibility, Gateway } from '@agentim/shared'
import { Button, Modal, ModalPanel } from '../components/ui.js'
import {
  TrashIcon,
  CheckIcon,
  XMarkIcon,
  ServerIcon,
  KeyIcon,
  BotIcon,
  StarIcon,
  PencilIcon,
  LockIcon,
  UsersIcon,
  SearchIcon,
} from '../components/icons.js'
import { api } from '../lib/api.js'

export default function AgentsPage() {
  const { t } = useTranslation()
  const agents = useAgentStore((state) => state.agents)
  const gateways = useAgentStore((state) => state.gateways)
  const isLoading = useAgentStore((state) => state.isLoading)
  const loadError = useAgentStore((state) => state.loadError)
  const loadAgents = useAgentStore((state) => state.loadAgents)
  const loadGateways = useAgentStore((state) => state.loadGateways)

  // Standalone agents = agents not managed by any non-ephemeral gateway
  const gatewayIds = useMemo(() => new Set(gateways.map((g) => g.id)), [gateways])
  const standaloneAgents = useMemo(
    () => agents.filter((a) => !gatewayIds.has(a.gatewayId)),
    [agents, gatewayIds],
  )

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedGatewayId, setSelectedGatewayId] = useState<string | null>(null)

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
        {/* Standalone Agents Section */}
        {standaloneAgents.length > 0 ? (
          <>
            <div className="mb-4">
              <h1 className="text-2xl font-bold text-text-primary">{t('agent.agents')}</h1>
              <p className="mt-1 text-sm text-text-secondary">
                {t('agent.standaloneAgents', { count: standaloneAgents.length })}
              </p>
            </div>

            <div data-testid="agents-list" className="space-y-1.5">
              {standaloneAgents.map((agent) => (
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
            <div className="space-y-1.5">
              {gateways.map((gw) => (
                <GatewayRow
                  key={gw.id}
                  gateway={gw}
                  agents={agents.filter((a) => a.gatewayId === gw.id)}
                  expanded={selectedGatewayId === gw.id}
                  onToggle={() => setSelectedGatewayId((prev) => (prev === gw.id ? null : gw.id))}
                />
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
  const [showSharingModal, setShowSharingModal] = useState(false)

  const statusConfig = getStatusConfig(t)
  const typeConfig = getTypeConfig(t)

  const status = statusConfig[agent.status as keyof typeof statusConfig] || statusConfig.offline
  const type = typeConfig[agent.type] || typeConfig.generic
  const gradient = agentGradients[agent.type] || agentGradients.generic

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

        {/* Sharing status button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowSharingModal(true)
          }}
          className="flex items-center gap-1 px-2 py-1 text-[11px] font-medium rounded-md border border-border bg-surface-hover/50 text-text-secondary hover:text-text-primary hover:bg-surface-hover transition-colors flex-shrink-0"
          title={t('agent.sharingManage')}
        >
          {agent.visibility === 'private' ? (
            <LockIcon className="w-3 h-3" />
          ) : (
            <UsersIcon className="w-3 h-3" />
          )}
          <span className="hidden sm:inline">
            {agent.visibility === 'private'
              ? t('agent.visibilityPrivate')
              : agent.visibility === 'whitelist'
                ? t('agent.sharingUsers', { count: agent.visibilityList?.length ?? 0 })
                : t('agent.sharingAll')}
          </span>
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
              title={t('common.confirm')}
              className="p-1 rounded-md text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors disabled:opacity-50"
            >
              <CheckIcon className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setConfirmDelete(false)
              }}
              title={t('common.cancel')}
              className="p-1 rounded-md text-text-muted hover:bg-surface-hover transition-colors"
            >
              <XMarkIcon className="w-4 h-4" />
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

      {/* Sharing Modal */}
      {showSharingModal && (
        <SharingModal
          agent={agent}
          onClose={() => setShowSharingModal(false)}
          onSave={async (visibility, visibilityList) => {
            await updateAgentVisibility(agent.id, visibility, visibilityList)
            toast.success(t('agent.sharingUpdated'))
            setShowSharingModal(false)
          }}
        />
      )}
    </div>
  )
}

interface SearchUser {
  id: string
  username: string
  displayName: string
  avatarUrl?: string
}

function SharingModal({
  agent,
  onClose,
  onSave,
}: {
  agent: Agent
  onClose: () => void
  onSave: (visibility: AgentVisibility, visibilityList?: string[]) => Promise<void>
}) {
  const { t } = useTranslation()
  const [visibility, setVisibility] = useState<AgentVisibility>(agent.visibility ?? 'private')
  const [selectedUsers, setSelectedUsers] = useState<SearchUser[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchUser[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Load existing whitelist users on mount
  useEffect(() => {
    if (agent.visibility === 'whitelist' && agent.visibilityList?.length) {
      // Fetch user details for existing whitelist
      Promise.all(
        agent.visibilityList.map((userId) =>
          api
            .get<SearchUser[]>(`/users/search?q=${encodeURIComponent(userId)}`)
            .then((res) => (res.ok && res.data?.length ? res.data[0] : null)),
        ),
      ).then((users) => {
        setSelectedUsers(users.filter((u): u is SearchUser => u !== null))
      })
    }
  }, [agent.visibility, agent.visibilityList])

  // Debounced user search
  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults([])
      return
    }
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(async () => {
      setSearching(true)
      const res = await api.get<SearchUser[]>(`/users/search?q=${encodeURIComponent(searchQuery)}`)
      if (res.ok && res.data) {
        // Exclude already selected users
        const selectedIds = new Set(selectedUsers.map((u) => u.id))
        setSearchResults(res.data.filter((u) => !selectedIds.has(u.id)))
      }
      setSearching(false)
    }, 300)
    return () => {
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    }
  }, [searchQuery, selectedUsers])

  const handleSave = async () => {
    setSaving(true)
    try {
      const list = visibility === 'whitelist' ? selectedUsers.map((u) => u.id) : undefined
      await onSave(visibility, list)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen onClose={onClose}>
      <ModalPanel size="sm">
        <div className="p-5 space-y-4">
          <h3 className="text-base font-semibold text-text-primary">{t('agent.sharing')}</h3>

          {/* Radio options */}
          <div className="space-y-2">
            {(['private', 'all', 'whitelist'] as const).map((v) => (
              <label
                key={v}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                  visibility === v
                    ? 'border-accent bg-accent/5'
                    : 'border-border hover:bg-surface-hover/50'
                }`}
              >
                <input
                  type="radio"
                  name="visibility"
                  value={v}
                  checked={visibility === v}
                  onChange={() => setVisibility(v)}
                  className="accent-accent"
                />
                <div>
                  <div className="text-sm font-medium text-text-primary">
                    {v === 'private'
                      ? t('agent.visibilityPrivate')
                      : v === 'all'
                        ? t('agent.sharingAll')
                        : t('agent.sharingManage')}
                  </div>
                  <div className="text-xs text-text-muted">
                    {v === 'private'
                      ? t('agent.visibilityDesc')
                      : v === 'all'
                        ? t('agent.sharingAllDesc')
                        : t('agent.sharingUsersDesc')}
                  </div>
                </div>
              </label>
            ))}
          </div>

          {/* User search (only for whitelist) */}
          {visibility === 'whitelist' && (
            <div className="space-y-2">
              {/* Selected users */}
              {selectedUsers.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {selectedUsers.map((user) => (
                    <span
                      key={user.id}
                      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-full bg-accent/10 text-accent"
                    >
                      {user.displayName || user.username}
                      <button
                        onClick={() =>
                          setSelectedUsers((prev) => prev.filter((u) => u.id !== user.id))
                        }
                        className="hover:text-danger-text"
                      >
                        <XMarkIcon className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Search input */}
              <div className="relative">
                <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-muted" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('agent.searchUsers')}
                  className="w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              {/* Search results */}
              {searching && <p className="text-xs text-text-muted px-1">{t('common.loading')}</p>}
              {searchResults.length > 0 && (
                <div className="max-h-32 overflow-y-auto space-y-0.5 rounded-lg border border-border">
                  {searchResults.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => {
                        setSelectedUsers((prev) => [...prev, user])
                        setSearchResults((prev) => prev.filter((u) => u.id !== user.id))
                        setSearchQuery('')
                      }}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-surface-hover transition-colors text-left"
                    >
                      <span className="font-medium text-text-primary">{user.displayName}</span>
                      <span className="text-text-muted">@{user.username}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={saving || (visibility === 'whitelist' && selectedUsers.length === 0)}
            >
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </div>
      </ModalPanel>
    </Modal>
  )
}

function GatewayRow({
  gateway,
  agents: gatewayAgents,
  expanded,
  onToggle,
}: {
  gateway: Gateway
  agents: Agent[]
  expanded: boolean
  onToggle: () => void
}) {
  const { t, i18n } = useTranslation()
  const deleteGateway = useAgentStore((s) => s.deleteGateway)
  const spawnAgent = useAgentStore((s) => s.spawnAgent)
  const loadAgents = useAgentStore((s) => s.loadAgents)
  const gatewayCredentials = useAgentStore((s) => s.gatewayCredentials)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [showSpawnModal, setShowSpawnModal] = useState(false)
  const [showCredentials, setShowCredentials] = useState(false)
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null)
  const [spawnType, setSpawnType] = useState<string>(AGENT_TYPES[0])
  const [spawnName, setSpawnName] = useState('')
  const [spawnWorkDir, setSpawnWorkDir] = useState('')
  const [spawning, setSpawning] = useState(false)
  const [credentialSelection, setCredentialSelection] = useState<CredentialInfo[] | null>(null)
  const [selectedCredentialId, setSelectedCredentialId] = useState<string>('')

  const isOnline = !!gateway.connectedAt && !gateway.disconnectedAt

  // Load credentials when spawn modal opens
  const credKey = `${gateway.id}:${spawnType}`
  const credentials = gatewayCredentials.get(credKey) ?? null

  useEffect(() => {
    if (showSpawnModal && isOnline) {
      wsClient.send({
        type: 'client:list_gateway_credentials',
        gatewayId: gateway.id,
        agentType: spawnType,
      })
    }
  }, [showSpawnModal, spawnType, gateway.id, isOnline])

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
      setShowSpawnModal(false)
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
      setShowSpawnModal(false)
      setSpawnName('')
      setSpawnWorkDir('')
    } catch (err) {
      toast.error((err as Error).message ?? t('agent.spawnFailed'))
    } finally {
      setSpawning(false)
    }
  }

  const deviceLabel = gateway.deviceInfo
    ? `${gateway.deviceInfo.platform}${gateway.deviceInfo.hostname ? ` · ${gateway.deviceInfo.hostname}` : ''}`
    : null

  // Only allow expand when there is content to show
  const hasExpandableContent =
    gatewayAgents.length > 0 || !!gateway.deviceInfo || !!gateway.disconnectedAt

  return (
    <div className="bg-surface rounded-lg border border-border overflow-hidden transition-colors">
      {/* Header row */}
      <div
        className={`px-3 py-2.5 flex items-center gap-3 ${hasExpandableContent ? 'hover:bg-surface-hover/50 cursor-pointer' : ''}`}
        onClick={
          hasExpandableContent
            ? () => {
                if (showCredentials) setShowCredentials(false) // close credentials when expanding agents
                onToggle()
              }
            : undefined
        }
      >
        {/* Status dot */}
        <span className="relative flex h-2.5 w-2.5 flex-shrink-0">
          {isOnline && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          )}
          <span
            className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}
          />
        </span>

        {/* Gateway icon + Name */}
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="w-8 h-8 shrink-0 rounded-full bg-gradient-to-br from-gray-500 to-gray-700 flex items-center justify-center">
            <ServerIcon className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-medium text-text-primary truncate">{gateway.name}</span>
        </div>

        {/* Device info (hidden on small screens) */}
        {deviceLabel && (
          <span className="hidden md:inline text-xs text-text-muted truncate max-w-[200px]">
            {deviceLabel}
          </span>
        )}

        {/* Spawn + Credentials icon buttons (online only) */}
        {isOnline && !confirmDelete && (
          <div
            className="flex items-center gap-0.5 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setShowSpawnModal(true)}
              className="p-1.5 rounded-md text-text-muted/50 hover:text-accent hover:bg-surface-hover transition-colors"
              title={t('agent.spawnAgent')}
            >
              <BotIcon className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowCredentials((prev) => {
                  if (!prev && expanded) onToggle() // collapse agents when opening credentials
                  return !prev
                })
              }}
              className={`p-1.5 rounded-md transition-colors ${
                showCredentials
                  ? 'text-accent bg-accent/10'
                  : 'text-text-muted/50 hover:text-accent hover:bg-surface-hover'
              }`}
              title={t('credential.title')}
            >
              <KeyIcon className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Delete button / confirm */}
        {confirmDelete ? (
          <div
            className="flex items-center gap-1 flex-shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={handleDelete}
              disabled={deleting}
              title={t('common.confirm')}
              className="p-1 rounded-md text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors disabled:opacity-50"
            >
              <CheckIcon className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                setConfirmDelete(false)
              }}
              title={t('common.cancel')}
              className="p-1 rounded-md text-text-muted hover:bg-surface-hover transition-colors"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              setConfirmDelete(true)
            }}
            className="p-1.5 rounded-md text-text-muted/50 hover:text-danger-text hover:bg-surface-hover transition-colors flex-shrink-0"
            title={t('agent.deleteGateway')}
          >
            <TrashIcon className="w-4 h-4" />
          </button>
        )}

        {/* Expand/collapse chevron — only shown when expandable */}
        {hasExpandableContent && (
          <svg
            className={`w-4 h-4 text-text-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        )}
      </div>

      {/* Expanded details */}
      {(expanded || showCredentials) && (
        <div className="border-t border-border px-4 py-3 bg-surface-secondary/50 space-y-3 text-sm">
          {/* Gateway's agents — full AgentRow (only when main section expanded) */}
          {expanded && gatewayAgents.length > 0 && (
            <div className="space-y-1.5">
              {gatewayAgents.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  expanded={expandedAgentId === agent.id}
                  onToggle={() =>
                    setExpandedAgentId((prev) => (prev === agent.id ? null : agent.id))
                  }
                />
              ))}
            </div>
          )}

          {/* Device details */}
          {expanded && gateway.deviceInfo && (
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-xs text-text-muted shrink-0">{t('agent.device')}</span>
              <span className="text-xs text-text-primary truncate">
                {gateway.deviceInfo.platform}{' '}
                {gateway.deviceInfo.hostname && `· ${gateway.deviceInfo.hostname}`}
              </span>
            </div>
          )}

          {/* Disconnected time */}
          {expanded && gateway.disconnectedAt && (
            <div className="flex items-baseline justify-between gap-4">
              <span className="text-xs text-text-muted shrink-0">{t('agent.disconnectedAt')}</span>
              <span className="text-xs text-text-primary">
                {new Date(gateway.disconnectedAt).toLocaleString(i18n.language, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          )}

          {/* Credentials Management Panel */}
          {showCredentials && isOnline && <GatewayCredentialsPanel gatewayId={gateway.id} />}
        </div>
      )}

      {/* Spawn Agent Modal */}
      <Modal isOpen={showSpawnModal} onClose={() => setShowSpawnModal(false)}>
        <ModalPanel size="sm">
          <div className="p-5 space-y-4">
            <h3 className="text-base font-semibold text-text-primary">{t('agent.spawnAgent')}</h3>

            {/* Agent type tabs */}
            <div>
              <label className="block text-xs font-medium text-text-muted mb-1.5">
                {t('agent.agentType')}
              </label>
              <div className="flex gap-1.5">
                {AGENT_TYPES.filter((at) => at !== 'generic').map((type) => (
                  <button
                    key={type}
                    onClick={() => setSpawnType(type)}
                    className={`flex-1 px-2 py-1.5 text-[11px] font-medium rounded-lg transition-colors text-center ${
                      spawnType === type
                        ? 'bg-accent text-white shadow-sm'
                        : 'bg-surface-hover/60 text-text-secondary hover:text-text-primary hover:bg-surface-hover'
                    }`}
                  >
                    {type}
                  </button>
                ))}
              </div>
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
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
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
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
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

            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setShowSpawnModal(false)}
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
        </ModalPanel>
      </Modal>
    </div>
  )
}

function GatewayCredentialsPanel({ gatewayId }: { gatewayId: string }) {
  const { t } = useTranslation()
  const gatewayCredentials = useAgentStore((s) => s.gatewayCredentials)
  const addGatewayCredential = useAgentStore((s) => s.addGatewayCredential)
  const manageGatewayCredential = useAgentStore((s) => s.manageGatewayCredential)
  const refreshGatewayCredentials = useAgentStore((s) => s.refreshGatewayCredentials)
  const startGatewayOAuth = useAgentStore((s) => s.startGatewayOAuth)
  const completeGatewayOAuth = useAgentStore((s) => s.completeGatewayOAuth)

  const [credAgentType, setCredAgentType] = useState<string>(AGENT_TYPES[0])
  const [showAddForm, setShowAddForm] = useState(false)
  const [addMode, setAddMode] = useState<'api' | 'subscription'>('api')
  const [addName, setAddName] = useState('')
  const [addApiKey, setAddApiKey] = useState('')
  const [addBaseUrl, setAddBaseUrl] = useState('')
  const [addModel, setAddModel] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  // OAuth flow state
  const [oauthPending, setOauthPending] = useState(false)
  const [oauthRequestId, setOauthRequestId] = useState<string | null>(null)
  const [oauthAuthUrl, setOauthAuthUrl] = useState<string | null>(null)
  const [oauthAutoCallback, setOauthAutoCallback] = useState(false)
  const [callbackUrl, setCallbackUrl] = useState('')
  const [oauthSubmitting, setOauthSubmitting] = useState(false)

  const credKey = `${gatewayId}:${credAgentType}`
  const creds = gatewayCredentials.get(credKey) ?? null

  useEffect(() => {
    refreshGatewayCredentials(gatewayId, credAgentType)
  }, [gatewayId, credAgentType, refreshGatewayCredentials])

  useEffect(() => {
    const handler = () => {
      refreshGatewayCredentials(gatewayId, credAgentType)
    }
    window.addEventListener('agentim:credential_updated', handler)
    return () => window.removeEventListener('agentim:credential_updated', handler)
  }, [gatewayId, credAgentType, refreshGatewayCredentials])

  // OAuth timeout — reset pending state if no response within 30s
  useEffect(() => {
    if (!oauthPending) return
    const timer = setTimeout(() => {
      setOauthPending(false)
      toast.error(t('credential.oauthTimeout'))
    }, 30_000)
    return () => clearTimeout(timer)
  }, [oauthPending, t])

  // Listen for OAuth URL from gateway
  useEffect(() => {
    const handleOAuthUrl = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.gatewayId === gatewayId) {
        setOauthRequestId(detail.requestId)
        setOauthAuthUrl(detail.authUrl)
        setOauthAutoCallback(!!detail.autoCallback)
        setOauthPending(false)
      }
    }
    const handleOAuthResult = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (detail.gatewayId === gatewayId) {
        setOauthPending(false)
        setOauthSubmitting(false)
        setOauthAuthUrl(null)
        setOauthAutoCallback(false)
        setOauthRequestId(null)
        setCallbackUrl('')
        if (detail.success) {
          setShowAddForm(false)
          setAddName('')
          setAddMode('api')
        }
      }
    }
    window.addEventListener('agentim:oauth_url', handleOAuthUrl)
    window.addEventListener('agentim:oauth_result', handleOAuthResult)
    return () => {
      window.removeEventListener('agentim:oauth_url', handleOAuthUrl)
      window.removeEventListener('agentim:oauth_result', handleOAuthResult)
    }
  }, [gatewayId])

  const canAdd = addName.trim() && (addMode === 'subscription' || addApiKey.trim())

  const handleAdd = () => {
    if (!canAdd) return
    addGatewayCredential(gatewayId, credAgentType, {
      name: addName.trim(),
      mode: addMode,
      ...(addMode === 'api' && addApiKey ? { apiKey: addApiKey } : {}),
      baseUrl: addBaseUrl || undefined,
      model: addModel || undefined,
    })
    setAddName('')
    setAddApiKey('')
    setAddBaseUrl('')
    setAddModel('')
    setAddMode('api')
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

  const inputCls =
    'w-full px-2.5 py-1.5 text-xs rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent'

  return (
    <div className="space-y-3">
      {/* Agent type tabs */}
      <div className="flex gap-1.5">
        {AGENT_TYPES.filter((at) => at !== 'generic').map((type) => (
          <button
            key={type}
            onClick={() => setCredAgentType(type)}
            className={`flex-1 px-2 py-1.5 text-[11px] font-medium rounded-lg transition-colors text-center ${
              credAgentType === type
                ? 'bg-accent text-white shadow-sm'
                : 'bg-surface-hover/60 text-text-secondary hover:text-text-primary hover:bg-surface-hover'
            }`}
          >
            {type}
          </button>
        ))}
      </div>

      {/* Credential list */}
      {creds === null ? (
        <div className="text-xs text-text-muted animate-pulse py-3 text-center">Loading...</div>
      ) : creds.length === 0 ? (
        <p className="text-xs text-text-muted py-2 text-center">{t('credential.noCredentials')}</p>
      ) : (
        <div className="space-y-2">
          {creds.map((cred) => (
            <div
              key={cred.id}
              className="rounded-lg border border-border/60 bg-surface-secondary/30 overflow-hidden"
            >
              {/* Credential header with inline action icons */}
              <div className="px-3 py-2">
                {renamingId === cred.id ? (
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(cred.id)
                        if (e.key === 'Escape') setRenamingId(null)
                      }}
                      autoFocus
                      className={inputCls}
                    />
                    <button
                      onClick={() => handleRename(cred.id)}
                      className="px-2.5 py-1 text-xs font-medium text-white bg-accent rounded-lg hover:bg-accent/90 shrink-0"
                    >
                      OK
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {/* Info */}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-text-primary truncate">
                          {cred.name}
                        </span>
                        {cred.isDefault && (
                          <span className="px-1.5 py-0.5 text-[9px] font-semibold bg-accent/15 text-accent rounded-full shrink-0">
                            {t('credential.default')}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-[10px] text-text-muted">
                        <span
                          className={`inline-flex items-center gap-0.5 ${cred.mode === 'api' ? 'text-emerald-500' : 'text-blue-500'}`}
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-current" />
                          {cred.mode === 'api'
                            ? t('credential.modeApi')
                            : t('credential.modeSubscription')}
                        </span>
                        {cred.baseUrl && (
                          <span className="truncate max-w-[150px]" title={cred.baseUrl}>
                            {cred.baseUrl}
                          </span>
                        )}
                        {cred.model && (
                          <span className="font-mono truncate max-w-[100px]" title={cred.model}>
                            {cred.model}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Action icon buttons — inline on right */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      {!cred.isDefault && (
                        <button
                          onClick={() => handleSetDefault(cred.id)}
                          title={t('credential.setDefault')}
                          className="p-1 rounded-md text-text-muted/50 hover:text-amber-500 hover:bg-amber-500/10 transition-colors"
                        >
                          <StarIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => {
                          setRenamingId(cred.id)
                          setRenameValue(cred.name)
                        }}
                        title={t('credential.rename')}
                        className="p-1 rounded-md text-text-muted/50 hover:text-text-primary hover:bg-surface-hover transition-colors"
                      >
                        <PencilIcon className="w-3.5 h-3.5" />
                      </button>
                      {confirmDeleteId === cred.id ? (
                        <div className="flex items-center gap-0.5">
                          <button
                            onClick={() => handleDelete(cred.id)}
                            title={t('common.confirm')}
                            className="p-1 rounded-md text-green-600 hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors"
                          >
                            <CheckIcon className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            title={t('common.cancel')}
                            className="p-1 rounded-md text-text-muted hover:bg-surface-hover transition-colors"
                          >
                            <XMarkIcon className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(cred.id)}
                          title={t('credential.delete')}
                          className="p-1 rounded-md text-text-muted/50 hover:text-red-500 hover:bg-red-500/10 transition-colors"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add credential button */}
      <button
        onClick={() => setShowAddForm(true)}
        className="w-full px-3 py-2 text-xs font-medium text-accent bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors"
      >
        + {t('credential.add')}
      </button>

      {/* Add Credential Modal */}
      <Modal
        isOpen={showAddForm}
        onClose={() => {
          setShowAddForm(false)
          setAddName('')
          setAddApiKey('')
          setAddBaseUrl('')
          setAddModel('')
          setAddMode('api')
          setOauthPending(false)
          setOauthAuthUrl(null)
          setOauthAutoCallback(false)
          setOauthRequestId(null)
          setCallbackUrl('')
        }}
      >
        <ModalPanel size="sm">
          <div className="p-5 space-y-3">
            <h3 className="text-base font-semibold text-text-primary">{t('credential.add')}</h3>

            {/* Mode selector */}
            <div className="flex gap-1.5">
              <button
                onClick={() => setAddMode('api')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  addMode === 'api'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 ring-1 ring-emerald-500/30'
                    : 'bg-surface-hover/50 text-text-secondary hover:bg-surface-hover'
                }`}
              >
                {t('credential.modeApi')}
              </button>
              <button
                onClick={() => setAddMode('subscription')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  addMode === 'subscription'
                    ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/30'
                    : 'bg-surface-hover/50 text-text-secondary hover:bg-surface-hover'
                }`}
              >
                {t('credential.modeSubscription')}
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-medium text-text-muted mb-1">
                {t('credential.name')}
              </label>
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                placeholder={addMode === 'api' ? 'my-api-key' : 'my-subscription'}
                className={inputCls}
              />
            </div>

            {addMode === 'api' ? (
              <>
                <div>
                  <label className="block text-[10px] font-medium text-text-muted mb-1">
                    {t('credential.apiKey')}
                  </label>
                  <input
                    type="password"
                    value={addApiKey}
                    onChange={(e) => setAddApiKey(e.target.value)}
                    placeholder="sk-..."
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-text-muted mb-1">
                    {t('credential.baseUrl')}
                    <span className="ml-1 opacity-50">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={addBaseUrl}
                    onChange={(e) => setAddBaseUrl(e.target.value)}
                    placeholder="https://api.example.com"
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-text-muted mb-1">
                    {t('credential.model')}
                    <span className="ml-1 opacity-50">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={addModel}
                    onChange={(e) => setAddModel(e.target.value)}
                    placeholder="claude-opus-4-6"
                    className={inputCls}
                  />
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setShowAddForm(false)
                      setAddName('')
                      setAddApiKey('')
                      setAddBaseUrl('')
                      setAddModel('')
                      setAddMode('api')
                    }}
                    className="flex-1"
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button size="sm" onClick={handleAdd} disabled={!canAdd} className="flex-1">
                    {t('credential.add')}
                  </Button>
                </div>
              </>
            ) : (
              <>
                {/* OAuth flow UI for subscription mode */}
                {!oauthAuthUrl ? (
                  <div className="space-y-2">
                    <p className="text-[10px] text-text-muted leading-relaxed">
                      {t('credential.oauthHint')}
                    </p>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setShowAddForm(false)
                          setAddName('')
                          setAddMode('api')
                          setOauthPending(false)
                          setOauthAuthUrl(null)
                          setOauthAutoCallback(false)
                          setOauthRequestId(null)
                          setCallbackUrl('')
                        }}
                        className="flex-1"
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          if (!addName.trim()) return
                          setOauthPending(true)
                          startGatewayOAuth(gatewayId, credAgentType, addName.trim())
                        }}
                        disabled={oauthPending || !addName.trim()}
                        className="flex-1"
                      >
                        {oauthPending ? t('credential.oauthStarting') : t('credential.oauthStart')}
                      </Button>
                    </div>
                  </div>
                ) : oauthAutoCallback ? (
                  <div className="space-y-2.5">
                    {/* Auth URL display — auto-callback mode (no paste step) */}
                    <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                      <p className="text-[10px] font-medium text-blue-700 dark:text-blue-300 mb-1.5">
                        {t('credential.oauthStep1')}
                      </p>
                      <a
                        href={oauthAuthUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-blue-600 dark:text-blue-400 underline break-all leading-relaxed"
                      >
                        {oauthAuthUrl.length > 120
                          ? oauthAuthUrl.slice(0, 120) + '...'
                          : oauthAuthUrl}
                      </a>
                    </div>

                    {/* Waiting indicator */}
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-surface-hover/50 border border-border">
                      <svg
                        className="animate-spin h-3.5 w-3.5 text-accent flex-shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="3"
                          className="opacity-25"
                        />
                        <path
                          d="M4 12a8 8 0 018-8"
                          stroke="currentColor"
                          strokeWidth="3"
                          strokeLinecap="round"
                        />
                      </svg>
                      <p className="text-[10px] text-text-muted">
                        {t('credential.oauthAutoWaiting')}
                      </p>
                    </div>

                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setShowAddForm(false)
                        setAddName('')
                        setAddMode('api')
                        setOauthPending(false)
                        setOauthAuthUrl(null)
                        setOauthAutoCallback(false)
                        setOauthRequestId(null)
                        setCallbackUrl('')
                      }}
                      className="w-full"
                    >
                      {t('common.cancel')}
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {/* Auth URL display */}
                    <div className="p-2.5 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                      <p className="text-[10px] font-medium text-blue-700 dark:text-blue-300 mb-1.5">
                        {t('credential.oauthStep1')}
                      </p>
                      <a
                        href={oauthAuthUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-blue-600 dark:text-blue-400 underline break-all leading-relaxed"
                      >
                        {oauthAuthUrl.length > 120
                          ? oauthAuthUrl.slice(0, 120) + '...'
                          : oauthAuthUrl}
                      </a>
                    </div>

                    {/* Auto-complete hint */}
                    <p className="text-[10px] text-text-muted italic">
                      {t('credential.oauthAutoHint')}
                    </p>

                    {/* Callback URL paste */}
                    <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                      <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300 mb-1.5">
                        {t('credential.oauthStep2')}
                      </p>
                      <input
                        type="text"
                        value={callbackUrl}
                        onChange={(e) => setCallbackUrl(e.target.value)}
                        placeholder="http://localhost:PORT/callback?code=..."
                        className={inputCls}
                      />
                    </div>

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setShowAddForm(false)
                          setAddName('')
                          setAddMode('api')
                          setOauthPending(false)
                          setOauthAuthUrl(null)
                          setOauthAutoCallback(false)
                          setOauthRequestId(null)
                          setCallbackUrl('')
                        }}
                        className="flex-1"
                      >
                        {t('common.cancel')}
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          if (!callbackUrl.trim() || !oauthRequestId) return
                          setOauthSubmitting(true)
                          completeGatewayOAuth(gatewayId, oauthRequestId, callbackUrl.trim())
                        }}
                        disabled={oauthSubmitting || !callbackUrl.trim()}
                        className="flex-1"
                      >
                        {oauthSubmitting
                          ? t('credential.oauthCompleting')
                          : t('credential.oauthComplete')}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </ModalPanel>
      </Modal>
    </div>
  )
}
