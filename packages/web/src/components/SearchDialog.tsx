import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api.js'
import { useChatStore } from '../stores/chat.js'
import { Modal } from './ui.js'
import { SearchIcon, CloseIcon } from './icons.js'
import type { Message } from '@agentim/shared'

function timeAgo(dateStr: string, locale: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diff = now - then
  const mins = Math.floor(diff / 60000)
  if (mins < 1)
    return locale.startsWith('zh')
      ? '刚刚'
      : locale.startsWith('ja')
        ? 'たった今'
        : locale.startsWith('ko')
          ? '방금'
          : 'now'
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
  const [sender, setSender] = useState('')
  const [results, setResults] = useState<Message[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const roomMap = new Map(rooms.map((r) => [r.id, r]))

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      setQuery('')
      setSender('')
      setResults([])
      setSearched(false)
      setShowFilters(false)
    }
  }, [isOpen])

  const doSearch = useCallback(async (q: string, senderFilter?: string) => {
    if (q.trim().length < 2) {
      setResults([])
      setSearched(false)
      return
    }
    setLoading(true)
    setSearched(true)
    try {
      const params = new URLSearchParams({ q: q.trim(), limit: '30' })
      if (senderFilter?.trim()) params.set('chat.sender', senderFilter.trim())
      const res = await api.get<Message[]>(`/messages/search?${params}`)
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
    timerRef.current = setTimeout(() => doSearch(value, sender), 400)
  }

  const handleSenderChange = (value: string) => {
    setSender(value)
    if (query.trim().length >= 2) {
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => doSearch(query, value), 400)
    }
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
    const slice =
      (start > 0 ? '...' : '') + text.slice(start, end) + (end < text.length ? '...' : '')
    const hlIdx = slice.toLowerCase().indexOf(q.toLowerCase())
    return (
      <>
        {slice.slice(0, hlIdx)}
        <mark className="bg-warning-subtle text-warning-text rounded px-0.5">
          {slice.slice(hlIdx, hlIdx + q.length)}
        </mark>
        {slice.slice(hlIdx + q.length)}
      </>
    )
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="items-start pt-[10vh]"
      aria-labelledby="search-dialog-label"
    >
      <div className="bg-surface rounded-xl shadow-xl max-w-lg w-full overflow-hidden">
        {/* Search Input */}
        <div className="px-4 py-3 border-b border-border">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
            <input
              ref={inputRef}
              id="search-dialog-label"
              type="text"
              value={query}
              onChange={(e) => handleInputChange(e.target.value)}
              placeholder={t('chat.searchMessages')}
              aria-label={t('chat.searchMessages')}
              className="w-full pl-11 pr-10 py-2.5 border border-border rounded-xl text-sm bg-surface text-text-primary placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
            />
            {query && (
              <button
                onClick={() => {
                  setQuery('')
                  setResults([])
                  setSearched(false)
                  inputRef.current?.focus()
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-surface-hover text-text-muted"
              >
                <CloseIcon className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`text-xs px-2 py-1 rounded-md transition-colors ${showFilters ? 'bg-info-muted text-info-text' : 'text-text-muted hover:bg-surface-hover'}`}
            >
              {t('chat.filters')}
            </button>
            {sender && (
              <span className="text-xs bg-surface-hover text-text-secondary px-2 py-0.5 rounded-md flex items-center gap-1">
                {t('chat.sender')}: {sender}
                <button onClick={() => handleSenderChange('')} className="hover:text-danger-text">
                  ×
                </button>
              </span>
            )}
          </div>
          {showFilters && (
            <div className="mt-2">
              <input
                type="text"
                value={sender}
                onChange={(e) => handleSenderChange(e.target.value)}
                placeholder={t('chat.filterBySender')}
                className="w-full px-3 py-1.5 border border-border rounded-lg text-xs bg-surface text-text-primary placeholder-text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          )}
        </div>

        {/* Results */}
        <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
          {loading && (
            <div className="px-4 py-8 text-center text-sm text-text-secondary">
              {t('common.loading')}
            </div>
          )}

          {!loading && searched && results.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-text-secondary">
              {t('common.noResults')}
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
                    className="w-full px-4 py-3 text-left hover:bg-surface-hover transition-colors border-b border-border last:border-0"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-xs font-medium text-info-text bg-info-subtle px-1.5 py-0.5 rounded truncate max-w-[120px]">
                          {room?.name ?? msg.roomId}
                        </span>
                        <span className="text-xs font-medium text-text-primary truncate">
                          {msg.senderName}
                        </span>
                      </div>
                      <span className="text-[10px] text-text-muted flex-shrink-0 ml-2">
                        {timeAgo(msg.createdAt, i18n.language)}
                      </span>
                    </div>
                    <p className="text-sm text-text-secondary leading-relaxed">
                      {highlightMatch(msg.content, query)}
                    </p>
                  </button>
                )
              })}
            </div>
          )}

          {!loading && !searched && (
            <div className="px-4 py-8 text-center text-sm text-text-muted">
              {t('chat.searchHint')}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border flex justify-between items-center">
          <span className="text-xs text-text-muted">
            {searched && results.length > 0 && `${results.length} ${t('chat.resultsFound')}`}
          </span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm font-medium text-text-secondary hover:bg-surface-hover rounded-lg transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
