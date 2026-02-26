import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { redactSensitiveContent } from '../src/adapters/spawn-base.js'

describe('redactSensitiveContent', () => {
  it('redacts API keys with sk- prefix', () => {
    const input = 'sk-abcdefghijklmnopqrstuvwxyz'
    const result = redactSensitiveContent(input)
    assert.equal(result, 'sk-••••••')
  })

  it('redacts API keys with key- prefix', () => {
    const input = 'key-abcdefghijklmnopqrstuvwxyz'
    const result = redactSensitiveContent(input)
    assert.equal(result, 'key-••••••')
  })

  it('redacts Bearer tokens', () => {
    const input = 'Bearer eyJhbGciOiJIUzI1NiJ9.test12345'
    const result = redactSensitiveContent(input)
    assert.equal(result, 'Bearer ••••••')
  })

  it('redacts Authorization headers', () => {
    const input = 'Authorization: some-secret-token'
    const result = redactSensitiveContent(input)
    assert.equal(result, 'Authorization: ••••••')
  })

  it('redacts home directory paths on macOS', () => {
    const input = '/Users/john/project'
    const result = redactSensitiveContent(input)
    assert.equal(result, '/••••/••••/project')
  })

  it('redacts home directory paths on Linux', () => {
    const input = '/home/john/project'
    const result = redactSensitiveContent(input)
    assert.equal(result, '/••••/••••/project')
  })

  it('redacts API key in env format', () => {
    const input = 'api_key=mysecretvalue123'
    const result = redactSensitiveContent(input)
    assert.equal(result, 'api_key=••••••')
  })

  it('leaves non-sensitive text unchanged', () => {
    const input = 'Hello world'
    const result = redactSensitiveContent(input)
    assert.equal(result, 'Hello world')
  })
})
