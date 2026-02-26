import type {
  Agent,
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

export interface ServerServiceAgentResponse {
  type: 'server:service_agent_response'
  roomId: string
  serviceAgentId: string
  serviceAgentName: string
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
  agent: Pick<Agent, 'id' | 'name' | 'type' | 'status'>
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
  | ServerServiceAgentResponse
  | ServerMessageEdited
  | ServerMessageDeleted
  | ServerTyping
  | ServerAgentStatus
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
  | ServerPong
  | ServerError

// ─── All Messages Union ───

export type WsMessage = ClientMessage | ServerMessage | GatewayMessage | ServerGatewayMessage

// ─── Type Guards ───

/** Type guard for ClientMessage */
export function isClientMessage(msg: unknown): msg is ClientMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    typeof (msg as { type: unknown }).type === 'string' &&
    (msg as { type: string }).type.startsWith('client:')
  )
}

/** Type guard for ServerMessage */
export function isServerMessage(msg: unknown): msg is ServerMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    typeof (msg as { type: unknown }).type === 'string' &&
    (msg as { type: string }).type.startsWith('server:') &&
    !(msg as { type: string }).type.startsWith('server:gateway_auth_result')
  )
}

/** Type guard for GatewayMessage */
export function isGatewayMessage(msg: unknown): msg is GatewayMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'type' in msg &&
    typeof (msg as { type: unknown }).type === 'string' &&
    (msg as { type: string }).type.startsWith('gateway:')
  )
}

/**
 * All known ServerGatewayMessage type discriminants. Kept in sync with the
 * ServerGatewayMessage union above. When adding a new variant to the union,
 * add its type string here as well so the type guard stays correct.
 */
const SERVER_GATEWAY_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'server:gateway_auth_result',
  'server:send_to_agent',
  'server:stop_agent',
  'server:remove_agent',
  'server:room_context',
  'server:permission_response',
  'server:pong',
  'server:error',
])

/** Type guard for ServerGatewayMessage */
export function isServerGatewayMessage(msg: unknown): msg is ServerGatewayMessage {
  const type = (msg as { type?: string })?.type
  return (
    typeof msg === 'object' &&
    msg !== null &&
    typeof type === 'string' &&
    SERVER_GATEWAY_MESSAGE_TYPES.has(type)
  )
}
