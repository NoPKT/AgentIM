import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { isPrivateIp, isInternalUrl, resolvesToPrivateIp } from '../../src/lib/ssrf.js'

describe('isPrivateIp', () => {
  // IPv4 private ranges
  it('detects 10.0.0.0/8', () => {
    assert.ok(isPrivateIp('10.0.0.1'))
    assert.ok(isPrivateIp('10.255.255.255'))
  })

  it('detects 172.16.0.0/12', () => {
    assert.ok(isPrivateIp('172.16.0.1'))
    assert.ok(isPrivateIp('172.31.255.255'))
    assert.ok(!isPrivateIp('172.15.0.1'))
    assert.ok(!isPrivateIp('172.32.0.1'))
  })

  it('detects 192.168.0.0/16', () => {
    assert.ok(isPrivateIp('192.168.0.1'))
    assert.ok(isPrivateIp('192.168.255.255'))
  })

  it('detects 127.0.0.0/8 (loopback)', () => {
    assert.ok(isPrivateIp('127.0.0.1'))
    assert.ok(isPrivateIp('127.255.255.255'))
  })

  it('detects 169.254.0.0/16 (link-local)', () => {
    assert.ok(isPrivateIp('169.254.1.1'))
    assert.ok(isPrivateIp('169.254.169.254'))
  })

  it('detects 0.0.0.0/8', () => {
    assert.ok(isPrivateIp('0.0.0.0'))
    assert.ok(isPrivateIp('0.255.255.255'))
  })

  it('detects 240.0.0.0/4 (reserved) and broadcast', () => {
    assert.ok(isPrivateIp('240.0.0.1'))
    assert.ok(isPrivateIp('255.255.255.255'))
  })

  it('detects 224.0.0.0/4 (multicast)', () => {
    assert.ok(isPrivateIp('224.0.0.1'))
    assert.ok(isPrivateIp('239.255.255.255'))
  })

  it('detects 100.64.0.0/10 (CGNAT)', () => {
    assert.ok(isPrivateIp('100.64.0.1'))
    assert.ok(isPrivateIp('100.127.255.255'))
    assert.ok(!isPrivateIp('100.63.255.255'))
    assert.ok(!isPrivateIp('100.128.0.1'))
  })

  it('allows public IPv4 addresses', () => {
    assert.ok(!isPrivateIp('8.8.8.8'))
    assert.ok(!isPrivateIp('1.1.1.1'))
    assert.ok(!isPrivateIp('203.0.113.1'))
    assert.ok(!isPrivateIp('93.184.216.34'))
  })

  // IPv6 private ranges
  it('detects IPv6 unique local addresses (fc00::/7)', () => {
    assert.ok(isPrivateIp('fc00::1'))
    assert.ok(isPrivateIp('fd12:3456::1'))
  })

  it('detects IPv6 link-local (fe80::/10)', () => {
    assert.ok(isPrivateIp('fe80::1'))
  })

  it('detects IPv6 loopback (::1) and unspecified (::)', () => {
    assert.ok(isPrivateIp('::1'))
    assert.ok(isPrivateIp('::'))
  })

  it('detects IPv4-mapped IPv6 in dotted form', () => {
    assert.ok(isPrivateIp('::ffff:127.0.0.1'))
    assert.ok(isPrivateIp('::ffff:10.0.0.1'))
    assert.ok(isPrivateIp('::ffff:192.168.1.1'))
    assert.ok(isPrivateIp('::ffff:169.254.1.1')) // link-local
    assert.ok(isPrivateIp('::ffff:100.64.0.1')) // CGNAT
    assert.ok(isPrivateIp('::ffff:224.0.0.1')) // multicast
    assert.ok(isPrivateIp('::ffff:240.0.0.1')) // reserved
    assert.ok(isPrivateIp('::ffff:255.255.255.255')) // broadcast
    assert.ok(!isPrivateIp('::ffff:8.8.8.8'))
  })

  it('detects IPv4-mapped IPv6 in hex form', () => {
    // ::ffff:7f00:1 = ::ffff:127.0.0.1
    assert.ok(isPrivateIp('::ffff:7f00:1'))
    // ::ffff:a00:1 = ::ffff:10.0.0.1
    assert.ok(isPrivateIp('::ffff:a00:1'))
  })

  it('strips brackets from IPv6', () => {
    assert.ok(isPrivateIp('[::1]'))
    assert.ok(isPrivateIp('[fe80::1]'))
  })

  it('returns false for non-IP strings', () => {
    assert.ok(!isPrivateIp('example.com'))
    assert.ok(!isPrivateIp('not-an-ip'))
  })
})

describe('isInternalUrl', () => {
  it('blocks localhost variants', () => {
    assert.ok(isInternalUrl('http://localhost'))
    assert.ok(isInternalUrl('http://localhost:3000'))
    assert.ok(isInternalUrl('http://127.0.0.1'))
    assert.ok(isInternalUrl('http://[::1]'))
    assert.ok(isInternalUrl('https://localhost/path'))
  })

  it('blocks 0.0.0.0', () => {
    assert.ok(isInternalUrl('http://0.0.0.0'))
    assert.ok(isInternalUrl('http://0.0.0.0:8080'))
  })

  it('blocks cloud metadata endpoints', () => {
    assert.ok(isInternalUrl('http://169.254.169.254'))
    assert.ok(isInternalUrl('http://169.254.169.254/latest/meta-data/'))
  })

  it('blocks .local and .internal hostnames', () => {
    assert.ok(isInternalUrl('http://myservice.local'))
    assert.ok(isInternalUrl('http://db.internal'))
    assert.ok(isInternalUrl('https://api.service.internal:8080/path'))
  })

  it('blocks octal IP notation (bypass attempt)', () => {
    // 0177.0.0.1 = 127.0.0.1 in octal
    assert.ok(isInternalUrl('http://0177.0.0.1'))
  })

  it('blocks hex IP notation (bypass attempt)', () => {
    // 0x7f.0.0.1 = 127.0.0.1 in hex
    assert.ok(isInternalUrl('http://0x7f.0.0.1'))
  })

  it('blocks private IP addresses', () => {
    assert.ok(isInternalUrl('http://10.0.0.1'))
    assert.ok(isInternalUrl('http://172.16.0.1'))
    assert.ok(isInternalUrl('http://192.168.1.1'))
  })

  it('blocks non-HTTP schemes', () => {
    assert.ok(isInternalUrl('ftp://example.com'))
    assert.ok(isInternalUrl('file:///etc/passwd'))
    assert.ok(isInternalUrl('gopher://evil.com'))
  })

  it('blocks malformed URLs', () => {
    assert.ok(isInternalUrl('not-a-url'))
    assert.ok(isInternalUrl(''))
    assert.ok(isInternalUrl('://missing-scheme'))
  })

  it('allows valid public HTTPS URLs', () => {
    assert.ok(!isInternalUrl('https://api.openai.com/v1/chat/completions'))
    assert.ok(!isInternalUrl('https://api.anthropic.com'))
    assert.ok(!isInternalUrl('http://93.184.216.34:8080/api'))
  })

  it('allows valid public HTTP URLs', () => {
    assert.ok(!isInternalUrl('http://api.example.com/v1'))
  })
})

describe('resolvesToPrivateIp', () => {
  it('returns false for literal IP addresses (already handled by isInternalUrl)', async () => {
    assert.equal(await resolvesToPrivateIp('http://8.8.8.8'), false)
    assert.equal(await resolvesToPrivateIp('http://127.0.0.1'), false)
  })

  it('returns false for well-known public domains', async () => {
    assert.equal(await resolvesToPrivateIp('https://google.com'), false)
  })

  it('returns false for malformed URLs', async () => {
    assert.equal(await resolvesToPrivateIp('not-a-url'), false)
  })

  it('returns false for IPv6 literal addresses', async () => {
    assert.equal(await resolvesToPrivateIp('http://[::1]'), false)
  })
})
