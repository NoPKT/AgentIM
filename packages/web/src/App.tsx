import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { useAuthStore } from './stores/auth.js'
import { useChatStore } from './stores/chat.js'
import { useWebSocket } from './hooks/useWebSocket.js'
import ProtectedRoute from './components/ProtectedRoute.js'
import { AppLayout } from './components/AppLayout.js'
import { ToastContainer } from './components/ToastContainer.js'
import LoginPage from './pages/LoginPage.js'
import RegisterPage from './pages/RegisterPage.js'
import ChatPage from './pages/ChatPage.js'
import AgentsPage from './pages/AgentsPage.js'
import TasksPage from './pages/TasksPage.js'
import SettingsPage from './pages/SettingsPage.js'
import './lib/i18n.js'

function AppInner() {
  const loadUser = useAuthStore((s) => s.loadUser)
  const loadRooms = useChatStore((s) => s.loadRooms)
  const user = useAuthStore((s) => s.user)

  useWebSocket()

  useEffect(() => {
    loadUser()
  }, [loadUser])

  useEffect(() => {
    if (user) loadRooms()
  }, [user, loadRooms])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<ChatPage />} />
        <Route path="room/:roomId" element={<ChatPage />} />
        <Route path="agents" element={<AgentsPage />} />
        <Route path="tasks" element={<TasksPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <AppInner />
      <ToastContainer />
    </BrowserRouter>
  )
}
