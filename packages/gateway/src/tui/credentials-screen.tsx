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

type AgentTypeKey = (typeof AGENT_TYPES)[number]['type']

type SubDialog =
  | { type: 'none' }
  | { type: 'add'; step: 'name' | 'mode' | 'apiKey' | 'baseUrl' | 'model' }
  | { type: 'delete' }
  | { type: 'rename' }

interface CredentialsScreenProps {
  onClose: () => void
}

export function CredentialsScreen({ onClose }: CredentialsScreenProps) {
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

  // Rename dialog state
  const [renameName, setRenameName] = useState('')

  const agentType = AGENT_TYPES[agentTypeIdx].type

  const showMessage = useCallback((text: string, color = 'green') => {
    setMessage({ text, color })
    setTimeout(() => setMessage(null), 3000)
  }, [])

  const refreshCredentials = useCallback(() => {
    const creds = listCredentialInfo(agentType)
    setCredentials(creds)
    // Reset selection if out of bounds
    setSelectedIdx((prev) => Math.min(prev, Math.max(0, creds.length - 1)))
  }, [agentType])

  useEffect(() => {
    refreshCredentials()
  }, [refreshCredentials])

  const selectedCred = credentials.length > 0 ? (credentials[selectedIdx] ?? null) : null

  // Handle main screen input
  useInput(
    (input, key) => {
      if (key.escape) {
        onClose()
        return
      }

      // Agent type switching with left/right arrows or Tab
      if (key.leftArrow) {
        setAgentTypeIdx((i) => (i - 1 + AGENT_TYPES.length) % AGENT_TYPES.length)
        setSelectedIdx(0)
        return
      }
      if (key.rightArrow || key.tab) {
        setAgentTypeIdx((i) => (i + 1) % AGENT_TYPES.length)
        setSelectedIdx(0)
        return
      }

      // Credential selection with up/down
      if (key.upArrow && credentials.length > 0) {
        setSelectedIdx((i) => Math.max(0, i - 1))
        return
      }
      if (key.downArrow && credentials.length > 0) {
        setSelectedIdx((i) => Math.min(credentials.length - 1, i + 1))
        return
      }

      // Hotkeys
      const lower = input.toLowerCase()
      if (lower === 'a') {
        setAddName('')
        setAddMode('api')
        setAddApiKey('')
        setAddBaseUrl('')
        setAddModel('')
        setSubDialog({ type: 'add', step: 'name' })
        return
      }
      if (lower === 'd' && selectedCred) {
        setSubDialog({ type: 'delete' })
        return
      }
      if (lower === 'r' && selectedCred) {
        setRenameName(selectedCred.name)
        setSubDialog({ type: 'rename' })
        return
      }
      if (lower === 's' && selectedCred) {
        const ok = setDefaultCredential(agentType, selectedCred.id)
        if (ok) {
          showMessage(`"${selectedCred.name}" set as default.`)
          refreshCredentials()
        } else {
          showMessage('Failed to set default.', 'red')
        }
      }
    },
    { isActive: subDialog.type === 'none' },
  )

  // ─── Sub-dialog: Add credential ───

  if (subDialog.type === 'add') {
    return (
      <AddCredentialDialog
        step={subDialog.step}
        agentType={agentType}
        agentLabel={AGENT_TYPES[agentTypeIdx].label}
        name={addName}
        onNameChange={setAddName}
        mode={addMode}
        onModeChange={setAddMode}
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
        onCancel={() => setSubDialog({ type: 'none' })}
      />
    )
  }

  // ─── Sub-dialog: Delete confirm ───

  if (subDialog.type === 'delete' && selectedCred) {
    return (
      <DeleteConfirmDialog
        name={selectedCred.name}
        onConfirm={() => {
          const ok = removeCredential(agentType, selectedCred.id)
          showMessage(
            ok ? `"${selectedCred.name}" deleted.` : 'Delete failed.',
            ok ? 'green' : 'red',
          )
          refreshCredentials()
          setSubDialog({ type: 'none' })
        }}
        onCancel={() => setSubDialog({ type: 'none' })}
      />
    )
  }

  // ─── Sub-dialog: Rename ───

  if (subDialog.type === 'rename' && selectedCred) {
    return (
      <RenameCredentialDialog
        currentName={selectedCred.name}
        value={renameName}
        onChange={setRenameName}
        onSubmit={() => {
          const trimmed = renameName.trim()
          if (trimmed && trimmed !== selectedCred.name) {
            const ok = updateCredential(agentType, selectedCred.id, { name: trimmed })
            showMessage(ok ? `Renamed to "${trimmed}".` : 'Rename failed.', ok ? 'green' : 'red')
            refreshCredentials()
          }
          setSubDialog({ type: 'none' })
        }}
        onCancel={() => setSubDialog({ type: 'none' })}
      />
    )
  }

  // ─── Main credentials screen ───

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="single" flexDirection="column" paddingX={1}>
        <Text bold color="cyan">
          Credentials
        </Text>

        {/* Agent type tabs */}
        <Box gap={2} marginY={1}>
          <Text>Agent Type: </Text>
          {AGENT_TYPES.map((at, i) => (
            <Text key={at.type} bold={i === agentTypeIdx} inverse={i === agentTypeIdx}>
              {i === agentTypeIdx ? ` ${at.label} ` : ` ${at.label} `}
            </Text>
          ))}
        </Box>

        {/* Credential list */}
        <Box flexDirection="column" minHeight={3}>
          {credentials.length === 0 ? (
            <Text dimColor> No credentials configured. Press [A] to add one.</Text>
          ) : (
            credentials.map((cred, i) => {
              const isSelected = i === selectedIdx
              const maskedKey = cred.hasApiKey ? maskKey(cred) : ''
              return (
                <Text key={cred.id} inverse={isSelected}>
                  {isSelected ? ' > ' : '   '}
                  {cred.name.padEnd(20)}
                  {cred.mode.padEnd(16)}
                  {cred.isDefault ? '* default ' : '          '}
                  {maskedKey}
                </Text>
              )
            })
          )}
        </Box>

        {/* Action hints */}
        <Box marginTop={1} gap={1}>
          <Text>
            [
            <Text bold color="cyan">
              A
            </Text>
            ]dd
          </Text>
          {selectedCred && (
            <>
              <Text>
                [
                <Text bold color="cyan">
                  D
                </Text>
                ]elete
              </Text>
              <Text>
                [
                <Text bold color="cyan">
                  R
                </Text>
                ]ename
              </Text>
              <Text>
                [
                <Text bold color="cyan">
                  S
                </Text>
                ]et Default
              </Text>
            </>
          )}
          <Text>
            [
            <Text bold color="cyan">
              Esc
            </Text>
            ] Back
          </Text>
        </Box>

        <Box marginTop={0} gap={1}>
          <Text dimColor>Left/Right or Tab to switch agent type, Up/Down to select</Text>
        </Box>
      </Box>

      {/* Message toast */}
      {message && (
        <Box paddingX={1}>
          <Text color={message.color}>{message.text}</Text>
        </Box>
      )}
    </Box>
  )
}

/** Mask an API key for display, showing only the last 4 characters. */
function maskKey(cred: CredentialInfo): string {
  if (!cred.hasApiKey) return ''
  // We don't have the actual key here (CredentialInfo has no secrets),
  // just indicate that an API key is configured.
  return '(API key set)'
}

// ─── Sub-dialog Components ───

interface AddCredentialDialogProps {
  step: 'name' | 'mode' | 'apiKey' | 'baseUrl' | 'model'
  agentType: AgentTypeKey
  agentLabel: string
  name: string
  onNameChange: (v: string) => void
  mode: 'api' | 'subscription'
  onModeChange: (v: 'api' | 'subscription') => void
  apiKey: string
  onApiKeyChange: (v: string) => void
  baseUrl: string
  onBaseUrlChange: (v: string) => void
  model: string
  onModelChange: (v: string) => void
  onStepChange: (step: 'name' | 'mode' | 'apiKey' | 'baseUrl' | 'model') => void
  onComplete: () => void
  onCancel: () => void
}

function AddCredentialDialog({
  step,
  agentLabel,
  name,
  onNameChange,
  mode,
  onModeChange,
  apiKey,
  onApiKeyChange,
  baseUrl,
  onBaseUrlChange,
  model,
  onModelChange,
  onStepChange,
  onComplete,
  onCancel,
}: AddCredentialDialogProps) {
  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel()
        return
      }
      if (step === 'mode') {
        if (input === '1' || input === 'a') {
          onModeChange('api')
          onStepChange('apiKey')
        } else if (input === '2' || input === 's') {
          onModeChange('subscription')
          // Skip API key for subscription mode, go to optional baseUrl
          onStepChange('baseUrl')
        }
      }
    },
    { isActive: step === 'mode' },
  )

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={2} paddingY={1}>
      <Text bold color="cyan">
        Add {agentLabel} Credential
      </Text>
      <Box height={1} />

      {/* Step 1: Name */}
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

      {/* Step 2: Mode */}
      {step === 'mode' && (
        <Box flexDirection="column">
          <Text>Name: {name || '(unnamed)'}</Text>
          <Box height={1} />
          <Text>Select mode:</Text>
          <Text> [1] API Key</Text>
          <Text> [2] Subscription (OAuth)</Text>
        </Box>
      )}

      {/* Step 3: API Key */}
      {step === 'apiKey' && (
        <Box flexDirection="column">
          <Text>Name: {name || '(unnamed)'}</Text>
          <Text>Mode: API Key</Text>
          <Box height={1} />
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

      {/* Step 4: Base URL (optional) */}
      {step === 'baseUrl' && (
        <Box flexDirection="column">
          <Text>Name: {name || '(unnamed)'}</Text>
          <Text>Mode: {mode === 'api' ? 'API Key' : 'Subscription'}</Text>
          <Box height={1} />
          <Box>
            <Text>Base URL (optional, Enter to skip): </Text>
            <TextInput
              value={baseUrl}
              onChange={onBaseUrlChange}
              placeholder="https://api.example.com"
              onSubmit={() => onStepChange('model')}
            />
          </Box>
        </Box>
      )}

      {/* Step 5: Model (optional) */}
      {step === 'model' && (
        <Box flexDirection="column">
          <Text>Name: {name || '(unnamed)'}</Text>
          <Text>Mode: {mode === 'api' ? 'API Key' : 'Subscription'}</Text>
          <Box height={1} />
          <Box>
            <Text>Model (optional, Enter to finish): </Text>
            <TextInput
              value={model}
              onChange={onModelChange}
              placeholder="e.g., claude-opus-4-6"
              onSubmit={() => onComplete()}
            />
          </Box>
        </Box>
      )}

      <Box height={1} />
      <Text dimColor>Enter to continue, Esc to cancel</Text>
    </Box>
  )
}

function DeleteConfirmDialog({
  name,
  onConfirm,
  onCancel,
}: {
  name: string
  onConfirm: () => void
  onCancel: () => void
}) {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y') onConfirm()
    else if (input === 'n' || input === 'N' || key.escape) onCancel()
  })

  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text>Delete credential "{name}"? </Text>
      <Text bold>[Y/N]</Text>
    </Box>
  )
}

function RenameCredentialDialog({
  currentName,
  value,
  onChange,
  onSubmit,
  onCancel,
}: {
  currentName: string
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  onCancel: () => void
}) {
  useInput((_input, key) => {
    if (key.escape) onCancel()
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>Rename Credential: {currentName}</Text>
      <Box>
        <Text>New name: </Text>
        <TextInput value={value} onChange={onChange} onSubmit={() => onSubmit()} />
      </Box>
      <Text dimColor>Enter to confirm, Esc to cancel</Text>
    </Box>
  )
}
