import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/auth.js'
import { Button, Input, FormField } from '../components/ui.js'

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const login = useAuthStore((state) => state.login)
  const user = useAuthStore((state) => state.user)

  // Redirect already-authenticated users away from login page
  useEffect(() => {
    if (user) navigate('/', { replace: true })
  }, [user, navigate])

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!username || !password) {
      setError(t('auth.pleaseEnterUsernameAndPassword'))
      return
    }

    setIsLoading(true)
    try {
      await login(username, password)
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.loginFailed'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-surface-secondary px-4">
      <div className="w-full max-w-md">
        <div className="bg-surface rounded-lg border border-border shadow-sm p-8">
          <div className="mb-8 text-center">
            <h1 className="text-2xl font-semibold text-text-primary mb-2">
              {t('auth.loginTitle')}
            </h1>
            <p className="text-sm text-text-secondary">{t('auth.loginSubtitle')}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {error && (
              <div
                role="alert"
                className="bg-danger-subtle border border-danger/20 text-danger-text px-4 py-3 rounded-md text-sm"
              >
                {error}
              </div>
            )}

            <FormField label={t('auth.username')} htmlFor="username">
              <Input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={t('auth.enterUsername')}
                disabled={isLoading}
                autoComplete="username"
              />
            </FormField>

            <FormField label={t('auth.password')} htmlFor="password">
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t('auth.enterPassword')}
                disabled={isLoading}
                autoComplete="current-password"
              />
            </FormField>

            <Button type="submit" disabled={isLoading} size="lg" className="w-full">
              {isLoading ? t('auth.loggingIn') : t('auth.login')}
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
