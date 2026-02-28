import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgentStore } from '../stores/agents.js'
import { wsClient } from '../lib/ws.js'
import { getStatusConfig, getTypeConfig, agentGradients } from '../lib/agentConfig.js'
import { toast } from '../stores/toast.js'
import { Modal, Input, Button } from './ui.js'
import { CloseIcon, PencilIcon, TrashIcon } from './icons.js'

interface AgentInfoModalProps {
  agentId: string | null
  isOpen: boolean
  onClose: () => void
  /** Whether the current user owns this agent (enables rename). */
  isOwner?: boolean
}

export function AgentInfoModal({ agentId, isOpen, onClose, isOwner = false }: AgentInfoModalProps) {
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

  // Query fresh info from the gateway when modal opens
  useEffect(() => {
    if (isOpen && agentId && agent?.status === 'online') {
      wsClient.send({ type: 'client:query_agent_info', agentId })
    }
  }, [isOpen, agentId, agent?.status])

  useEffect(() => {
    if (agent) setNameValue(agent.name)
  }, [agent])

  useEffect(() => {
    if (!isOpen) {
      setEditingName(false)
      setConfirmDelete(false)
    }
  }, [isOpen])

  if (!agent) return null

  const statusConfig = getStatusConfig(t)
  const typeConfig = getTypeConfig(t)
  const status = statusConfig[agent.status as keyof typeof statusConfig] || statusConfig.offline
  const type = typeConfig[agent.type] || typeConfig.generic
  const gradient = agentGradients[agent.type] || agentGradients.generic

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await deleteAgent(agent!.id)
      toast.success(t('agent.agentDeleted'))
      onClose()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setDeleting(false)
    }
  }

  const handleRename = async () => {
    const trimmed = nameValue.trim()
    if (!trimmed || trimmed === agent.name) {
      setEditingName(false)
      return
    }
    setSaving(true)
    try {
      await renameAgent(agent.id, trimmed)
      toast.success(t('agentInfo.renamed'))
      setEditingName(false)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} aria-labelledby="agent-info-title">
      <div className="bg-surface rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border flex items-center justify-between">
          <h2 id="agent-info-title" className="text-lg font-semibold text-text-primary">
            {t('agentInfo.title')}
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
                    placeholder={t('agentInfo.renamePlaceholder')}
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
                      aria-label={t('agentInfo.rename')}
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

          {/* General section */}
          <Section title={t('agentInfo.general')}>
            {agent.model && <InfoRow label={t('agentInfo.model')} value={agent.model} mono />}
            {agent.workingDirectory && (
              <InfoRow label={t('agent.workingDir')} value={agent.workingDirectory} mono />
            )}
            {agent.deviceInfo && (
              <InfoRow
                label={t('agentInfo.gateway')}
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
          <Section title={t('agentInfo.mcpServers')}>
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
              <p className="text-xs text-text-muted">{t('agentInfo.noMcpServers')}</p>
            )}
          </Section>

          {/* Slash Commands */}
          <Section title={t('agentInfo.slashCommands')}>
            {agent.slashCommands && agent.slashCommands.length > 0 ? (
              <div className="space-y-1.5">
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
                      {cmd.source === 'builtin' ? t('agentInfo.builtin') : t('agentInfo.skill')}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-muted">{t('agentInfo.noCommands')}</p>
            )}
          </Section>

          {/* Delete Agent */}
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
