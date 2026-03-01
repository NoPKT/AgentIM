import { create } from 'zustand'
import type { WorkspaceStatus, DirectoryEntry } from '@agentim/shared'

export interface WorkspaceState {
  // Per-agent latest git status (from message chunks)
  statuses: Map<string, { data: WorkspaceStatus; workingDirectory: string; updatedAt: number }>
  // Per-agent directory listings cache (path → entries)
  trees: Map<string, Map<string, DirectoryEntry[]>>
  // Currently viewed file
  fileContent: {
    agentId: string
    path: string
    content: string
    size: number
    truncated: boolean
  } | null
  // Loading states
  loading: { agentId: string; kind: string } | null

  setStatus(agentId: string, data: WorkspaceStatus, workingDirectory: string): void
  setTree(agentId: string, path: string, entries: DirectoryEntry[]): void
  setFileContent(content: WorkspaceState['fileContent']): void
  setLoading(loading: WorkspaceState['loading']): void
  clear(): void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  statuses: new Map(),
  trees: new Map(),
  fileContent: null,
  loading: null,

  setStatus(agentId, data, workingDirectory) {
    set((state) => {
      const next = new Map(state.statuses)
      next.set(agentId, { data, workingDirectory, updatedAt: Date.now() })
      return { statuses: next }
    })
  },

  setTree(agentId, path, entries) {
    set((state) => {
      const next = new Map(state.trees)
      const agentTrees = new Map(next.get(agentId) ?? [])
      agentTrees.set(path, entries)
      next.set(agentId, agentTrees)
      return { trees: next }
    })
  },

  setFileContent(content) {
    set({ fileContent: content })
  },

  setLoading(loading) {
    set({ loading })
  },

  clear() {
    set({
      statuses: new Map(),
      trees: new Map(),
      fileContent: null,
      loading: null,
    })
  },
}))
