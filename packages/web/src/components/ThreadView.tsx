import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { Message } from '@agentim/shared'
import { getThread } from '../lib/api.js'

interface ThreadViewProps {
  messageId: string
  roomId: string
  onClose: () => void
}

export function ThreadView({ messageId, roomId, onClose }: ThreadViewProps) {
  const { t } = useTranslation()
  const [replies, setReplies] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    getThread(messageId)
      .then((data) => {
        if (!cancelled) setReplies(data)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? 'Failed to load thread')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [messageId])

  return (
    <div className="border-l border-border flex flex-col h-full w-80 bg-surface">
      <div className="flex items-center justify-between p-3 border-b border-border">
        <h3 className="font-semibold text-sm text-text-primary">{t('thread.title')}</h3>
        <button
          onClick={onClose}
          className="text-text-muted hover:text-text-primary p-1 rounded-md hover:bg-surface-hover transition-colors"
          aria-label={t('common.close')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {loading && (
          <div className="flex justify-center py-4">
            <span className="text-text-muted text-sm">{t('common.loading')}</span>
          </div>
        )}
        {error && <div className="text-danger-text text-sm text-center py-4">{error}</div>}
        {!loading && !error && replies.length === 0 && (
          <div className="text-text-muted text-sm text-center py-4">{t('thread.noReplies')}</div>
        )}
        {replies.map((reply) => (
          <div key={reply.id} className="bg-surface-secondary rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-medium text-sm text-text-primary">{reply.senderName}</span>
              <span className="text-xs text-text-muted">
                {new Date(reply.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="text-sm text-text-primary whitespace-pre-wrap break-words">
              {reply.content}
            </p>
          </div>
        ))}
      </div>
    </div>
  )
}
