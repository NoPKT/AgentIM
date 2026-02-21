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

// Initial singleton (used as startup fallback)
export const storage = createStorage()

// ─── Dynamic Storage (lazy rebuild on config change) ───

let _currentAdapter: StorageAdapter = storage
let _currentConfigHash = ''
let _getSettingSync: ((key: string) => string) | null = null

/**
 * Inject the settings module (called once at startup to avoid circular deps).
 */
export function _setStorageSettingsReader(fn: (key: string) => string): void {
  _getSettingSync = fn
}

function computeStorageConfigHash(): string {
  if (!_getSettingSync) return ''
  const provider = _getSettingSync('storage.provider')
  if (provider === 's3') {
    return `s3:${_getSettingSync('storage.s3.bucket')}:${_getSettingSync('storage.s3.region')}:${_getSettingSync('storage.s3.endpoint')}`
  }
  return `local:${config.uploadDir}`
}

/**
 * Get the current storage adapter. Rebuilds automatically when the
 * admin changes storage settings (provider, S3 credentials, etc.).
 */
export function getStorage(): StorageAdapter {
  if (!_getSettingSync) return _currentAdapter

  const hash = computeStorageConfigHash()
  if (!hash || hash === _currentConfigHash) return _currentAdapter

  // Config changed → rebuild
  _currentConfigHash = hash
  try {
    const provider = _getSettingSync('storage.provider')
    if (provider === 's3') {
      _currentAdapter = new S3StorageAdapter({
        bucket: _getSettingSync('storage.s3.bucket'),
        region: _getSettingSync('storage.s3.region'),
        endpoint: _getSettingSync('storage.s3.endpoint'),
        accessKeyId: _getSettingSync('storage.s3.accessKeyId'),
        secretAccessKey: _getSettingSync('storage.s3.secretAccessKey'),
      })
    } else {
      _currentAdapter = new LocalStorageAdapter(config.uploadDir)
    }
  } catch {
    // Rebuild failed — keep current adapter
  }

  return _currentAdapter
}
