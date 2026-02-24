import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MessageAttachment } from '@agentim/shared'
import { useUploadUrls } from '../hooks/useUploadUrl.js'
import { DownloadIcon } from './icons.js'

interface MediaMessageProps {
  attachments: MessageAttachment[]
  onImageClick?: (url: string) => void
}

function ImageWithSkeleton({ src, alt }: { src: string; alt: string }) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div className="relative min-w-32 max-w-full min-h-32">
      {!loaded && <div className="absolute inset-0 rounded-lg bg-surface-hover animate-pulse" />}
      <img
        src={src}
        alt={alt}
        className={`rounded-lg border border-border max-h-80 object-contain transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`}
        loading="lazy"
        onLoad={() => setLoaded(true)}
      />
    </div>
  )
}

/**
 * Rich media renderer for service agent responses.
 * Renders images, audio, video, and 3D models inline.
 */
export function MediaMessage({ attachments, onImageClick }: MediaMessageProps) {
  const { t } = useTranslation()
  const authUrls = useUploadUrls(attachments.map((a) => a.url))

  return (
    <div className="mt-2 space-y-2">
      {attachments.map((attachment, i) => {
        const authUrl = authUrls[i]

        // Image
        if (attachment.mimeType.startsWith('image/')) {
          return (
            <button
              key={attachment.id}
              onClick={() => onImageClick?.(attachment.url)}
              className="block max-w-md cursor-zoom-in"
            >
              <ImageWithSkeleton src={authUrl} alt={attachment.filename} />
            </button>
          )
        }

        // Audio
        if (attachment.mimeType.startsWith('audio/')) {
          return (
            <div key={attachment.id} className="max-w-md">
              <audio controls preload="metadata" className="w-full rounded-lg" src={authUrl}>
                {t('serviceAgent.audioUnsupported')}
              </audio>
              <div className="flex items-center justify-between mt-1 text-xs text-text-secondary">
                <span>{attachment.filename}</span>
                <a
                  href={authUrl}
                  download={attachment.filename}
                  className="flex items-center gap-1 hover:text-accent"
                >
                  <DownloadIcon className="w-3 h-3" />
                  {t('common.download')}
                </a>
              </div>
            </div>
          )
        }

        // Video
        if (attachment.mimeType.startsWith('video/')) {
          return (
            <div key={attachment.id} className="max-w-lg">
              <video
                controls
                preload="metadata"
                className="w-full rounded-lg border border-border"
                src={authUrl}
              >
                {t('serviceAgent.videoUnsupported')}
              </video>
              <div className="flex items-center justify-between mt-1 text-xs text-text-secondary">
                <span>{attachment.filename}</span>
                <a
                  href={authUrl}
                  download={attachment.filename}
                  className="flex items-center gap-1 hover:text-accent"
                >
                  <DownloadIcon className="w-3 h-3" />
                  {t('common.download')}
                </a>
              </div>
            </div>
          )
        }

        // 3D Model (GLB/GLTF)
        if (
          attachment.mimeType === 'model/gltf-binary' ||
          attachment.mimeType === 'model/gltf+json'
        ) {
          return (
            <div
              key={attachment.id}
              className="flex items-center gap-3 px-4 py-3 bg-surface-secondary border border-border rounded-lg max-w-sm"
            >
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center text-white text-sm font-bold">
                3D
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">
                  {attachment.filename}
                </p>
                <p className="text-xs text-text-secondary">
                  {(attachment.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </div>
              <a
                href={authUrl}
                download={attachment.filename}
                className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-accent bg-accent/10 rounded-lg hover:bg-accent/20 transition-colors"
              >
                <DownloadIcon className="w-3.5 h-3.5" />
                {t('common.download')}
              </a>
            </div>
          )
        }

        // Fallback: generic file download
        return (
          <a
            key={attachment.id}
            href={authUrl}
            download={attachment.filename}
            className="flex items-center gap-2 px-3 py-2 bg-surface-secondary border border-border rounded-lg hover:bg-surface-hover transition-colors max-w-sm"
          >
            <DownloadIcon className="w-4 h-4 text-text-muted" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">
                {attachment.filename}
              </p>
              <p className="text-xs text-text-secondary">
                {attachment.size < 1024 * 1024
                  ? `${(attachment.size / 1024).toFixed(1)} KB`
                  : `${(attachment.size / 1024 / 1024).toFixed(1)} MB`}
              </p>
            </div>
          </a>
        )
      })}
    </div>
  )
}
