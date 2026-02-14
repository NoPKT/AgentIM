import type { WSContext } from 'hono/ws'
import { nanoid } from 'nanoid'
import { eq, and } from 'drizzle-orm'
import { gatewayMessageSchema } from '@agentim/shared'
import { connectionManager } from './connections.js'
import { verifyToken } from '../lib/jwt.js'
import { db } from '../db/index.js'
import { agents, gateways, messages, tasks } from '../db/schema.js'

const MAX_MESSAGE_SIZE = 256 * 1024 // 256 KB (gateway messages can be larger due to agent output)

export async function handleGatewayMessage(ws: WSContext, raw: string) {
  if (raw.length > MAX_MESSAGE_SIZE) return

  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }

  const parsed = gatewayMessageSchema.safeParse(data)
  if (!parsed.success) return

  const msg = parsed.data

  switch (msg.type) {
    case 'gateway:auth':
      return handleAuth(ws, msg)
    case 'gateway:register_agent':
      return handleRegisterAgent(ws, msg.agent)
    case 'gateway:unregister_agent':
      return handleUnregisterAgent(ws, msg.agentId)
    case 'gateway:message_chunk':
      return handleMessageChunk(ws, msg)
    case 'gateway:message_complete':
      return handleMessageComplete(ws, msg)
    case 'gateway:agent_status':
      return handleAgentStatus(ws, msg.agentId, msg.status)
    case 'gateway:terminal_data':
      return // Terminal data handling - Phase 2
    case 'gateway:task_update':
      return handleTaskUpdate(msg.taskId, msg.status, msg.result)
  }
}

async function handleAuth(
  ws: WSContext,
  msg: { token: string; gatewayId: string; deviceInfo: Record<string, string> },
) {
  try {
    const payload = await verifyToken(msg.token)
    if (payload.type !== 'access') {
      ws.send(
        JSON.stringify({
          type: 'server:gateway_auth_result',
          ok: false,
          error: 'Invalid token type',
        }),
      )
      return
    }

    connectionManager.addGateway(ws, payload.sub, msg.gatewayId)

    // Upsert gateway in DB
    const now = new Date().toISOString()
    const [existing] = await db
      .select()
      .from(gateways)
      .where(eq(gateways.id, msg.gatewayId))
      .limit(1)
    if (existing) {
      await db
        .update(gateways)
        .set({
          userId: payload.sub,
          connectedAt: now,
          disconnectedAt: null,
          hostname: msg.deviceInfo.hostname,
          platform: msg.deviceInfo.platform,
          arch: msg.deviceInfo.arch,
          nodeVersion: msg.deviceInfo.nodeVersion,
        })
        .where(eq(gateways.id, msg.gatewayId))
    } else {
      await db.insert(gateways).values({
        id: msg.gatewayId,
        userId: payload.sub,
        name: msg.deviceInfo.hostname,
        hostname: msg.deviceInfo.hostname,
        platform: msg.deviceInfo.platform,
        arch: msg.deviceInfo.arch,
        nodeVersion: msg.deviceInfo.nodeVersion,
        connectedAt: now,
        createdAt: now,
      })
    }

    ws.send(JSON.stringify({ type: 'server:gateway_auth_result', ok: true }))
  } catch {
    ws.send(
      JSON.stringify({ type: 'server:gateway_auth_result', ok: false, error: 'Invalid token' }),
    )
  }
}

async function handleRegisterAgent(
  ws: WSContext,
  agent: { id: string; name: string; type: string; workingDirectory?: string },
) {
  const gw = connectionManager.getGateway(ws)
  if (!gw) return

  const now = new Date().toISOString()

  // Mark any existing agents with same gateway + name as offline (orphan cleanup)
  await db
    .update(agents)
    .set({ status: 'offline', updatedAt: now })
    .where(
      and(
        eq(agents.gatewayId, gw.gatewayId),
        eq(agents.name, agent.name),
        eq(agents.status, 'online'),
      ),
    )

  // Upsert agent in DB
  const [existing] = await db.select().from(agents).where(eq(agents.id, agent.id)).limit(1)
  if (existing) {
    await db
      .update(agents)
      .set({
        name: agent.name,
        type: agent.type,
        status: 'online',
        workingDirectory: agent.workingDirectory,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(agents.id, agent.id))
  } else {
    await db.insert(agents).values({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      status: 'online',
      gatewayId: gw.gatewayId,
      workingDirectory: agent.workingDirectory,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
  }

  connectionManager.registerAgent(ws, agent.id)
}

async function handleUnregisterAgent(ws: WSContext, agentId: string) {
  const now = new Date().toISOString()
  await db
    .update(agents)
    .set({ status: 'offline', updatedAt: now })
    .where(eq(agents.id, agentId))

  connectionManager.unregisterAgent(ws, agentId)
}

async function handleMessageChunk(
  ws: WSContext,
  msg: {
    roomId: string
    agentId: string
    messageId: string
    chunk: { type: string; content: string; metadata?: Record<string, unknown> }
  },
) {
  const [agent] = await db.select().from(agents).where(eq(agents.id, msg.agentId)).limit(1)
  const agentName = agent?.name ?? 'Unknown Agent'

  connectionManager.broadcastToRoom(msg.roomId, {
    type: 'server:message_chunk',
    roomId: msg.roomId,
    agentId: msg.agentId,
    agentName,
    messageId: msg.messageId,
    chunk: msg.chunk,
  })
}

async function handleMessageComplete(
  ws: WSContext,
  msg: {
    roomId: string
    agentId: string
    messageId: string
    fullContent: string
    chunks?: Array<{ type: string; content: string; metadata?: Record<string, unknown> }>
  },
) {
  const [agent] = await db.select().from(agents).where(eq(agents.id, msg.agentId)).limit(1)
  const agentName = agent?.name ?? 'Unknown Agent'
  const now = new Date().toISOString()

  // Persist agent's full message with structured chunks
  await db.insert(messages).values({
    id: msg.messageId,
    roomId: msg.roomId,
    senderId: msg.agentId,
    senderType: 'agent',
    senderName: agentName,
    type: 'agent_response',
    content: msg.fullContent,
    mentions: '[]',
    chunks: msg.chunks ? JSON.stringify(msg.chunks) : null,
    createdAt: now,
  })

  const message = {
    id: msg.messageId,
    roomId: msg.roomId,
    senderId: msg.agentId,
    senderType: 'agent' as const,
    senderName: agentName,
    type: 'agent_response' as const,
    content: msg.fullContent,
    mentions: [] as string[],
    chunks: msg.chunks,
    createdAt: now,
  }

  connectionManager.broadcastToRoom(msg.roomId, {
    type: 'server:message_complete',
    message,
  })

  // Update agent status back to online
  await db
    .update(agents)
    .set({ status: 'online', lastSeenAt: now, updatedAt: now })
    .where(eq(agents.id, msg.agentId))
}

async function handleAgentStatus(ws: WSContext, agentId: string, status: string) {
  const now = new Date().toISOString()
  await db
    .update(agents)
    .set({ status, lastSeenAt: now, updatedAt: now })
    .where(eq(agents.id, agentId))

  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
  if (agent) {
    // Broadcast agent status to all clients (we'd need room context here)
    // For now, this is a simplified version
  }
}

async function handleTaskUpdate(taskId: string, status: string, result?: string) {
  const now = new Date().toISOString()
  const updateData: Record<string, unknown> = { status, updatedAt: now }
  if (result) updateData.description = result

  await db.update(tasks).set(updateData).where(eq(tasks.id, taskId))
}

export async function handleGatewayDisconnect(ws: WSContext) {
  const gw = connectionManager.getGateway(ws)
  if (gw) {
    const now = new Date().toISOString()

    // Mark all agents as offline
    for (const agentId of gw.agentIds) {
      await db
        .update(agents)
        .set({ status: 'offline', updatedAt: now })
        .where(eq(agents.id, agentId))
    }

    // Mark gateway as disconnected
    await db
      .update(gateways)
      .set({ disconnectedAt: now })
      .where(eq(gateways.id, gw.gatewayId))

    connectionManager.removeGateway(ws)
  }
}
