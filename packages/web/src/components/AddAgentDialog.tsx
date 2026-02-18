import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgentStore } from '../stores/agents.js'
import { useChatStore } from '../stores/chat.js'
import { getStatusConfig, getTypeConfig } from '../lib/agentConfig.js'
import { toast } from '../stores/toast.js'
import { Button, Input, Modal } from './ui.js'
import { SearchIcon } from './icons.js'
import type { Agent } from '@agentim/shared'

interface AddAgentDialogProps {
  roomId: string
  existingMemberIds: Set<string>
  isOpen: boolean
  onClose: () => void
  onAdded: () => void
}

export function AddAgentDialog({
  roomId,
  existingMemberIds,
  isOpen,
  onClose,
  onAdded,
}: AddAgentDialogProps) {
  const { t } = useTranslation()
  const agents = useAgentStore((s) => s.agents)
  const sharedAgents = useAgentStore((s) => s.sharedAgents)
  const loadSharedAgents = useAgentStore((s) => s.loadSharedAgents)
  const addRoomMember = useChatStore((s) => s.addRoomMember)
  const [search, setSearch] = useState('')
  const [onlineOnly, setOnlineOnly] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)

  const statusConfig = getStatusConfig(t)
  const typeConfig = getTypeConfig(t)

  // Load shared agents when dialog opens
  useEffect(() => {
    if (isOpen) {
      loadSharedAgents()
    }
  }, [isOpen, loadSharedAgents])

  const filterAgents = (list: Agent[]) =>
    list.filter((agent) => {
      if (existingMemberIds.has(agent.id)) return false
      if (onlineOnly && agent.status !== 'online') return false
      if (search && !agent.name.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })

  const availableMyAgents = useMemo(
    () => filterAgents(agents),
    [agents, existingMemberIds, onlineOnly, search],
  )
  const availableSharedAgents = useMemo(
    () => filterAgents(sharedAgents),
    [sharedAgents, existingMemberIds, onlineOnly, search],
  )

  const handleAdd = async (agentId: string) => {
    setAdding(agentId)
    try {
      await addRoomMember(roomId, agentId, 'agent')
      onAdded()
      toast.success(t('agentAdded'))
    } catch {
      toast.error(t('error'))
    } finally {
      setAdding(null)
    }
  }

  const renderAgentRow = (agent: Agent, showOwner = false) => {
    const status = statusConfig[agent.status as keyof typeof statusConfig] || statusConfig.offline
    const type = typeConfig[agent.type] || typeConfig.generic

    return (
      <div
        key={agent.id}
        className="px-6 py-3 flex items-center gap-3 hover:bg-surface-hover transition-colors"
      >
        {/* Avatar */}
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-medium text-white">
            {agent.name.charAt(0).toUpperCase()}
          </span>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary text-sm truncate">
              {agent.name}
            </span>
            <span className={`w-1.5 h-1.5 rounded-full ${status.color} flex-shrink-0`} />
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${type.color}`}
            >
              {type.label}
            </span>
            {showOwner && agent.ownerName && (
              <span className="text-xs text-text-muted truncate">
                {t('ownedBy', { name: agent.ownerName })}
              </span>
            )}
          </div>
        </div>

        {/* Add Button */}
        <button
          onClick={() => handleAdd(agent.id)}
          disabled={adding === agent.id}
          className="px-3 py-1.5 text-sm font-medium text-info-text bg-info-subtle rounded-lg hover:bg-info-muted transition-colors disabled:opacity-50 flex-shrink-0"
        >
          {adding === agent.id ? t('adding') : t('addAgent')}
        </button>
      </div>
    )
  }

  const hasNoAgents = availableMyAgents.length === 0 && availableSharedAgents.length === 0

  return (
    <Modal isOpen={isOpen} onClose={onClose} aria-labelledby="add-agent-title">
      <div className="bg-surface rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-border">
          <h2 id="add-agent-title" className="text-lg font-semibold text-text-primary">
            {t('addAgentToRoom')}
          </h2>
        </div>

        {/* Search + Filter */}
        <div className="px-6 py-3 space-y-3 border-b border-border">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
            <Input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search')}
              aria-label={t('search')}
              className="pl-10"
              autoFocus
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={onlineOnly}
              onChange={(e) => setOnlineOnly(e.target.checked)}
              className="rounded border-border text-accent focus:ring-accent"
            />
            <span className="text-sm text-text-secondary">
              {t('filterOnlineOnly')}
            </span>
          </label>
        </div>

        {/* Agent List */}
        <div className="max-h-80 overflow-y-auto">
          {hasNoAgents ? (
            <div className="px-6 py-8 text-center text-sm text-text-secondary">
              {t('noAgentsAvailable')}
            </div>
          ) : (
            <>
              {/* My Agents Section */}
              {availableMyAgents.length > 0 && (
                <>
                  <div className="px-6 py-2 bg-surface-secondary sticky top-0">
                    <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                      {t('myAgents')}
                    </span>
                  </div>
                  {availableMyAgents.map((agent) => renderAgentRow(agent))}
                </>
              )}

              {/* Shared Agents Section */}
              {availableSharedAgents.length > 0 && (
                <>
                  <div className="px-6 py-2 bg-surface-secondary sticky top-0">
                    <span className="text-xs font-semibold text-text-muted uppercase tracking-wider">
                      {t('sharedAgents')}
                    </span>
                  </div>
                  {availableSharedAgents.map((agent) => renderAgentRow(agent, true))}
                </>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-border flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            {t('close')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
