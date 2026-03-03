import React, { useState, useEffect } from 'react'
import { useApp, useStdout } from 'ink'
import { LoginScreen } from './login-screen.js'
import { Dashboard } from './dashboard.js'
import { useAuth } from './hooks/use-auth.js'

export function App() {
  const { exit } = useApp()
  const { auth, login, logout } = useAuth()
  const { stdout } = useStdout()

  const [dimensions, setDimensions] = useState({
    columns: stdout.columns ?? 80,
    rows: stdout.rows ?? 24,
  })

  useEffect(() => {
    const onResize = () => {
      setDimensions({
        columns: stdout.columns ?? 80,
        rows: stdout.rows ?? 24,
      })
    }
    stdout.on('resize', onResize)
    return () => {
      stdout.off('resize', onResize)
    }
  }, [stdout])

  if (!auth.loggedIn) {
    return (
      <LoginScreen
        columns={dimensions.columns}
        rows={dimensions.rows}
        onLogin={login}
        onQuit={() => exit()}
        sessionExpired={auth.authRevoked}
      />
    )
  }

  return (
    <Dashboard
      columns={dimensions.columns}
      rows={dimensions.rows}
      serverUrl={auth.serverUrl}
      onLogout={() => {
        logout()
      }}
    />
  )
}
