import { useState, useEffect, useCallback } from 'react'
import { api } from '../lib/api.js'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i)
  }
  return arr
}

export function usePushNotifications() {
  const isSupported = 'PushManager' in window && 'serviceWorker' in navigator
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!isSupported) return
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then((sub) => setIsSubscribed(!!sub))
      .catch(() => {})
  }, [isSupported])

  const subscribe = useCallback(async () => {
    if (!isSupported) return
    setIsLoading(true)
    try {
      const res = await api.get<{ publicKey: string }>('/push/vapid-key')
      if (!res.ok || !res.data?.publicKey) return

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(res.data.publicKey),
      })

      const json = sub.toJSON()
      await api.post('/push/subscribe', {
        endpoint: json.endpoint,
        keys: json.keys,
      })
      setIsSubscribed(true)
    } finally {
      setIsLoading(false)
    }
  }, [isSupported])

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return
    setIsLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (sub) {
        const endpoint = sub.endpoint
        await sub.unsubscribe()
        await api.post('/push/unsubscribe', { endpoint })
      }
      setIsSubscribed(false)
    } finally {
      setIsLoading(false)
    }
  }, [isSupported])

  return { isSupported, isSubscribed, isLoading, subscribe, unsubscribe }
}
