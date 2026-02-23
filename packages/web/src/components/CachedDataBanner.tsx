import { useTranslation } from 'react-i18next'

interface CachedDataBannerProps {
  type: 'messages' | 'rooms'
}

export function CachedDataBanner({ type }: CachedDataBannerProps) {
  const { t } = useTranslation()

  return (
    <div className="mx-4 my-1 flex items-center gap-2 rounded-md bg-warning-subtle/50 px-3 py-1.5 text-xs text-warning-text">
      <svg
        className="h-3.5 w-3.5 flex-shrink-0 animate-spin"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
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
      <span>
        {type === 'messages' ? t('chat.viewingCachedMessages') : t('chat.viewingCachedRooms')}
      </span>
    </div>
  )
}
