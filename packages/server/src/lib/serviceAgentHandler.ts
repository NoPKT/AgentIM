import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '../db/index.js'
import { serviceAgents, messages } from '../db/schema.js'
import { decryptSecret } from './crypto.js'
import { connectionManager } from '../ws/connections.js'
import { createLogger } from './logger.js'
import { incCounter } from './metrics.js'
import { getProvider } from './providers/registry.js'
import { startAsyncTaskPolling } from './providers/async-poller.js'
import { downloadAndStoreMedia, createMediaAttachment } from './providers/media-storage.js'

const log = createLogger('ServiceAgentHandler')

/**
 * Handle a @mention of a service agent in a room message.
 * Dispatches to the appropriate provider based on agent type.
 */
export async function handleServiceAgentMention(
  serviceAgentId: string,
  roomId: string,
  triggerMessageContent: string,
  senderName: string,
): Promise<void> {
  const [sa] = await db
    .select()
    .from(serviceAgents)
    .where(eq(serviceAgents.id, serviceAgentId))
    .limit(1)

  if (!sa || sa.status !== 'active') {
    log.warn(`Service agent ${serviceAgentId} not found or inactive`)
    return
  }

  const provider = getProvider(sa.type)
  if (!provider) {
    log.error(`No provider found for service agent type: ${sa.type}`)
    return
  }

  let config: Record<string, unknown>
  try {
    const decrypted = decryptSecret(sa.configEncrypted)
    if (!decrypted) {
      log.error(`Failed to decrypt config for service agent ${serviceAgentId}`)
      return
    }
    config = JSON.parse(decrypted)
  } catch (err) {
    log.error(`Invalid config for service agent ${serviceAgentId}: ${(err as Error).message}`)
    return
  }

  try {
    const result = await provider.invoke(config, {
      prompt: triggerMessageContent,
      senderName,
      systemPrompt: (config.systemPrompt as string) ?? undefined,
    })

    switch (result.kind) {
      case 'text': {
        if (!result.content) {
          log.warn(`Service agent ${serviceAgentId} returned empty response`)
          return
        }

        const messageId = nanoid()
        const now = new Date().toISOString()
        let content = result.content

        // Append citations if present (search providers)
        if (result.citations?.length) {
          content +=
            '\n\n---\n**Sources:**\n' +
            result.citations.map((url, i) => `${i + 1}. ${url}`).join('\n')
        }

        await db.insert(messages).values({
          id: messageId,
          roomId,
          senderId: serviceAgentId,
          senderType: 'agent',
          senderName: sa.name,
          type: 'agent_response',
          content,
          mentions: [],
          createdAt: now,
        })

        incCounter('agentim_messages_total', { type: 'service_agent' })

        connectionManager.broadcastToRoom(roomId, {
          type: 'server:new_message',
          message: {
            id: messageId,
            roomId,
            senderId: serviceAgentId,
            senderType: 'agent' as const,
            senderName: sa.name,
            type: 'agent_response' as const,
            content,
            mentions: [] as string[],
            createdAt: now,
          },
        })
        break
      }

      case 'media': {
        // Download media to local storage
        const stored = await downloadAndStoreMedia(result.url, result.filename, result.mimeType)

        const messageId = nanoid()
        const now = new Date().toISOString()
        const content = result.caption ?? 'Generation complete'

        await db.insert(messages).values({
          id: messageId,
          roomId,
          senderId: serviceAgentId,
          senderType: 'agent',
          senderName: sa.name,
          type: 'agent_response',
          content,
          mentions: [],
          createdAt: now,
        })

        // Create attachment record
        const attachmentId = await createMediaAttachment(
          messageId,
          stored,
          result.filename,
          result.mimeType,
        )

        incCounter('agentim_messages_total', { type: 'service_agent' })

        connectionManager.broadcastToRoom(roomId, {
          type: 'server:new_message',
          message: {
            id: messageId,
            roomId,
            senderId: serviceAgentId,
            senderType: 'agent' as const,
            senderName: sa.name,
            type: 'agent_response' as const,
            content,
            mentions: [] as string[],
            attachments: [
              {
                id: attachmentId,
                messageId,
                filename: result.filename,
                mimeType: result.mimeType,
                size: stored.size,
                url: stored.url,
              },
            ],
            createdAt: now,
          },
        })
        break
      }

      case 'async': {
        await startAsyncTaskPolling(serviceAgentId, sa.name, roomId, result, config, provider)
        break
      }
    }
  } catch (err) {
    log.error(`Service agent ${serviceAgentId} error: ${(err as Error).message}`)
    // Update agent status to error
    await db
      .update(serviceAgents)
      .set({ status: 'error', updatedAt: new Date().toISOString() })
      .where(eq(serviceAgents.id, serviceAgentId))
  }
}
