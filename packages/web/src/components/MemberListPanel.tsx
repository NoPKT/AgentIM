import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomMember } from '@agentim/shared'
import { useAgentStore } from '../stores/agents.js'
import { useChatStore } from '../stores/chat.js'
import { getStatusConfig, agentGradients, agentTypeIcons } from '../lib/agentConfig.js'
import { AgentPanelInline } from './AgentPanel.js'
import { CloseIcon, PlusIcon } from './icons.js'
import { wsClient } from '../lib/ws.js'

interface MemberListPanelProps {
  members: RoomMember[]
  roomId: string
  isOpen: boolean
  onClose: () => void
  onAddAgent: () => void
  onRemoveMember: (memberId: string) => void
}

export function MemberListPanel({
  members,
  roomId,
  isOpen,
  onClose,
  onAddAgent,
  onRemoveMember,
}: MemberListPanelProps) {
  const { t } = useTranslation()
  const agents = useAgentStore((s) => s.agents)
  const sharedAgents = useAgentStore((s) => s.sharedAgents)
  const onlineUsers = useChatStore((s) => s.onlineUsers)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  const statusConfig = getStatusConfig(t)

  const agentMap = new Map([...agents, ...sharedAgents].map((a) => [a.id, a]))

  const roleLabel = (role: string) => {
    switch (role) {
      case 'owner':
        return t('chat.roleOwner')
      case 'admin':
        return t('chat.roleAdmin')
      default:
        return t('chat.roleMember')
    }
  }

  // When an agent is selected, show inline details instead of the member list
  if (selectedAgentId) {
    // Query fresh info when selecting an agent
    wsClient.send({ type: 'client:query_agent_info', agentId: selectedAgentId, roomId })

    return (
      <>
        {/* Backdrop */}
        {isOpen && (
          <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-overlay" onClick={onClose} />
        )}

        {/* Drawer */}
        <div
          role="dialog"
          aria-modal={isOpen}
          aria-label={t('chat.members')}
          className={`
            fixed top-0 right-0 h-full w-full sm:w-80 bg-surface shadow-xl z-modal
            transform transition-transform duration-300 ease-in-out
            ${isOpen ? 'translate-x-0' : 'translate-x-full'}
          `}
        >
          <div className="flex flex-col h-full">
            {/* Header with back button */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2 min-w-0">
                <button
                  onClick={() => setSelectedAgentId(null)}
                  className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors flex-shrink-0"
                  aria-label={t('chat.backToMembers')}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M15 19l-7-7 7-7"
                    />
                  </svg>
                </button>
                <h2 className="text-lg font-semibold text-text-primary truncate">
                  {agentMap.get(selectedAgentId)?.name ?? selectedAgentId}
                </h2>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors flex-shrink-0"
                aria-label={t('common.close')}
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Inline agent details */}
            <AgentPanelInline agentId={selectedAgentId} roomId={roomId} />
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      {/* Backdrop */}
      {isOpen && (
        <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-overlay" onClick={onClose} />
      )}

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal={isOpen}
        aria-label={t('chat.members')}
        className={`
          fixed top-0 right-0 h-full w-full sm:w-80 bg-surface shadow-xl z-modal
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}
        `}
      >
        <div className="flex flex-col h-full">
          {/* Header — same style as RoomSettingsDrawer */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h2 className="text-lg font-semibold text-text-primary">
              {t('chat.members')} ({members.length})
            </h2>
            <div className="flex items-center gap-1">
              <button
                onClick={onAddAgent}
                className="p-1 rounded-md text-accent hover:bg-surface-hover transition-colors"
                title={t('chat.addAgent')}
              >
                <PlusIcon className="w-5 h-5" />
              </button>
              <button
                onClick={onClose}
                className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors"
                aria-label={t('common.close')}
              >
                <CloseIcon className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Member List */}
          <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
            {members.map((member) => {
              const agent = member.memberType === 'agent' ? agentMap.get(member.memberId) : null
              const status = agent
                ? statusConfig[agent.status as keyof typeof statusConfig] || statusConfig.offline
                : null
              const displayName = agent ? agent.name : (member.displayName ?? member.memberId)

              return (
                <div
                  key={member.memberId}
                  className="flex items-center gap-2.5 px-4 py-2.5 hover:bg-surface-hover transition-colors group"
                >
                  {/* Avatar */}
                  <div className="relative flex-shrink-0">
                    {agent ? (
                      (() => {
                        const icon = agentTypeIcons[agent.type] || agentTypeIcons.generic
                        const gradient = agentGradients[agent.type] || agentGradients.generic
                        return (
                          <div
                            className={`w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br ${gradient}`}
                          >
                            <svg
                              className="w-4 h-4 text-white"
                              fill="currentColor"
                              viewBox={icon.viewBox || '0 0 24 24'}
                            >
                              {icon.paths.map((d, i) => (
                                <path key={i} d={d} />
                              ))}
                            </svg>
                          </div>
                        )
                      })()
                    ) : (
                      <div className="w-8 h-8 rounded-full flex items-center justify-center bg-gradient-to-br from-gray-400 to-gray-500">
                        <span className="text-xs font-medium text-white">
                          {displayName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}
                    {member.memberType === 'user' && onlineUsers.has(member.memberId) && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-surface rounded-full" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    {agent ? (
                      <button
                        onClick={() => setSelectedAgentId(agent.id)}
                        className="text-sm font-medium text-text-primary truncate block hover:text-accent transition-colors text-left w-full"
                      >
                        {displayName}
                      </button>
                    ) : (
                      <span className="text-sm font-medium text-text-primary truncate block">
                        {displayName}
                      </span>
                    )}
                    <div className="flex items-center gap-1 mt-0.5">
                      {status && (
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${status.color} flex-shrink-0`}
                        />
                      )}
                      <span className="text-xs text-text-muted">{roleLabel(member.role)}</span>
                    </div>
                  </div>

                  {/* Remove */}
                  {member.role !== 'owner' && (
                    <button
                      onClick={() => onRemoveMember(member.memberId)}
                      className="p-0.5 rounded text-text-muted hover:text-red-500 md:opacity-0 md:group-hover:opacity-100 transition-all flex-shrink-0"
                      title={t('chat.removeMember')}
                      aria-label={t('chat.removeMember')}
                    >
                      <CloseIcon className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </>
  )
}
