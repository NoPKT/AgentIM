import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/auth.js'
import { api } from '../lib/api.js'
import { toast } from '../stores/toast.js'
import { Button, Input, Select, FormField } from '../components/ui.js'
import type { UserRole } from '@agentim/shared'

interface UserItem {
  id: string
  username: string
  displayName: string
  role: UserRole
  createdAt: string
  updatedAt: string
}

export default function UsersPage() {
  const { t } = useTranslation()
  const currentUser = useAuthStore((s) => s.user)
  const [users, setUsers] = useState<UserItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  // Create user form
  const [showCreate, setShowCreate] = useState(false)
  const [newUsername, setNewUsername] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')
  const [newRole, setNewRole] = useState<UserRole>('user')
  const [isCreating, setIsCreating] = useState(false)

  const isAdmin = currentUser?.role === 'admin'

  const loadUsers = async () => {
    setIsLoading(true)
    setLoadError(false)
    const res = await api.get<UserItem[]>('/users')
    if (res.ok && res.data) {
      setUsers(res.data)
    } else {
      setLoadError(true)
    }
    setIsLoading(false)
  }

  useEffect(() => {
    if (isAdmin) loadUsers()
    else setIsLoading(false)
  }, [isAdmin])

  const handleCreateUser = async () => {
    if (!newUsername.trim() || !newPassword.trim()) return
    setIsCreating(true)
    try {
      const res = await api.post<UserItem>('/users', {
        username: newUsername.trim(),
        password: newPassword,
        displayName: newDisplayName.trim() || undefined,
        role: newRole,
      })
      if (res.ok && res.data) {
        setUsers((prev) => [...prev, res.data!])
        toast.success(t('settings.userCreated'))
        setShowCreate(false)
        setNewUsername('')
        setNewPassword('')
        setNewDisplayName('')
        setNewRole('user')
      } else {
        toast.error(res.error || t('common.error'))
      }
    } catch {
      toast.error(t('common.error'))
    } finally {
      setIsCreating(false)
    }
  }

  const handleDeleteUser = async (userId: string) => {
    if (!confirm(t('settings.confirmDeleteUser'))) return
    const res = await api.delete(`/users/${userId}`)
    if (res.ok) {
      setUsers((prev) => prev.filter((u) => u.id !== userId))
      toast.success(t('settings.userDeleted'))
    } else {
      toast.error(res.error || t('common.error'))
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-secondary px-4">
        <div className="text-center max-w-md">
          <svg
            className="mx-auto h-16 w-16 text-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-semibold text-text-primary">{t('error.forbidden')}</h3>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex-1 overflow-y-auto scrollbar-thin bg-surface-secondary px-6 py-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-6 animate-pulse">
            <div className="h-8 w-40 bg-skeleton rounded" />
            <div className="mt-2 h-4 w-56 bg-surface-hover rounded" />
          </div>
          <div className="bg-surface rounded-lg border border-border overflow-hidden">
            <div className="bg-surface-hover px-6 py-3 flex gap-6">
              <div className="h-3 w-20 bg-skeleton rounded" />
              <div className="h-3 w-24 bg-skeleton rounded" />
              <div className="h-3 w-12 bg-skeleton rounded" />
            </div>
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="px-6 py-4 border-t border-border flex gap-6 animate-pulse">
                <div className="h-4 w-24 bg-skeleton rounded" />
                <div className="h-4 w-32 bg-surface-hover rounded" />
                <div className="h-4 w-14 bg-surface-hover rounded-full" />
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="flex-1 flex items-center justify-center bg-surface-secondary px-4">
        <div className="text-center max-w-md">
          <svg
            className="mx-auto h-12 w-12 text-text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3 className="mt-4 text-lg font-semibold text-text-primary">{t('common.loadFailed')}</h3>
          <Button onClick={loadUsers} className="mt-4">
            {t('common.retry')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin bg-surface-secondary px-6 py-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">{t('settings.userManagement')}</h1>
            <p className="mt-1 text-sm text-text-secondary">{t('settings.userManagementDesc')}</p>
          </div>
          <Button onClick={() => setShowCreate(!showCreate)}>{t('settings.createUser')}</Button>
        </div>

        {/* Create User Form */}
        {showCreate && (
          <div className="bg-surface rounded-lg border border-border shadow-sm p-6 mb-6">
            <h3 className="text-lg font-semibold text-text-primary mb-4">
              {t('settings.createUser')}
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField label={t('auth.username')}>
                <Input
                  type="text"
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value)}
                  placeholder={t('auth.enterUsername')}
                />
              </FormField>
              <FormField label={t('auth.password')}>
                <Input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder={t('auth.enterPassword')}
                />
              </FormField>
              <FormField label={`${t('auth.displayName')} (${t('auth.optional')})`}>
                <Input
                  type="text"
                  value={newDisplayName}
                  onChange={(e) => setNewDisplayName(e.target.value)}
                  placeholder={t('auth.enterDisplayName')}
                />
              </FormField>
              <FormField label={t('settings.role')}>
                <Select value={newRole} onChange={(e) => setNewRole(e.target.value as UserRole)}>
                  <option value="user">{t('settings.roleUser')}</option>
                  <option value="admin">{t('settings.roleAdmin')}</option>
                </Select>
              </FormField>
            </div>
            <div className="flex justify-end gap-3 mt-4">
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={handleCreateUser}
                disabled={isCreating || !newUsername.trim() || !newPassword.trim()}
              >
                {isCreating ? t('settings.creatingUser') : t('common.create')}
              </Button>
            </div>
          </div>
        )}

        {/* User List */}
        <div className="bg-surface rounded-lg border border-border shadow-sm overflow-hidden">
          <table className="w-full">
            <thead className="bg-surface-hover border-b border-border">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  {t('auth.username')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  {t('auth.displayName')}
                </th>
                <th className="px-6 py-3 text-left text-xs font-medium text-text-muted uppercase tracking-wider">
                  {t('settings.role')}
                </th>
                <th className="px-6 py-3 text-right text-xs font-medium text-text-muted uppercase tracking-wider" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-surface-hover">
                  <td className="px-6 py-4 text-sm font-medium text-text-primary">{u.username}</td>
                  <td className="px-6 py-4 text-sm text-text-secondary">{u.displayName}</td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        u.role === 'admin'
                          ? 'bg-role-bg text-role-text'
                          : 'bg-badge-bg text-badge-text'
                      }`}
                    >
                      {u.role === 'admin' ? t('settings.roleAdmin') : t('settings.roleUser')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {u.id !== currentUser?.id && (
                      <button
                        onClick={() => handleDeleteUser(u.id)}
                        className="text-danger-text hover:text-danger-hover text-sm font-medium transition-colors"
                      >
                        {t('common.delete')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-8 text-center text-sm text-text-muted">
                    {t('settings.noUsers')}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
