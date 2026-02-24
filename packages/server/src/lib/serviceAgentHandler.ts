import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '../db/index.js'
import { serviceAgents, messages } from '../db/schema.js'
import { decryptSecret } from './crypto.js'
import { connectionManager } from '../ws/connections.js'
import { createLogger } from './logger.js'
import { incCounter } from './metrics.js'

const log = createLogger('ServiceAgentHandler')

interface ServiceAgentConfig {
  baseUrl: string
  apiKey: string
  model: string
  systemPrompt?: string
  maxTokens?: number
}

/**
 * Handle a @mention of a service agent in a room message.
 * Calls the configured OpenAI-compatible API and broadcasts the response.
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

  let config: ServiceAgentConfig
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
    const apiMessages: Array<{ role: string; content: string }> = []
    if (config.systemPrompt) {
      apiMessages.push({ role: 'system', content: config.systemPrompt })
    }
    apiMessages.push({ role: 'user', content: `[${senderName}]: ${triggerMessageContent}` })

    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: apiMessages,
        max_tokens: config.maxTokens ?? 4096,
      }),
      signal: AbortSignal.timeout(60_000), // 60s timeout
    })

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error')
      log.error(`Service agent API call failed (${response.status}): ${errorText}`)
      // Update agent status to error
      await db
        .update(serviceAgents)
        .set({ status: 'error', updatedAt: new Date().toISOString() })
        .where(eq(serviceAgents.id, serviceAgentId))
      return
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }

    const content = data.choices?.[0]?.message?.content
    if (!content) {
      log.warn(`Service agent ${serviceAgentId} returned empty response`)
      return
    }

    // Save the response as a message
    const messageId = nanoid()
    const now = new Date().toISOString()

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

    // Broadcast to room
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
  } catch (err) {
    log.error(`Service agent ${serviceAgentId} API call error: ${(err as Error).message}`)
  }
}
