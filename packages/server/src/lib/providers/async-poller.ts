import { nanoid } from 'nanoid'
import { db } from '../../db/index.js'
import { messages } from '../../db/schema.js'
import { connectionManager } from '../../ws/connections.js'
import { createLogger } from '../logger.js'
import { incCounter } from '../metrics.js'
import type { AsyncTaskResult, ServiceAgentProvider, MediaResult, TextResult } from './types.js'
import { downloadAndStoreMedia } from './media-storage.js'

const log = createLogger('AsyncPoller')

interface AsyncTaskInfo {
  taskId: string
  serviceAgentId: string
  serviceAgentName: string
  roomId: string
  config: unknown
  provider: ServiceAgentProvider
  statusMessageId: string
  startedAt: number
  maxWaitMs: number
  timer: ReturnType<typeof setInterval>
  maxTimeout: ReturnType<typeof setTimeout>
}

const activeTasks = new Map<string, AsyncTaskInfo>()
const MAX_ACTIVE_TASKS = 100

export function getActiveTaskCount(): number {
  return activeTasks.size
}

export async function startAsyncTaskPolling(
  serviceAgentId: string,
  serviceAgentName: string,
  roomId: string,
  task: AsyncTaskResult,
  config: unknown,
  provider: ServiceAgentProvider,
): Promise<void> {
  if (activeTasks.size >= MAX_ACTIVE_TASKS) {
    throw new Error('Too many active async tasks')
  }

  if (!provider.poll) {
    throw new Error(`Provider does not support polling`)
  }

  // Send a "generating..." status message to the room
  const statusMessageId = nanoid()
  const now = new Date().toISOString()

  await db.insert(messages).values({
    id: statusMessageId,
    roomId,
    senderId: serviceAgentId,
    senderType: 'agent',
    senderName: serviceAgentName,
    type: 'agent_response',
    content: task.statusMessage,
    mentions: [],
    createdAt: now,
  })

  connectionManager.broadcastToRoom(roomId, {
    type: 'server:new_message',
    message: {
      id: statusMessageId,
      roomId,
      senderId: serviceAgentId,
      senderType: 'agent' as const,
      senderName: serviceAgentName,
      type: 'agent_response' as const,
      content: task.statusMessage,
      mentions: [] as string[],
      createdAt: now,
    },
  })

  // Start polling
  const taskKey = `${serviceAgentId}:${task.taskId}`
  const cleanupTask = () => {
    const info = activeTasks.get(taskKey)
    if (info) {
      clearInterval(info.timer)
      clearTimeout(info.maxTimeout)
      activeTasks.delete(taskKey)
    }
  }

  const timer = setInterval(async () => {
    try {
      const result = await provider.poll!(config, task.taskId)

      if (result.kind === 'async') {
        // Still processing, do nothing (status already shown)
        return
      }

      // Task completed — cleanup and broadcast result
      cleanupTask()
      await broadcastResult(serviceAgentId, serviceAgentName, roomId, result)
    } catch (err) {
      log.error(`Async poll error for ${taskKey}: ${(err as Error).message}`)
      cleanupTask()
      await broadcastError(serviceAgentId, serviceAgentName, roomId, (err as Error).message)
    }
  }, task.pollIntervalMs)

  // Set up max timeout
  const maxTimeout = setTimeout(() => {
    cleanupTask()
    broadcastError(serviceAgentId, serviceAgentName, roomId, 'Generation timed out').catch((e) =>
      log.error(`Timeout broadcast error: ${(e as Error).message}`),
    )
  }, task.maxWaitMs)

  // Prevent timeout from keeping process alive
  maxTimeout.unref?.()

  activeTasks.set(taskKey, {
    taskId: task.taskId,
    serviceAgentId,
    serviceAgentName,
    roomId,
    config,
    provider,
    statusMessageId,
    startedAt: Date.now(),
    maxWaitMs: task.maxWaitMs,
    timer,
    maxTimeout,
  })
}

async function broadcastResult(
  serviceAgentId: string,
  serviceAgentName: string,
  roomId: string,
  result: MediaResult | TextResult,
): Promise<void> {
  const messageId = nanoid()
  const now = new Date().toISOString()

  let content: string
  let attachmentData:
    | { id: string; filename: string; mimeType: string; size: number; url: string }
    | undefined

  if (result.kind === 'media') {
    // Download external media to local storage
    const stored = await downloadAndStoreMedia(result.url, result.filename, result.mimeType)
    content = result.caption ?? 'Generation complete'
    attachmentData = {
      id: nanoid(),
      filename: result.filename,
      mimeType: result.mimeType,
      size: stored.size,
      url: stored.url,
    }
  } else {
    content = result.content
  }

  await db.insert(messages).values({
    id: messageId,
    roomId,
    senderId: serviceAgentId,
    senderType: 'agent',
    senderName: serviceAgentName,
    type: 'agent_response',
    content,
    mentions: [],
    createdAt: now,
  })

  incCounter('agentim_messages_total', { type: 'service_agent' })

  const messagePayload = {
    id: messageId,
    roomId,
    senderId: serviceAgentId,
    senderType: 'agent' as const,
    senderName: serviceAgentName,
    type: 'agent_response' as const,
    content,
    mentions: [] as string[],
    attachments: attachmentData ? [{ ...attachmentData, messageId }] : undefined,
    createdAt: now,
  }

  connectionManager.broadcastToRoom(roomId, {
    type: 'server:new_message',
    message: messagePayload,
  })
}

async function broadcastError(
  serviceAgentId: string,
  serviceAgentName: string,
  roomId: string,
  error: string,
): Promise<void> {
  const messageId = nanoid()
  const now = new Date().toISOString()

  const content = `Generation failed: ${error}`

  await db.insert(messages).values({
    id: messageId,
    roomId,
    senderId: serviceAgentId,
    senderType: 'agent',
    senderName: serviceAgentName,
    type: 'agent_response',
    content,
    mentions: [],
    createdAt: now,
  })

  connectionManager.broadcastToRoom(roomId, {
    type: 'server:new_message',
    message: {
      id: messageId,
      roomId,
      senderId: serviceAgentId,
      senderType: 'agent' as const,
      senderName: serviceAgentName,
      type: 'agent_response' as const,
      content,
      mentions: [] as string[],
      createdAt: now,
    },
  })
}

/** Clean up all active tasks on shutdown */
export function cleanupActiveTasks(): void {
  for (const [key, info] of activeTasks) {
    clearInterval(info.timer)
    clearTimeout(info.maxTimeout)
    activeTasks.delete(key)
  }
}
