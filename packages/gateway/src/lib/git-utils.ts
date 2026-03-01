import { execFile } from 'node:child_process'
import type { WorkspaceStatus, WorkspaceFileChange } from '@agentim/shared'
import { createLogger } from './logger.js'

const log = createLogger('GitUtils')
const EXEC_TIMEOUT = 10_000
const MAX_DIFF_SIZE = 500 * 1024 // 500KB

/** Patterns for files whose diffs should be excluded from workspace status */
const SENSITIVE_PATTERNS = [/\.env/i, /secret/i, /credential/i, /\.pem$/i, /\.key$/i, /password/i]

function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(path))
}

function execGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, timeout: EXEC_TIMEOUT, maxBuffer: 2 * 1024 * 1024 },
      (err, stdout) => {
        if (err) reject(err)
        else resolve(stdout.trim())
      },
    )
  })
}

export async function getWorkspaceStatus(
  workingDirectory: string,
): Promise<WorkspaceStatus | null> {
  try {
    // Check if this is a git repo
    await execGit(['rev-parse', '--is-inside-work-tree'], workingDirectory)
  } catch {
    return null
  }

  try {
    const [branch, diffStat, diffContent, logOutput] = await Promise.all([
      execGit(['rev-parse', '--abbrev-ref', 'HEAD'], workingDirectory),
      execGit(['diff', '--stat', 'HEAD'], workingDirectory).catch(() => ''),
      execGit(['diff', 'HEAD'], workingDirectory).catch(() => ''),
      execGit(['log', '--oneline', '-3'], workingDirectory).catch(() => ''),
    ])

    // Parse --stat output for file change summary
    const statLines = diffStat.split('\n').filter(Boolean)
    const changedFiles: WorkspaceFileChange[] = []
    const knownPaths = new Set<string>()
    let totalAdditions = 0
    let totalDeletions = 0

    for (const line of statLines) {
      // Skip the summary line (e.g. "3 files changed, 10 insertions(+), 5 deletions(-)")
      if (line.includes('file') && line.includes('changed')) {
        const addMatch = line.match(/(\d+) insertion/)
        const delMatch = line.match(/(\d+) deletion/)
        if (addMatch) totalAdditions = parseInt(addMatch[1])
        if (delMatch) totalDeletions = parseInt(delMatch[1])
        continue
      }

      // Parse individual file stat lines: " path/to/file | 5 ++--"
      const match = line.match(/^\s*(.+?)\s+\|\s+(\d+)\s*([+-]*)/)
      if (match) {
        let path = match[1].trim()
        const additions = (match[3].match(/\+/g) || []).length
        const deletions = (match[3].match(/-/g) || []).length

        let status: WorkspaceFileChange['status'] = 'modified'
        // Handle rename format: "old => new" or "{prefix/}{old => new}{/suffix}"
        if (path.includes('=>')) {
          status = 'renamed'
          const renameMatch = path.match(/\{(.*)=> (.+?)\}/)
          if (renameMatch) {
            // Format: prefix/{old => new}/suffix — show both names
            const prefix = path.slice(0, path.indexOf('{'))
            const suffix = path.slice(path.indexOf('}') + 1)
            const oldName = prefix + renameMatch[1].trim() + suffix
            const newName = prefix + renameMatch[2].trim() + suffix
            path = `${oldName} \u2192 ${newName}`
          } else {
            // Format: old => new — show both names
            const parts = path.split('=>')
            path = `${parts[0].trim()} \u2192 ${parts[1].trim()}`
          }
        }

        if (knownPaths.has(path)) continue
        knownPaths.add(path)

        changedFiles.push({
          path,
          status,
          additions,
          deletions,
          // diff is populated after parsing per-file diffs below
        })
      }
    }

    // Parse per-file diffs (truncate total to MAX_DIFF_SIZE)
    const truncatedDiff =
      diffContent.length > MAX_DIFF_SIZE ? diffContent.slice(0, MAX_DIFF_SIZE) : diffContent

    if (truncatedDiff) {
      const fileDiffs = splitDiffByFile(truncatedDiff)
      for (const file of changedFiles) {
        // For renames ("old → new"), try both the new name (used by diff --git b/)
        // and the full path for diff lookup
        const lookupPath =
          file.status === 'renamed' && file.path.includes(' \u2192 ')
            ? file.path.split(' \u2192 ').pop()!.trim()
            : file.path
        if (!isSensitivePath(lookupPath)) {
          file.diff = fileDiffs.get(lookupPath)
        }
      }
    }

    // Also check for untracked/added/deleted files via git status
    try {
      const statusOutput = await execGit(
        ['status', '--porcelain', '--no-renames'],
        workingDirectory,
      )
      for (const line of statusOutput.split('\n').filter(Boolean)) {
        const code = line.slice(0, 2).trim()
        const path = line.slice(3).trim()

        if (!knownPaths.has(path)) {
          knownPaths.add(path)
          let status: WorkspaceFileChange['status'] = 'modified'
          if (code === '??' || code.startsWith('A')) status = 'added'
          else if (code.startsWith('D')) status = 'deleted'
          changedFiles.push({ path, status })
        } else {
          const existing = changedFiles.find((f) => f.path === path)
          if (existing) {
            if (code.startsWith('D')) existing.status = 'deleted'
            else if (code === '??' || code.startsWith('A')) existing.status = 'added'
          }
        }
      }
    } catch {
      // git status failed, continue with diff-only info
    }

    // Parse recent commits
    const recentCommits = logOutput
      ? logOutput
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const spaceIdx = line.indexOf(' ')
            return {
              hash: line.slice(0, spaceIdx),
              message: line.slice(spaceIdx + 1),
            }
          })
      : undefined

    if (changedFiles.length === 0) {
      return null
    }

    return {
      branch,
      changedFiles,
      summary: {
        filesChanged: changedFiles.length,
        additions: totalAdditions,
        deletions: totalDeletions,
      },
      recentCommits,
    }
  } catch (err) {
    log.warn(`Failed to collect workspace status: ${(err as Error).message}`)
    return null
  }
}

/** Split a unified diff string into per-file diffs */
function splitDiffByFile(diff: string): Map<string, string> {
  const result = new Map<string, string>()
  const filePattern = /^diff --git a\/(.+?) b\/(.+?)$/gm
  const matches: { path: string; start: number }[] = []

  let m: RegExpExecArray | null
  while ((m = filePattern.exec(diff)) !== null) {
    matches.push({ path: m[2], start: m.index })
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start
    const end = i + 1 < matches.length ? matches[i + 1].start : diff.length
    result.set(matches[i].path, diff.slice(start, end).trim())
  }

  return result
}
