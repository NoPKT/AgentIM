import React, { useState, useCallback, useMemo } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { StatusBar } from './status-bar.js'
import { AgentList } from './agent-list.js'
import { AgentDetails } from './agent-details.js'
import { LogViewer } from './log-viewer.js'
import { ActionBar } from './action-bar.js'
import type { ActionDef } from './action-bar.js'
import { RenameDialog, ConfirmDialog, MessageBox } from './dialogs.js'
import { CredentialsScreen } from './credentials-screen.js'
import { useDaemons } from './hooks/use-daemons.js'
import { useLogs } from './hooks/use-logs.js'
import { useGateway } from './hooks/use-gateway.js'
import { stopDaemon, removeDaemon } from '../lib/daemon-manager.js'
import { ServerApi } from '../lib/server-api.js'

type DialogState =
  | { type: 'none' }
  | { type: 'rename'; daemonName: string; agentId?: string }
  | { type: 'confirm-stop'; daemonName: string }
  | { type: 'confirm-delete'; daemonName: string }
  | { type: 'credentials' }
  | { type: 'full-log'; daemonName: string }

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
  const [dialog, setDialog] = useState<DialogState>({ type: 'none' })
  const [message, setMessage] = useState<{ text: string; color: string } | null>(null)
  const { gateway, refresh: refreshGateway, start: startGateway } = useGateway()

  const selectedDaemon = daemons.length > 0 ? (daemons[selectedIndex] ?? null) : null
  const logs = useLogs(selectedDaemon?.info.name ?? null)

  const showMessage = useCallback((text: string, color = 'green') => {
    setMessage({ text, color })
    setTimeout(() => setMessage(null), 3000)
  }, [])

  const handleAction = useCallback(
    (id: string) => {
      switch (id) {
        case 'gateway':
          if (gateway.running) {
            const ok = stopDaemon('gateway')
            refreshGateway()
            showMessage(ok ? 'Gateway stopped.' : 'Failed to stop gateway.', ok ? 'green' : 'red')
          } else {
            // Start gateway daemon
            void startGateway().then((result) => {
              if (result.ok) {
                showMessage(`Gateway started (PID ${result.pid}).`)
              } else {
                showMessage(result.error ?? 'Failed to start gateway.', 'red')
              }
            })
          }
          break
        case 'rename':
          if (selectedDaemon) {
            setDialog({
              type: 'rename',
              daemonName: selectedDaemon.info.name,
              agentId: selectedDaemon.status?.agentId ?? selectedDaemon.info.agentId,
            })
          }
          break
        case 'stop':
          if (selectedDaemon) {
            setDialog({ type: 'confirm-stop', daemonName: selectedDaemon.info.name })
          }
          break
        case 'delete':
          if (selectedDaemon) {
            setDialog({ type: 'confirm-delete', daemonName: selectedDaemon.info.name })
          }
          break
        case 'logs':
          if (selectedDaemon) {
            setDialog({ type: 'full-log', daemonName: selectedDaemon.info.name })
          }
          break
        case 'credentials':
          setDialog({ type: 'credentials' })
          break
        case 'logout':
          onLogout()
          break
        case 'quit':
          exit()
          break
      }
    },
    [gateway.running, refreshGateway, startGateway, selectedDaemon, showMessage, onLogout, exit],
  )

  // Map single-letter hotkeys to action IDs
  const hotkeyMap: Record<string, string> = {
    g: 'gateway',
    r: 'rename',
    s: 'stop',
    d: 'delete',
    l: 'logs',
    c: 'credentials',
    o: 'logout',
    q: 'quit',
  }

  useInput((input, key) => {
    if (dialog.type !== 'none') return

    // Arrow navigation
    if (key.upArrow && daemons.length > 0) {
      setSelectedIndex((i) => Math.max(0, i - 1))
    }
    if (key.downArrow && daemons.length > 0) {
      setSelectedIndex((i) => Math.min(daemons.length - 1, i + 1))
    }

    // Single-letter hotkeys
    const actionId = hotkeyMap[input.toLowerCase()]
    if (actionId) handleAction(actionId)
  })

  // Build dynamic action list for the bar
  const actions = useMemo(() => {
    const list: ActionDef[] = [{ id: 'gateway', hotkey: 'G', label: 'ateway' }]
    if (selectedDaemon) {
      list.push(
        { id: 'rename', hotkey: 'R', label: 'ename' },
        { id: 'stop', hotkey: 'S', label: 'top' },
        { id: 'delete', hotkey: 'D', label: 'elete' },
        { id: 'logs', hotkey: 'L', label: 'ogs' },
      )
    }
    list.push({ id: 'credentials', hotkey: 'C', label: 'redentials' })
    if (serverUrl) list.push({ id: 'logout', hotkey: 'O', label: 'ut' })
    list.push({ id: 'quit', hotkey: 'Q', label: 'uit' })
    return list
  }, [selectedDaemon, serverUrl])

  const handleRename = useCallback(
    async (newName: string) => {
      if (dialog.type !== 'rename') return
      const agentId = dialog.agentId
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
      setDialog({ type: 'none' })
    },
    [dialog, showMessage],
  )

  const handleStop = useCallback(() => {
    if (dialog.type !== 'confirm-stop') return
    const ok = stopDaemon(dialog.daemonName)
    showMessage(
      ok ? `Stopped "${dialog.daemonName}".` : `Failed to stop "${dialog.daemonName}".`,
      ok ? 'green' : 'red',
    )
    setDialog({ type: 'none' })
  }, [dialog, showMessage])

  const handleDelete = useCallback(() => {
    if (dialog.type !== 'confirm-delete') return
    removeDaemon(dialog.daemonName)
    showMessage(`Removed "${dialog.daemonName}".`)
    setDialog({ type: 'none' })
    if (selectedIndex >= daemons.length - 1) {
      setSelectedIndex(Math.max(0, daemons.length - 2))
    }
  }, [dialog, showMessage, selectedIndex, daemons.length])

  // Full log view
  if (dialog.type === 'full-log') {
    return (
      <FullLogView
        columns={columns}
        rows={rows}
        daemonName={dialog.daemonName}
        onClose={() => setDialog({ type: 'none' })}
      />
    )
  }

  // Credentials view
  if (dialog.type === 'credentials') {
    return <CredentialsScreen onClose={() => setDialog({ type: 'none' })} />
  }

  // Reserve rows: status bar ~3, action bar ~1, message ~1 = ~5 fixed
  // Log panel gets a fixed height, middle section gets the rest
  const logHeight = Math.max(5, Math.min(8, Math.floor(rows * 0.2)))
  const middleHeight = Math.max(5, rows - logHeight - 5)

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <StatusBar serverUrl={serverUrl} loggedIn gatewayRunning={gateway.running} />

      <Box height={middleHeight}>
        {/* Agent list panel */}
        <Box flexDirection="column" borderStyle="single" borderRight={false} width="50%">
          <Text bold color="cyan">
            {' '}
            Agents{' '}
          </Text>
          <AgentList daemons={daemons} selectedIndex={selectedIndex} />
        </Box>

        {/* Details panel */}
        <Box flexDirection="column" borderStyle="single" width="50%">
          <Text bold color="cyan">
            {' '}
            Details{' '}
          </Text>
          <AgentDetails entry={selectedDaemon} />
        </Box>
      </Box>

      {/* Log panel */}
      <Box flexDirection="column" borderStyle="single" borderTop={false} height={logHeight}>
        <Text bold color="cyan">
          {' '}
          Log{' '}
        </Text>
        <LogViewer logs={logs} />
      </Box>

      {/* Dialog overlay */}
      {dialog.type === 'rename' && (
        <RenameDialog
          currentName={dialog.daemonName}
          onSubmit={(name) => void handleRename(name)}
          onCancel={() => setDialog({ type: 'none' })}
        />
      )}
      {dialog.type === 'confirm-stop' && (
        <ConfirmDialog
          message={`Stop "${dialog.daemonName}"?`}
          onConfirm={handleStop}
          onCancel={() => setDialog({ type: 'none' })}
        />
      )}
      {dialog.type === 'confirm-delete' && (
        <ConfirmDialog
          message={`Delete "${dialog.daemonName}"? This will stop it and remove all files.`}
          onConfirm={handleDelete}
          onCancel={() => setDialog({ type: 'none' })}
        />
      )}

      {/* Message toast */}
      {message && <MessageBox message={message.text} color={message.color} />}

      {/* Action bar */}
      <ActionBar actions={actions} onAction={handleAction} />
    </Box>
  )
}

/** Simple full-log view that returns on Esc/q. */
function FullLogView({
  columns,
  rows,
  daemonName,
  onClose,
}: {
  columns: number
  rows: number
  daemonName: string
  onClose: () => void
}) {
  const logs = useLogs(daemonName)

  useInput((input, key) => {
    if (key.escape || input.toLowerCase() === 'q') onClose()
  })

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      <Text bold color="cyan">
        Logs: {daemonName} (Esc to return)
      </Text>
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {logs.length === 0 ? (
          <Text dimColor>No log output.</Text>
        ) : (
          logs.map((entry, i) => (
            <Text key={i} wrap="truncate">
              {entry.line}
            </Text>
          ))
        )}
      </Box>
    </Box>
  )
}
