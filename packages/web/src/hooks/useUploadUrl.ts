import { useTokenVersionStore } from '../stores/tokenVersion.js'
import { api } from '../lib/api.js'

/**
 * Returns an auth-gated URL for /uploads/* paths by appending the current
 * access token as a ?token= query parameter.
 *
 * Security trade-off: token is passed in the URL because {@literal <img src>}
 * and other HTML resource attributes cannot send Authorization headers.
 * The server validates and expires these tokens to limit exposure.
 * Mitigations:
 *   - Access tokens are short-lived (default 15m) and auto-rotated
 *   - Server logs should never log query parameters
 *   - HTTPS ensures the URL is not visible on the wire
 *
 * Re-evaluates whenever the token rotates (tokenVersion changes), so browser
 * image requests always carry a valid credential.
 *
 * Non-upload URLs are returned unchanged.
 */
export function useUploadUrl(url: string | undefined | null): string {
  // Subscribe to tokenVersion — triggers re-render on every token refresh
  useTokenVersionStore((s) => s.version)
  if (!url?.startsWith('/uploads/')) return url ?? ''
  const token = api.getToken()
  if (!token) return url
  return `${url}?token=${encodeURIComponent(token)}`
}

/**
 * Batch version of useUploadUrl for arrays (e.g. lightbox image galleries).
 */
export function useUploadUrls(urls: string[]): string[] {
  useTokenVersionStore((s) => s.version)
  const token = api.getToken()
  if (!token) return urls
  return urls.map((url) =>
    url.startsWith('/uploads/') ? `${url}?token=${encodeURIComponent(token)}` : url,
  )
}
