import { readdir, stat } from 'node:fs/promises'
import { resolve, relative, normalize } from 'node:path'
import type { DirectoryEntry } from '@agentim/shared'

const MAX_DIR_ENTRIES = 1000
const MAX_FILE_SIZE = 500 * 1024 // 500KB

/** Patterns for files whose content should be blocked */
const SENSITIVE_PATTERNS = [/\.env/i, /secret/i, /credential/i, /\.pem$/i, /\.key$/i, /password/i]

function isSensitivePath(path: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(path))
}

/** Ensure resolved path stays within basePath to prevent path traversal. */
function assertWithinBase(basePath: string, resolvedPath: string): void {
  const normalizedBase = normalize(basePath)
  const normalizedResolved = normalize(resolvedPath)
  if (!normalizedResolved.startsWith(normalizedBase)) {
    throw new Error('Path traversal detected')
  }
}

export async function getDirectoryListing(
  basePath: string,
  relativePath?: string,
): Promise<DirectoryEntry[]> {
  const targetPath = relativePath ? resolve(basePath, relativePath) : basePath
  assertWithinBase(basePath, targetPath)

  const dirents = await readdir(targetPath, { withFileTypes: true })

  const entries: DirectoryEntry[] = []
  for (const dirent of dirents) {
    // Exclude .git directory
    if (dirent.name === '.git') continue
    if (entries.length >= MAX_DIR_ENTRIES) break

    const entryType = dirent.isDirectory() ? 'directory' : 'file'
    const entry: DirectoryEntry = { name: dirent.name, type: entryType }

    if (entryType === 'file') {
      try {
        const fileStat = await stat(resolve(targetPath, dirent.name))
        entry.size = fileStat.size
      } catch {
        // Skip stat errors
      }
    }

    entries.push(entry)
  }

  // Sort: directories first, then alphabetical
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return entries
}

export async function getFileContent(
  basePath: string,
  relativePath: string,
  maxSize: number = MAX_FILE_SIZE,
): Promise<{ content: string; size: number; truncated: boolean }> {
  const targetPath = resolve(basePath, relativePath)
  assertWithinBase(basePath, targetPath)

  // Block sensitive files
  const relPath = relative(basePath, targetPath)
  if (isSensitivePath(relPath)) {
    throw new Error('Access denied: sensitive file')
  }

  const fileStat = await stat(targetPath)
  if (!fileStat.isFile()) {
    throw new Error('Not a file')
  }

  const truncated = fileStat.size > maxSize

  // Read the file (or just the first maxSize bytes)
  const { createReadStream } = await import('node:fs')
  const content = await new Promise<string>((res, reject) => {
    const chunks: Buffer[] = []
    let bytesRead = 0
    const stream = createReadStream(targetPath, { end: maxSize - 1 })
    stream.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
      bytesRead += chunk.length
    })
    stream.on('end', () => {
      const buf = Buffer.concat(chunks, bytesRead)
      // Detect binary: check for null bytes in first 8KB
      const checkLen = Math.min(buf.length, 8192)
      for (let i = 0; i < checkLen; i++) {
        if (buf[i] === 0) {
          res('[Binary file]')
          return
        }
      }
      res(buf.toString('utf-8'))
    })
    stream.on('error', reject)
  })

  return { content, size: fileStat.size, truncated }
}
