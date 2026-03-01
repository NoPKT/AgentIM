/**
 * McpContext — bridge between MCP tool handlers and the AgentManager/WebSocket layer.
 *
 * Each agent gets its own McpContext instance. The context provides methods
 * that MCP tools call to interact with the AgentIM room.
 */

export interface RoomMemberInfo {
  name: string
  type: 'user' | 'agent'
  agentType?: string
  status?: string
}

export interface RoomMessage {
  sender: string
  senderType: 'user' | 'agent'
  content: string
  timestamp: string
}

export interface McpContext {
  /** Agent ID that owns this context */
  agentId: string
  /** Agent display name */
  agentName: string

  /** Send a fire-and-forget message to a target agent */
  sendMessage(
    targetAgent: string,
    content: string,
  ): Promise<{ success: boolean; messageId: string }>

  /** Send a message and wait for a reply */
  requestReply(
    targetAgent: string,
    content: string,
    timeoutSeconds?: number,
  ): Promise<{ reply: string; agentName: string } | { timeout: true }>

  /** Get recent room messages */
  getRoomMessages(limit?: number): Promise<RoomMessage[]>

  /** List room members */
  listRoomMembers(): Promise<RoomMemberInfo[]>
}
