import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Outlet, Link, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/auth.js'
import { RoomList } from './RoomList.js'
import { ErrorBoundary } from './ErrorBoundary.js'
import {
  CloseIcon,
  MenuIcon,
  UsersIcon,
  AgentsIcon,
  TasksIcon,
  SettingsIcon,
  LogoutIcon,
  DashboardIcon,
  ServiceAgentsIcon,
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
  const logout = useAuthStore((s) => s.logout)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const sidebarRef = useRef<HTMLElement>(null)

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  // Auto-focus sidebar when it opens on mobile
  useEffect(() => {
    if (sidebarOpen && sidebarRef.current) {
      sidebarRef.current.focus()
    }
  }, [sidebarOpen])

  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  const swipe = useSwipeToClose({ onClose: closeSidebar })

  const overlayStyle = useMemo(
    () => (swipe.isSwiping ? { opacity: 1 - swipe.progress } : undefined),
    [swipe.isSwiping, swipe.progress],
  )

  const navLinks: NavLink[] = [
    ...(currentUser?.role === 'admin'
      ? [
          {
            path: '/admin/dashboard',
            label: t('adminDashboard.title'),
            Icon: DashboardIcon,
          },
          { path: '/users', label: t('settings.userManagement'), Icon: UsersIcon },
          { path: '/admin/settings', label: t('adminSettings.title'), Icon: SettingsIcon },
          {
            path: '/service-agents',
            label: t('serviceAgent.title'),
            Icon: ServiceAgentsIcon,
          },
        ]
      : []),
    { path: '/agents', label: t('agent.agents'), Icon: AgentsIcon },
    { path: '/tasks', label: t('task.tasks'), Icon: TasksIcon },
    { path: '/settings', label: t('settings.settings'), Icon: SettingsIcon },
  ]

  const isActive = (path: string) => location.pathname === path

  return (
    <div className="flex h-dvh bg-surface-secondary">
      {/* Skip to content link */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:p-4 focus:bg-white focus:text-black dark:focus:bg-gray-900 dark:focus:text-white"
      >
        {t('a11y.skipToContent')}
      </a>

      {/* Main Content — rendered before sidebar in DOM so sidebar paints on top */}
      <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col min-h-0 outline-none">
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
          <h2 className="ml-4 text-lg font-semibold text-text-primary">{t('common.appName')}</h2>
        </div>

        {/* Route content */}
        <div className="flex-1 flex flex-col min-h-0">
          <Outlet />
        </div>
      </main>

      {/* Mobile overlay — rendered after main so it paints on top */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-backdrop backdrop-blur-sm z-overlay lg:hidden"
          style={overlayStyle}
          onClick={() => setSidebarOpen(false)}
          role="presentation"
          aria-hidden="true"
        />
      )}

      {/* Sidebar — rendered after main in DOM for correct mobile stacking;
          lg:order-first restores left-side position on desktop flex layout */}
      <aside
        ref={sidebarRef}
        className={`
          fixed lg:static inset-y-0 left-0 z-sidebar lg:order-first
          w-72 bg-surface border-r border-border shadow-sm
          flex flex-col
          ${swipe.isSwiping ? '' : 'transform transition-transform duration-300 ease-in-out'}
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
        style={swipe.style}
        {...swipe.handlers}
        {...(sidebarOpen ? { role: 'dialog' as const, 'aria-modal': true, tabIndex: -1 } : {})}
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
          <ErrorBoundary
            fallback={(_err, retry) => (
              <div className="p-4 text-center text-text-secondary">
                <p className="mb-2">{t('error.generic')}</p>
                <button className="text-sm text-accent hover:underline" onClick={retry}>
                  {t('common.retry')}
                </button>
              </div>
            )}
          >
            <RoomList onRoomSelect={closeSidebar} />
          </ErrorBoundary>
        </div>

        {/* Bottom Navigation */}
        <nav className="border-t border-border p-3 space-y-0.5">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              aria-current={isActive(link.path) ? 'page' : undefined}
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
          <button
            onClick={() => logout()}
            className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-medium transition-all text-text-secondary hover:bg-danger-subtle hover:text-danger-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            <LogoutIcon className="w-4 h-4" aria-hidden="true" />
            {t('auth.logout')}
          </button>
        </nav>
      </aside>
    </div>
  )
}
