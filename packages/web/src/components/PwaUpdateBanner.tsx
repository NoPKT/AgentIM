import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useTranslation } from 'react-i18next'

export function PwaUpdateBanner() {
  const { t } = useTranslation()
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error('PWA service worker registration error', error)
    },
  })

  // Auto-clear if somehow dismissed without updating
  useEffect(() => {
    return () => setNeedRefresh(false)
  }, [setNeedRefresh])

  if (!needRefresh) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-0 inset-x-0 z-50 flex items-center justify-center gap-3 bg-accent px-4 py-2 text-white shadow-md"
    >
      <span className="text-sm">{t('pwa.updateAvailable')}</span>
      <button
        onClick={() => updateServiceWorker(true)}
        className="rounded border border-white/40 px-3 py-0.5 text-sm font-medium hover:bg-white/20 transition-colors"
      >
        {t('pwa.reload')}
      </button>
      <button
        onClick={() => setNeedRefresh(false)}
        aria-label="Dismiss"
        className="ml-1 text-white/70 hover:text-white transition-colors"
      >
        ✕
      </button>
    </div>
  )
}
