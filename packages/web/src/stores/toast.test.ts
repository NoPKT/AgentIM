import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useToastStore, toast } from './toast'

describe('useToastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    useToastStore.setState({ toasts: [] })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('adds a toast', () => {
    useToastStore.getState().addToast('success', 'Hello')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'success',
      message: 'Hello',
    })
  })

  it('removes a toast', () => {
    useToastStore.getState().addToast('info', 'Msg')
    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().removeToast(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('auto-removes toast after duration', () => {
    useToastStore.getState().addToast('info', 'Auto remove', 2000)
    expect(useToastStore.getState().toasts).toHaveLength(1)
    vi.advanceTimersByTime(2001)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('enforces MAX_TOASTS limit', () => {
    for (let i = 0; i < 25; i++) {
      useToastStore.getState().addToast('info', `Toast ${i}`)
    }
    expect(useToastStore.getState().toasts.length).toBeLessThanOrEqual(20)
  })

  it('convenience helpers work', () => {
    toast.success('ok')
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0].type).toBe('success')

    toast.error('fail')
    expect(useToastStore.getState().toasts).toHaveLength(2)
    expect(useToastStore.getState().toasts[1].type).toBe('error')

    toast.info('note')
    expect(useToastStore.getState().toasts).toHaveLength(3)
    expect(useToastStore.getState().toasts[2].type).toBe('info')
  })
})
