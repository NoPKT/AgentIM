import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkspaceStore } from './workspace'
import type { WorkspaceStatus } from '@agentim/shared'

const MOCK_STATUS: WorkspaceStatus = {
  branch: 'main',
  summary: { filesChanged: 1, additions: 5, deletions: 2 },
  changedFiles: [
    {
      path: 'src/index.ts',
      status: 'modified',
      additions: 5,
      deletions: 2,
    },
  ],
  recentCommits: [],
}

describe('useWorkspaceStore', () => {
  beforeEach(() => {
    useWorkspaceStore.getState().clear()
  })

  it('starts with empty state', () => {
    const state = useWorkspaceStore.getState()
    expect(state.statuses.size).toBe(0)
    expect(state.trees.size).toBe(0)
    expect(state.fileContent).toBeNull()
    expect(state.loading).toBeNull()
  })

  it('setStatus stores per-agent status', () => {
    useWorkspaceStore.getState().setStatus('agent1', MOCK_STATUS, '/home/user/project')
    const entry = useWorkspaceStore.getState().statuses.get('agent1')
    expect(entry).toBeDefined()
    expect(entry!.data!.branch).toBe('main')
    expect(entry!.workingDirectory).toBe('/home/user/project')
    expect(entry!.updatedAt).toBeGreaterThan(0)
  })

  it('setStatus overwrites previous status for same agent', () => {
    useWorkspaceStore.getState().setStatus('agent1', MOCK_STATUS, '/dir1')
    const updated: WorkspaceStatus = { ...MOCK_STATUS, branch: 'develop' }
    useWorkspaceStore.getState().setStatus('agent1', updated, '/dir2')
    expect(useWorkspaceStore.getState().statuses.size).toBe(1)
    expect(useWorkspaceStore.getState().statuses.get('agent1')!.data!.branch).toBe('develop')
  })

  it('setStatus supports multiple agents', () => {
    useWorkspaceStore.getState().setStatus('agent1', MOCK_STATUS, '/dir1')
    useWorkspaceStore.getState().setStatus('agent2', MOCK_STATUS, '/dir2')
    expect(useWorkspaceStore.getState().statuses.size).toBe(2)
  })

  it('setTree stores directory entries per agent and path', () => {
    const entries = [
      { name: 'src', type: 'directory' as const },
      { name: 'README.md', type: 'file' as const, size: 1024 },
    ]
    useWorkspaceStore.getState().setTree('agent1', '/', entries)
    const agentTrees = useWorkspaceStore.getState().trees.get('agent1')
    expect(agentTrees).toBeDefined()
    expect(agentTrees!.get('/')).toEqual(entries)
  })

  it('setTree supports multiple paths for same agent', () => {
    const rootEntries = [{ name: 'src', type: 'directory' as const }]
    const srcEntries = [{ name: 'index.ts', type: 'file' as const, size: 256 }]
    useWorkspaceStore.getState().setTree('agent1', '/', rootEntries)
    useWorkspaceStore.getState().setTree('agent1', '/src', srcEntries)
    const agentTrees = useWorkspaceStore.getState().trees.get('agent1')
    expect(agentTrees!.size).toBe(2)
    expect(agentTrees!.get('/')!).toEqual(rootEntries)
    expect(agentTrees!.get('/src')!).toEqual(srcEntries)
  })

  it('setFileContent stores file content', () => {
    const content = {
      agentId: 'agent1',
      path: '/src/index.ts',
      content: 'console.log("hello")',
      size: 20,
      truncated: false,
    }
    useWorkspaceStore.getState().setFileContent(content)
    expect(useWorkspaceStore.getState().fileContent).toEqual(content)
  })

  it('setFileContent can be set to null', () => {
    useWorkspaceStore.getState().setFileContent({
      agentId: 'a',
      path: '/x',
      content: 'x',
      size: 1,
      truncated: false,
    })
    useWorkspaceStore.getState().setFileContent(null)
    expect(useWorkspaceStore.getState().fileContent).toBeNull()
  })

  it('setLoading stores loading state', () => {
    useWorkspaceStore.getState().setLoading({ agentId: 'agent1', kind: 'tree' })
    expect(useWorkspaceStore.getState().loading).toEqual({ agentId: 'agent1', kind: 'tree' })
  })

  it('setLoading can be cleared', () => {
    useWorkspaceStore.getState().setLoading({ agentId: 'agent1', kind: 'status' })
    useWorkspaceStore.getState().setLoading(null)
    expect(useWorkspaceStore.getState().loading).toBeNull()
  })

  it('clear resets all state', () => {
    useWorkspaceStore.getState().setStatus('agent1', MOCK_STATUS, '/dir')
    useWorkspaceStore.getState().setTree('agent1', '/', [])
    useWorkspaceStore.getState().setFileContent({
      agentId: 'a',
      path: '/x',
      content: 'x',
      size: 1,
      truncated: false,
    })
    useWorkspaceStore.getState().setLoading({ agentId: 'a', kind: 'file' })

    useWorkspaceStore.getState().clear()

    const state = useWorkspaceStore.getState()
    expect(state.statuses.size).toBe(0)
    expect(state.trees.size).toBe(0)
    expect(state.fileContent).toBeNull()
    expect(state.loading).toBeNull()
  })
})
