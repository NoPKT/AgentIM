import { describe, it, expect, beforeEach } from 'vitest'
import { useTokenVersionStore } from './tokenVersion'

describe('useTokenVersionStore', () => {
  beforeEach(() => {
    useTokenVersionStore.setState({ version: 0 })
  })

  it('initial version is 0', () => {
    expect(useTokenVersionStore.getState().version).toBe(0)
  })

  it('bump() increments version', () => {
    useTokenVersionStore.getState().bump()
    expect(useTokenVersionStore.getState().version).toBe(1)

    useTokenVersionStore.getState().bump()
    expect(useTokenVersionStore.getState().version).toBe(2)
  })
})
