import { create } from 'zustand'

interface TokenVersionState {
  version: number
  bump: () => void
}

export const useTokenVersionStore = create<TokenVersionState>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}))
