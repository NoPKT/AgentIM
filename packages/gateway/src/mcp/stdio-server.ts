#!/usr/bin/env node
/**
 * Standalone stdio MCP server for OpenCode and Codex.
 *
 * This script is spawned as a child process by OpenCode/Codex.
 * It communicates with the gateway process via HTTP loopback (IPC server).
 *
 * Environment variables:
 *   AGENTIM_IPC_PORT — port of the gateway's IPC server
 *   AGENTIM_AGENT_ID — agent ID
 *   AGENTIM_AGENT_NAME — agent display name
 *   AGENTIM_ROOM_ID — current room ID
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const IPC_PORT = process.env.AGENTIM_IPC_PORT
const AGENT_ID = process.env.AGENTIM_AGENT_ID
const _AGENT_NAME = process.env.AGENTIM_AGENT_NAME || 'agent'

if (!IPC_PORT || !AGENT_ID) {
  console.error('Missing AGENTIM_IPC_PORT or AGENTIM_AGENT_ID')
  process.exit(1)
}

const IPC_BASE = `http://127.0.0.1:${IPC_PORT}`

async function ipcCall(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${IPC_BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ agentId: AGENT_ID, ...body }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`IPC error (${res.status}): ${text}`)
  }
  return res.json()
}

const server = new McpServer({
  name: 'agentim',
  version: '1.0.0',
})

server.tool(
  'send_message',
  'Send a message to another agent in the room. Fire-and-forget.',
  {
    target_agent: z.string().describe('Name of the target agent'),
    content: z.string().describe('Message content'),
  },
  async (args) => {
    const result = await ipcCall('/send-message', {
      targetAgent: args.target_agent,
      content: args.content,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    }
  },
)

server.tool(
  'request_reply',
  'Send a message to another agent and wait for their reply.',
  {
    target_agent: z.string().describe('Name of the target agent'),
    content: z.string().describe('Message/question to send'),
    timeout_seconds: z.number().optional().describe('Timeout (default: 120, max: 300)'),
  },
  async (args) => {
    const result = await ipcCall('/request-reply', {
      targetAgent: args.target_agent,
      content: args.content,
      timeoutSeconds: args.timeout_seconds,
    })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    }
  },
)

server.tool(
  'get_room_messages',
  'Get recent messages from the room.',
  {
    limit: z.number().optional().describe('Number of messages (default: 20, max: 50)'),
  },
  async (args) => {
    const result = await ipcCall('/messages', { limit: args.limit })
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(result) }],
    }
  },
)

server.tool('list_room_members', 'List all members in the room.', {}, async () => {
  const result = await ipcCall('/members', {})
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result) }],
  }
})

const transport = new StdioServerTransport()
await server.connect(transport)
