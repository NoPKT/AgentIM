import { useState, useEffect, useCallback, useMemo } from 'react'
import { Outlet, Link, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/auth.js'
import { RoomList } from './RoomList.js'
import {
  CloseIcon,
  MenuIcon,
  UsersIcon,
  AgentsIcon,
  TasksIcon,
  SettingsIcon,
} from './icons.js'
import { useSwipeToClose } from '../hooks/useSwipeToClose.js'

type NavIcon = React.ComponentType<React.SVGProps<SVGSVGElement>>

interface NavLink {
  path: string
  label: string
  Icon: NavIcon
}

export function AppLayout() {
  const { t } = useTranslation()
  const location = useLocation()
  const currentUser = useAuthStore((s) => s.user)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  const swipe = useSwipeToClose({ onClose: closeSidebar })

  const overlayStyle = useMemo(
    () => (swipe.isSwiping ? { opacity: 1 - swipe.progress } : undefined),
    [swipe.isSwiping, swipe.progress],
  )

  const navLinks: NavLink[] = [
    ...(currentUser?.role === 'admin'
      ? [{ path: '/users', label: t('settings.userManagement'), Icon: UsersIcon }]
      : []),
    { path: '/agents', label: t('agent.agents'), Icon: AgentsIcon },
    { path: '/tasks', label: t('task.tasks'), Icon: TasksIcon },
    { path: '/settings', label: t('settings.settings'), Icon: SettingsIcon },
  ]

  const isActive = (path: string) => location.pathname === path

  return (
    <div className="flex h-dvh bg-surface-secondary">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-backdrop backdrop-blur-sm z-overlay lg:hidden"
          style={overlayStyle}
          onClick={() => setSidebarOpen(false)}
          role="presentation"
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed lg:static inset-y-0 left-0 z-sidebar
          w-72 bg-surface border-r border-border shadow-sm
          flex flex-col
          ${swipe.isSwiping ? '' : 'transform transition-transform duration-300 ease-in-out'}
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        style={swipe.style}
        {...swipe.handlers}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-6 border-b border-border">
          <h1 className="text-xl font-bold text-text-primary">{t('common.appName')}</h1>
          <button
            className="lg:hidden p-2 rounded-md hover:bg-surface-hover text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => setSidebarOpen(false)}
            aria-label={t('common.close')}
          >
            <CloseIcon className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Room List */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          <RoomList onRoomSelect={closeSidebar} />
        </div>

        {/* Bottom Navigation */}
        <nav className="border-t border-border p-3 space-y-0.5">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`
                flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all relative
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent
                ${
                  isActive(link.path)
                    ? 'bg-info-subtle text-info-text'
                    : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }
              `}
            >
              {isActive(link.path) && (
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 bg-accent rounded-r-full" />
              )}
              <link.Icon className="w-4 h-4" aria-hidden="true" />
              {link.label}
            </Link>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <div className="lg:hidden h-16 flex items-center px-4 bg-surface border-b border-border">
          <button
            className="p-2 rounded-md hover:bg-surface-hover text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            onClick={() => setSidebarOpen(true)}
            aria-label={t('chat.rooms')}
            aria-expanded={sidebarOpen}
          >
            <MenuIcon className="w-6 h-6" aria-hidden="true" />
          </button>
          <h2 className="ml-4 text-lg font-semibold text-text-primary">
            {t('common.appName')}
          </h2>
        </div>

        {/* Route content */}
        <div className="flex-1 overflow-hidden">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
