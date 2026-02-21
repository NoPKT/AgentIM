import { useAuthStore } from '../stores/auth.js'
import { api } from '../lib/api.js'

/**
 * Returns an auth-gated URL for /uploads/* paths by appending the current
 * access token as a ?token= query parameter.
 *
 * Re-evaluates whenever the token rotates (tokenVersion changes), so browser
 * image requests always carry a valid credential.
 *
 * Non-upload URLs are returned unchanged.
 */
export function useUploadUrl(url: string | undefined | null): string {
  // Subscribe to tokenVersion — triggers re-render on every token refresh
  useAuthStore((s) => s.tokenVersion)
  if (!url?.startsWith('/uploads/')) return url ?? ''
  const token = api.getToken()
  if (!token) return url
  return `${url}?token=${encodeURIComponent(token)}`
}

/**
 * Batch version of useUploadUrl for arrays (e.g. lightbox image galleries).
 */
export function useUploadUrls(urls: string[]): string[] {
  useAuthStore((s) => s.tokenVersion)
  const token = api.getToken()
  if (!token) return urls
  return urls.map((url) =>
    url.startsWith('/uploads/') ? `${url}?token=${encodeURIComponent(token)}` : url,
  )
}
