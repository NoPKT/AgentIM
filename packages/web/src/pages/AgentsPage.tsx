import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgentStore } from '../stores/agents.js'
import { getStatusConfig, getTypeConfig, agentGradients } from '../lib/agentConfig.js'
import type { Agent } from '@agentim/shared'

export default function AgentsPage() {
  const { t } = useTranslation()
  const agents = useAgentStore((state) => state.agents)
  const loadAgents = useAgentStore((state) => state.loadAgents)

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 px-4">
        <div className="text-center max-w-md">
          <svg
            className="mx-auto h-16 w-16 text-gray-400"
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
          <h3 className="mt-4 text-lg font-semibold text-gray-900">{t('noAgents')}</h3>
          <p className="mt-2 text-sm text-gray-600">{t('noAgentsDesc')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 px-6 py-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{t('agents')}</h1>
          <p className="mt-1 text-sm text-gray-600">
            {agents.length} {agents.length === 1 ? 'agent' : 'agents'} connected
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      </div>
    </div>
  )
}

function AgentCard({ agent }: { agent: Agent }) {
  const { t } = useTranslation()

  const statusConfig = getStatusConfig(t)
  const typeConfig = getTypeConfig(t)

  const status = statusConfig[agent.status as keyof typeof statusConfig] || statusConfig.offline
  const type = typeConfig[agent.type] || typeConfig.generic
  const gradient = agentGradients[agent.type] || agentGradients.generic

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center`}>
            <span className="text-sm font-semibold text-white">
              {agent.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{agent.name}</h3>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${type.color}`}>
              {type.label}
            </span>
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 mb-4">
        <span className="relative flex h-2.5 w-2.5">
          {agent.status === 'online' && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          )}
          <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${status.color}`} />
        </span>
        <span className="text-sm font-medium text-gray-700">{status.label}</span>
      </div>

      {/* Details */}
      <div className="space-y-2 text-sm">
        {agent.workingDirectory && (
          <div>
            <dt className="text-gray-500 text-xs font-medium mb-0.5">{t('workingDir')}</dt>
            <dd className="text-gray-900 truncate font-mono text-xs" title={agent.workingDirectory}>
              {agent.workingDirectory}
            </dd>
          </div>
        )}

        {agent.deviceInfo && (
          <div>
            <dt className="text-gray-500 text-xs font-medium mb-0.5">{t('device')}</dt>
            <dd className="text-gray-900 truncate">
              {agent.deviceInfo.platform} {agent.deviceInfo.hostname && `· ${agent.deviceInfo.hostname}`}
            </dd>
          </div>
        )}

        {agent.lastSeenAt && (
          <div>
            <dt className="text-gray-500 text-xs font-medium mb-0.5">{t('lastSeen')}</dt>
            <dd className="text-gray-900">
              {new Date(agent.lastSeenAt).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </dd>
          </div>
        )}
      </div>
    </div>
  )
}
