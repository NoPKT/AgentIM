import { config } from '../config.js'
import { LocalStorageAdapter } from './local.js'
import { S3StorageAdapter } from './s3.js'
import type { StorageAdapter } from './types.js'

export type { StorageAdapter }

export function createStorage(): StorageAdapter {
  if (config.storageProvider === 's3') {
    return new S3StorageAdapter(config.s3)
  }
  return new LocalStorageAdapter(config.uploadDir)
}

export const storage = createStorage()
