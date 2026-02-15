import { useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router'
import { useAuthStore } from './stores/auth.js'
import { useChatStore } from './stores/chat.js'
import { useWebSocket } from './hooks/useWebSocket.js'
import ProtectedRoute from './components/ProtectedRoute.js'
import { ErrorBoundary } from './components/ErrorBoundary.js'
import { AppLayout } from './components/AppLayout.js'
import { ToastContainer } from './components/ToastContainer.js'
import './lib/i18n.js'

const LoginPage = lazy(() => import('./pages/LoginPage.js'))
const ChatPage = lazy(() => import('./pages/ChatPage.js'))
const AgentsPage = lazy(() => import('./pages/AgentsPage.js'))
const TasksPage = lazy(() => import('./pages/TasksPage.js'))
const SettingsPage = lazy(() => import('./pages/SettingsPage.js'))
const UsersPage = lazy(() => import('./pages/UsersPage.js'))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.js'))

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
  const unreadCounts = useChatStore((s) => s.unreadCounts)
  const user = useAuthStore((s) => s.user)

  useWebSocket()

  useEffect(() => {
    loadUser()
  }, [loadUser])

  useEffect(() => {
    if (user) loadRooms()
  }, [user, loadRooms])

  // Update browser title with total unread count
  useEffect(() => {
    let total = 0
    for (const count of unreadCounts.values()) total += count
    document.title = total > 0 ? `(${total}) AgentIM` : 'AgentIM'
  }, [unreadCounts])

  return (
    <Routes>
      <Route path="/login" element={<Suspense fallback={<PageLoader />}><LoginPage /></Suspense>} />
      <Route
        path="/"
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<ErrorBoundary><Suspense fallback={<PageLoader />}><ChatPage /></Suspense></ErrorBoundary>} />
        <Route path="room/:roomId" element={<ErrorBoundary><Suspense fallback={<PageLoader />}><ChatPage /></Suspense></ErrorBoundary>} />
        <Route path="agents" element={<ErrorBoundary><Suspense fallback={<PageLoader />}><AgentsPage /></Suspense></ErrorBoundary>} />
        <Route path="tasks" element={<ErrorBoundary><Suspense fallback={<PageLoader />}><TasksPage /></Suspense></ErrorBoundary>} />
        <Route path="settings" element={<ErrorBoundary><Suspense fallback={<PageLoader />}><SettingsPage /></Suspense></ErrorBoundary>} />
        <Route path="users" element={<ErrorBoundary><Suspense fallback={<PageLoader />}><UsersPage /></Suspense></ErrorBoundary>} />
      </Route>
      <Route path="*" element={<Suspense fallback={<PageLoader />}><NotFoundPage /></Suspense>} />
    </Routes>
  )
}

export function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppInner />
        <ToastContainer />
      </BrowserRouter>
    </ErrorBoundary>
  )
}
