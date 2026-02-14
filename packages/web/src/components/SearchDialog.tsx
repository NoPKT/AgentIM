import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api.js'
import { useChatStore } from '../stores/chat.js'
import type { Message } from '@agentim/shared'

function timeAgo(dateStr: string, locale: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return locale.startsWith('zh') ? '刚刚' : locale.startsWith('ja') ? 'たった今' : locale.startsWith('ko') ? '방금' : 'now'
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

interface SearchDialogProps {
  isOpen: boolean
  onClose: () => void
}

export function SearchDialog({ isOpen, onClose }: SearchDialogProps) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const setCurrentRoom = useChatStore((s) => s.setCurrentRoom)
  const rooms = useChatStore((s) => s.rooms)
  const inputRef = useRef<HTMLInputElement>(null)

  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>()

  const roomMap = new Map(rooms.map((r) => [r.id, r]))

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      setQuery('')
      setResults([])
      setSearched(false)
    }
  }, [isOpen])

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults([])
      setSearched(false)
      return
    }
    setLoading(true)
    setSearched(true)
    try {
      const res = await api.get<Message[]>(`/messages/search?q=${encodeURIComponent(q.trim())}&limit=30`)
      if (res.ok && res.data) {
        setResults(res.data)
      }
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInputChange = (value: string) => {
    setQuery(value)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => doSearch(value), 400)
  }

  const handleResultClick = (msg: Message) => {
    setCurrentRoom(msg.roomId)
    navigate(`/room/${msg.roomId}`)
    onClose()
  }

  const highlightMatch = (text: string, q: string) => {
    if (!q.trim()) return text
    const idx = text.toLowerCase().indexOf(q.toLowerCase())
    if (idx === -1) return text.length > 120 ? text.slice(0, 120) + '...' : text
    const start = Math.max(0, idx - 40)
    const end = Math.min(text.length, idx + q.length + 60)
    const slice = (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '')
    const hlIdx = slice.toLowerCase().indexOf(q.toLowerCase())
    return (
      <>
        {slice.slice(0, hlIdx)}
        <mark className="bg-yellow-200 text-yellow-900 rounded px-0.5">{slice.slice(hlIdx, hlIdx + q.length)}</mark>
        {slice.slice(hlIdx + q.length)}
      </>
    )
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-start justify-center z-50 p-4 pt-[10vh]">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
        {/* Search Input */}
        <div className="px-4 py-3 border-b border-gray-100">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder={t('searchMessages')}
              className="w-full pl-11 pr-10 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              onKeyDown={(e) => {
                if (e.key === 'Escape') onClose()
              }}
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setResults([]); setSearched(false); inputRef.current?.focus() }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-gray-100 text-gray-400"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto">
          {loading && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              {t('loading')}
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              {t('noResults')}
            </div>
          )}

          {!loading && results.length > 0 && (
            <div className="py-1">
              {results.map((msg) => {
                const room = roomMap.get(msg.roomId)
                return (
                  <button
                    key={msg.id}
                    onClick={() => handleResultClick(msg)}
                    className="w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded truncate max-w-[120px]">
                          {room?.name ?? msg.roomId}
                        </span>
                        <span className="text-xs font-medium text-gray-700 truncate">
                          {msg.senderName}
                        </span>
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0 ml-2">
                        {timeAgo(msg.createdAt, i18n.language)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {highlightMatch(msg.content, query)}
                    </p>
                  </button>
                )
              })}
            </div>
          )}

          {!loading && !searched && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              {t('searchHint')}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-gray-100 flex justify-between items-center">
          <span className="text-xs text-gray-400">
            {searched && results.length > 0 && `${results.length} ${t('resultsFound')}`}
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
