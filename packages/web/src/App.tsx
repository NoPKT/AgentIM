import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { useAuthStore } from './stores/auth.js'
import { useChatStore } from './stores/chat.js'
import { useWebSocket } from './hooks/useWebSocket.js'
import ProtectedRoute from './components/ProtectedRoute.js'
import { AppLayout } from './components/AppLayout.js'
import { ToastContainer } from './components/ToastContainer.js'
import './lib/i18n.js'

const LoginPage = lazy(() => import('./pages/LoginPage.js'))
const RegisterPage = lazy(() => import('./pages/RegisterPage.js'))
const ChatPage = lazy(() => import('./pages/ChatPage.js'))
const AgentsPage = lazy(() => import('./pages/AgentsPage.js'))
const TasksPage = lazy(() => import('./pages/TasksPage.js'))
const SettingsPage = lazy(() => import('./pages/SettingsPage.js'))

function PageLoader() {
  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
}

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
    <Suspense fallback={<PageLoader />}>
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
    </Suspense>
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
