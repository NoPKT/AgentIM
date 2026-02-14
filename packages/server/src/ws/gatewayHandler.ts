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
    const existing = db.select().from(gateways).where(eq(gateways.id, msg.gatewayId)).get()
    if (existing) {
      db.update(gateways)
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
        .run()
    } else {
      db.insert(gateways)
        .values({
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
        .run()
    }

    ws.send(JSON.stringify({ type: 'server:gateway_auth_result', ok: true }))
  } catch {
    ws.send(
      JSON.stringify({ type: 'server:gateway_auth_result', ok: false, error: 'Invalid token' }),
    )
  }
}

function handleRegisterAgent(
  ws: WSContext,
  agent: { id: string; name: string; type: string; workingDirectory?: string },
) {
  const gw = connectionManager.getGateway(ws)
  if (!gw) return

  const now = new Date().toISOString()

  // Mark any existing agents with same gateway + name as offline (orphan cleanup)
  db.update(agents)
    .set({ status: 'offline', updatedAt: now })
    .where(
      and(
        eq(agents.gatewayId, gw.gatewayId),
        eq(agents.name, agent.name),
        eq(agents.status, 'online'),
      ),
    )
    .run()

  // Upsert agent in DB
  const existing = db.select().from(agents).where(eq(agents.id, agent.id)).get()
  if (existing) {
    db.update(agents)
      .set({
        name: agent.name,
        type: agent.type,
        status: 'online',
        workingDirectory: agent.workingDirectory,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(agents.id, agent.id))
      .run()
  } else {
    db.insert(agents)
      .values({
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
      .run()
  }

  connectionManager.registerAgent(ws, agent.id)
}

function handleUnregisterAgent(ws: WSContext, agentId: string) {
  const now = new Date().toISOString()
  db.update(agents)
    .set({ status: 'offline', updatedAt: now })
    .where(eq(agents.id, agentId))
    .run()

  connectionManager.unregisterAgent(ws, agentId)
}

function handleMessageChunk(
  ws: WSContext,
  msg: {
    roomId: string
    agentId: string
    messageId: string
    chunk: { type: string; content: string; metadata?: Record<string, unknown> }
  },
) {
  const agent = db.select().from(agents).where(eq(agents.id, msg.agentId)).get()
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

function handleMessageComplete(
  ws: WSContext,
  msg: { roomId: string; agentId: string; messageId: string; fullContent: string },
) {
  const agent = db.select().from(agents).where(eq(agents.id, msg.agentId)).get()
  const agentName = agent?.name ?? 'Unknown Agent'
  const now = new Date().toISOString()

  // Persist agent's full message
  db.insert(messages)
    .values({
      id: msg.messageId,
      roomId: msg.roomId,
      senderId: msg.agentId,
      senderType: 'agent',
      senderName: agentName,
      type: 'agent_response',
      content: msg.fullContent,
      mentions: '[]',
      createdAt: now,
    })
    .run()

  const message = {
    id: msg.messageId,
    roomId: msg.roomId,
    senderId: msg.agentId,
    senderType: 'agent' as const,
    senderName: agentName,
    type: 'agent_response' as const,
    content: msg.fullContent,
    mentions: [],
    createdAt: now,
  }

  connectionManager.broadcastToRoom(msg.roomId, {
    type: 'server:message_complete',
    message,
  })

  // Update agent status back to online
  db.update(agents)
    .set({ status: 'online', lastSeenAt: now, updatedAt: now })
    .where(eq(agents.id, msg.agentId))
    .run()
}

function handleAgentStatus(ws: WSContext, agentId: string, status: string) {
  const now = new Date().toISOString()
  db.update(agents)
    .set({ status, lastSeenAt: now, updatedAt: now })
    .where(eq(agents.id, agentId))
    .run()

  const agent = db.select().from(agents).where(eq(agents.id, agentId)).get()
  if (agent) {
    // Broadcast agent status to all clients (we'd need room context here)
    // For now, this is a simplified version
  }
}

function handleTaskUpdate(taskId: string, status: string, result?: string) {
  const now = new Date().toISOString()
  const updateData: Record<string, unknown> = { status, updatedAt: now }
  if (result) updateData.description = result

  db.update(tasks).set(updateData).where(eq(tasks.id, taskId)).run()
}

export function handleGatewayDisconnect(ws: WSContext) {
  const gw = connectionManager.getGateway(ws)
  if (gw) {
    const now = new Date().toISOString()

    // Mark all agents as offline
    for (const agentId of gw.agentIds) {
      db.update(agents)
        .set({ status: 'offline', updatedAt: now })
        .where(eq(agents.id, agentId))
        .run()
    }

    // Mark gateway as disconnected
    db.update(gateways)
      .set({ disconnectedAt: now })
      .where(eq(gateways.id, gw.gatewayId))
      .run()

    connectionManager.removeGateway(ws)
  }
}
