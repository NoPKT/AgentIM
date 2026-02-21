import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'

export default function NotFoundPage() {
  const { t } = useTranslation()

  return (
    <div className="min-h-dvh flex items-center justify-center bg-surface-secondary px-4">
      <div className="text-center">
        <p className="text-7xl font-bold text-border">404</p>
        <h1 className="mt-4 text-xl font-semibold text-text-primary">{t('error.notFound')}</h1>
        <p className="mt-2 text-sm text-text-muted">{t('error.generic')}</p>
        <Link
          to="/"
          className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover text-white font-medium rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          {t('common.back')}
        </Link>
      </div>
    </div>
  )
}
