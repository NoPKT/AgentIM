import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/auth.js'
import { useThemeStore } from '../stores/theme.js'
import { useRouterStore } from '../stores/routers.js'
import { api } from '../lib/api.js'
import {
  getNotificationPreference,
  setNotificationPreference,
  requestNotificationPermission,
} from '../lib/notifications.js'
import { toast } from '../stores/toast.js'
import { Button, Input } from '../components/ui.js'
import { RouterFormDialog } from '../components/RouterFormDialog.js'
import type { Router } from '@agentim/shared'

export default function SettingsPage() {
  const { t, i18n } = useTranslation()
  const user = useAuthStore((state) => state.user)
  const updateUser = useAuthStore((state) => state.updateUser)
  const { mode: themeMode, setMode: setThemeMode } = useThemeStore()
  const [displayName, setDisplayName] = useState(user?.displayName || '')
  const [isSaving, setIsSaving] = useState(false)
  const [notificationsEnabled, setNotificationsEnabled] = useState(getNotificationPreference())

  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [isChangingPassword, setIsChangingPassword] = useState(false)

  // Router state
  const routers = useRouterStore((s) => s.routers)
  const routersLoading = useRouterStore((s) => s.loading)
  const loadRouters = useRouterStore((s) => s.loadRouters)
  const deleteRouterAction = useRouterStore((s) => s.deleteRouter)
  const [showRouterForm, setShowRouterForm] = useState(false)
  const [editingRouter, setEditingRouter] = useState<Router | null>(null)
  const [deletingRouterId, setDeletingRouterId] = useState<string | null>(null)
  const isAdmin = user?.role === 'admin'

  useEffect(() => {
    loadRouters()
  }, [loadRouters])

  const myRouters = routers.filter((r) => r.scope === 'personal' && r.createdById === user?.id)
  const globalRouters = routers.filter((r) => r.scope === 'global')

  const handleDeleteRouter = async (id: string) => {
    try {
      await deleteRouterAction(id)
      toast.success(t('router.deleted'))
      setDeletingRouterId(null)
    } catch {
      toast.error(t('error.generic'))
    }
  }

  const languages = [
    { code: 'en', label: 'English', flag: '\u{1F1FA}\u{1F1F8}' },
    { code: 'zh-CN', label: '\u4E2D\u6587', flag: '\u{1F1E8}\u{1F1F3}' },
    { code: 'ja', label: '\u65E5\u672C\u8A9E', flag: '\u{1F1EF}\u{1F1F5}' },
    { code: 'ko', label: '\uD55C\uAD6D\uC5B4', flag: '\u{1F1F0}\u{1F1F7}' },
    { code: 'fr', label: 'Fran\u00E7ais', flag: '\u{1F1EB}\u{1F1F7}' },
    { code: 'de', label: 'Deutsch', flag: '\u{1F1E9}\u{1F1EA}' },
    { code: 'ru', label: '\u0420\u0443\u0441\u0441\u043A\u0438\u0439', flag: '\u{1F1F7}\u{1F1FA}' },
  ]

  const themes = [
    {
      mode: 'light' as const,
      label: t('settings.lightTheme'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"
          />
        </svg>
      ),
    },
    {
      mode: 'dark' as const,
      label: t('settings.darkTheme'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"
          />
        </svg>
      ),
    },
    {
      mode: 'system' as const,
      label: t('settings.systemTheme'),
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      ),
    },
  ]

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsUploadingAvatar(true)
    try {
      const res = await api.upload<{ avatarUrl: string }>('/upload/avatar', file)
      if (res.ok && res.data) {
        updateUser({ avatarUrl: res.data.avatarUrl })
        toast.success(t('settings.profileUpdated'))
      } else {
        toast.error(res.error || t('common.error'))
      }
    } catch {
      toast.error(t('common.error'))
    } finally {
      setIsUploadingAvatar(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  const handleSaveProfile = async () => {
    setIsSaving(true)
    try {
      const res = await api.put('/users/me', { displayName })
      if (res.ok) {
        updateUser({ displayName })
        toast.success(t('settings.profileUpdated'))
      } else {
        toast.error(res.error || t('common.error'))
      }
    } catch {
      toast.error(t('common.error'))
    } finally {
      setIsSaving(false)
    }
  }

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      toast.error(t('auth.passwordTooShort'))
      return
    }
    if (!/[a-z]/.test(newPassword) || !/[A-Z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      toast.error(t('settings.passwordRequirements'))
      return
    }
    if (newPassword !== confirmNewPassword) {
      toast.error(t('auth.passwordsDoNotMatch'))
      return
    }

    setIsChangingPassword(true)
    try {
      const res = await api.put('/users/me/password', {
        currentPassword,
        newPassword,
      })
      if (res.ok) {
        toast.success(t('settings.passwordChanged'))
        // Server invalidated all refresh tokens — log out so user re-authenticates
        await useAuthStore.getState().logout()
        return
      } else {
        toast.error(res.error || t('common.error'))
      }
    } catch {
      toast.error(t('common.error'))
    } finally {
      setIsChangingPassword(false)
    }
  }

  const handleLanguageChange = (langCode: string) => {
    i18n.changeLanguage(langCode)
    localStorage.setItem('agentim_language', langCode)
  }

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 dark:bg-gray-900 px-6 py-6">
      <div className="max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('settings.settings')}</h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('settings.manageSettings')}</p>
        </div>

        <div className="space-y-6">
          {/* Profile Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('settings.profile')}
              </h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('settings.updateProfile')}</p>
            </div>
            <div className="px-6 py-5 space-y-5">
              {/* Avatar */}
              <div className="flex items-center gap-4">
                <div className="relative group">
                  {user?.avatarUrl ? (
                    <img
                      src={user.avatarUrl}
                      alt={user.displayName}
                      className="w-16 h-16 rounded-full object-cover border-2 border-gray-200 dark:border-gray-600"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-400 to-gray-500 flex items-center justify-center text-white text-xl font-bold">
                      {user?.displayName?.charAt(0).toUpperCase() || '?'}
                    </div>
                  )}
                  <button
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={isUploadingAvatar}
                    className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                  >
                    {isUploadingAvatar ? (
                      <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                        />
                      </svg>
                    ) : (
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                    )}
                  </button>
                  <input
                    ref={avatarInputRef}
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {user?.displayName}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">@{user?.username}</p>
                </div>
              </div>

              <div>
                <label
                  htmlFor="username"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  {t('auth.username')}
                </label>
                <Input
                  id="username"
                  type="text"
                  value={user?.username || ''}
                  disabled
                  className="bg-gray-50 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('settings.usernameCannotBeChanged')}
                </p>
              </div>

              {user?.role && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    {t('settings.role')}
                  </label>
                  <span
                    className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${
                      user.role === 'admin'
                        ? 'bg-purple-100 dark:bg-purple-900/30 text-purple-800 dark:text-purple-300'
                        : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
                    }`}
                  >
                    {user.role === 'admin' ? t('settings.roleAdmin') : t('settings.roleUser')}
                  </span>
                </div>
              )}

              <div>
                <label
                  htmlFor="displayName"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  {t('auth.displayName')}
                </label>
                <Input
                  id="displayName"
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t('auth.enterDisplayName')}
                />
              </div>

              <div className="flex items-center justify-end pt-2">
                <Button onClick={handleSaveProfile} disabled={isSaving} className="ml-auto">
                  {isSaving ? t('common.saving') : t('common.save')}
                </Button>
              </div>
            </div>
          </div>

          {/* Change Password Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('settings.changePassword')}
              </h2>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label
                  htmlFor="currentPassword"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  {t('settings.currentPassword')}
                </label>
                <Input
                  id="currentPassword"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div>
                <label
                  htmlFor="newPassword"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  {t('settings.newPassword')}
                </label>
                <Input
                  id="newPassword"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  {t('settings.passwordRequirements')}
                </p>
              </div>
              <div>
                <label
                  htmlFor="confirmNewPassword"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2"
                >
                  {t('settings.confirmNewPassword')}
                </label>
                <Input
                  id="confirmNewPassword"
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="flex items-center justify-end pt-2">
                <Button
                  onClick={handleChangePassword}
                  disabled={
                    isChangingPassword || !currentPassword || !newPassword || !confirmNewPassword
                  }
                >
                  {isChangingPassword ? t('settings.changingPassword') : t('settings.changePassword')}
                </Button>
              </div>
            </div>
          </div>

          {/* Theme Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('settings.theme')}
              </h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {t('settings.selectTheme')}
              </p>
            </div>
            <div className="px-6 py-5">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                {themes.map((theme) => {
                  const isActive = themeMode === theme.mode
                  return (
                    <button
                      key={theme.mode}
                      onClick={() => setThemeMode(theme.mode)}
                      className={`px-4 py-3 border-2 rounded-lg text-left transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                        isActive
                          ? 'border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={
                            isActive
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-gray-500 dark:text-gray-400'
                          }
                        >
                          {theme.icon}
                        </span>
                        <div className="flex-1">
                          <div
                            className={`font-medium ${isActive ? 'text-blue-900 dark:text-blue-200' : 'text-gray-900 dark:text-gray-100'}`}
                          >
                            {theme.label}
                          </div>
                        </div>
                        {isActive && (
                          <svg
                            className="w-5 h-5 text-blue-600 dark:text-blue-400"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Language Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('settings.language')}
              </h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">{t('settings.selectLanguage')}</p>
            </div>
            <div className="px-6 py-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {languages.map((lang) => {
                  const isActive = i18n.language === lang.code
                  return (
                    <button
                      key={lang.code}
                      onClick={() => handleLanguageChange(lang.code)}
                      className={`px-4 py-3 border-2 rounded-lg text-left transition-all focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                        isActive
                          ? 'border-blue-600 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/30'
                          : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700/50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-2xl">{lang.flag}</span>
                        <div className="flex-1">
                          <div
                            className={`font-medium ${isActive ? 'text-blue-900 dark:text-blue-200' : 'text-gray-900 dark:text-gray-100'}`}
                          >
                            {lang.label}
                          </div>
                          <div
                            className={`text-xs ${isActive ? 'text-blue-600 dark:text-blue-400' : 'text-gray-500 dark:text-gray-400'}`}
                          >
                            {lang.code}
                          </div>
                        </div>
                        {isActive && (
                          <svg
                            className="w-5 h-5 text-blue-600 dark:text-blue-400"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fillRule="evenodd"
                              d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clipRule="evenodd"
                            />
                          </svg>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Notifications Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                {t('settings.notifications')}
              </h2>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                {t('settings.notificationsDesc')}
              </p>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {t('settings.mentionNotifications')}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {t('settings.mentionNotificationsDesc')}
                  </p>
                </div>
                <button
                  onClick={async () => {
                    if (!notificationsEnabled) {
                      const granted = await requestNotificationPermission()
                      if (!granted) {
                        toast.error(t('settings.notificationPermissionDenied'))
                        return
                      }
                    }
                    const next = !notificationsEnabled
                    setNotificationPreference(next)
                    setNotificationsEnabled(next)
                    toast.success(next ? t('settings.notificationsEnabled') : t('settings.notificationsDisabled'))
                  }}
                  className={`
                    relative inline-flex h-6 w-11 items-center rounded-full transition-colors
                    ${notificationsEnabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-600'}
                  `}
                >
                  <span
                    className={`
                      inline-block h-4 w-4 rounded-full bg-white shadow-sm transform transition-transform
                      ${notificationsEnabled ? 'translate-x-6' : 'translate-x-1'}
                    `}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* My Routers Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                  {t('router.myRouters')}
                </h2>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                  {t('router.routerDesc')}
                </p>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  setEditingRouter(null)
                  setShowRouterForm(true)
                }}
              >
                {t('router.createRouter')}
              </Button>
            </div>
            <div className="px-6 py-4">
              {routersLoading && routers.length === 0 ? (
                <div className="text-center py-6">
                  <div className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
                </div>
              ) : myRouters.length === 0 && globalRouters.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t('router.noRouters')}
                  </p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                    {t('router.noRoutersDesc')}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {myRouters.map((router) => (
                    <div
                      key={router.id}
                      className="flex items-center justify-between px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {router.name}
                          </span>
                          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                            {router.llmModel}
                          </span>
                        </div>
                        {router.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                            {router.description}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1 ml-3">
                        <button
                          onClick={() => {
                            setEditingRouter(router)
                            setShowRouterForm(true)
                          }}
                          className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                        </button>
                        {deletingRouterId === router.id ? (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => handleDeleteRouter(router.id)}
                              className="p-1.5 text-red-600 dark:text-red-400 rounded-md bg-red-50 dark:bg-red-900/30"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            </button>
                            <button
                              onClick={() => setDeletingRouterId(null)}
                              className="p-1.5 text-gray-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setDeletingRouterId(router.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Global routers (read-only for non-admins) */}
                  {globalRouters.map((router) => (
                    <div
                      key={router.id}
                      className="flex items-center justify-between px-4 py-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                            {router.name}
                          </span>
                          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded">
                            {t('router.scopeGlobal')}
                          </span>
                          <span className="px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded">
                            {router.llmModel}
                          </span>
                        </div>
                        {router.description && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 truncate">
                            {router.description}
                          </p>
                        )}
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1 ml-3">
                          <button
                            onClick={() => {
                              setEditingRouter(router)
                              setShowRouterForm(true)
                            }}
                            className="p-1.5 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 rounded-md hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                            </svg>
                          </button>
                          {deletingRouterId === router.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => handleDeleteRouter(router.id)}
                                className="p-1.5 text-red-600 dark:text-red-400 rounded-md bg-red-50 dark:bg-red-900/30"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </button>
                              <button
                                onClick={() => setDeletingRouterId(null)}
                                className="p-1.5 text-gray-400 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setDeletingRouterId(router.id)}
                              className="p-1.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400 rounded-md hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* About Section */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">{t('settings.about')}</h2>
            </div>
            <div className="px-6 py-5 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('settings.version')}
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-400">{__APP_VERSION__}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t('common.appName')}
                </span>
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {t('settings.aiAgentPlatform')}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <RouterFormDialog
        isOpen={showRouterForm}
        onClose={() => {
          setShowRouterForm(false)
          setEditingRouter(null)
        }}
        router={editingRouter}
      />
    </div>
  )
}
