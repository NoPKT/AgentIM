import { useState, useMemo, useCallback } from 'react'
import { useChatStore } from '../stores/chat.js'

interface UseLightboxReturn {
  isOpen: boolean
  images: string[]
  currentIndex: number
  openLightbox: (url: string) => void
  closeLightbox: () => void
  navigateTo: (index: number) => void
}

export function useLightbox(roomId: string | null): UseLightboxReturn {
  const messages = useChatStore((s) => s.messages)
  const [isOpen, setIsOpen] = useState(false)
  const [currentIndex, setCurrentIndex] = useState(0)

  const images = useMemo(() => {
    if (!roomId) return []
    const roomMessages = messages.get(roomId) ?? []
    const urls: string[] = []
    for (const msg of roomMessages) {
      if (msg.attachments) {
        for (const att of msg.attachments) {
          if (att.mimeType.startsWith('image/')) {
            urls.push(att.url)
          }
        }
      }
    }
    return urls
  }, [roomId, messages])

  const openLightbox = useCallback(
    (url: string) => {
      const idx = images.indexOf(url)
      setCurrentIndex(idx >= 0 ? idx : 0)
      setIsOpen(true)
    },
    [images],
  )

  const closeLightbox = useCallback(() => {
    setIsOpen(false)
  }, [])

  const navigateTo = useCallback(
    (index: number) => {
      if (index >= 0 && index < images.length) {
        setCurrentIndex(index)
      }
    },
    [images.length],
  )

  return {
    isOpen,
    images,
    currentIndex,
    openLightbox,
    closeLightbox,
    navigateTo,
  }
}
