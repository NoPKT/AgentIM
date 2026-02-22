export interface ReadStreamResult {
  stream: ReadableStream<Uint8Array>
  contentType?: string
  contentLength?: number
}

export interface StorageAdapter {
  write(key: string, data: Buffer, contentType: string): Promise<void>
  read(key: string): Promise<Buffer>
  readStream(key: string): Promise<ReadStreamResult>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  list(prefix?: string): Promise<string[]>
}
