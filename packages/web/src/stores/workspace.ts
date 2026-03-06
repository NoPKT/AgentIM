import { create } from 'zustand'
import type { WorkspaceStatus, DirectoryEntry } from '@agentim/shared'

/** A file open request originating from a chat message link click. */
export interface PendingFile {
  agentId: string
  roomId: string
  path: string
  line?: number
}

export interface WorkspaceState {
  // Per-agent latest git status (from message chunks or explicit requests)
  statuses: Map<
    string,
    { data: WorkspaceStatus | null; workingDirectory: string; updatedAt: number }
  >
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
  // Pending file open request from a chat message link
  pendingFile: PendingFile | null

  setStatus(agentId: string, data: WorkspaceStatus | null, workingDirectory: string): void
  setTree(agentId: string, path: string, entries: DirectoryEntry[]): void
  setFileContent(content: WorkspaceState['fileContent']): void
  setLoading(loading: WorkspaceState['loading']): void
  /** Request to open a file from a chat message link. */
  openFile(agentId: string, roomId: string, path: string, line?: number): void
  clearPendingFile(): void
  clear(): void
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  statuses: new Map(),
  trees: new Map(),
  fileContent: null,
  loading: null,
  pendingFile: null,

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

  openFile(agentId, roomId, path, line) {
    set({ pendingFile: { agentId, roomId, path, line } })
    window.dispatchEvent(new CustomEvent('agentim:open_workspace_file'))
  },

  clearPendingFile() {
    set({ pendingFile: null })
  },

  clear() {
    set({
      statuses: new Map(),
      trees: new Map(),
      fileContent: null,
      loading: null,
      pendingFile: null,
    })
  },
}))
