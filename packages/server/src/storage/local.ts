import { resolve } from 'node:path'
import { writeFile, readFile, unlink, readdir, access, constants } from 'node:fs/promises'
import type { StorageAdapter } from './types.js'

export class LocalStorageAdapter implements StorageAdapter {
  private baseDir: string

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir)
  }

  private safePath(key: string): string {
    const full = resolve(this.baseDir, key)
    if (!full.startsWith(this.baseDir + '/') && full !== this.baseDir) {
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
