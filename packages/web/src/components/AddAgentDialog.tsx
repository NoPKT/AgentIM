import { useState, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgentStore } from '../stores/agents.js'
import { useChatStore } from '../stores/chat.js'
import { getStatusConfig, getTypeConfig } from '../lib/agentConfig.js'
import { toast } from '../stores/toast.js'
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

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const renderAgentRow = (agent: Agent, showOwner = false) => {
    const status = statusConfig[agent.status as keyof typeof statusConfig] || statusConfig.offline
    const type = typeConfig[agent.type] || typeConfig.generic

    return (
      <div
        key={agent.id}
        className="px-6 py-3 flex items-center gap-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
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
            <span className="font-medium text-gray-900 dark:text-gray-100 text-sm truncate">
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
              <span className="text-xs text-gray-400 dark:text-gray-500 truncate">
                {t('ownedBy', { name: agent.ownerName })}
              </span>
            )}
          </div>
        </div>

        {/* Add Button */}
        <button
          onClick={() => handleAdd(agent.id)}
          disabled={adding === agent.id}
          className="px-3 py-1.5 text-sm font-medium text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/30 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50 flex-shrink-0"
        >
          {adding === agent.id ? '...' : t('addAgent')}
        </button>
      </div>
    )
  }

  const hasNoAgents = availableMyAgents.length === 0 && availableSharedAgents.length === 0

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-[60] p-4"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl max-w-md w-full overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t('addAgentToRoom')}
          </h2>
        </div>

        {/* Search + Filter */}
        <div className="px-6 py-3 space-y-3 border-b border-gray-100 dark:border-gray-700">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 dark:text-gray-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('search')}
              className="w-full pl-10 pr-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              autoFocus
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={onlineOnly}
              onChange={(e) => setOnlineOnly(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">
              {t('filterOnlineOnly')}
            </span>
          </label>
        </div>

        {/* Agent List */}
        <div className="max-h-80 overflow-y-auto">
          {hasNoAgents ? (
            <div className="px-6 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
              {t('noAgentsAvailable')}
            </div>
          ) : (
            <>
              {/* My Agents Section */}
              {availableMyAgents.length > 0 && (
                <>
                  <div className="px-6 py-2 bg-gray-50 dark:bg-gray-700/30 sticky top-0">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      {t('myAgents')}
                    </span>
                  </div>
                  {availableMyAgents.map((agent) => renderAgentRow(agent))}
                </>
              )}

              {/* Shared Agents Section */}
              {availableSharedAgents.length > 0 && (
                <>
                  <div className="px-6 py-2 bg-gray-50 dark:bg-gray-700/30 sticky top-0">
                    <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
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
        <div className="px-6 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
