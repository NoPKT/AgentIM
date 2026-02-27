import { describe, it, expect, vi } from 'vitest'
import { registerStoreReset, resetAllStores } from './reset'

describe('registerStoreReset / resetAllStores', () => {
  it('calls registered reset function on resetAllStores', () => {
    const fn = vi.fn()
    registerStoreReset(fn)
    resetAllStores()
    expect(fn).toHaveBeenCalledOnce()
  })

  it('calls multiple registered functions', () => {
    const fn1 = vi.fn()
    const fn2 = vi.fn()
    registerStoreReset(fn1)
    registerStoreReset(fn2)
    resetAllStores()
    expect(fn1).toHaveBeenCalled()
    expect(fn2).toHaveBeenCalled()
  })
})
