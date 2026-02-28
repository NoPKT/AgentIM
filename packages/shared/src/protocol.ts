import type {
  Agent,
  AgentSlashCommand,
  DeviceInfo,
  Message,
  MessageReaction,
  ParsedChunk,
  Task,
  Room,
  RoomMember,
  RoomContext,
} from './types.js'
import type {
  AgentStatus,
  AgentType,
  TaskStatus,
  RoutingMode,
  SenderType,
  PermissionDecision,
} from './constants.js'

// ─── Client → Server Messages ───

export interface ClientAuth {
  type: 'client:auth'
  token: string
  protocolVersion?: string
}

export interface ClientJoinRoom {
  type: 'client:join_room'
  roomId: string
}

export interface ClientLeaveRoom {
  type: 'client:leave_room'
  roomId: string
}

export interface ClientSendMessage {
  type: 'client:send_message'
  roomId: string
  content: string
  mentions: string[]
  replyToId?: string
  attachmentIds?: string[]
}

export interface ClientTyping {
  type: 'client:typing'
  roomId: string
}

export interface ClientStopGeneration {
  type: 'client:stop_generation'
  roomId: string
  agentId: string
}

export interface ClientPermissionResponse {
  type: 'client:permission_response'
  requestId: string
  decision: Extract<PermissionDecision, 'allow' | 'deny'>
}

export interface ClientAgentCommand {
  type: 'client:agent_command'
  agentId: string
  roomId: string
  command: string
  args: string
}

export interface ClientQueryAgentInfo {
  type: 'client:query_agent_info'
  agentId: string
}

export interface ClientPing {
  type: 'client:ping'
  ts: number
}

export type ClientMessage =
  | ClientAuth
  | ClientJoinRoom
  | ClientLeaveRoom
  | ClientSendMessage
  | ClientTyping
  | ClientStopGeneration
  | ClientPermissionResponse
  | ClientAgentCommand
  | ClientQueryAgentInfo
  | ClientPing

// ─── Server → Client Messages ───

export interface ServerAuthResult {
  type: 'server:auth_result'
  ok: boolean
  error?: string
  userId?: string
}

export interface ServerNewMessage {
  type: 'server:new_message'
  message: Message
}

export interface ServerMessageChunk {
  type: 'server:message_chunk'
  roomId: string
  agentId: string
  agentName: string
  messageId: string
  chunk: ParsedChunk
}

export interface ServerMessageComplete {
  type: 'server:message_complete'
  message: Message
}

export interface ServerTyping {
  type: 'server:typing'
  roomId: string
  userId: string
  username: string
}

export interface ServerAgentStatus {
  type: 'server:agent_status'
  agent: Pick<Agent, 'id' | 'name' | 'type' | 'status' | 'slashCommands' | 'mcpServers' | 'model'>
}

export interface ServerAgentCommandResult {
  type: 'server:agent_command_result'
  agentId: string
  roomId: string
  command: string
  success: boolean
  message?: string
}

export interface ServerAgentInfo {
  type: 'server:agent_info'
  agent: Agent
}

export interface ServerTaskUpdate {
  type: 'server:task_update'
  task: Task
}

export interface ServerRoomUpdate {
  type: 'server:room_update'
  room: Room
  members?: RoomMember[]
}

export interface ServerTerminalData {
  type: 'server:terminal_data'
  agentId: string
  agentName: string
  roomId: string
  data: string
}

export interface ServerMessageEdited {
  type: 'server:message_edited'
  message: Message
}

export interface ServerMessageDeleted {
  type: 'server:message_deleted'
  roomId: string
  messageId: string
}

export interface ServerReadReceipt {
  type: 'server:read_receipt'
  roomId: string
  userId: string
  username: string
  lastReadAt: string
}

export interface ServerPresence {
  type: 'server:presence'
  userId: string
  username: string
  online: boolean
}

export interface ServerReactionUpdate {
  type: 'server:reaction_update'
  roomId: string
  messageId: string
  reactions: MessageReaction[]
}

export interface ServerError {
  type: 'server:error'
  code: string
  message: string
}

export interface ServerPermissionRequest {
  type: 'server:permission_request'
  requestId: string
  agentId: string
  agentName: string
  roomId: string
  toolName: string
  toolInput: Record<string, unknown>
  expiresAt: string
}

export interface ServerPermissionRequestExpired {
  type: 'server:permission_request_expired'
  requestId: string
}

export interface ServerRoomRemoved {
  type: 'server:room_removed'
  roomId: string
}

export type ServerMessage =
  | ServerAuthResult
  | ServerNewMessage
  | ServerMessageChunk
  | ServerMessageComplete
  | ServerMessageEdited
  | ServerMessageDeleted
  | ServerTyping
  | ServerAgentStatus
  | ServerAgentCommandResult
  | ServerAgentInfo
  | ServerTaskUpdate
  | ServerRoomUpdate
  | ServerRoomRemoved
  | ServerTerminalData
  | ServerReadReceipt
  | ServerPresence
  | ServerReactionUpdate
  | ServerPermissionRequest
  | ServerPermissionRequestExpired
  | ServerPong
  | ServerError

// ─── Gateway → Server Messages ───

export interface GatewayAuth {
  type: 'gateway:auth'
  token: string
  gatewayId: string
  protocolVersion?: string
  deviceInfo: DeviceInfo
}

export interface GatewayRegisterAgent {
  type: 'gateway:register_agent'
  agent: {
    id: string
    name: string
    type: AgentType
    workingDirectory?: string
    capabilities?: string[]
    slashCommands?: AgentSlashCommand[]
    mcpServers?: string[]
    model?: string
  }
}

export interface GatewayUnregisterAgent {
  type: 'gateway:unregister_agent'
  agentId: string
}

export interface GatewayMessageChunk {
  type: 'gateway:message_chunk'
  roomId: string
  agentId: string
  messageId: string
  chunk: ParsedChunk
}

export interface GatewayMessageComplete {
  type: 'gateway:message_complete'
  roomId: string
  agentId: string
  messageId: string
  fullContent: string
  chunks?: ParsedChunk[]
  conversationId?: string
  depth?: number
}

export interface GatewayAgentStatus {
  type: 'gateway:agent_status'
  agentId: string
  status: AgentStatus
  /** Number of messages waiting in the per-agent queue on the gateway. */
  queueDepth?: number
}

export interface GatewayTerminalData {
  type: 'gateway:terminal_data'
  agentId: string
  data: string
}

export interface GatewayTaskUpdate {
  type: 'gateway:task_update'
  taskId: string
  status: TaskStatus
  result?: string
}

export interface GatewayPermissionRequest {
  type: 'gateway:permission_request'
  requestId: string
  agentId: string
  roomId: string
  toolName: string
  toolInput: Record<string, unknown>
  timeoutMs: number
}

export interface GatewayAgentCommandResult {
  type: 'gateway:agent_command_result'
  agentId: string
  roomId: string
  command: string
  success: boolean
  message?: string
}

export interface GatewayAgentInfo {
  type: 'gateway:agent_info'
  agentId: string
  slashCommands: AgentSlashCommand[]
  mcpServers: string[]
  model?: string
}

export interface GatewayPing {
  type: 'gateway:ping'
  ts: number
}

export type GatewayMessage =
  | GatewayAuth
  | GatewayRegisterAgent
  | GatewayUnregisterAgent
  | GatewayMessageChunk
  | GatewayMessageComplete
  | GatewayAgentStatus
  | GatewayTerminalData
  | GatewayTaskUpdate
  | GatewayPermissionRequest
  | GatewayAgentCommandResult
  | GatewayAgentInfo
  | GatewayPing

// ─── Server → Gateway Messages ───

export interface ServerGatewayAuthResult {
  type: 'server:gateway_auth_result'
  ok: boolean
  error?: string
}

export interface ServerSendToAgent {
  type: 'server:send_to_agent'
  agentId: string
  roomId: string
  messageId: string
  content: string
  senderName: string
  senderType: SenderType
  routingMode: RoutingMode
  conversationId: string
  depth: number
}

export interface ServerRoomContext {
  type: 'server:room_context'
  agentId: string
  context: RoomContext
}

export interface ServerStopAgent {
  type: 'server:stop_agent'
  agentId: string
}

export interface ServerRemoveAgent {
  type: 'server:remove_agent'
  agentId: string
}

export interface ServerAgentCommand {
  type: 'server:agent_command'
  agentId: string
  roomId: string
  command: string
  args: string
  userId: string
}

export interface ServerQueryAgentInfo {
  type: 'server:query_agent_info'
  agentId: string
}

export interface ServerPermissionResponse {
  type: 'server:permission_response'
  requestId: string
  agentId: string
  decision: PermissionDecision
}

export interface ServerPong {
  type: 'server:pong'
  ts: number
}

export type ServerGatewayMessage =
  | ServerGatewayAuthResult
  | ServerSendToAgent
  | ServerStopAgent
  | ServerRemoveAgent
  | ServerRoomContext
  | ServerPermissionResponse
  | ServerAgentCommand
  | ServerQueryAgentInfo
  | ServerPong
  | ServerError

// ─── All Messages Union ───

export type WsMessage = ClientMessage | ServerMessage | GatewayMessage | ServerGatewayMessage

// ─── Type Guards ───

/** All valid ClientMessage type discriminants */
const CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'client:auth',
  'client:join_room',
  'client:leave_room',
  'client:send_message',
  'client:typing',
  'client:stop_generation',
  'client:permission_response',
  'client:agent_command',
  'client:query_agent_info',
  'client:ping',
])

/** All valid GatewayMessage type discriminants */
const GATEWAY_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'gateway:auth',
  'gateway:register_agent',
  'gateway:unregister_agent',
  'gateway:message_chunk',
  'gateway:message_complete',
  'gateway:agent_status',
  'gateway:terminal_data',
  'gateway:task_update',
  'gateway:permission_request',
  'gateway:agent_command_result',
  'gateway:agent_info',
  'gateway:ping',
])

/** All valid ServerMessage type discriminants */
const SERVER_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'server:auth_result',
  'server:new_message',
  'server:message_chunk',
  'server:message_complete',
  'server:message_edited',
  'server:message_deleted',
  'server:typing',
  'server:agent_status',
  'server:agent_command_result',
  'server:agent_info',
  'server:task_update',
  'server:room_update',
  'server:room_removed',
  'server:terminal_data',
  'server:read_receipt',
  'server:presence',
  'server:reaction_update',
  'server:permission_request',
  'server:permission_request_expired',
  'server:pong',
  'server:error',
])

/** Type guard for ClientMessage */
export function isClientMessage(msg: unknown): msg is ClientMessage {
  const type = (msg as { type?: string })?.type
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof type === 'string' &&
    CLIENT_MESSAGE_TYPES.has(type)
  )
}

/** Type guard for ServerMessage */
export function isServerMessage(msg: unknown): msg is ServerMessage {
  const type = (msg as { type?: string })?.type
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof type === 'string' &&
    SERVER_MESSAGE_TYPES.has(type)
  )
}

/** Type guard for GatewayMessage */
export function isGatewayMessage(msg: unknown): msg is GatewayMessage {
  const type = (msg as { type?: string })?.type
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof type === 'string' &&
    GATEWAY_MESSAGE_TYPES.has(type)
  )
}

/**
 * ServerGatewayMessage type discriminants that are exclusive to the gateway
 * channel (i.e. NOT shared with ServerMessage). `server:pong` and
 * `server:error` belong to BOTH unions, so they are intentionally omitted.
 */
const SERVER_GATEWAY_ONLY_TYPES: ReadonlySet<string> = new Set([
  'server:gateway_auth_result',
  'server:send_to_agent',
  'server:stop_agent',
  'server:remove_agent',
  'server:room_context',
  'server:permission_response',
  'server:agent_command',
  'server:query_agent_info',
])

/** Type guard for ServerGatewayMessage */
export function isServerGatewayMessage(msg: unknown): msg is ServerGatewayMessage {
  const type = (msg as { type?: string })?.type
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof type === 'string' &&
    (SERVER_GATEWAY_ONLY_TYPES.has(type) || type === 'server:pong' || type === 'server:error')
  )
}
