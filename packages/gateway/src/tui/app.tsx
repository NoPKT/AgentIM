import React from 'react'
import { useApp } from 'ink'
import { LoginScreen } from './login-screen.js'
import { Dashboard } from './dashboard.js'
import { useAuth } from './hooks/use-auth.js'

export function App() {
  const { exit } = useApp()
  const { auth, login, logout } = useAuth()

  if (!auth.loggedIn) {
    return <LoginScreen onLogin={login} onQuit={() => exit()} />
  }

  return (
    <Dashboard
      serverUrl={auth.serverUrl}
      onLogout={() => {
        logout()
      }}
    />
  )
}
