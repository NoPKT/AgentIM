/**
 * AgentIM MCP Tools — expose room interaction capabilities to agents.
 *
 * For Claude Code: uses createSdkMcpServer() for in-process zero-overhead MCP.
 * For OpenCode/Codex: uses a stdio MCP server (see stdio-server.ts).
 */

import type { McpContext } from './mcp-context.js'

/**
 * Create an in-process MCP server for Claude Code SDK using createSdkMcpServer().
 * Returns the McpSdkServerConfigWithInstance ready to pass to query() options.
 */
export async function createAgentImMcpServer(ctx: McpContext) {
  const { createSdkMcpServer, tool } = await import('@anthropic-ai/claude-agent-sdk')
  const { z } = await import('zod')

  return createSdkMcpServer({
    name: 'agentim',
    version: '1.0.0',
    tools: [
      tool(
        'send_message',
        'Send a message to another agent in the room. Fire-and-forget — the message will be displayed in the room and routed to the target agent.',
        {
          target_agent: z.string().describe('Name of the target agent to send the message to'),
          content: z.string().describe('The message content to send'),
        },
        async (args) => {
          const result = await ctx.sendMessage(args.target_agent, args.content)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result),
              },
            ],
          }
        },
      ),

      tool(
        'request_reply',
        'Send a message to another agent and wait for their reply. Use this when you need a response from the target agent before proceeding.',
        {
          target_agent: z.string().describe('Name of the target agent to request a reply from'),
          content: z.string().describe('The message/question to send'),
          timeout_seconds: z
            .number()
            .optional()
            .describe('Timeout in seconds (default: 120, max: 300)'),
        },
        async (args) => {
          const result = await ctx.requestReply(
            args.target_agent,
            args.content,
            args.timeout_seconds,
          )
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(result),
              },
            ],
          }
        },
      ),

      tool(
        'get_room_messages',
        'Get recent messages from the room. Returns messages from all participants (users and agents).',
        {
          limit: z
            .number()
            .optional()
            .describe('Number of recent messages to retrieve (default: 20, max: 50)'),
        },
        async (args) => {
          const messages = await ctx.getRoomMessages(args.limit)
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ messages }),
              },
            ],
          }
        },
      ),

      tool(
        'list_room_members',
        'List all members currently in the room, including their type (user/agent), agent type, and status.',
        {},
        async () => {
          const members = await ctx.listRoomMembers()
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({ members }),
              },
            ],
          }
        },
      ),
    ],
  })
}
