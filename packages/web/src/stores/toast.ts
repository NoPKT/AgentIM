import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: number
  type: ToastType
  message: string
}

interface ToastState {
  toasts: Toast[]
  addToast: (type: ToastType, message: string, duration?: number) => void
  removeToast: (id: number) => void
}

const MAX_TOASTS = 20
let nextId = 0

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  addToast: (type, message, duration = 3000) => {
    const id = nextId++
    const toasts = [...get().toasts, { id, type, message }]
    // Drop oldest toasts if over limit
    set({ toasts: toasts.length > MAX_TOASTS ? toasts.slice(-MAX_TOASTS) : toasts })
    setTimeout(() => get().removeToast(id), duration)
  },

  removeToast: (id) => {
    set({ toasts: get().toasts.filter((t) => t.id !== id) })
  },
}))

// Convenience helpers
export const toast = {
  success: (msg: string) => useToastStore.getState().addToast('success', msg),
  error: (msg: string) => useToastStore.getState().addToast('error', msg, 5000),
  info: (msg: string) => useToastStore.getState().addToast('info', msg),
}
