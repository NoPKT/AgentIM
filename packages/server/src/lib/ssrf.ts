/**
 * SSRF prevention utilities.
 *
 * Provides functions to detect and block requests targeting private/internal
 * networks, used by router LLM URL validation and media download.
 */

/** Check if a single IP address is private/internal. */
export function isPrivateIp(ip: string): boolean {
  // IPv4
  const v4 = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (v4) {
    const [, a, b] = v4.map(Number)
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
    if (a === 127) return true
    if (a === 0) return true
    if (a >= 240) return true // 240.0.0.0/4 (reserved) + 255.255.255.255 (broadcast)
    if (a >= 224 && a <= 239) return true // 224.0.0.0/4 (multicast)
    if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 (CGNAT)
    return false
  }
  // IPv6
  const lower = ip.replace(/^\[|\]$/g, '').toLowerCase()
  if (lower.includes(':')) {
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true
    if (lower.startsWith('fe80')) return true
    if (lower === '::' || lower === '::1') return true
    // IPv4-mapped IPv6 in dotted form: ::ffff:127.0.0.1
    // Delegate to isPrivateIp() to reuse the full IPv4 range checks
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateIp(mapped[1])
    // IPv4-mapped IPv6 in hex form: ::ffff:7f00:1 (= ::ffff:127.0.0.1)
    const hexMapped = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (hexMapped) {
      const hi = parseInt(hexMapped[1], 16)
      const lo = parseInt(hexMapped[2], 16)
      const a = (hi >> 8) & 0xff
      const b = hi & 0xff
      const c = (lo >> 8) & 0xff
      const d = lo & 0xff
      return isPrivateIp(`${a}.${b}.${c}.${d}`)
    }
  }
  return false
}

/**
 * Check if a URL points to an internal/private network.
 * Blocks localhost, private IPs, cloud metadata, octal/hex bypasses,
 * .local/.internal hostnames, and non-HTTP schemes.
 */
export function isInternalUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr)
    const hostname = url.hostname.toLowerCase()

    // Block localhost variants
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname === '[::1]'
    )
      return true
    // Block 0.0.0.0
    if (hostname === '0.0.0.0') return true
    // Block cloud metadata endpoints
    if (hostname === '169.254.169.254') return true
    // Block .local and .internal hostnames (mDNS / service discovery)
    if (hostname.endsWith('.local') || hostname.endsWith('.internal')) return true

    // Block octal/hex IP notation (e.g., 0177.0.0.1, 0x7f.0.0.1) used to bypass filters
    if (/^(0x[0-9a-f]+|0[0-7]+)(\.|$)/i.test(hostname)) return true

    // Check literal IP addresses
    if (isPrivateIp(hostname)) return true

    // Only allow http/https schemes
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return true

    return false
  } catch {
    return true // Malformed URL → reject
  }
}

/**
 * Resolve a hostname's DNS records and check if any resolved IPs are private.
 * This catches hostnames that resolve to internal addresses (SSRF via DNS rebinding).
 */
const DNS_TIMEOUT_MS = 5000

export async function resolvesToPrivateIp(urlStr: string): Promise<boolean> {
  try {
    const { hostname } = new URL(urlStr)
    // Skip resolution for literal IP addresses (already checked by isInternalUrl)
    if (/^(\d+\.){3}\d+$/.test(hostname) || hostname.includes(':')) return false

    const dns = await import('node:dns/promises')
    const withTimeout = <T>(p: Promise<T>): Promise<T> =>
      Promise.race([
        p,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS),
        ),
      ])

    // Resolve A and AAAA records in parallel for efficiency.
    // If a DNS lookup times out, treat as potentially unsafe (reject).
    // This prevents SSRF via DNS rebinding where an attacker controls a
    // slow-resolving domain that eventually points to a private IP.
    const [v4Result, v6Result] = await Promise.allSettled([
      withTimeout(dns.resolve4(hostname)),
      withTimeout(dns.resolve6(hostname)),
    ])

    // Check for timeouts — reject if any lookup timed out
    for (const result of [v4Result, v6Result]) {
      if (
        result.status === 'rejected' &&
        result.reason instanceof Error &&
        result.reason.message === 'DNS timeout'
      ) {
        return true // Timeout → reject (fail-closed)
      }
    }

    // Check resolved addresses for private IPs
    if (v4Result.status === 'fulfilled' && v4Result.value.some(isPrivateIp)) return true
    if (v6Result.status === 'fulfilled' && v6Result.value.some(isPrivateIp)) return true

    return false
  } catch {
    return false // URL parse failure is not an SSRF indicator
  }
}
