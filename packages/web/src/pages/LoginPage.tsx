import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useAuthStore } from '../stores/auth.js'
import { Button, Input, FormField } from '../components/ui.js'

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  )
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  )
}

export default function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
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
  const [oauthProviders, setOauthProviders] = useState<string[]>([])

  // Show OAuth error from redirect
  useEffect(() => {
    const oauthError = searchParams.get('error')
    if (oauthError) {
      setError(t('auth.oauthError'))
    }
  }, [searchParams, t])

  // Fetch available OAuth providers
  useEffect(() => {
    const fetchProviders = async () => {
      try {
        const res = await fetch('/api/auth/oauth/providers')
        if (res.ok) {
          const data = (await res.json()) as { ok: boolean; data: string[] }
          if (data.ok && data.data) {
            setOauthProviders(data.data)
          }
        }
      } catch {
        // OAuth providers are optional — silently ignore errors
      }
    }
    fetchProviders()
  }, [])

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

  const handleOAuthLogin = (provider: string) => {
    window.location.href = `/api/auth/oauth/${provider}`
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

          {oauthProviders.length > 0 && (
            <div className="mt-6">
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-surface px-3 text-text-muted">
                    {t('auth.orContinueWith')}
                  </span>
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-3">
                {oauthProviders.includes('github') && (
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin('github')}
                    className="flex items-center justify-center gap-3 w-full px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-text-primary hover:bg-surface-hover transition-colors"
                  >
                    <GitHubIcon className="w-5 h-5" />
                    {t('auth.continueWithGithub')}
                  </button>
                )}
                {oauthProviders.includes('google') && (
                  <button
                    type="button"
                    onClick={() => handleOAuthLogin('google')}
                    className="flex items-center justify-center gap-3 w-full px-4 py-2.5 border border-border rounded-lg text-sm font-medium text-text-primary hover:bg-surface-hover transition-colors"
                  >
                    <GoogleIcon className="w-5 h-5" />
                    {t('auth.continueWithGoogle')}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
