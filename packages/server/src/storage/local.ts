import { resolve, sep } from 'node:path'
import { createReadStream } from 'node:fs'
import { writeFile, readFile, unlink, readdir, access, stat, constants } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { StorageAdapter, ReadStreamResult } from './types.js'

export class LocalStorageAdapter implements StorageAdapter {
  private baseDir: string

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir)
  }

  private safePath(key: string): string {
    const full = resolve(this.baseDir, key)
    if (!full.startsWith(this.baseDir + sep) && full !== this.baseDir) {
      throw new Error('Path traversal detected')
    }
    return full
  }

  async write(key: string, data: Buffer): Promise<void> {
    await writeFile(this.safePath(key), data)
  }

  async read(key: string): Promise<Buffer> {
    return readFile(this.safePath(key))
  }

  async readStream(key: string): Promise<ReadStreamResult> {
    const filePath = this.safePath(key)
    const fileStat = await stat(filePath)
    const nodeStream = createReadStream(filePath)
    return {
      stream: Readable.toWeb(nodeStream) as ReadableStream<Uint8Array>,
      contentLength: fileStat.size,
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.safePath(key))
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.safePath(key), constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const files = await readdir(this.baseDir)
    if (!prefix) return files
    return files.filter((f) => f.startsWith(prefix))
  }
}
