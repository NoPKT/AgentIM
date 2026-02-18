import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAgentStore } from '../stores/agents.js'
import { getStatusConfig, getTypeConfig, agentGradients } from '../lib/agentConfig.js'
import { Button } from '../components/ui.js'
import type { Agent, AgentVisibility } from '@agentim/shared'

export default function AgentsPage() {
  const { t } = useTranslation()
  const agents = useAgentStore((state) => state.agents)
  const isLoading = useAgentStore((state) => state.isLoading)
  const loadError = useAgentStore((state) => state.loadError)
  const loadAgents = useAgentStore((state) => state.loadAgents)

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  if (isLoading && agents.length === 0) {
    return (
      <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 px-4 sm:px-6 py-6">
        <div className="max-w-7xl mx-auto">
          <div className="mb-6 animate-pulse">
            <div className="h-8 w-32 bg-gray-200 dark:bg-gray-700 rounded" />
            <div className="mt-2 h-4 w-48 bg-gray-100 dark:bg-gray-700 rounded" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5 animate-pulse"
              >
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700" />
                  <div className="space-y-2">
                    <div className="h-4 w-24 bg-gray-200 dark:bg-gray-700 rounded" />
                    <div className="h-3 w-16 bg-gray-100 dark:bg-gray-700 rounded" />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-3 w-full bg-gray-100 dark:bg-gray-700 rounded" />
                  <div className="h-3 w-2/3 bg-gray-100 dark:bg-gray-700 rounded" />
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
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="text-center max-w-md">
          <svg
            className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-500"
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
          <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('loadFailed')}
          </h3>
          <Button onClick={loadAgents} className="mt-4">
            {t('retry')}
          </Button>
        </div>
      </div>
    )
  }

  if (agents.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900 px-4">
        <div className="text-center max-w-md">
          <svg
            className="mx-auto h-16 w-16 text-gray-400 dark:text-gray-500"
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
          <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
            {t('noAgents')}
          </h3>
          <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">{t('noAgentsDesc')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 px-4 sm:px-6 py-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{t('agents')}</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {t('agentsConnected', { count: agents.length })}
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
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5 hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div
            className={`w-10 h-10 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center`}
          >
            <span className="text-sm font-semibold text-white">
              {agent.name.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 dark:text-gray-100 truncate">
              {agent.name}
            </h3>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${type.color}`}
            >
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
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">{status.label}</span>
      </div>

      {/* Details */}
      <div className="space-y-2 text-sm">
        {agent.workingDirectory && (
          <div>
            <dt className="text-gray-500 dark:text-gray-400 text-xs font-medium mb-0.5">
              {t('workingDir')}
            </dt>
            <dd
              className="text-gray-900 dark:text-gray-100 truncate font-mono text-xs"
              title={agent.workingDirectory}
            >
              {agent.workingDirectory}
            </dd>
          </div>
        )}

        {agent.deviceInfo && (
          <div>
            <dt className="text-gray-500 dark:text-gray-400 text-xs font-medium mb-0.5">
              {t('device')}
            </dt>
            <dd className="text-gray-900 dark:text-gray-100 truncate">
              {agent.deviceInfo.platform}{' '}
              {agent.deviceInfo.hostname && `· ${agent.deviceInfo.hostname}`}
            </dd>
          </div>
        )}

        {agent.capabilities && agent.capabilities.length > 0 && (
          <div>
            <dt className="text-gray-500 dark:text-gray-400 text-xs font-medium mb-1">
              {t('capabilities')}
            </dt>
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
            <dt className="text-gray-500 dark:text-gray-400 text-xs font-medium mb-0.5">
              {t('lastSeen')}
            </dt>
            <dd className="text-gray-900 dark:text-gray-100">
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

      {/* Visibility Toggle */}
      <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
              {t('visibility')}
            </span>
            <span
              className={`ml-2 text-xs font-medium ${isShared ? 'text-green-600 dark:text-green-400' : 'text-gray-500 dark:text-gray-400'}`}
            >
              {isShared ? t('visibilityShared') : t('visibilityPrivate')}
            </span>
          </div>
          <button
            onClick={handleToggleVisibility}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
              isShared ? 'bg-green-500' : 'bg-gray-300 dark:bg-gray-600'
            }`}
            title={t('visibilityDesc')}
          >
            <span
              className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                isShared ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  )
}
