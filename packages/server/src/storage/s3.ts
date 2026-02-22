import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import type { StorageAdapter, ReadStreamResult } from './types.js'

export interface S3Config {
  bucket: string
  region: string
  endpoint?: string
  accessKeyId: string
  secretAccessKey: string
}

export class S3StorageAdapter implements StorageAdapter {
  private client: S3Client
  private bucket: string

  constructor(cfg: S3Config) {
    this.bucket = cfg.bucket
    this.client = new S3Client({
      region: cfg.region,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
      // Required for path-style access with R2/MinIO
      forcePathStyle: !!cfg.endpoint,
    })
  }

  async write(key: string, data: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      }),
    )
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    )
    const stream = res.Body
    if (!stream) throw new Error(`Empty response for key: ${key}`)
    // Convert readable stream to Buffer
    const chunks: Uint8Array[] = []
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  async readStream(key: string): Promise<ReadStreamResult> {
    const res = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    )
    const body = res.Body
    if (!body) throw new Error(`Empty response for key: ${key}`)
    return {
      stream: body.transformToWebStream() as ReadableStream<Uint8Array>,
      contentType: res.ContentType,
      contentLength: res.ContentLength,
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    )
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      )
      return true
    } catch (err: unknown) {
      if ((err as { name?: string }).name === 'NotFound') return false
      // Also handle the $metadata.httpStatusCode === 404 case
      if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404)
        return false
      throw err
    }
  }

  async list(prefix?: string): Promise<string[]> {
    const keys: string[] = []
    let continuationToken: string | undefined

    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          ...(prefix ? { Prefix: prefix } : {}),
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        }),
      )
      for (const obj of res.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key)
      }
      continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined
    } while (continuationToken)

    return keys
  }
}
