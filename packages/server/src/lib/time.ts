/** Parse a duration string like '7d', '24h', '30m' into milliseconds. */
export function parseExpiryMs(expiry: string): number {
  const match = expiry.match(/^(\d+)\s*([smhd])$/)
  if (!match) return 7 * 24 * 60 * 60 * 1000 // default 7 days
  const [, num, unit] = match
  const n = parseInt(num, 10)
  switch (unit) {
    case 's':
      return n * 1000
    case 'm':
      return n * 60 * 1000
    case 'h':
      return n * 60 * 60 * 1000
    case 'd':
      return n * 24 * 60 * 60 * 1000
    default:
      return 7 * 24 * 60 * 60 * 1000
  }
}
