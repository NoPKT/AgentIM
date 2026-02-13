import { useState, useRef, useEffect, KeyboardEvent, ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { parseMentions } from '@agentim/shared'
import { useChatStore } from '../stores/chat.js'
import { useAgentStore } from '../stores/agents.js'

export function MessageInput() {
  const { t } = useTranslation()
  const { currentRoomId, sendMessage } = useChatStore()
  const { agents } = useAgentStore()
  const [content, setContent] = useState('')
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionSearch, setMentionSearch] = useState('')
  const [mentionPosition, setMentionPosition] = useState(0)
  const [selectedMentionIndex, setSelectedMentionIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 过滤可提及的agents
  const filteredAgents = agents.filter((agent) =>
    agent.name.toLowerCase().includes(mentionSearch.toLowerCase())
  )

  // 自动调整textarea高度
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [content])

  // 检测@符号并显示提及菜单
  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setContent(newContent)

    const cursorPos = e.target.selectionStart
    const textBeforeCursor = newContent.slice(0, cursorPos)
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1)
      // 检查@后面没有空格
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

  // 插入提及
  const insertMention = (agentName: string) => {
    const before = content.slice(0, mentionPosition)
    const after = content.slice(textareaRef.current?.selectionStart ?? content.length)
    const newContent = `${before}@${agentName} ${after}`
    setContent(newContent)
    setShowMentionMenu(false)

    // 聚焦并移动光标到插入位置后
    setTimeout(() => {
      if (textareaRef.current) {
        const newPos = mentionPosition + agentName.length + 2
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newPos, newPos)
      }
    }, 0)
  }

  // 键盘事件处理
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 提及菜单导航
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

    // Cmd/Ctrl + Enter 发送消息
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSend()
    }
  }

  // 发送消息
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
    <div className="border-t border-gray-200 bg-white p-4">
      <div className="relative">
        {/* 提及菜单 */}
        {showMentionMenu && filteredAgents.length > 0 && (
          <div className="absolute bottom-full mb-2 left-0 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto z-10 w-64">
            <div className="p-2 border-b border-gray-100">
              <p className="text-xs text-gray-500">{t('chat.mentionHint')}</p>
            </div>
            {filteredAgents.map((agent, index) => (
              <button
                key={agent.id}
                onClick={() => insertMention(agent.name)}
                className={`
                  w-full px-3 py-2 text-left hover:bg-gray-100 transition-colors
                  ${index === selectedMentionIndex ? 'bg-blue-50' : ''}
                `}
              >
                <div className="flex items-center space-x-2">
                  <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                    <span className="text-xs font-medium text-blue-700">
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

        {/* 输入框 */}
        <div className="flex items-end space-x-2">
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={content}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={t('chat.sendMessage')}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={1}
              style={{ minHeight: '48px', maxHeight: '200px' }}
            />
            <div className="absolute bottom-2 right-2">
              <p className="text-xs text-gray-400">{t('chat.sendWithCmd')}</p>
            </div>
          </div>

          {/* 发送按钮 */}
          <button
            onClick={handleSend}
            disabled={!content.trim()}
            className="flex-shrink-0 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
