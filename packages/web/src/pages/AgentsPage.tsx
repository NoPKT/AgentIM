import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentStore } from '../stores/agents.js';
import type { Agent } from '@agentim/shared';

export default function AgentsPage() {
  const { t } = useTranslation();
  const agents = useAgentStore((state) => state.agents);
  const loadAgents = useAgentStore((state) => state.loadAgents);

  useEffect(() => {
    loadAgents();
  }, [loadAgents]);

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
    );
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
  );
}

function AgentCard({ agent }: { agent: Agent }) {
  const { t } = useTranslation();

  const statusConfig = {
    online: {
      color: 'bg-green-500',
      label: t('online'),
      textColor: 'text-green-700',
      bgColor: 'bg-green-50',
    },
    offline: {
      color: 'bg-gray-400',
      label: t('offline'),
      textColor: 'text-gray-700',
      bgColor: 'bg-gray-50',
    },
    busy: {
      color: 'bg-yellow-500',
      label: t('busy'),
      textColor: 'text-yellow-700',
      bgColor: 'bg-yellow-50',
    },
    error: {
      color: 'bg-red-500',
      label: t('error'),
      textColor: 'text-red-700',
      bgColor: 'bg-red-50',
    },
  };

  const typeConfig: Record<string, { label: string; color: string }> = {
    claude_code: {
      label: t('claudeCode'),
      color: 'bg-purple-100 text-purple-800',
    },
    codex: {
      label: t('codex'),
      color: 'bg-blue-100 text-blue-800',
    },
    gemini: {
      label: t('gemini'),
      color: 'bg-cyan-100 text-cyan-800',
    },
    cursor: {
      label: t('cursor'),
      color: 'bg-indigo-100 text-indigo-800',
    },
    generic: {
      label: t('generic'),
      color: 'bg-gray-100 text-gray-800',
    },
  };

  const status = statusConfig[agent.status] || statusConfig.offline;
  const type = typeConfig[agent.type] || typeConfig.generic;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-5 hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{agent.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${type.color}`}>
              {type.label}
            </span>
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="flex items-center gap-2 mb-4">
        <span className={`w-2 h-2 rounded-full ${status.color}`} />
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
              {agent.deviceInfo.platform} {agent.deviceInfo.hostname && `• ${agent.deviceInfo.hostname}`}
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
  );
}
