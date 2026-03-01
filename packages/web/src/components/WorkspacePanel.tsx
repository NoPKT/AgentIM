import { useState, useCallback, useMemo, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspaceStore } from '../stores/workspace.js'
import { wsClient } from '../lib/ws.js'
import { CloseIcon, RefreshIcon, FolderIcon, FileIcon } from './icons.js'
import type { RoomMember, WorkspaceFileChange } from '@agentim/shared'

// ─── Shared sub-components (from former ChunkBlocks workspace rendering) ───

function FileStatusIcon({ status }: { status: WorkspaceFileChange['status'] }) {
  switch (status) {
    case 'added':
      return <span className="text-green-500 font-bold text-xs">A</span>
    case 'modified':
      return <span className="text-yellow-500 font-bold text-xs">M</span>
    case 'deleted':
      return <span className="text-red-500 font-bold text-xs">D</span>
    case 'renamed':
      return <span className="text-blue-500 font-bold text-xs">R</span>
    default:
      return <span className="text-gray-500 font-bold text-xs">?</span>
  }
}

type DiffRow = {
  type: 'hunk' | 'add' | 'del' | 'ctx'
  old?: number
  new?: number
  text: string
}

function DiffView({ diff }: { diff: string }) {
  const lines = diff.split('\n')
  let oldLine = 0
  let newLine = 0
  const rows: DiffRow[] = []

  for (const line of lines) {
    if (
      line.startsWith('diff --git') ||
      line.startsWith('index ') ||
      line.startsWith('--- ') ||
      line.startsWith('+++ ')
    ) {
      continue
    }
    if (line.startsWith('@@')) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/)
      if (m) {
        oldLine = +m[1]
        newLine = +m[2]
      }
      const context = m?.[3]?.trim()
      rows.push({
        type: 'hunk',
        text: context ? `\u00B7\u00B7\u00B7 ${context}` : '\u00B7\u00B7\u00B7',
      })
    } else if (line.startsWith('+')) {
      rows.push({ type: 'add', new: newLine++, text: line.slice(1) })
    } else if (line.startsWith('-')) {
      rows.push({ type: 'del', old: oldLine++, text: line.slice(1) })
    } else {
      rows.push({
        type: 'ctx',
        old: oldLine++,
        new: newLine++,
        text: line.startsWith(' ') ? line.slice(1) : line,
      })
    }
  }

  return (
    <div className="overflow-x-auto max-h-60 overflow-y-auto rounded-md border border-border">
      <table className="text-xs font-mono w-full border-collapse">
        <tbody>
          {rows.map((r, i) => {
            const rowBg =
              r.type === 'add'
                ? 'bg-green-500/10'
                : r.type === 'del'
                  ? 'bg-red-500/10'
                  : r.type === 'hunk'
                    ? 'bg-blue-500/10'
                    : ''
            const textCls =
              r.type === 'add'
                ? 'text-green-700 dark:text-green-300'
                : r.type === 'del'
                  ? 'text-red-700 dark:text-red-300'
                  : r.type === 'hunk'
                    ? 'text-blue-600 dark:text-blue-400'
                    : ''
            return (
              <tr key={i} className={rowBg}>
                <td className="select-none text-right pr-2 pl-2 text-text-muted/50 w-[1%] whitespace-nowrap">
                  {r.old ?? ''}
                </td>
                <td className="select-none text-right pr-2 text-text-muted/50 w-[1%] whitespace-nowrap border-r border-border">
                  {r.new ?? ''}
                </td>
                <td
                  className={`px-2 whitespace-pre ${textCls} ${r.type === 'hunk' ? 'italic' : ''}`}
                >
                  {r.text}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function WorkspaceFileItem({ file }: { file: WorkspaceFileChange }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        onClick={() => file.diff && setExpanded(!expanded)}
        aria-expanded={file.diff ? expanded : undefined}
        className="flex items-center gap-2 text-xs w-full text-left py-0.5 hover:bg-surface-hover rounded px-1"
      >
        <FileStatusIcon status={file.status} />
        <span className="font-mono truncate flex-1">{file.path}</span>
        {file.additions != null && file.additions > 0 && (
          <span className="text-green-500 text-xs">+{file.additions}</span>
        )}
        {file.deletions != null && file.deletions > 0 && (
          <span className="text-red-500 text-xs">-{file.deletions}</span>
        )}
        {file.diff && (
          <svg
            className={`w-3 h-3 text-text-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        )}
      </button>
      {expanded && file.diff && (
        <div className="ml-5 mt-1 mb-2">
          <DiffView diff={file.diff} />
        </div>
      )}
    </div>
  )
}

// ─── Changes Tab ───

function WorkspaceChangesView({ roomId, agentId }: { roomId: string; agentId: string }) {
  const { t } = useTranslation()
  const statusEntry = useWorkspaceStore((s) => s.statuses.get(agentId))
  const loading = useWorkspaceStore((s) => s.loading)

  // Auto-request workspace status when no data exists
  useEffect(() => {
    if (!statusEntry && !(loading?.agentId === agentId && loading?.kind === 'status')) {
      useWorkspaceStore.getState().setLoading({ agentId, kind: 'status' })
      wsClient.send({
        type: 'client:request_workspace',
        roomId,
        agentId,
        request: { kind: 'status' },
      })
    }
  }, [roomId, agentId])

  if (!statusEntry) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-text-muted p-4">
        {loading?.agentId === agentId && loading?.kind === 'status'
          ? t('chat.workspaceLoading')
          : t('chat.workspaceNoData')}
      </div>
    )
  }

  const { data: status } = statusEntry

  if (status.changedFiles.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-text-muted p-4">
        {t('chat.noChanges')}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-1">
      {/* Branch + summary */}
      <div className="flex items-center gap-3 text-xs text-text-secondary mb-2">
        <span className="font-medium">{t('chat.workspaceBranch', { branch: status.branch })}</span>
        <span>{t('chat.filesChanged', { count: status.summary.filesChanged })}</span>
        <span className="text-green-500">+{status.summary.additions}</span>
        <span className="text-red-500">-{status.summary.deletions}</span>
      </div>

      {/* File list */}
      {status.changedFiles.map((file, i) => (
        <WorkspaceFileItem key={i} file={file} />
      ))}

      {/* Recent commits */}
      {status.recentCommits && status.recentCommits.length > 0 && (
        <div className="mt-3 pt-2 border-t border-border">
          <div className="text-xs font-medium text-text-secondary mb-1">
            {t('chat.recentCommits')}
          </div>
          {status.recentCommits.map((commit, i) => (
            <div key={i} className="flex items-center gap-2 text-xs py-0.5">
              <code className="text-orange-500 font-mono">{commit.hash}</code>
              <span className="text-text-secondary truncate">{commit.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Files Tab ───

function WorkspaceFilesView({ roomId, agentId }: { roomId: string; agentId: string }) {
  const { t } = useTranslation()
  const [currentPath, setCurrentPath] = useState('.')
  const trees = useWorkspaceStore((s) => s.trees.get(agentId))
  const fileContent = useWorkspaceStore((s) => s.fileContent)
  const loading = useWorkspaceStore((s) => s.loading)
  const entries = trees?.get(currentPath)

  const requestTree = useCallback(
    (path: string) => {
      useWorkspaceStore.getState().setLoading({ agentId, kind: 'tree' })
      wsClient.send({
        type: 'client:request_workspace',
        roomId,
        agentId,
        request: { kind: 'tree', path: path === '.' ? undefined : path },
      })
      setCurrentPath(path)
    },
    [roomId, agentId],
  )

  const requestFile = useCallback(
    (path: string) => {
      useWorkspaceStore.getState().setLoading({ agentId, kind: 'file' })
      useWorkspaceStore.getState().setFileContent(null)
      wsClient.send({
        type: 'client:request_workspace',
        roomId,
        agentId,
        request: { kind: 'file', path },
      })
    },
    [roomId, agentId],
  )

  // Initial load — must be in useEffect, not during render
  useEffect(() => {
    if (!entries && !(loading?.agentId === agentId && loading?.kind === 'tree')) {
      requestTree('.')
    }
  }, [agentId])

  const isLoadingTree = loading?.agentId === agentId && loading?.kind === 'tree'
  const isLoadingFile = loading?.agentId === agentId && loading?.kind === 'file'

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Directory tree */}
      <div className="w-64 border-r border-border overflow-y-auto p-2 flex-shrink-0">
        {/* Parent directory button */}
        {currentPath !== '.' && (
          <button
            onClick={() => {
              const parts = currentPath.split('/')
              parts.pop()
              requestTree(parts.length > 0 ? parts.join('/') : '.')
            }}
            className="flex items-center gap-2 text-xs w-full text-left py-1 px-2 hover:bg-surface-hover rounded text-text-secondary"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            <span>{t('chat.workspaceParentDir')}</span>
          </button>
        )}

        {isLoadingTree ? (
          <div className="text-xs text-text-muted p-2">{t('chat.workspaceLoading')}</div>
        ) : entries ? (
          entries.length === 0 ? (
            <div className="text-xs text-text-muted p-2">{t('chat.workspaceEmptyDir')}</div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.name}
                onClick={() => {
                  const entryPath =
                    currentPath === '.' ? entry.name : `${currentPath}/${entry.name}`
                  if (entry.type === 'directory') {
                    requestTree(entryPath)
                  } else {
                    requestFile(entryPath)
                  }
                }}
                className="flex items-center gap-2 text-xs w-full text-left py-1 px-2 hover:bg-surface-hover rounded"
              >
                {entry.type === 'directory' ? (
                  <FolderIcon className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0" />
                ) : (
                  <FileIcon className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
                )}
                <span className="truncate flex-1">{entry.name}</span>
                {entry.size != null && entry.type === 'file' && (
                  <span className="text-text-muted text-[10px]">
                    {entry.size > 1024 ? `${Math.round(entry.size / 1024)}KB` : `${entry.size}B`}
                  </span>
                )}
              </button>
            ))
          )
        ) : null}
      </div>

      {/* File viewer */}
      <div className="flex-1 overflow-y-auto p-3">
        {isLoadingFile ? (
          <div className="text-xs text-text-muted">{t('chat.workspaceLoading')}</div>
        ) : fileContent && fileContent.agentId === agentId ? (
          <div>
            <div className="flex items-center gap-2 text-xs text-text-secondary mb-2">
              <span className="font-mono">{fileContent.path}</span>
              <span className="text-text-muted">
                (
                {fileContent.size > 1024
                  ? `${Math.round(fileContent.size / 1024)}KB`
                  : `${fileContent.size}B`}
                )
              </span>
              {fileContent.truncated && (
                <span className="text-warning-text">{t('chat.workspaceFileTooBig')}</span>
              )}
            </div>
            <pre className="text-xs font-mono bg-surface-secondary rounded-md p-3 overflow-x-auto whitespace-pre-wrap">
              {fileContent.content}
            </pre>
          </div>
        ) : (
          <div className="text-xs text-text-muted">{t('chat.workspaceNoData')}</div>
        )}
      </div>
    </div>
  )
}

// ─── Main Panel ───

interface WorkspacePanelProps {
  roomId: string
  agentMembers: RoomMember[]
  onClose: () => void
}

export function WorkspacePanel({ roomId, agentMembers, onClose }: WorkspacePanelProps) {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<'changes' | 'files'>('changes')
  const [selectedAgentId, setSelectedAgentId] = useState<string>(agentMembers[0]?.memberId ?? '')
  const loading = useWorkspaceStore((s) => s.loading)

  // Clear loading state after 15s timeout to prevent permanent "Loading..."
  useEffect(() => {
    if (!loading) return
    const timer = setTimeout(() => {
      useWorkspaceStore.getState().setLoading(null)
    }, 15_000)
    return () => clearTimeout(timer)
  }, [loading])

  // Agent selector options
  const agentOptions = useMemo(
    () => agentMembers.map((m) => ({ id: m.memberId, name: m.displayName || m.memberId })),
    [agentMembers],
  )

  const handleRefresh = useCallback(() => {
    if (!selectedAgentId) return
    useWorkspaceStore.getState().setLoading({ agentId: selectedAgentId, kind: 'status' })
    wsClient.send({
      type: 'client:request_workspace',
      roomId,
      agentId: selectedAgentId,
      request: { kind: 'status' },
    })
  }, [roomId, selectedAgentId])

  if (agentMembers.length === 0) {
    return (
      <div className="border-t border-border bg-surface-secondary px-4 py-3">
        <p className="text-sm text-text-muted">{t('chat.workspaceNoAgents')}</p>
      </div>
    )
  }

  const isLoading = loading?.agentId === selectedAgentId

  return (
    <div className="border-t border-border flex flex-col h-72">
      {/* Header bar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-secondary border-b border-border flex-shrink-0">
        {/* Agent selector */}
        {agentOptions.length === 1 ? (
          <span className="text-xs font-medium text-text-primary truncate max-w-[120px]">
            {agentOptions[0].name}
          </span>
        ) : (
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            className="text-xs bg-surface border border-border rounded px-1.5 py-0.5 text-text-primary max-w-[150px]"
          >
            {agentOptions.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        )}

        {/* Tab switcher */}
        <div className="flex gap-0.5 ml-2">
          <button
            onClick={() => setActiveTab('changes')}
            className={`px-2 py-0.5 text-xs rounded ${
              activeTab === 'changes'
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:bg-surface-hover'
            }`}
          >
            {t('chat.workspaceChanges')}
          </button>
          <button
            onClick={() => setActiveTab('files')}
            className={`px-2 py-0.5 text-xs rounded ${
              activeTab === 'files'
                ? 'bg-accent text-white'
                : 'text-text-secondary hover:bg-surface-hover'
            }`}
          >
            {t('chat.workspaceFiles')}
          </button>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {/* Refresh */}
          <button
            onClick={handleRefresh}
            disabled={isLoading}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-secondary disabled:opacity-50"
            title={t('chat.workspaceRefresh')}
          >
            <RefreshIcon className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          {/* Close */}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-secondary"
            title={t('common.close')}
          >
            <CloseIcon className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'changes' && (
          <WorkspaceChangesView roomId={roomId} agentId={selectedAgentId} />
        )}
        {activeTab === 'files' && <WorkspaceFilesView roomId={roomId} agentId={selectedAgentId} />}
      </div>
    </div>
  )
}
