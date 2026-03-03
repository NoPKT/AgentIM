import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import {
  listCredentialInfo,
  addCredential,
  removeCredential,
  setDefaultCredential,
  updateCredential,
  type CredentialInfo,
} from '../agent-config.js'

const AGENT_TYPES = [
  { type: 'claude-code', label: 'Claude' },
  { type: 'codex', label: 'Codex' },
  { type: 'gemini', label: 'Gemini' },
] as const

type SubDialog =
  | { type: 'none' }
  | { type: 'add'; step: 'name' | 'mode' | 'apiKey' | 'baseUrl' | 'model' }
  | { type: 'delete' }
  | { type: 'rename' }
  | { type: 'action-menu'; menuIndex: number }

interface CredentialsModalProps {
  onClose: () => void
}

export function CredentialsModal({ onClose }: CredentialsModalProps) {
  const [agentTypeIdx, setAgentTypeIdx] = useState(0)
  const [selectedIdx, setSelectedIdx] = useState(0)
  const [credentials, setCredentials] = useState<CredentialInfo[]>([])
  const [subDialog, setSubDialog] = useState<SubDialog>({ type: 'none' })
  const [message, setMessage] = useState<{ text: string; color: string } | null>(null)

  // Add dialog state
  const [addName, setAddName] = useState('')
  const [addMode, setAddMode] = useState<'api' | 'subscription'>('api')
  const [addApiKey, setAddApiKey] = useState('')
  const [addBaseUrl, setAddBaseUrl] = useState('')
  const [addModel, setAddModel] = useState('')
  const [modeIdx, setModeIdx] = useState(0)

  // Rename dialog state
  const [renameName, setRenameName] = useState('')

  // Delete confirm navigation state
  const [deleteFocused, setDeleteFocused] = useState<'yes' | 'no'>('no')

  const agentType = AGENT_TYPES[agentTypeIdx].type

  const showMessage = useCallback((text: string, color = 'green') => {
    setMessage({ text, color })
    setTimeout(() => setMessage(null), 3000)
  }, [])

  const refreshCredentials = useCallback(() => {
    const creds = listCredentialInfo(agentType)
    setCredentials(creds)
    setSelectedIdx((prev) => Math.min(prev, creds.length))
  }, [agentType])

  useEffect(() => {
    refreshCredentials()
  }, [refreshCredentials])

  const selectedCred = credentials.length > 0 ? (credentials[selectedIdx] ?? null) : null

  // Action menu items for a selected credential
  const actionMenuItems = selectedCred
    ? [
        { id: 'set-default', label: 'Set Default' },
        { id: 'rename', label: 'Rename' },
        { id: 'delete', label: 'Delete' },
      ]
    : []

  // Handle main credentials list input
  useInput(
    (input, key) => {
      if (key.escape) {
        onClose()
        return
      }

      // Agent type switching
      if (key.leftArrow) {
        setAgentTypeIdx((i) => (i - 1 + AGENT_TYPES.length) % AGENT_TYPES.length)
        setSelectedIdx(0)
        return
      }
      if (key.rightArrow) {
        setAgentTypeIdx((i) => (i + 1) % AGENT_TYPES.length)
        setSelectedIdx(0)
        return
      }

      // Credential selection (extra slot at end = Add button)
      if (key.upArrow) {
        setSelectedIdx((i) => Math.max(0, i - 1))
        return
      }
      if (key.downArrow) {
        setSelectedIdx((i) => Math.min(credentials.length, i + 1))
        return
      }

      // Enter opens action menu on selected credential, or starts add flow on Add button
      if (key.return) {
        if (selectedIdx === credentials.length) {
          // Add button selected
          setAddName('')
          setAddMode('api')
          setAddApiKey('')
          setAddBaseUrl('')
          setAddModel('')
          setModeIdx(0)
          setSubDialog({ type: 'add', step: 'name' })
        } else if (selectedCred) {
          setSubDialog({ type: 'action-menu', menuIndex: 0 })
        }
        return
      }

      // 'a' to add (shortcut)
      if (input.toLowerCase() === 'a') {
        setAddName('')
        setAddMode('api')
        setAddApiKey('')
        setAddBaseUrl('')
        setAddModel('')
        setModeIdx(0)
        setSubDialog({ type: 'add', step: 'name' })
      }
    },
    { isActive: subDialog.type === 'none' },
  )

  // Handle action menu input
  useInput(
    (input, key) => {
      if (subDialog.type !== 'action-menu') return
      if (key.escape) {
        setSubDialog({ type: 'none' })
        return
      }
      if (key.upArrow) {
        setSubDialog({ type: 'action-menu', menuIndex: Math.max(0, subDialog.menuIndex - 1) })
        return
      }
      if (key.downArrow) {
        setSubDialog({
          type: 'action-menu',
          menuIndex: Math.min(actionMenuItems.length - 1, subDialog.menuIndex + 1),
        })
        return
      }
      if (key.return) {
        const item = actionMenuItems[subDialog.menuIndex]
        if (!item || !selectedCred) return
        if (item.id === 'set-default') {
          const ok = setDefaultCredential(agentType, selectedCred.id)
          showMessage(
            ok ? `"${selectedCred.name}" set as default.` : 'Failed to set default.',
            ok ? 'green' : 'red',
          )
          refreshCredentials()
          setSubDialog({ type: 'none' })
        } else if (item.id === 'rename') {
          setRenameName(selectedCred.name)
          setSubDialog({ type: 'rename' })
        } else if (item.id === 'delete') {
          setDeleteFocused('no')
          setSubDialog({ type: 'delete' })
        }
      }
    },
    { isActive: subDialog.type === 'action-menu' },
  )

  // Handle delete confirm input
  useInput(
    (input, key) => {
      if (subDialog.type !== 'delete' || !selectedCred) return
      if (input === 'y' || input === 'Y') {
        const ok = removeCredential(agentType, selectedCred.id)
        showMessage(ok ? `"${selectedCred.name}" deleted.` : 'Delete failed.', ok ? 'green' : 'red')
        refreshCredentials()
        setSubDialog({ type: 'none' })
        return
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setSubDialog({ type: 'none' })
        return
      }
      if (key.leftArrow || key.rightArrow || key.upArrow || key.downArrow || key.tab) {
        setDeleteFocused((f) => (f === 'yes' ? 'no' : 'yes'))
        return
      }
      if (key.return) {
        if (deleteFocused === 'yes') {
          const ok = removeCredential(agentType, selectedCred.id)
          showMessage(
            ok ? `"${selectedCred.name}" deleted.` : 'Delete failed.',
            ok ? 'green' : 'red',
          )
          refreshCredentials()
          setSubDialog({ type: 'none' })
        } else {
          setSubDialog({ type: 'none' })
        }
      }
    },
    { isActive: subDialog.type === 'delete' },
  )

  // Handle rename input (Esc to cancel)
  useInput(
    (_input, key) => {
      if (subDialog.type !== 'rename') return
      if (key.escape) {
        setSubDialog({ type: 'none' })
      }
    },
    { isActive: subDialog.type === 'rename' },
  )

  // Handle add credential mode step input
  useInput(
    (input, key) => {
      if (subDialog.type !== 'add') return
      if (key.escape) {
        setSubDialog({ type: 'none' })
        return
      }
      if (subDialog.step === 'mode') {
        if (key.upArrow || key.downArrow) {
          setModeIdx((i) => (i === 0 ? 1 : 0))
          return
        }
        if (key.return) {
          if (modeIdx === 0) {
            setAddMode('api')
            setSubDialog({ type: 'add', step: 'apiKey' })
          } else {
            setAddMode('subscription')
            setSubDialog({ type: 'add', step: 'baseUrl' })
          }
          return
        }
        if (input === '1' || input === 'a') {
          setModeIdx(0)
          setAddMode('api')
          setSubDialog({ type: 'add', step: 'apiKey' })
        } else if (input === '2' || input === 's') {
          setModeIdx(1)
          setAddMode('subscription')
          setSubDialog({ type: 'add', step: 'baseUrl' })
        }
      }
    },
    { isActive: subDialog.type === 'add' && subDialog.step === 'mode' },
  )

  // Handle add credential name/apiKey/baseUrl/model step input (Esc to cancel)
  useInput(
    (_input, key) => {
      if (subDialog.type !== 'add') return
      if (key.escape) {
        setSubDialog({ type: 'none' })
      }
    },
    { isActive: subDialog.type === 'add' && subDialog.step !== 'mode' },
  )

  // ─── Render ───

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} flexGrow={1}>
      <Text bold color="cyan">
        Credentials
      </Text>

      {/* Agent type tabs */}
      <Box gap={2} marginY={1}>
        <Text>Agent: </Text>
        {AGENT_TYPES.map((at, i) => (
          <Text key={at.type} bold={i === agentTypeIdx} inverse={i === agentTypeIdx}>
            {` ${at.label} `}
          </Text>
        ))}
      </Box>

      {/* Credential list with inline action menu */}
      <Box flexDirection="column" minHeight={3} flexGrow={1}>
        {credentials.length === 0 ? (
          <Text dimColor> No credentials configured.</Text>
        ) : (
          credentials.map((cred, i) => {
            const isSelected = i === selectedIdx
            return (
              <Box key={cred.id}>
                <Text inverse={isSelected && subDialog.type !== 'action-menu'}>
                  {isSelected ? ' > ' : '   '}
                  {cred.name.padEnd(20)}
                  {cred.mode.padEnd(12)}
                  {cred.isDefault ? '* default' : '         '}
                </Text>
                {/* Show action menu next to selected item */}
                {isSelected && subDialog.type === 'action-menu' && (
                  <Box flexDirection="column" borderStyle="round" borderColor="cyan" marginLeft={1}>
                    {actionMenuItems.map((item, mi) => (
                      <Text key={item.id} inverse={mi === subDialog.menuIndex}>
                        {mi === subDialog.menuIndex ? ' > ' : '   '}
                        {item.label}
                      </Text>
                    ))}
                  </Box>
                )}
              </Box>
            )
          })
        )}
        {/* Add button — navigable with arrow keys */}
        <Box>
          <Text inverse={selectedIdx === credentials.length && subDialog.type === 'none'}>
            {selectedIdx === credentials.length ? ' > ' : '   '}[ + Add ]
          </Text>
        </Box>
      </Box>

      {/* Sub-dialogs rendered inline at bottom */}
      {subDialog.type === 'delete' && selectedCred && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="yellow"
          paddingX={1}
          marginTop={1}
        >
          <Text>Delete &quot;{selectedCred.name}&quot;?</Text>
          <Box gap={2} marginTop={1}>
            <Text bold inverse={deleteFocused === 'yes'}>
              {deleteFocused === 'yes' ? ' > ' : '   '}[Y]es
            </Text>
            <Text bold inverse={deleteFocused === 'no'}>
              {deleteFocused === 'no' ? ' > ' : '   '}[N]o
            </Text>
          </Box>
          <Text dimColor>
            Left/Right/Tab: navigate | Enter: confirm | Y/N: quick select | Esc: cancel
          </Text>
        </Box>
      )}

      {subDialog.type === 'rename' && selectedCred && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor="cyan"
          paddingX={1}
          marginTop={1}
        >
          <Text bold>Rename Credential</Text>
          <Box>
            <Text>Current: {selectedCred.name}</Text>
          </Box>
          <Box>
            <Text>New name: </Text>
            <TextInput
              value={renameName}
              onChange={setRenameName}
              onSubmit={() => {
                const trimmed = renameName.trim()
                if (trimmed && trimmed !== selectedCred.name) {
                  const ok = updateCredential(agentType, selectedCred.id, { name: trimmed })
                  showMessage(
                    ok ? `Renamed to "${trimmed}".` : 'Rename failed.',
                    ok ? 'green' : 'red',
                  )
                  refreshCredentials()
                }
                setSubDialog({ type: 'none' })
              }}
            />
          </Box>
          <Text dimColor>Enter: confirm | Esc: cancel</Text>
        </Box>
      )}

      {subDialog.type === 'add' && (
        <AddCredentialInline
          step={subDialog.step}
          agentLabel={AGENT_TYPES[agentTypeIdx].label}
          name={addName}
          onNameChange={setAddName}
          mode={addMode}
          modeIdx={modeIdx}
          apiKey={addApiKey}
          onApiKeyChange={setAddApiKey}
          baseUrl={addBaseUrl}
          onBaseUrlChange={setAddBaseUrl}
          model={addModel}
          onModelChange={setAddModel}
          onStepChange={(step) => setSubDialog({ type: 'add', step })}
          onComplete={() => {
            addCredential(agentType, {
              name: addName.trim() || 'unnamed',
              mode: addMode,
              apiKey: addMode === 'api' ? addApiKey : undefined,
              baseUrl: addBaseUrl || undefined,
              model: addModel || undefined,
            })
            showMessage(`Credential "${addName.trim() || 'unnamed'}" added.`)
            refreshCredentials()
            setSubDialog({ type: 'none' })
          }}
        />
      )}

      {/* Hints */}
      {subDialog.type === 'none' && (
        <Box marginTop={1}>
          <Text dimColor>
            Enter: actions/add | Left/Right: agent type | Up/Down: select | A: add | Esc: close
          </Text>
        </Box>
      )}

      {/* Message toast */}
      {message && (
        <Box paddingX={1}>
          <Text color={message.color}>{message.text}</Text>
        </Box>
      )}
    </Box>
  )
}

// ─── Inline Add Credential Form ───

interface AddCredentialInlineProps {
  step: 'name' | 'mode' | 'apiKey' | 'baseUrl' | 'model'
  agentLabel: string
  name: string
  onNameChange: (v: string) => void
  mode: 'api' | 'subscription'
  modeIdx: number
  apiKey: string
  onApiKeyChange: (v: string) => void
  baseUrl: string
  onBaseUrlChange: (v: string) => void
  model: string
  onModelChange: (v: string) => void
  onStepChange: (step: 'name' | 'mode' | 'apiKey' | 'baseUrl' | 'model') => void
  onComplete: () => void
}

function AddCredentialInline({
  step,
  agentLabel,
  name,
  onNameChange,
  mode,
  modeIdx,
  apiKey,
  onApiKeyChange,
  baseUrl,
  onBaseUrlChange,
  model,
  onModelChange,
  onStepChange,
  onComplete,
}: AddCredentialInlineProps) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginTop={1}>
      <Text bold color="cyan">
        Add {agentLabel} Credential
      </Text>

      {step === 'name' && (
        <Box>
          <Text>Name: </Text>
          <TextInput
            value={name}
            onChange={onNameChange}
            placeholder="e.g., work-api"
            onSubmit={() => onStepChange('mode')}
          />
        </Box>
      )}

      {step === 'mode' && (
        <Box flexDirection="column">
          <Text>Name: {name || '(unnamed)'}</Text>
          <Text>Select mode (Up/Down + Enter):</Text>
          <Text inverse={modeIdx === 0}>{modeIdx === 0 ? ' > ' : '   '}[1] API Key</Text>
          <Text inverse={modeIdx === 1}>
            {modeIdx === 1 ? ' > ' : '   '}[2] Subscription (OAuth)
          </Text>
        </Box>
      )}

      {step === 'apiKey' && (
        <Box flexDirection="column">
          <Text>Name: {name || '(unnamed)'} | Mode: API Key</Text>
          <Box>
            <Text>API Key: </Text>
            <TextInput
              value={apiKey}
              onChange={onApiKeyChange}
              mask="*"
              placeholder="sk-..."
              onSubmit={() => onStepChange('baseUrl')}
            />
          </Box>
        </Box>
      )}

      {step === 'baseUrl' && (
        <Box flexDirection="column">
          <Text>
            Name: {name || '(unnamed)'} | Mode: {mode === 'api' ? 'API Key' : 'Subscription'}
          </Text>
          <Box>
            <Text>Base URL (Enter to skip): </Text>
            <TextInput
              value={baseUrl}
              onChange={onBaseUrlChange}
              placeholder="https://api.example.com"
              onSubmit={() => onStepChange('model')}
            />
          </Box>
        </Box>
      )}

      {step === 'model' && (
        <Box flexDirection="column">
          <Text>
            Name: {name || '(unnamed)'} | Mode: {mode === 'api' ? 'API Key' : 'Subscription'}
          </Text>
          <Box>
            <Text>Model (Enter to finish): </Text>
            <TextInput
              value={model}
              onChange={onModelChange}
              placeholder="e.g., claude-opus-4-6"
              onSubmit={() => onComplete()}
            />
          </Box>
        </Box>
      )}

      <Text dimColor>Enter: continue | Esc: cancel</Text>
    </Box>
  )
}
