import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomMember } from '@agentim/shared'
import { useAgentStore } from '../stores/agents.js'
import { useChatStore } from '../stores/chat.js'
import { getStatusConfig, getTypeConfig } from '../lib/agentConfig.js'
import { AgentInfoModal } from './AgentInfoModal.js'
import { CloseIcon, PlusIcon } from './icons.js'

interface MemberListPanelProps {
  members: RoomMember[]
  onClose: () => void
  onAddAgent: () => void
  onRemoveMember: (memberId: string) => void
}

export function MemberListPanel({
  members,
  onClose,
  onAddAgent,
  onRemoveMember,
}: MemberListPanelProps) {
  const { t } = useTranslation()
  const agents = useAgentStore((s) => s.agents)
  const onlineUsers = useChatStore((s) => s.onlineUsers)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)

  const statusConfig = getStatusConfig(t)
  const typeConfig = getTypeConfig(t)

  const agentMap = new Map(agents.map((a) => [a.id, a]))

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

  return (
    <>
      <div className="w-64 border-l border-border bg-surface flex flex-col h-full">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-sm font-semibold text-text-primary">
            {t('chat.members')} ({members.length})
          </h3>
          <div className="flex items-center gap-1">
            <button
              onClick={onAddAgent}
              className="p-1 rounded-md text-accent hover:bg-surface-hover transition-colors"
              title={t('chat.addAgent')}
            >
              <PlusIcon className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-surface-hover transition-colors"
              aria-label={t('common.close')}
            >
              <CloseIcon className="w-4 h-4" />
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
            const type = agent ? typeConfig[agent.type] || typeConfig.generic : null
            const displayName = agent ? agent.name : (member.displayName ?? member.memberId)

            return (
              <div
                key={member.memberId}
                className="flex items-center gap-2.5 px-3 py-2 hover:bg-surface-hover transition-colors group"
              >
                {/* Avatar */}
                <div className="relative flex-shrink-0">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center ${
                      member.memberType === 'agent'
                        ? 'bg-gradient-to-br from-blue-500 to-indigo-600'
                        : 'bg-gradient-to-br from-gray-400 to-gray-500'
                    }`}
                  >
                    <span className="text-[10px] font-medium text-white">
                      {displayName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  {member.memberType === 'user' && onlineUsers.has(member.memberId) && (
                    <span className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-500 border-2 border-surface rounded-full" />
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  {agent ? (
                    <button
                      onClick={() => setSelectedAgentId(agent.id)}
                      className="text-xs font-medium text-text-primary truncate block hover:text-accent transition-colors text-left w-full"
                    >
                      {displayName}
                    </button>
                  ) : (
                    <span className="text-xs font-medium text-text-primary truncate block">
                      {displayName}
                    </span>
                  )}
                  <div className="flex items-center gap-1 mt-0.5">
                    {status && (
                      <span className={`w-1.5 h-1.5 rounded-full ${status.color} flex-shrink-0`} />
                    )}
                    {type && (
                      <span className={`text-[9px] font-medium ${type.color}`}>{type.label}</span>
                    )}
                    <span className="text-[9px] text-text-muted">{roleLabel(member.role)}</span>
                  </div>
                </div>

                {/* Remove */}
                {member.role !== 'owner' && (
                  <button
                    onClick={() => onRemoveMember(member.memberId)}
                    className="p-0.5 rounded text-text-muted hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all flex-shrink-0"
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

      <AgentInfoModal
        agentId={selectedAgentId}
        isOpen={!!selectedAgentId}
        onClose={() => setSelectedAgentId(null)}
        isOwner={false}
      />
    </>
  )
}
