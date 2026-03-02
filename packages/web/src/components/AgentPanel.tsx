import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServerMessage, Agent } from '@agentim/shared'
import { useAgentStore } from '../stores/agents.js'
import { wsClient } from '../lib/ws.js'
import { toast } from '../stores/toast.js'
import { getStatusConfig, getTypeConfig, agentGradients } from '../lib/agentConfig.js'
import { Modal, Input, Button } from './ui.js'
import { CloseIcon, PencilIcon, TrashIcon } from './icons.js'

// ─── Shared props ───

interface AgentPanelProps {
  agentId: string | null
  isOpen: boolean
  onClose: () => void
  /** Whether the current user owns this agent (enables rename/delete). */
  isOwner?: boolean
  /** Room ID — required for sending agent commands. */
  roomId?: string
}

/**
 * Unified agent panel: shows agent identity, settings (model, thinking, effort,
 * plan mode), info (working dir, gateway, capabilities, MCP, slash commands),
 * session cost breakdown, and danger zone (delete).
 *
 * Merges the previous AgentInfoModal and AgentConfigPanel into one.
 */
export function AgentPanel({ agentId, isOpen, onClose, isOwner = false, roomId }: AgentPanelProps) {
  const { t, i18n } = useTranslation()
  const agents = useAgentStore((s) => s.agents)
  const renameAgent = useAgentStore((s) => s.renameAgent)
  const deleteAgent = useAgentStore((s) => s.deleteAgent)
  const agent = agents.find((a) => a.id === agentId) ?? null

  const [editingName, setEditingName] = useState(false)
  const [nameValue, setNameValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Settings state
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)
  const [customModelInput, setCustomModelInput] = useState('')
  const [showCustomModel, setShowCustomModel] = useState(false)
  const [commandsExpanded, setCommandsExpanded] = useState(false)

  // Query fresh info when panel opens
  useEffect(() => {
    if (isOpen && agentId) {
      wsClient.send({ type: 'client:query_agent_info', agentId })
    }
  }, [isOpen, agentId])

  useEffect(() => {
    if (agent) setNameValue(agent.name)
  }, [agent])

  useEffect(() => {
    if (!isOpen) {
      setEditingName(false)
      setConfirmDelete(false)
      setShowCustomModel(false)
      setCustomModelInput('')
      setPendingCommand(null)
      setCommandsExpanded(false)
    }
  }, [isOpen])

  // Listen for command results
  useEffect(() => {
    if (!isOpen || !agentId) return
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      if (msg.type === 'server:agent_command_result' && msg.agentId === agentId) {
        setPendingCommand(null)
        if (msg.success) {
          toast.success(t('agentPanel.settingUpdated'))
          wsClient.send({ type: 'client:query_agent_info', agentId })
        } else {
          toast.error(msg.message ?? t('common.error'))
        }
      }
    })
    return unsub
  }, [isOpen, agentId, t])

  const sendCommand = useCallback(
    (command: string, args: string) => {
      if (!agentId || !roomId) return
      setPendingCommand(command)
      wsClient.send({
        type: 'client:agent_command',
        agentId,
        roomId,
        command,
        args,
      })
    },
    [agentId, roomId],
  )

  const handleDelete = async () => {
    if (!agent) return
    setDeleting(true)
    try {
      await deleteAgent(agent.id)
      toast.success(t('agent.agentDeleted'))
      onClose()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setDeleting(false)
    }
  }

  const handleRename = async () => {
    if (!agent) return
    const trimmed = nameValue.trim()
    if (!trimmed || trimmed === agent.name) {
      setEditingName(false)
      return
    }
    setSaving(true)
    try {
      await renameAgent(agent.id, trimmed)
      toast.success(t('agentPanel.renamed'))
      setEditingName(false)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  if (!agent) return null

  const statusConfig = getStatusConfig(t)
  const typeConfig = getTypeConfig(t)
  const status = statusConfig[agent.status as keyof typeof statusConfig] || statusConfig.offline
  const type = typeConfig[agent.type] || typeConfig.generic
  const gradient = agentGradients[agent.type] || agentGradients.generic
  const isOnline = agent.status === 'online'
  const hasCompact = agent.slashCommands?.some((c) => c.name === 'compact')
  const hasPlanMode = agent.planMode != null || agent.slashCommands?.some((c) => c.name === 'plan')

  return (
    <Modal isOpen={isOpen} onClose={onClose} aria-labelledby="agent-panel-title">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 id="agent-panel-title" className="text-lg font-semibold text-text-primary">
            {t('agentPanel.title')}
          </h2>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors"
            aria-label={t('common.close')}
          >
            <CloseIcon className="w-5 h-5 text-text-secondary" aria-hidden="true" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin px-6 py-4 space-y-5">
          {/* Agent identity */}
          <div className="flex items-center gap-4">
            <div
              className={`w-12 h-12 shrink-0 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center`}
            >
              <span className="text-lg font-semibold text-white">
                {agent.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              {editingName ? (
                <div className="flex items-center gap-2">
                  <Input
                    inputSize="sm"
                    value={nameValue}
                    onChange={(e) => setNameValue(e.target.value)}
                    autoFocus
                    className="flex-1"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleRename()
                      if (e.key === 'Escape') {
                        setNameValue(agent.name)
                        setEditingName(false)
                      }
                    }}
                    placeholder={t('agentPanel.renamePlaceholder')}
                  />
                  <Button size="sm" onClick={handleRename} disabled={saving}>
                    {t('common.save')}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold text-text-primary truncate">{agent.name}</h3>
                  {isOwner && (
                    <button
                      onClick={() => setEditingName(true)}
                      className="p-1 rounded hover:bg-surface-hover transition-colors"
                      aria-label={t('agentPanel.rename')}
                    >
                      <PencilIcon className="w-4 h-4 text-text-muted" aria-hidden="true" />
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2 mt-0.5">
                <span
                  className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${type.color}`}
                >
                  {type.label}
                </span>
                <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                  <span className={`w-2 h-2 rounded-full ${status.color}`} />
                  {status.label}
                </span>
              </div>
            </div>
          </div>

          {/* ─── Settings (only when online and roomId is provided) ─── */}
          {isOnline && roomId && (
            <>
              {/* Model */}
              {((agent.availableModels?.length ?? 0) > 0 || agent.model) && (
                <Section title={t('agentPanel.model')}>
                  {showCustomModel ||
                  ((agent.availableModels?.length ?? 0) === 0 && agent.model) ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customModelInput || (showCustomModel ? '' : (agent.model ?? ''))}
                        onChange={(e) => {
                          setCustomModelInput(e.target.value)
                          if (!showCustomModel) setShowCustomModel(true)
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            const model = customModelInput.trim()
                            if (model) {
                              sendCommand('model', model)
                              setShowCustomModel(false)
                              setCustomModelInput('')
                            }
                          }
                          if (e.key === 'Escape') {
                            setShowCustomModel(false)
                            setCustomModelInput('')
                          }
                        }}
                        placeholder={t('agentPanel.modelPlaceholder')}
                        className="flex-1 min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                        autoFocus={showCustomModel}
                      />
                      <button
                        onClick={() => {
                          const model = customModelInput.trim()
                          if (model) {
                            sendCommand('model', model)
                            setShowCustomModel(false)
                            setCustomModelInput('')
                          }
                        }}
                        disabled={!customModelInput.trim()}
                        className="min-h-[44px] px-4 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-40 transition-colors"
                      >
                        {t('common.confirm')}
                      </button>
                    </div>
                  ) : (
                    <select
                      value={agent.model ?? ''}
                      onChange={(e) => {
                        if (e.target.value === '__custom__') {
                          setShowCustomModel(true)
                          return
                        }
                        sendCommand('model', e.target.value)
                      }}
                      disabled={pendingCommand === 'model'}
                      className="w-full min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 appearance-none cursor-pointer"
                    >
                      {!agent.model && <option value="">{t('agentPanel.default')}</option>}
                      {agent.availableModelInfo && agent.availableModelInfo.length > 0
                        ? agent.availableModelInfo.map((m) => (
                            <option key={m.value} value={m.value} title={m.description}>
                              {m.displayName}
                            </option>
                          ))
                        : agent.availableModels?.map((m) => (
                            <option key={m} value={m}>
                              {m}
                            </option>
                          ))}
                      <option value="__custom__">{t('agentPanel.customModel')}</option>
                    </select>
                  )}
                </Section>
              )}

              {/* Thinking Mode */}
              {(agent.availableThinkingModes?.length ?? 0) > 0 && (
                <Section title={t('agentPanel.thinkingMode')}>
                  <select
                    value={agent.thinkingMode ?? ''}
                    onChange={(e) => sendCommand('think', e.target.value)}
                    disabled={pendingCommand === 'think'}
                    className="w-full min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 appearance-none cursor-pointer"
                  >
                    {!agent.thinkingMode && <option value="">{t('agentPanel.default')}</option>}
                    {agent.availableThinkingModes?.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </Section>
              )}

              {/* Effort Level */}
              {(agent.availableEffortLevels?.length ?? 0) > 0 && (
                <Section title={t('agentPanel.effortLevel')}>
                  <select
                    value={agent.effortLevel ?? ''}
                    onChange={(e) => sendCommand('effort', e.target.value)}
                    disabled={pendingCommand === 'effort'}
                    className="w-full min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 appearance-none cursor-pointer"
                  >
                    {!agent.effortLevel && <option value="">{t('agentPanel.default')}</option>}
                    {agent.availableEffortLevels?.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </Section>
              )}

              {/* Plan Mode */}
              {hasPlanMode && (
                <Section title={t('agentPanel.planMode')}>
                  <button
                    onClick={() => sendCommand('plan', '')}
                    disabled={pendingCommand === 'plan'}
                    className="flex items-center justify-between w-full min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm disabled:opacity-50 transition-colors"
                  >
                    <span className="text-text-secondary">
                      {t('agentPanel.planModeDescription')}
                    </span>
                    <span
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                        agent.planMode ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform mt-0.5 ${
                          agent.planMode ? 'translate-x-[22px]' : 'translate-x-[2px]'
                        }`}
                      />
                    </span>
                  </button>
                </Section>
              )}
            </>
          )}

          {/* ─── Info section ─── */}
          <Section title={t('agentPanel.general')}>
            {agent.model && <InfoRow label={t('agentPanel.model')} value={agent.model} mono />}
            {agent.workingDirectory && (
              <InfoRow label={t('agent.workingDir')} value={agent.workingDirectory} mono />
            )}
            {agent.deviceInfo && (
              <InfoRow
                label={t('agentPanel.gateway')}
                value={`${agent.deviceInfo.hostname || agent.deviceInfo.platform} (${agent.deviceInfo.arch})`}
              />
            )}
            {agent.lastSeenAt && (
              <InfoRow
                label={t('agent.lastSeen')}
                value={new Date(agent.lastSeenAt).toLocaleString(i18n.language, {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              />
            )}
          </Section>

          {/* Capabilities */}
          {agent.capabilities && agent.capabilities.length > 0 && (
            <Section title={t('agent.capabilities')}>
              <div className="flex flex-wrap gap-1.5">
                {agent.capabilities.map((cap) => (
                  <span
                    key={cap}
                    className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300"
                  >
                    {cap}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* MCP Servers */}
          <Section title={t('agentPanel.mcpServers')}>
            {agent.mcpServers && agent.mcpServers.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {agent.mcpServers.map((server) => (
                  <span
                    key={server}
                    className="inline-flex px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300"
                  >
                    {server}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted">{t('agentPanel.noMcpServers')}</p>
            )}
          </Section>

          {/* Session cost breakdown */}
          {isOnline && (
            <Section title={t('agentPanel.session')}>
              <div className="space-y-1.5 text-sm">
                {agent.sessionCostUSD != null && agent.sessionCostUSD > 0 && (
                  <div className="flex justify-between">
                    <span className="text-text-muted">{t('agentPanel.cost')}</span>
                    <span className="text-text-primary font-mono">
                      ${agent.sessionCostUSD.toFixed(4)}
                    </span>
                  </div>
                )}
              </div>
            </Section>
          )}

          {/* Action buttons */}
          {isOnline && roomId && (
            <div className="space-y-2">
              {hasCompact && (
                <button
                  onClick={() => sendCommand('compact', '')}
                  disabled={pendingCommand === 'compact'}
                  className="w-full min-h-[44px] px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
                >
                  {t('agentPanel.compactSession')}
                </button>
              )}
              <button
                onClick={() => {
                  if (window.confirm(t('agentPanel.resetConfirm'))) {
                    sendCommand('clear', '')
                  }
                }}
                disabled={pendingCommand === 'clear'}
                className="w-full min-h-[44px] px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-danger-text hover:bg-danger-subtle transition-colors disabled:opacity-50"
              >
                {t('agentPanel.resetSession')}
              </button>
            </div>
          )}

          {/* Slash Commands */}
          {agent.slashCommands && agent.slashCommands.length > 0 && (
            <Section title={t('agentPanel.slashCommands')}>
              <button
                onClick={() => setCommandsExpanded(!commandsExpanded)}
                className="text-xs text-accent hover:text-accent-hover transition-colors"
              >
                {commandsExpanded
                  ? t('common.collapse')
                  : `${t('common.showMore')} (${agent.slashCommands.length})`}
              </button>
              {commandsExpanded && (
                <div className="space-y-1.5 mt-2">
                  {agent.slashCommands.map((cmd) => (
                    <div
                      key={cmd.name}
                      className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-surface-secondary"
                    >
                      <div>
                        <span className="text-sm font-medium text-text-primary">/{cmd.name}</span>
                        <span className="ml-2 text-xs text-text-muted">{cmd.description}</span>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-hover text-text-muted">
                        {cmd.source === 'builtin' ? t('agentPanel.builtin') : t('agentPanel.skill')}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Section>
          )}

          {/* Danger zone — delete */}
          {isOwner && (
            <div className="mt-2 pt-3 border-t border-border">
              {confirmDelete ? (
                <div className="space-y-2">
                  <p className="text-xs text-text-secondary">{t('agent.confirmDeleteAgent')}</p>
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
                  className="flex items-center gap-2 text-sm text-danger-text hover:text-danger-text/80 transition-colors"
                >
                  <TrashIcon className="w-4 h-4" aria-hidden="true" />
                  {t('agent.deleteAgent')}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

// ─── Multi-agent variant for ChatPage ───

interface AgentPanelMultiProps {
  agentIds: string[]
  roomId: string
  isOpen: boolean
  onClose: () => void
}

/**
 * Multi-agent panel wrapper — shows tabs for selecting an agent, then renders
 * the full panel content for the selected agent.
 */
export function AgentPanelMulti({ agentIds, roomId, isOpen, onClose }: AgentPanelMultiProps) {
  const { t } = useTranslation()
  const agents = useAgentStore((s) => s.agents)
  const [activeAgentId, setActiveAgentId] = useState(agentIds[0] ?? '')
  const panelRef = useRef<HTMLDivElement>(null)

  // Reset active agent when agentIds change
  useEffect(() => {
    if (agentIds.length > 0 && !agentIds.includes(activeAgentId)) {
      setActiveAgentId(agentIds[0])
    }
  }, [agentIds, activeAgentId])

  // Query all agent info on open
  useEffect(() => {
    if (isOpen) {
      for (const id of agentIds) {
        wsClient.send({ type: 'client:query_agent_info', agentId: id })
      }
    }
  }, [isOpen, agentIds])

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  if (!isOpen || agentIds.length === 0) return null

  const agentList = agentIds.map((id) => agents.find((a) => a.id === id)).filter(Boolean) as Agent[]

  return (
    <div
      className="fixed inset-0 z-modal bg-black/50 flex items-end sm:items-center justify-center"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={t('agentPanel.title')}
    >
      <div
        ref={panelRef}
        className="bg-surface w-full max-w-md rounded-t-2xl sm:rounded-2xl sm:my-auto shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[70vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">{t('agentPanel.title')}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-surface-hover transition-colors text-text-muted hover:text-text-primary"
            aria-label={t('common.close')}
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Agent tabs — only shown when multiple agents */}
        {agentList.length > 1 && (
          <div className="flex border-b border-border overflow-x-auto scrollbar-thin">
            {agentList.map((a) => (
              <button
                key={a.id}
                onClick={() => setActiveAgentId(a.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors border-b-2 ${
                  a.id === activeAgentId
                    ? 'border-accent text-accent'
                    : 'border-transparent text-text-muted hover:text-text-secondary hover:border-border'
                }`}
              >
                <span
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    a.status === 'online' ? 'bg-green-500' : 'bg-gray-400'
                  }`}
                />
                <span className="truncate max-w-32">{a.name}</span>
              </button>
            ))}
          </div>
        )}

        {/* Inline panel content for selected agent */}
        <AgentPanelInline agentId={activeAgentId} roomId={roomId} />
      </div>
    </div>
  )
}

/**
 * Inline panel content for a single agent — used inside AgentPanelMulti.
 * Shares most logic with AgentPanel but renders without the Modal wrapper.
 */
export function AgentPanelInline({ agentId, roomId }: { agentId: string; roomId: string }) {
  const { t, i18n } = useTranslation()
  const agents = useAgentStore((s) => s.agents)
  const agent = agents.find((a) => a.id === agentId) ?? null

  const [pendingCommand, setPendingCommand] = useState<string | null>(null)
  const [customModelInput, setCustomModelInput] = useState('')
  const [showCustomModel, setShowCustomModel] = useState(false)

  // Reset state when switching agents
  useEffect(() => {
    setShowCustomModel(false)
    setCustomModelInput('')
    setPendingCommand(null)
  }, [agentId])

  // Listen for command results
  useEffect(() => {
    if (!agentId) return
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      if (msg.type === 'server:agent_command_result' && msg.agentId === agentId) {
        setPendingCommand(null)
        if (msg.success) {
          toast.success(t('agentPanel.settingUpdated'))
          wsClient.send({ type: 'client:query_agent_info', agentId })
        } else {
          toast.error(msg.message ?? t('common.error'))
        }
      }
    })
    return unsub
  }, [agentId, t])

  const sendCommand = useCallback(
    (command: string, args: string) => {
      if (!agentId) return
      setPendingCommand(command)
      wsClient.send({
        type: 'client:agent_command',
        agentId,
        roomId,
        command,
        args,
      })
    },
    [agentId, roomId],
  )

  if (!agent) {
    return (
      <div className="py-8 text-center text-sm text-text-muted">{t('agentPanel.noOptions')}</div>
    )
  }

  const isOnline = agent.status === 'online'
  const hasCompact = agent.slashCommands?.some((c) => c.name === 'compact')
  const hasPlanMode = agent.planMode != null || agent.slashCommands?.some((c) => c.name === 'plan')
  const statusConfig = getStatusConfig(t)
  const status = statusConfig[agent.status as keyof typeof statusConfig] || statusConfig.offline

  return (
    <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
      {/* Agent identity */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-bold text-white">{agent.name.charAt(0).toUpperCase()}</span>
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary truncate">{agent.name}</p>
          <p className="text-xs text-text-muted">
            {agent.type}
            <span className="mx-1.5">&middot;</span>
            <span className={agent.status === 'online' ? 'text-success-text' : 'text-text-muted'}>
              {status.label}
            </span>
          </p>
        </div>
      </div>

      {/* Model */}
      {((agent.availableModels?.length ?? 0) > 0 || agent.model) && (
        <ConfigSection label={t('agentPanel.model')}>
          {showCustomModel || ((agent.availableModels?.length ?? 0) === 0 && agent.model) ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={customModelInput || (showCustomModel ? '' : (agent.model ?? ''))}
                onChange={(e) => {
                  setCustomModelInput(e.target.value)
                  if (!showCustomModel) setShowCustomModel(true)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const model = customModelInput.trim()
                    if (model) {
                      sendCommand('model', model)
                      setShowCustomModel(false)
                      setCustomModelInput('')
                    }
                  }
                  if (e.key === 'Escape') {
                    setShowCustomModel(false)
                    setCustomModelInput('')
                  }
                }}
                placeholder={t('agentPanel.modelPlaceholder')}
                className="flex-1 min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                autoFocus={showCustomModel}
              />
              <button
                onClick={() => {
                  const model = customModelInput.trim()
                  if (model) {
                    sendCommand('model', model)
                    setShowCustomModel(false)
                    setCustomModelInput('')
                  }
                }}
                disabled={!customModelInput.trim()}
                className="min-h-[44px] px-4 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-40 transition-colors"
              >
                {t('common.confirm')}
              </button>
            </div>
          ) : (
            <select
              value={agent.model ?? ''}
              onChange={(e) => {
                if (e.target.value === '__custom__') {
                  setShowCustomModel(true)
                  return
                }
                sendCommand('model', e.target.value)
              }}
              disabled={pendingCommand === 'model'}
              className="w-full min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 appearance-none cursor-pointer"
            >
              {!agent.model && <option value="">{t('agentPanel.default')}</option>}
              {agent.availableModelInfo && agent.availableModelInfo.length > 0
                ? agent.availableModelInfo.map((m) => (
                    <option key={m.value} value={m.value} title={m.description}>
                      {m.displayName}
                    </option>
                  ))
                : agent.availableModels?.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
              <option value="__custom__">{t('agentPanel.customModel')}</option>
            </select>
          )}
        </ConfigSection>
      )}

      {/* Thinking Mode */}
      {(agent.availableThinkingModes?.length ?? 0) > 0 && (
        <ConfigSection label={t('agentPanel.thinkingMode')}>
          <select
            value={agent.thinkingMode ?? ''}
            onChange={(e) => sendCommand('think', e.target.value)}
            disabled={pendingCommand === 'think'}
            className="w-full min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 appearance-none cursor-pointer"
          >
            {!agent.thinkingMode && <option value="">{t('agentPanel.default')}</option>}
            {agent.availableThinkingModes?.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </ConfigSection>
      )}

      {/* Effort Level */}
      {(agent.availableEffortLevels?.length ?? 0) > 0 && (
        <ConfigSection label={t('agentPanel.effortLevel')}>
          <select
            value={agent.effortLevel ?? ''}
            onChange={(e) => sendCommand('effort', e.target.value)}
            disabled={pendingCommand === 'effort'}
            className="w-full min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 appearance-none cursor-pointer"
          >
            {!agent.effortLevel && <option value="">{t('agentPanel.default')}</option>}
            {agent.availableEffortLevels?.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </ConfigSection>
      )}

      {/* Plan Mode */}
      {hasPlanMode && (
        <ConfigSection label={t('agentPanel.planMode')}>
          <button
            onClick={() => sendCommand('plan', '')}
            disabled={pendingCommand === 'plan'}
            className="flex items-center justify-between w-full min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm disabled:opacity-50 transition-colors"
          >
            <span className="text-text-secondary">{t('agentPanel.planModeDescription')}</span>
            <span
              className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full transition-colors ${
                agent.planMode ? 'bg-accent' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-sm transition-transform mt-0.5 ${
                  agent.planMode ? 'translate-x-[22px]' : 'translate-x-[2px]'
                }`}
              />
            </span>
          </button>
        </ConfigSection>
      )}

      {/* Session Info */}
      {isOnline && (
        <ConfigSection label={t('agentPanel.session')}>
          <div className="space-y-2 text-sm">
            {agent.sessionCostUSD != null && agent.sessionCostUSD > 0 && (
              <div className="flex justify-between">
                <span className="text-text-muted">{t('agentPanel.cost')}</span>
                <span className="text-text-primary font-mono">
                  ${agent.sessionCostUSD.toFixed(4)}
                </span>
              </div>
            )}
          </div>
        </ConfigSection>
      )}

      {/* General Info */}
      {(agent.workingDirectory || agent.deviceInfo || agent.lastSeenAt) && (
        <Section title={t('agentPanel.general')}>
          {agent.workingDirectory && (
            <InfoRow label={t('agent.workingDir')} value={agent.workingDirectory} mono />
          )}
          {agent.deviceInfo && (
            <InfoRow
              label={t('agentPanel.gateway')}
              value={`${agent.deviceInfo.hostname || agent.deviceInfo.platform} (${agent.deviceInfo.arch})`}
            />
          )}
          {agent.lastSeenAt && (
            <InfoRow
              label={t('agent.lastSeen')}
              value={new Date(agent.lastSeenAt).toLocaleString(i18n.language, {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            />
          )}
        </Section>
      )}

      {/* Action buttons */}
      {isOnline && (
        <div className="space-y-2">
          {hasCompact && (
            <button
              onClick={() => sendCommand('compact', '')}
              disabled={pendingCommand === 'compact'}
              className="w-full min-h-[44px] px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
            >
              {t('agentPanel.compactSession')}
            </button>
          )}
          <button
            onClick={() => {
              if (window.confirm(t('agentPanel.resetConfirm'))) {
                sendCommand('clear', '')
              }
            }}
            disabled={pendingCommand === 'clear'}
            className="w-full min-h-[44px] px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-danger-text hover:bg-danger-subtle transition-colors disabled:opacity-50"
          >
            {t('agentPanel.resetSession')}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Shared sub-components ───

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="text-xs font-medium text-text-secondary uppercase tracking-wider mb-2">
        {title}
      </h4>
      {children}
    </div>
  )
}

function ConfigSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-muted uppercase tracking-wider mb-2">
        {label}
      </label>
      {children}
    </div>
  )
}

function InfoRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="text-xs text-text-muted shrink-0">{label}</span>
      <span
        className={`text-sm text-text-primary truncate text-right ${mono ? 'font-mono text-xs' : ''}`}
        title={value}
      >
        {value}
      </span>
    </div>
  )
}
