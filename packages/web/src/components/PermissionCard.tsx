import { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { wsClient } from '../lib/ws.js'
import { Button } from './ui.js'

export interface PermissionRequestData {
  requestId: string
  agentId: string
  agentName: string
  roomId: string
  toolName: string
  toolInput: Record<string, unknown>
  expiresAt: string
  /** Set after the user responds or the request expires */
  resolved?: 'allowed' | 'denied' | 'timedOut'
}

const DANGEROUS_TOOLS = new Set(['Bash', 'Write', 'Edit'])

interface PermissionCardProps {
  request: PermissionRequestData
  onResolved: (requestId: string, decision: 'allowed' | 'denied') => void
}

export function PermissionCard({ request, onResolved }: PermissionCardProps) {
  const { t } = useTranslation()
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(0, Math.ceil((new Date(request.expiresAt).getTime() - Date.now()) / 1000)),
  )

  const isDangerous = useMemo(() => DANGEROUS_TOOLS.has(request.toolName), [request.toolName])
  const isResolved = !!request.resolved

  // Countdown timer
  useEffect(() => {
    if (isResolved) return
    const timer = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((new Date(request.expiresAt).getTime() - Date.now()) / 1000),
      )
      setSecondsLeft(remaining)
    }, 1000)
    return () => clearInterval(timer)
  }, [request.expiresAt, isResolved])

  const handleAllow = useCallback(() => {
    wsClient.send({
      type: 'client:permission_response',
      requestId: request.requestId,
      decision: 'allow',
    })
    onResolved(request.requestId, 'allowed')
  }, [request.requestId, onResolved])

  const handleDeny = useCallback(() => {
    wsClient.send({
      type: 'client:permission_response',
      requestId: request.requestId,
      decision: 'deny',
    })
    onResolved(request.requestId, 'denied')
  }, [request.requestId, onResolved])

  // Build a short summary of the tool input
  const inputSummary = useMemo(() => {
    const entries = Object.entries(request.toolInput)
    if (entries.length === 0) return ''
    return entries
      .slice(0, 3)
      .map(([key, value]) => {
        const strVal = typeof value === 'string' ? value : JSON.stringify(value)
        const truncated = strVal.length > 80 ? strVal.slice(0, 77) + '...' : strVal
        return `${key}: ${truncated}`
      })
      .join('\n')
  }, [request.toolInput])

  // Determine card border/bg color based on state
  const cardStyle = isResolved
    ? request.resolved === 'allowed'
      ? 'border-success-border bg-success-subtle/30'
      : request.resolved === 'denied'
        ? 'border-danger-border bg-danger-subtle/30'
        : 'border-border bg-surface-secondary/50'
    : isDangerous
      ? 'border-warning-border bg-warning-subtle/30'
      : 'border-info-border bg-info-subtle/30'

  return (
    <div className={`mx-6 my-2 rounded-lg border ${cardStyle} p-4`}>
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
          {isDangerous ? (
            <svg
              className="w-5 h-5 text-warning-text"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
          ) : (
            <svg
              className="w-5 h-5 text-info-text"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
              />
            </svg>
          )}
        </div>
        <span className="text-sm font-semibold text-text-primary">
          {t('chat.permissionRequestTitle')}
        </span>
        {!isResolved && secondsLeft > 0 && (
          <span
            className={`ml-auto text-xs font-medium tabular-nums ${
              secondsLeft <= 10 ? 'text-danger-text' : 'text-text-muted'
            }`}
          >
            {t('chat.permissionTimeoutIn', { seconds: secondsLeft })}
          </span>
        )}
      </div>

      {/* Description */}
      <p className="text-sm text-text-secondary mb-1">
        {t('chat.permissionToolWantsTo', {
          agent: request.agentName,
          tool: request.toolName,
        })}
      </p>

      {/* Danger warning */}
      {isDangerous && !isResolved && (
        <p className="text-xs text-warning-text mb-2">{t('chat.permissionDangerWarning')}</p>
      )}

      {/* Tool input summary */}
      {inputSummary && (
        <pre className="text-xs text-text-muted bg-surface-secondary rounded-md px-3 py-2 mb-3 overflow-x-auto whitespace-pre-wrap break-all max-h-32">
          {inputSummary}
        </pre>
      )}

      {/* Actions / Resolved status */}
      {isResolved ? (
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md ${
              request.resolved === 'allowed'
                ? 'bg-success-subtle text-success-text'
                : request.resolved === 'denied'
                  ? 'bg-danger-subtle text-danger-text'
                  : 'bg-surface-hover text-text-muted'
            }`}
          >
            {request.resolved === 'allowed' && (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            )}
            {request.resolved === 'denied' && (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            )}
            {request.resolved === 'timedOut' && (
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            )}
            {request.resolved === 'allowed'
              ? t('chat.permissionAllowed')
              : request.resolved === 'denied'
                ? t('chat.permissionDenied')
                : t('chat.permissionTimedOut')}
          </span>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleAllow}>
            {t('chat.permissionAllow')}
          </Button>
          <Button size="sm" variant="danger" onClick={handleDeny}>
            {t('chat.permissionDeny')}
          </Button>
          <span className="ml-auto text-xs text-text-muted italic">
            {t('chat.permissionAgentPaused')}
          </span>
        </div>
      )}
    </div>
  )
}
