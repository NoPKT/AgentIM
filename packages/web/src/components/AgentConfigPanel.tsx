import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ServerMessage, Agent } from '@agentim/shared'
import { useAgentStore } from '../stores/agents.js'
import { wsClient } from '../lib/ws.js'
import { toast } from '../stores/toast.js'
import { CloseIcon } from './icons.js'

interface AgentConfigPanelProps {
  agentIds: string[]
  roomId: string
  isOpen: boolean
  onClose: () => void
}

export function AgentConfigPanel({ agentIds, roomId, isOpen, onClose }: AgentConfigPanelProps) {
  const { t } = useTranslation()
  const agents = useAgentStore((s) => s.agents)
  const [activeAgentId, setActiveAgentId] = useState(agentIds[0] ?? '')
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)
  const [customModelInput, setCustomModelInput] = useState('')
  const [showCustomModel, setShowCustomModel] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  // Reset active agent when agentIds change
  useEffect(() => {
    if (agentIds.length > 0 && !agentIds.includes(activeAgentId)) {
      setActiveAgentId(agentIds[0])
    }
  }, [agentIds, activeAgentId])

  // Reset custom model input when switching agents
  useEffect(() => {
    setShowCustomModel(false)
    setCustomModelInput('')
    setPendingCommand(null)
  }, [activeAgentId])

  const agent = agents.find((a) => a.id === activeAgentId)
  const agentList = agentIds.map((id) => agents.find((a) => a.id === id)).filter(Boolean) as Agent[]

  // Query agent info on open
  useEffect(() => {
    if (isOpen) {
      for (const id of agentIds) {
        wsClient.send({ type: 'client:query_agent_info', agentId: id })
      }
    }
  }, [isOpen, agentIds])

  // Listen for command results
  useEffect(() => {
    if (!isOpen) return
    const unsub = wsClient.onMessage((msg: ServerMessage) => {
      if (msg.type === 'server:agent_command_result' && agentIds.includes(msg.agentId)) {
        setPendingCommand(null)
        if (msg.success) {
          toast.success(t('agentConfig.settingUpdated'))
          wsClient.send({ type: 'client:query_agent_info', agentId: msg.agentId })
        } else {
          toast.error(msg.message ?? t('common.error'))
        }
      }
    })
    return unsub
  }, [isOpen, agentIds, t])

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

  const sendCommand = useCallback(
    (command: string, args: string) => {
      setPendingCommand(command)
      wsClient.send({
        type: 'client:agent_command',
        agentId: activeAgentId,
        roomId,
        command,
        args,
      })
    },
    [activeAgentId, roomId],
  )

  const handleModelChange = useCallback(
    (value: string) => {
      if (value === '__custom__') {
        setShowCustomModel(true)
        return
      }
      sendCommand('model', value)
    },
    [sendCommand],
  )

  const handleCustomModelSubmit = useCallback(() => {
    const model = customModelInput.trim()
    if (!model) return
    sendCommand('model', model)
    setShowCustomModel(false)
    setCustomModelInput('')
  }, [customModelInput, sendCommand])

  const handleThinkingChange = useCallback(
    (value: string) => {
      sendCommand('think', value)
    },
    [sendCommand],
  )

  const handleEffortChange = useCallback(
    (value: string) => {
      sendCommand('effort', value)
    },
    [sendCommand],
  )

  const handleResetSession = useCallback(() => {
    if (window.confirm(t('agentConfig.resetConfirm'))) {
      sendCommand('clear', '')
    }
  }, [sendCommand, t])

  const handleCompact = useCallback(() => {
    sendCommand('compact', '')
  }, [sendCommand])

  if (!isOpen || agentIds.length === 0) return null

  return (
    <div
      className="fixed inset-0 z-modal bg-black/50 flex items-end sm:items-center justify-center"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-label={t('agentConfig.title')}
    >
      <div
        ref={panelRef}
        className="bg-surface w-full max-w-md rounded-t-2xl sm:rounded-2xl sm:my-auto shadow-2xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[70vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-lg font-semibold text-text-primary">{t('agentConfig.title')}</h2>
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {agent ? (
            <AgentSettings
              agent={agent}
              pendingCommand={pendingCommand}
              showCustomModel={showCustomModel}
              customModelInput={customModelInput}
              onCustomModelInputChange={setCustomModelInput}
              onShowCustomModelChange={setShowCustomModel}
              onModelChange={handleModelChange}
              onCustomModelSubmit={handleCustomModelSubmit}
              onThinkingChange={handleThinkingChange}
              onEffortChange={handleEffortChange}
              onResetSession={handleResetSession}
              onCompact={handleCompact}
            />
          ) : (
            <div className="py-8 text-center text-sm text-text-muted">
              {t('agentConfig.noOptions')}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

interface AgentSettingsProps {
  agent: Agent
  pendingCommand: string | null
  showCustomModel: boolean
  customModelInput: string
  onCustomModelInputChange: (v: string) => void
  onShowCustomModelChange: (v: boolean) => void
  onModelChange: (v: string) => void
  onCustomModelSubmit: () => void
  onThinkingChange: (v: string) => void
  onEffortChange: (v: string) => void
  onResetSession: () => void
  onCompact: () => void
}

function AgentSettings({
  agent,
  pendingCommand,
  showCustomModel,
  customModelInput,
  onCustomModelInputChange,
  onShowCustomModelChange,
  onModelChange,
  onCustomModelSubmit,
  onThinkingChange,
  onEffortChange,
  onResetSession,
  onCompact,
}: AgentSettingsProps) {
  const { t } = useTranslation()
  const costSummary = agent.sessionCostUSD
  const hasCompact = agent.type === 'claude-code'

  return (
    <>
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
              {t(`common.${agent.status}`)}
            </span>
          </p>
        </div>
      </div>

      {/* Model */}
      {(agent.availableModels?.length ?? 0) > 0 && (
        <ConfigSection label={t('agentConfig.model')}>
          {showCustomModel ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={customModelInput}
                onChange={(e) => onCustomModelInputChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onCustomModelSubmit()
                  if (e.key === 'Escape') onShowCustomModelChange(false)
                }}
                placeholder={t('agentConfig.modelPlaceholder')}
                className="flex-1 min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                autoFocus
              />
              <button
                onClick={onCustomModelSubmit}
                disabled={!customModelInput.trim()}
                className="min-h-[44px] px-4 bg-accent text-white rounded-lg text-sm font-medium hover:bg-accent-hover disabled:opacity-40 transition-colors"
              >
                {t('common.confirm')}
              </button>
            </div>
          ) : (
            <select
              value={agent.model ?? ''}
              onChange={(e) => onModelChange(e.target.value)}
              disabled={pendingCommand === 'model'}
              className="w-full min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 appearance-none cursor-pointer"
            >
              {!agent.model && <option value="">{t('agentConfig.default')}</option>}
              {agent.availableModels?.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              <option value="__custom__">{t('agentConfig.customModel')}</option>
            </select>
          )}
        </ConfigSection>
      )}

      {/* Thinking Mode */}
      {(agent.availableThinkingModes?.length ?? 0) > 0 && (
        <ConfigSection label={t('agentConfig.thinkingMode')}>
          <select
            value={agent.thinkingMode ?? ''}
            onChange={(e) => onThinkingChange(e.target.value)}
            disabled={pendingCommand === 'think'}
            className="w-full min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 appearance-none cursor-pointer"
          >
            {!agent.thinkingMode && <option value="">{t('agentConfig.default')}</option>}
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
        <ConfigSection label={t('agentConfig.effortLevel')}>
          <select
            value={agent.effortLevel ?? ''}
            onChange={(e) => onEffortChange(e.target.value)}
            disabled={pendingCommand === 'effort'}
            className="w-full min-h-[44px] px-3 py-2 bg-surface-secondary border border-border rounded-lg text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent disabled:opacity-50 appearance-none cursor-pointer"
          >
            {!agent.effortLevel && <option value="">{t('agentConfig.default')}</option>}
            {agent.availableEffortLevels?.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </ConfigSection>
      )}

      {/* Session Info */}
      <ConfigSection label={t('agentConfig.session')}>
        <div className="space-y-2 text-sm">
          {costSummary != null && costSummary > 0 && (
            <div className="flex justify-between">
              <span className="text-text-muted">{t('agentConfig.cost')}</span>
              <span className="text-text-primary font-mono">${costSummary.toFixed(4)}</span>
            </div>
          )}
        </div>
      </ConfigSection>

      {/* Action buttons */}
      <div className="space-y-2">
        {hasCompact && (
          <button
            onClick={onCompact}
            disabled={pendingCommand === 'compact'}
            className="w-full min-h-[44px] px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-text-secondary hover:bg-surface-hover transition-colors disabled:opacity-50"
          >
            {t('agentConfig.compactSession')}
          </button>
        )}
        <button
          onClick={onResetSession}
          disabled={pendingCommand === 'clear'}
          className="w-full min-h-[44px] px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-danger-text hover:bg-danger-subtle transition-colors disabled:opacity-50"
        >
          {t('agentConfig.resetSession')}
        </button>
      </div>
    </>
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
