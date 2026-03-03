import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import TextInput from 'ink-text-input'
import Spinner from 'ink-spinner'

interface LoginScreenProps {
  columns: number
  rows: number
  onLogin: (
    serverUrl: string,
    username: string,
    password: string,
  ) => Promise<{ ok: boolean; error?: string }>
  onQuit: () => void
}

type Field = 'server' | 'username' | 'password'
const FIELDS: Field[] = ['server', 'username', 'password']

export function LoginScreen({ columns, rows, onLogin, onQuit }: LoginScreenProps) {
  const [serverUrl, setServerUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [activeField, setActiveField] = useState<Field>('server')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  useInput((_input, key) => {
    if (key.escape) {
      onQuit()
      return
    }
    if (key.tab || (key.downArrow && !loading)) {
      const idx = FIELDS.indexOf(activeField)
      setActiveField(FIELDS[(idx + 1) % FIELDS.length])
    }
    if (key.upArrow && !loading) {
      const idx = FIELDS.indexOf(activeField)
      setActiveField(FIELDS[(idx - 1 + FIELDS.length) % FIELDS.length])
    }
  })

  const handleSubmit = async () => {
    if (!serverUrl || !username || !password) {
      setError('All fields are required.')
      return
    }
    setLoading(true)
    setError(null)
    const result = await onLogin(serverUrl, username, password)
    setLoading(false)
    if (!result.ok) {
      setError(result.error ?? 'Login failed')
    }
  }

  const fieldProps = (field: Field) => ({
    focus: activeField === field && !loading,
  })

  return (
    <Box width={columns} height={rows} justifyContent="center" alignItems="center">
      <Box
        flexDirection="column"
        borderStyle="single"
        paddingX={2}
        paddingY={1}
        alignItems="center"
      >
        <Text bold color="cyan">
          Welcome to AgentIM
        </Text>
        <Box height={1} />

        <Box>
          <Text>Server URL: </Text>
          <TextInput
            value={serverUrl}
            onChange={setServerUrl}
            placeholder="https://my-server.com"
            onSubmit={() => setActiveField('username')}
            {...fieldProps('server')}
          />
        </Box>

        <Box>
          <Text>Username: </Text>
          <TextInput
            value={username}
            onChange={setUsername}
            placeholder="admin"
            onSubmit={() => setActiveField('password')}
            {...fieldProps('username')}
          />
        </Box>

        <Box>
          <Text>Password: </Text>
          <TextInput
            value={password}
            onChange={setPassword}
            mask="*"
            onSubmit={() => void handleSubmit()}
            {...fieldProps('password')}
          />
        </Box>

        <Box height={1} />

        {loading && (
          <Text>
            <Spinner type="dots" /> Logging in...
          </Text>
        )}

        {error && <Text color="red">{error}</Text>}

        {!loading && <Text dimColor>Tab to switch fields, Enter to submit, Esc to quit</Text>}
      </Box>
    </Box>
  )
}
