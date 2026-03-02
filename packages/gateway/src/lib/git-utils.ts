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
    const [branch, numstatOutput, diffContent, logOutput, statusOutput] = await Promise.all([
      execGit(['rev-parse', '--abbrev-ref', 'HEAD'], workingDirectory),
      execGit(['diff', '--numstat', '--no-renames', 'HEAD'], workingDirectory).catch(() => ''),
      execGit(['diff', '--no-renames', 'HEAD'], workingDirectory).catch(() => ''),
      execGit(['log', '--oneline', '-3'], workingDirectory).catch(() => ''),
      execGit(['status', '--porcelain', '--no-renames'], workingDirectory).catch(() => ''),
    ])

    // ── 1. Parse git status — the SOLE authoritative source for file paths ──

    const statusFiles = new Map<string, string>()
    for (const line of statusOutput.split('\n').filter(Boolean)) {
      const code = line.slice(0, 2).trim()
      const path = line.slice(3).trim()
      if (path) statusFiles.set(path, code)
    }

    if (statusFiles.size === 0) return null

    // ── 2. Parse diff --numstat for exact per-file counts ──
    // Format: "ADDITIONS\tDELETIONS\tPATH" (tab-separated, "-" for binary)
    // We match numstat paths to git status paths; numstat paths are NEVER used directly.

    const statCounts = new Map<string, { additions: number; deletions: number }>()
    let totalAdditions = 0
    let totalDeletions = 0

    for (const line of numstatOutput.split('\n').filter(Boolean)) {
      const parts = line.split('\t')
      if (parts.length < 3) continue
      const [addStr, delStr, ...pathParts] = parts
      const filePath = pathParts.join('\t') // Handle paths with tabs (rare but possible)
      if (addStr === '-' || delStr === '-') continue // Binary file
      const additions = parseInt(addStr) || 0
      const deletions = parseInt(delStr) || 0
      totalAdditions += additions
      totalDeletions += deletions

      // Match numstat path to git status path (exact match only)
      if (statusFiles.has(filePath)) {
        statCounts.set(filePath, { additions, deletions })
      }
    }

    // ── 3. Parse per-file diffs ──

    const truncatedDiff =
      diffContent.length > MAX_DIFF_SIZE ? diffContent.slice(0, MAX_DIFF_SIZE) : diffContent

    const fileDiffs = truncatedDiff ? splitDiffByFile(truncatedDiff) : new Map<string, string>()

    // ── 4. Build changedFiles from git status paths (authoritative) ──

    const changedFiles: WorkspaceFileChange[] = []

    for (const [path, code] of statusFiles) {
      let status: WorkspaceFileChange['status'] = 'modified'
      if (code === '??' || code.startsWith('A')) status = 'added'
      else if (code.startsWith('D')) status = 'deleted'

      const counts = statCounts.get(path)
      // Look up diff by exact path; also try as the b/ side may differ
      const diff = !isSensitivePath(path) ? fileDiffs.get(path) : undefined

      changedFiles.push({
        path,
        status,
        additions: counts?.additions,
        deletions: counts?.deletions,
        diff,
      })
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

/** Split a unified diff string into per-file diffs, keyed by file path */
function splitDiffByFile(diff: string): Map<string, string> {
  const result = new Map<string, string>()
  // Match diff headers: "diff --git a/PATH b/PATH"
  // With --no-renames the a/ and b/ paths are identical.
  // We extract the b/ path (group 2) as the canonical key, and also
  // store the a/ path (group 1) as a fallback key for robustness.
  const filePattern = /^diff --git a\/(.+?) b\/(.+?)$/gm
  const matches: { aPath: string; bPath: string; start: number }[] = []

  let m: RegExpExecArray | null
  while ((m = filePattern.exec(diff)) !== null) {
    matches.push({ aPath: m[1], bPath: m[2], start: m.index })
  }

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].start
    const end = i + 1 < matches.length ? matches[i + 1].start : diff.length
    const chunk = diff.slice(start, end).trim()
    // Store under both b/ path and a/ path for maximum lookup success
    result.set(matches[i].bPath, chunk)
    if (matches[i].aPath !== matches[i].bPath) {
      result.set(matches[i].aPath, chunk)
    }
  }

  return result
}
