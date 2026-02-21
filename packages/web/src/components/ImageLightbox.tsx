import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import {
  CloseIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ZoomInIcon,
  ZoomOutIcon,
  ExternalLinkIcon,
} from './icons.js'
import { useUploadUrls } from '../hooks/useUploadUrl.js'

const ZOOM_LEVELS = [1, 1.5, 2, 3, 4]

interface ImageLightboxProps {
  images: string[]
  currentIndex: number
  onClose: () => void
  onNavigate: (index: number) => void
}

export function ImageLightbox({ images, currentIndex, onClose, onNavigate }: ImageLightboxProps) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, panX: 0, panY: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Convert raw /uploads/* URLs to auth-gated URLs (appends ?token=...).
  // Re-evaluated on every token rotation so the lightbox always shows valid images.
  const authImages = useUploadUrls(images)
  const currentImage = authImages[currentIndex]
  const hasMultiple = images.length > 1

  // Reset zoom/pan on image change
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [currentIndex])

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          onClose()
          break
        case 'ArrowLeft':
          if (currentIndex > 0) onNavigate(currentIndex - 1)
          break
        case 'ArrowRight':
          if (currentIndex < images.length - 1) onNavigate(currentIndex + 1)
          break
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose, onNavigate, currentIndex, images.length])

  // Lock body scroll
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = ''
    }
  }, [])

  const zoomIn = useCallback(() => {
    setZoom((prev) => {
      const nextIdx = ZOOM_LEVELS.findIndex((z) => z > prev)
      return nextIdx >= 0 ? ZOOM_LEVELS[nextIdx] : prev
    })
  }, [])

  const zoomOut = useCallback(() => {
    setZoom((prev) => {
      const levels = [...ZOOM_LEVELS].reverse()
      const nextIdx = levels.findIndex((z) => z < prev)
      if (nextIdx >= 0) return levels[nextIdx]
      return 1
    })
    setPan({ x: 0, y: 0 })
  }, [])

  const resetZoom = useCallback(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }, [])

  // Double-click to toggle zoom
  const handleDoubleClick = useCallback(() => {
    if (zoom === 1) {
      setZoom(2)
    } else {
      setZoom(1)
      setPan({ x: 0, y: 0 })
    }
  }, [zoom])

  // Wheel zoom
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault()
      if (e.deltaY < 0) {
        zoomIn()
      } else {
        zoomOut()
      }
    },
    [zoomIn, zoomOut],
  )

  // Mouse drag for panning when zoomed
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (zoom <= 1) return
      e.preventDefault()
      setIsDragging(true)
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        panX: pan.x,
        panY: pan.y,
      }
    },
    [zoom, pan],
  )

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return
      const dx = e.clientX - dragRef.current.startX
      const dy = e.clientY - dragRef.current.startY
      setPan({ x: dragRef.current.panX + dx, y: dragRef.current.panY + dy })
    },
    [isDragging],
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Touch pan when zoomed
  const touchRef = useRef({ startX: 0, startY: 0, panX: 0, panY: 0, dist: 0 })

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1 && zoom > 1) {
        touchRef.current = {
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          panX: pan.x,
          panY: pan.y,
          dist: 0,
        }
        setIsDragging(true)
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        touchRef.current.dist = Math.hypot(dx, dy)
      }
    },
    [zoom, pan],
  )

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      if (e.touches.length === 1 && isDragging) {
        const dx = e.touches[0].clientX - touchRef.current.startX
        const dy = e.touches[0].clientY - touchRef.current.startY
        setPan({ x: touchRef.current.panX + dx, y: touchRef.current.panY + dy })
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        const dist = Math.hypot(dx, dy)
        const prevDist = touchRef.current.dist
        if (prevDist > 0) {
          const scale = dist / prevDist
          setZoom((prev) => Math.max(1, Math.min(4, prev * scale)))
        }
        touchRef.current.dist = dist
      }
    },
    [isDragging],
  )

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false)
    if (zoom <= 1) setPan({ x: 0, y: 0 })
  }, [zoom])

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) onClose()
    },
    [onClose],
  )

  return createPortal(
    <div
      ref={containerRef}
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/90"
      role="dialog"
      aria-modal="true"
      aria-label={t('chat.imagePreview')}
      onClick={handleBackdropClick}
    >
      {/* Toolbar */}
      <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/60 to-transparent">
        {/* Left: counter */}
        <div className="text-white text-sm font-medium">
          {hasMultiple &&
            t('chat.lightboxCounter', { current: currentIndex + 1, total: images.length })}
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-1">
          {zoom !== 1 && (
            <span className="text-white/70 text-xs mr-1">{Math.round(zoom * 100)}%</span>
          )}
          <button
            onClick={zoomOut}
            disabled={zoom <= 1}
            className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title={t('chat.lightboxZoomOut')}
            aria-label={t('chat.lightboxZoomOut')}
          >
            <ZoomOutIcon className="w-5 h-5" />
          </button>
          <button
            onClick={zoom === 1 ? zoomIn : resetZoom}
            className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            title={zoom === 1 ? t('chat.lightboxZoomIn') : t('chat.lightboxResetZoom')}
            aria-label={zoom === 1 ? t('chat.lightboxZoomIn') : t('chat.lightboxResetZoom')}
          >
            <ZoomInIcon className="w-5 h-5" />
          </button>
          <a
            href={currentImage}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            title={t('chat.openOriginal')}
            aria-label={t('chat.openOriginal')}
          >
            <ExternalLinkIcon className="w-5 h-5" />
          </a>
          <button
            onClick={onClose}
            className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
            aria-label={t('common.close')}
          >
            <CloseIcon className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Navigation arrows */}
      {hasMultiple && currentIndex > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onNavigate(currentIndex - 1)
          }}
          className="absolute left-2 sm:left-4 top-1/2 -translate-y-1/2 z-10 p-2 sm:p-3 rounded-full bg-black/40 text-white/80 hover:text-white hover:bg-black/60 transition-colors"
          aria-label={t('chat.lightboxPrevious')}
        >
          <ChevronLeftIcon className="w-6 h-6" />
        </button>
      )}
      {hasMultiple && currentIndex < images.length - 1 && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onNavigate(currentIndex + 1)
          }}
          className="absolute right-2 sm:right-4 top-1/2 -translate-y-1/2 z-10 p-2 sm:p-3 rounded-full bg-black/40 text-white/80 hover:text-white hover:bg-black/60 transition-colors"
          aria-label={t('chat.lightboxNext')}
        >
          <ChevronRightIcon className="w-6 h-6" />
        </button>
      )}

      {/* Image */}
      <div
        className={`max-w-[90vw] max-h-[90vh] overflow-hidden ${isDragging ? 'cursor-grabbing' : zoom > 1 ? 'cursor-grab' : ''}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onDoubleClick={handleDoubleClick}
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={currentImage}
          alt={t('chat.imagePreview')}
          className="max-w-[90vw] max-h-[90vh] object-contain select-none"
          style={{
            transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out',
          }}
          draggable={false}
        />
      </div>
    </div>,
    document.body,
  )
}
