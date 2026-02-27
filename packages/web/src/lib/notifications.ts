const NOTIFICATION_PREF_KEY = 'agentim:notifications'

export function getNotificationPreference(): boolean {
  try {
    return localStorage.getItem(NOTIFICATION_PREF_KEY) !== 'off'
  } catch {
    return true // Default to enabled when localStorage is unavailable
  }
}

export function setNotificationPreference(enabled: boolean) {
  try {
    localStorage.setItem(NOTIFICATION_PREF_KEY, enabled ? 'on' : 'off')
  } catch {
    // localStorage may be unavailable in private browsing or when storage is full
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  const result = await Notification.requestPermission()
  return result === 'granted'
}

export function canShowNotifications(): boolean {
  return (
    'Notification' in window && Notification.permission === 'granted' && getNotificationPreference()
  )
}

export function showNotification(
  title: string,
  body: string,
  onClick?: () => void,
  tag = 'agentim-message',
) {
  if (!canShowNotifications()) return
  if (document.visibilityState === 'visible') return

  const notification = new Notification(title, {
    body,
    icon: '/favicon.svg',
    tag,
  })

  if (onClick) {
    notification.onclick = () => {
      window.focus()
      onClick()
      notification.close()
    }
  }

  setTimeout(() => notification.close(), 8000)
}
