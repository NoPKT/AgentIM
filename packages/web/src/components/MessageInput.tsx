import { useState, useRef, useEffect, useCallback, KeyboardEvent, ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { parseMentions } from '@agentim/shared'
import { useChatStore } from '../stores/chat.js'
import { useAgentStore } from '../stores/agents.js'
import { wsClient } from '../lib/ws.js'

export function MessageInput() {
  const { t } = useTranslation()
  const { currentRoomId, sendMessage, replyTo, setReplyTo } = useChatStore()
  const { agents } = useAgentStore()
  const [content, setContent] = useState('')
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionSearch, setMentionSearch] = useState('')
  const [mentionPosition, setMentionPosition] = useState(0)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const lastTypingSentRef = useRef(0)

  const sendTypingEvent = useCallback(() => {
    if (!currentRoomId) return
    const now = Date.now()
    if (now - lastTypingSentRef.current > 2000) {
      lastTypingSentRef.current = now
      wsClient.send({ type: 'client:typing', roomId: currentRoomId })
    }
  }, [currentRoomId])

  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(mentionSearch.toLowerCase())
  )

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [content])

  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setContent(newContent)
    sendTypingEvent()

    const cursorPos = e.target.selectionStart
    const textBeforeCursor = newContent.slice(0, cursorPos)
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
      if (!textAfterAt.includes(' ')) {
        setMentionSearch(textAfterAt)
        setMentionPosition(lastAtIndex)
        setShowMentionMenu(true)
        setSelectedMentionIndex(0)
        return
      }
    }

    setShowMentionMenu(false)
  }

  const insertMention = (agentName: string) => {
    const before = content.slice(0, mentionPosition)
    const after = content.slice(textareaRef.current?.selectionStart ?? content.length)
    const newContent = `${before}@${agentName} ${after}`
    setContent(newContent)
    setShowMentionMenu(false)

    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = mentionPosition + agentName.length + 2
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (showMentionMenu && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedMentionIndex((prev) =>
          prev < filteredAgents.length - 1 ? prev + 1 : prev
        )
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedMentionIndex((prev) => (prev > 0 ? prev - 1 : prev))
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertMention(filteredAgents[selectedMentionIndex].name)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setShowMentionMenu(false)
        return
      }
    }

    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  const handleSend = () => {
    if (!currentRoomId || !content.trim()) return

    const mentions = parseMentions(content)
    sendMessage(currentRoomId, content.trim(), mentions)
    setContent('')
  }

  if (!currentRoomId) {
    return null
  }

  return (
    <div className="bg-white px-4 pb-4 pt-2">
      {/* Reply preview */}
      {replyTo && (
        <div className="mb-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-xl flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              <span className="text-xs font-medium text-blue-600">{replyTo.senderName}</span>
            </div>
            <p className="text-xs text-gray-500 truncate mt-0.5">{replyTo.content.slice(0, 80)}</p>
          </div>
          <button
            onClick={() => setReplyTo(null)}
            className="p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 flex-shrink-0 ml-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      <div className="relative border border-gray-200 rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-shadow">
        {/* Mention menu */}
        {showMentionMenu && filteredAgents.length > 0 && (
          <div className="absolute bottom-full mb-2 left-4 bg-white border border-gray-200 rounded-xl shadow-xl max-h-48 overflow-y-auto z-10 w-64">
            <div className="p-2.5 border-b border-gray-100">
              <p className="text-xs text-gray-500">{t('mentionHint')}</p>
            </div>
            {filteredAgents.map((agent, index) => (
              <button
                key={agent.id}
                onClick={() => insertMention(agent.name)}
                className={`
                  w-full px-3 py-2.5 text-left hover:bg-gray-50 transition-colors
                  ${index === selectedMentionIndex ? 'bg-blue-50' : ''}
                `}
              >
                <div className="flex items-center space-x-2.5">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center">
                    <span className="text-xs font-medium text-white">
                      {agent.name.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{agent.name}</p>
                    <p className="text-xs text-gray-500">{agent.type}</p>
                  </div>
                  {agent.status === 'online' && (
                    <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Input area */}
        <div className="flex items-end">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={t('sendMessage')}
              className="w-full px-4 py-3 resize-none focus:outline-none rounded-2xl bg-transparent"
              rows={1}
              style={{ minHeight: '48px', maxHeight: '200px' }}
            />
          </div>

          {/* Send button */}
          <div className="px-2 pb-2">
            <button
              onClick={handleSend}
              disabled={!content.trim()}
              className="w-10 h-10 flex items-center justify-center bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
        </div>

        <div className="px-4 pb-2">
          <p className="text-[10px] text-gray-400">{t('sendWithCmd')}</p>
        </div>
      </div>
    </div>
  )
}
