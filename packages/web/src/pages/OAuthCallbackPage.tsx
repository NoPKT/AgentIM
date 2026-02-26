import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { api } from '../lib/api.js'
import { useAuthStore } from '../stores/auth.js'

export default function OAuthCallbackPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState('')
  const loadUser = useAuthStore((s) => s.loadUser)

  useEffect(() => {
    const provider = searchParams.get('provider')
    if (!provider) {
      setError('Missing provider')
      return
    }

    // The server has already set the httpOnly refresh token cookie.
    // We just need to restore the session via refresh.
    const restore = async () => {
      const refreshed = await api.tryRefresh()
      if (refreshed) {
        await loadUser()
        navigate('/', { replace: true })
      } else {
        setError(t('auth.loginFailed'))
        setTimeout(() => navigate('/login', { replace: true }), 2000)
      }
    }
    restore()
  }, [searchParams, navigate, t, loadUser])

  return (
    <div className="min-h-dvh flex items-center justify-center bg-surface-secondary px-4">
      <div className="text-center">
        {error ? (
          <div className="text-danger-text text-sm">{error}</div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-text-secondary">{t('common.loading')}</p>
          </div>
        )}
      </div>
    </div>
  )
}
