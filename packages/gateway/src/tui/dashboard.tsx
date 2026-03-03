import React, { useState, useCallback, useMemo, useRef } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import TextInput from 'ink-text-input'
import { StatusBar } from './status-bar.js'
import { AgentList } from './agent-list.js'
import { AgentDetails } from './agent-details.js'
import { LogViewer } from './log-viewer.js'
import { HelpBar } from './help-bar.js'
import { ContextMenu, type MenuItem } from './context-menu.js'
import { RenameDialog, ConfirmDialog, MessageBox } from './dialogs.js'
import { CredentialsModal } from './credentials-modal.js'
import { useDaemons } from './hooks/use-daemons.js'
import { useLogs } from './hooks/use-logs.js'
import { useGateway } from './hooks/use-gateway.js'
import { useFocusRegion } from './hooks/use-focus-region.js'
import { useScroll } from './hooks/use-scroll.js'
import { useLogSearch } from './hooks/use-log-search.js'
import { stopDaemon, removeDaemon } from '../lib/daemon-manager.js'
import { ServerApi } from '../lib/server-api.js'

type ModalState =
  | { type: 'none' }
  | { type: 'context-menu'; menuIndex: number }
  | { type: 'confirm'; title: string; message: string; onConfirm: () => void }
  | { type: 'rename'; daemonName: string; agentId?: string }
  | { type: 'credentials' }

interface DashboardProps {
  columns: number
  rows: number
  serverUrl: string | null
  onLogout: () => void
}

export function Dashboard({ columns, rows, serverUrl, onLogout }: DashboardProps) {
  const { exit } = useApp()
  const daemons = useDaemons()
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [modal, setModal] = useState<ModalState>({ type: 'none' })
  const [message, setMessage] = useState<{ text: string; color: string } | null>(null)
  const { gateway, refresh: refreshGateway, start: startGateway } = useGateway()
  const { region, setRegion, cycleNext, cyclePrev } = useFocusRegion('agents')
  const [statusSelectedItem, setStatusSelectedItem] = useState(0)

  // 'gg' double-press tracking for logs
  const gPending = useRef(false)
  const gTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const selectedDaemon = daemons.length > 0 ? (daemons[selectedIndex] ?? null) : null
  const logs = useLogs(selectedDaemon?.info.name ?? null)

  // Log panel dimensions
  const logHeight = Math.max(5, Math.min(8, Math.floor(rows * 0.2)))
  const logVisibleLines = Math.max(1, logHeight - 3) // minus border + title + scroll indicator
  const scroll = useScroll(logs.length, logVisibleLines)
  const logSearch = useLogSearch(logs)
  const matchLineSet = useMemo(
    () => (logSearch.confirmedQuery ? new Set(logSearch.matchIndices) : undefined),
    [logSearch.confirmedQuery, logSearch.matchIndices],
  )

  const showMessage = useCallback((text: string, color = 'green') => {
    setMessage({ text, color })
    setTimeout(() => setMessage(null), 3000)
  }, [])

  // Status bar navigable items count
  const STATUS_ITEM_COUNT = serverUrl ? 3 : 2 // gateway, credentials, [logout]

  // ─── Context menu items for selected daemon ───

  const contextMenuItems = useMemo((): MenuItem[] => {
    if (!selectedDaemon) return []
    if (selectedDaemon.info.type === 'gateway') {
      return [
        {
          id: gateway.running ? 'stop-gateway' : 'start-gateway',
          label: gateway.running ? 'Stop' : 'Start',
        },
        { id: 'view-logs', label: 'View Logs' },
      ]
    }
    return [
      { id: 'rename', label: 'Rename' },
      { id: 'remove', label: 'Remove' },
      { id: 'view-logs', label: 'View Logs' },
    ]
  }, [selectedDaemon, gateway.running])

  // ─── Action handlers ───

  const handleGatewayToggle = useCallback(() => {
    if (gateway.running) {
      const ok = stopDaemon('gateway')
      refreshGateway()
      showMessage(ok ? 'Gateway stopped.' : 'Failed to stop gateway.', ok ? 'green' : 'red')
    } else {
      void startGateway().then((result) => {
        if (result.ok) {
          showMessage(`Gateway started (PID ${result.pid}).`)
        } else {
          showMessage(result.error ?? 'Failed to start gateway.', 'red')
        }
      })
    }
  }, [gateway.running, refreshGateway, startGateway, showMessage])

  const handleRename = useCallback(
    async (newName: string) => {
      if (modal.type !== 'rename') return
      const agentId = modal.agentId
      if (agentId) {
        const api = new ServerApi()
        const result = await api.renameAgent(agentId, newName)
        if (result.ok) {
          showMessage(`Renamed to "${newName}".`)
        } else {
          showMessage(result.error ?? 'Rename failed.', 'red')
        }
      } else {
        showMessage('Cannot rename: no agent ID available.', 'yellow')
      }
      setModal({ type: 'none' })
    },
    [modal, showMessage],
  )

  const handleRemove = useCallback(
    (daemonName: string) => {
      removeDaemon(daemonName)
      showMessage(`Removed "${daemonName}".`)
      setModal({ type: 'none' })
      if (selectedIndex >= daemons.length - 1) {
        setSelectedIndex(Math.max(0, daemons.length - 2))
      }
    },
    [showMessage, selectedIndex, daemons.length],
  )

  const handleContextMenuSelect = useCallback(
    (id: string) => {
      setModal({ type: 'none' })
      if (!selectedDaemon) return

      switch (id) {
        case 'start-gateway':
          void startGateway().then((result) => {
            if (result.ok) {
              showMessage(`Gateway started (PID ${result.pid}).`)
            } else {
              showMessage(result.error ?? 'Failed to start gateway.', 'red')
            }
          })
          break
        case 'stop-gateway':
          setModal({
            type: 'confirm',
            title: 'Stop Gateway',
            message: 'Stop the gateway process?',
            onConfirm: () => {
              const ok = stopDaemon('gateway')
              refreshGateway()
              showMessage(ok ? 'Gateway stopped.' : 'Failed to stop gateway.', ok ? 'green' : 'red')
              setModal({ type: 'none' })
            },
          })
          break
        case 'rename':
          setModal({
            type: 'rename',
            daemonName: selectedDaemon.info.name,
            agentId: selectedDaemon.status?.agentId ?? selectedDaemon.info.agentId,
          })
          break
        case 'remove':
          setModal({
            type: 'confirm',
            title: 'Remove Agent',
            message: `Remove "${selectedDaemon.info.name}"? This will stop the process and remove all files.`,
            onConfirm: () => handleRemove(selectedDaemon.info.name),
          })
          break
        case 'view-logs':
          setRegion('logs')
          break
      }
    },
    [selectedDaemon, startGateway, refreshGateway, showMessage, handleRemove, setRegion],
  )

  const handleStatusAction = useCallback(
    (index: number) => {
      const ids = serverUrl ? ['gateway', 'credentials', 'logout'] : ['gateway', 'credentials']
      const id = ids[index]
      switch (id) {
        case 'gateway':
          if (gateway.running) {
            setModal({
              type: 'confirm',
              title: 'Stop Gateway',
              message: 'Stop the gateway process?',
              onConfirm: () => {
                const ok = stopDaemon('gateway')
                refreshGateway()
                showMessage(
                  ok ? 'Gateway stopped.' : 'Failed to stop gateway.',
                  ok ? 'green' : 'red',
                )
                setModal({ type: 'none' })
              },
            })
          } else {
            handleGatewayToggle()
          }
          break
        case 'credentials':
          setModal({ type: 'credentials' })
          break
        case 'logout':
          setModal({
            type: 'confirm',
            title: 'Logout',
            message: 'Disconnect from the server?',
            onConfirm: () => {
              setModal({ type: 'none' })
              onLogout()
            },
          })
          break
      }
    },
    [serverUrl, gateway.running, handleGatewayToggle, refreshGateway, showMessage, onLogout],
  )

  // ─── Input handling ───

  // Context menu input is handled by the ContextMenu component itself
  // Confirm/Rename dialog input is handled by dialog components

  // Search input handler — active when search bar is visible
  useInput(
    (_input, key) => {
      if (key.escape) {
        logSearch.deactivate()
        return
      }
      if (key.return) {
        logSearch.confirm()
      }
    },
    { isActive: logSearch.active },
  )

  // Auto-scroll to current search match
  const prevMatchLine = useRef(-1)
  React.useEffect(() => {
    if (logSearch.currentMatchLine >= 0 && logSearch.currentMatchLine !== prevMatchLine.current) {
      prevMatchLine.current = logSearch.currentMatchLine
      scroll.scrollTo(logSearch.currentMatchLine)
    }
  }, [logSearch.currentMatchLine, scroll])

  // Main input: routes to focused region or handles global keys
  useInput(
    (input, key) => {
      // Global keys (always work unless modal is open)
      if (key.tab && !key.shift) {
        cycleNext()
        return
      }
      // Shift+Tab: Ink sends key.tab with shift
      if (key.tab && key.shift) {
        cyclePrev()
        return
      }
      if (input === 'q') {
        exit()
        return
      }

      // Route to focused region
      if (region === 'agents') {
        if (key.upArrow && daemons.length > 0) {
          setSelectedIndex((i) => Math.max(0, i - 1))
          return
        }
        if (key.downArrow && daemons.length > 0) {
          setSelectedIndex((i) => Math.min(daemons.length - 1, i + 1))
          return
        }
        if (key.return && selectedDaemon && contextMenuItems.length > 0) {
          setModal({ type: 'context-menu', menuIndex: 0 })
          return
        }
      }

      if (region === 'status') {
        if (key.leftArrow) {
          setStatusSelectedItem((i) => Math.max(0, i - 1))
          return
        }
        if (key.rightArrow) {
          setStatusSelectedItem((i) => Math.min(STATUS_ITEM_COUNT - 1, i + 1))
          return
        }
        if (key.return) {
          handleStatusAction(statusSelectedItem)
          return
        }
      }

      if (region === 'logs') {
        // '/' activates search
        if (input === '/') {
          logSearch.activate()
          return
        }
        // 'n' / 'N' navigate search results
        if (input === 'n') {
          logSearch.nextMatch()
          return
        }
        if (input === 'N') {
          logSearch.prevMatch()
          return
        }
        // Escape clears search
        if (key.escape) {
          logSearch.clearSearch()
          return
        }
        if (key.upArrow || input === 'k') {
          scroll.scrollUp()
          return
        }
        if (key.downArrow || input === 'j') {
          scroll.scrollDown()
          return
        }
        if (key.pageUp) {
          scroll.pageUp()
          return
        }
        if (key.pageDown) {
          scroll.pageDown()
          return
        }
        // 'G' (uppercase) goes to bottom
        if (input === 'G') {
          scroll.goBottom()
          return
        }
        // 'g' press: handle gg (go to top)
        if (input === 'g') {
          if (gPending.current) {
            // Second 'g' within timeout → go to top
            gPending.current = false
            if (gTimer.current) clearTimeout(gTimer.current)
            gTimer.current = null
            scroll.goTop()
          } else {
            // First 'g': start waiting for second
            gPending.current = true
            gTimer.current = setTimeout(() => {
              gPending.current = false
              gTimer.current = null
            }, 500)
          }
          return
        }
      }
    },
    { isActive: modal.type === 'none' && !logSearch.active },
  )

  // ─── Help bar hints ───

  const hints = useMemo(() => {
    if (logSearch.active) return 'Enter: search | Esc: cancel'
    if (modal.type === 'context-menu') return 'Up/Down: navigate | Enter: select | Esc: close'
    if (modal.type === 'confirm')
      return 'Left/Right/Tab: navigate | Enter: confirm | Y/N: quick select | Esc: cancel'
    if (modal.type === 'rename') return 'Enter: confirm | Esc: cancel'
    if (modal.type === 'credentials')
      return 'Enter: actions/add | Left/Right: agent type | A: add | Esc: close'

    switch (region) {
      case 'agents':
        return 'Tab: switch focus | Enter: actions | Up/Down: select | q: quit'
      case 'status':
        return 'Tab: switch focus | Enter: activate | Left/Right: navigate | q: quit'
      case 'logs':
        if (logSearch.confirmedQuery) {
          return `Tab: switch | n/N: next/prev | Esc: clear | /: new search | q: quit`
        }
        return 'Tab: switch focus | Up/Down/j/k: scroll | PgUp/PgDn: page | gg/G: top/bottom | /: search | q: quit'
    }
  }, [logSearch.active, logSearch.confirmedQuery, modal.type, region])

  // ─── Layout ───

  const middleHeight = Math.max(5, rows - logHeight - 5) // status ~3, help ~1, message ~1

  // Build status bar items (hide logout if no server)
  const statusItems = useMemo(() => {
    const items = [
      {
        id: 'gateway',
        label: 'Gateway',
        indicator: gateway.running ? (
          <Text color="green">● On</Text>
        ) : (
          <Text color="gray">○ Off</Text>
        ),
      },
      { id: 'credentials', label: 'Credentials' },
    ]
    if (serverUrl) {
      items.push({ id: 'logout', label: 'Logout' })
    }
    return items
  }, [gateway.running, serverUrl])

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {/* Status bar */}
      <StatusBar
        serverUrl={serverUrl}
        loggedIn
        gatewayRunning={gateway.running}
        focused={region === 'status' && modal.type === 'none'}
        selectedItem={statusSelectedItem}
        items={statusItems}
      />

      {/* Middle section */}
      <Box height={middleHeight}>
        {modal.type === 'credentials' ? (
          <CredentialsModal onClose={() => setModal({ type: 'none' })} />
        ) : (
          <>
            {/* Agent list panel */}
            <Box
              flexDirection="column"
              borderStyle="single"
              borderColor={region === 'agents' && modal.type === 'none' ? 'cyan' : undefined}
              borderRight={false}
              width="50%"
            >
              <Text bold color="cyan">
                {' '}
                Agents{' '}
              </Text>
              <AgentList
                daemons={daemons}
                selectedIndex={selectedIndex}
                focused={region === 'agents' && modal.type === 'none'}
              />
              {/* Context menu appears below agent list within the panel */}
              {modal.type === 'context-menu' && (
                <Box marginLeft={2}>
                  <ContextMenu
                    items={contextMenuItems}
                    selectedIndex={modal.menuIndex}
                    onSelect={handleContextMenuSelect}
                    onClose={() => setModal({ type: 'none' })}
                    onNavigate={(i) => setModal({ type: 'context-menu', menuIndex: i })}
                  />
                </Box>
              )}
            </Box>

            {/* Details panel */}
            <Box flexDirection="column" borderStyle="single" width="50%">
              <Text bold color="cyan">
                {' '}
                Details{' '}
              </Text>
              <AgentDetails entry={selectedDaemon} />
            </Box>
          </>
        )}
      </Box>

      {/* Log panel */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={region === 'logs' && modal.type === 'none' ? 'cyan' : undefined}
        borderTop={false}
        height={logHeight}
      >
        <Box>
          <Text bold color="cyan">
            {' '}
            Log{' '}
          </Text>
          {/* Search indicator when not in search input mode */}
          {!logSearch.active && logSearch.confirmedQuery && (
            <Text dimColor>
              {' '}
              /{logSearch.confirmedQuery} [
              {logSearch.matchIndices.length > 0 ? logSearch.currentMatch + 1 : 0}/
              {logSearch.matchIndices.length}]
            </Text>
          )}
        </Box>
        <LogViewer
          logs={logs}
          maxLines={logSearch.active ? Math.max(1, logVisibleLines - 1) : logVisibleLines}
          scrollOffset={scroll.offset}
          focused={region === 'logs' && modal.type === 'none'}
          matchLineIndices={matchLineSet}
          currentMatchLine={
            logSearch.currentMatchLine >= 0 ? logSearch.currentMatchLine : undefined
          }
        />
        {/* Search input bar */}
        {logSearch.active && (
          <Box paddingX={1}>
            <Text color="yellow">/</Text>
            <TextInput
              value={logSearch.query}
              onChange={logSearch.setQuery}
              onSubmit={() => logSearch.confirm()}
              placeholder="search..."
            />
          </Box>
        )}
      </Box>

      {/* Inline dialogs */}
      {modal.type === 'rename' && (
        <RenameDialog
          currentName={modal.daemonName}
          onSubmit={(name) => void handleRename(name)}
          onCancel={() => setModal({ type: 'none' })}
        />
      )}
      {modal.type === 'confirm' && (
        <ConfirmDialog
          title={modal.title}
          message={modal.message}
          onConfirm={modal.onConfirm}
          onCancel={() => setModal({ type: 'none' })}
        />
      )}

      {/* Message toast */}
      {message && <MessageBox message={message.text} color={message.color} />}

      {/* Help bar */}
      <HelpBar hints={hints} />
    </Box>
  )
}
