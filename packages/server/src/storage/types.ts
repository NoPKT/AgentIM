export interface StorageAdapter {
  write(key: string, data: Buffer, contentType: string): Promise<void>
  read(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  list(prefix?: string): Promise<string[]>
}
