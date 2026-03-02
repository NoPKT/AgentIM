/** Format a USD cost value. */
export function formatCost(usd: number): string {
  if (usd === 0) return '—'
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

/** Format a token count (e.g. 12345 → "12.3K"). */
export function formatTokens(count: number): string {
  if (count === 0) return '0'
  if (count < 1000) return String(count)
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}K`
  return `${(count / 1_000_000).toFixed(1)}M`
}

/** Format milliseconds elapsed as a human-readable uptime string. */
export function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (hours < 24) return `${hours}h ${remainingMinutes}m`
  const days = Math.floor(hours / 24)
  const remainingHours = hours % 24
  return `${days}d ${remainingHours}h`
}

/** Truncate a string to maxLen, adding "…" if truncated. */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '…'
}
