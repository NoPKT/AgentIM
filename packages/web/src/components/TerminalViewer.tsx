import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { useChatStore } from '../stores/chat.js'

interface TerminalViewerProps {
  agentId: string
  agentName: string
  onClose: () => void
}

export function TerminalViewer({ agentId, agentName, onClose }: TerminalViewerProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const writtenTotalRef = useRef(0)
  const [collapsed, setCollapsed] = useState(false)
  const lines = useChatStore((s) => s.terminalBuffers.get(agentId)?.lines)
  const totalPushed = useChatStore((s) => s.terminalBuffers.get(agentId)?.totalPushed ?? 0)
  const clearTerminalBuffer = useChatStore((s) => s.clearTerminalBuffer)

  // Initialize xterm
  useEffect(() => {
    if (!containerRef.current) return

    // Read CSS custom property for terminal background
    const style = getComputedStyle(document.documentElement)
    const termBg = style.getPropertyValue('--color-terminal-bg').trim() || '#1e1e1e'
    const termFg = style.getPropertyValue('--color-terminal-text').trim() || '#d4d4d4'

    const term = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontSize: 13,
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      theme: {
        background: termBg,
        foreground: termFg,
        cursor: termFg,
      },
      scrollback: 5000,
      convertEol: true,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    termRef.current = term
    fitAddonRef.current = fitAddon
    writtenTotalRef.current = 0

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
    })
    observer.observe(containerRef.current)

    // Update xterm theme when dark/light mode toggles
    const themeObserver = new MutationObserver(() => {
      const s = getComputedStyle(document.documentElement)
      const bg = s.getPropertyValue('--color-terminal-bg').trim() || '#1e1e1e'
      const fg = s.getPropertyValue('--color-terminal-text').trim() || '#d4d4d4'
      term.options.theme = { background: bg, foreground: fg, cursor: fg }
    })
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      themeObserver.disconnect()
      observer.disconnect()
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [])

  // Write new data to terminal.
  // Uses a monotonic totalPushed counter from the store to reliably determine
  // how many new lines arrived, even when React batches multiple store updates
  // into a single render while the buffer is at its 500-line cap.
  useEffect(() => {
    if (!termRef.current || !lines || totalPushed === 0) return
    const newCount = totalPushed - writtenTotalRef.current
    if (newCount <= 0) return

    const term = termRef.current
    const startIdx = Math.max(0, lines.length - newCount)
    for (let i = startIdx; i < lines.length; i++) {
      term.write(lines[i])
    }
    writtenTotalRef.current = totalPushed
  }, [lines, totalPushed])

  // Re-fit when collapsed state changes
  useEffect(() => {
    if (!collapsed) {
      setTimeout(() => fitAddonRef.current?.fit(), 0)
    }
  }, [collapsed])

  return (
    <div className="border-t border-border bg-terminal-bg flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-terminal-header text-terminal-text text-xs">
        <div className="flex items-center gap-2">
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
            />
          </svg>
          <span className="font-medium">
            {t('common.terminal')} — {agentName}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              clearTerminalBuffer(agentId)
              termRef.current?.clear()
              writtenTotalRef.current = 0
            }}
            className="p-1 hover:bg-terminal-btn-hover rounded transition-colors"
            title={t('common.clear')}
            aria-label={t('common.clear')}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="p-1 hover:bg-terminal-btn-hover rounded transition-colors"
            title={collapsed ? t('common.expand') : t('common.collapse')}
            aria-label={collapsed ? t('common.expand') : t('common.collapse')}
          >
            <svg
              className={`w-3.5 h-3.5 transition-transform ${collapsed ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 9l-7 7-7-7"
              />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1 hover:bg-terminal-btn-hover rounded transition-colors"
            title={t('common.close')}
            aria-label={t('common.close')}
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>
      {/* Terminal body */}
      <div
        ref={containerRef}
        className={`transition-all overflow-hidden ${collapsed ? 'h-0' : 'h-48'}`}
      />
    </div>
  )
}
