import type {
  Agent,
  AgentSlashCommand,
  DeviceInfo,
  DirectoryEntry,
  Message,
  MessageReaction,
  ModelOption,
  ParsedChunk,
  Task,
  Room,
  RoomMember,
  RoomContext,
  WorkspaceStatus,
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

export interface ClientRequestWorkspace {
  type: 'client:request_workspace'
  roomId: string
  agentId: string
  request: { kind: 'status' } | { kind: 'tree'; path?: string } | { kind: 'file'; path: string }
}

// ─── Client → Server: Credential Management ───

export interface ClientListGatewayCredentials {
  type: 'client:list_gateway_credentials'
  gatewayId: string
  agentType: string
}

export interface ClientAddGatewayCredential {
  type: 'client:add_gateway_credential'
  gatewayId: string
  agentType: string
  name: string
  mode?: 'api' | 'subscription'
  apiKey?: string
  baseUrl?: string
  model?: string
}

export interface ClientManageGatewayCredential {
  type: 'client:manage_gateway_credential'
  gatewayId: string
  agentType: string
  credentialId: string
  action: 'rename' | 'delete' | 'set_default'
  name?: string
}

export interface ClientStartGatewayOAuth {
  type: 'client:start_gateway_oauth'
  gatewayId: string
  agentType: string
  credentialName: string
}

export interface ClientCompleteGatewayOAuth {
  type: 'client:complete_gateway_oauth'
  gatewayId: string
  requestId: string
  callbackUrl: string
}

export interface ClientPing {
  type: 'client:ping'
  ts: number
}

export interface ClientRewindRoom {
  type: 'client:rewind_room'
  roomId: string
  messageId: string
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
  | ClientRequestWorkspace
  | ClientListGatewayCredentials
  | ClientAddGatewayCredential
  | ClientManageGatewayCredential
  | ClientStartGatewayOAuth
  | ClientCompleteGatewayOAuth
  | ClientPing
  | ClientRewindRoom

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

export interface ServerWorkspaceResponse {
  type: 'server:workspace_response'
  agentId: string
  requestId: string
  response:
    | { kind: 'status'; data: WorkspaceStatus | null }
    | { kind: 'tree'; path: string; entries: DirectoryEntry[] }
    | { kind: 'file'; path: string; content: string; size: number; truncated: boolean }
    | { kind: 'error'; message: string }
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

export interface ServerRoomCleared {
  type: 'server:room_cleared'
  roomId: string
  clearedAt: string
}

export interface ServerRoomRewound {
  type: 'server:room_rewound'
  roomId: string
  messageId: string
  removedMessageIds: string[]
  messageContent: string
}

export interface ServerSpawnResult {
  type: 'server:spawn_result'
  requestId: string
  gatewayId: string
  success: boolean
  agentId?: string
  error?: string
  /** Included when error is CREDENTIAL_SELECTION_REQUIRED */
  credentials?: Array<{
    id: string
    name: string
    mode: 'subscription' | 'api'
    isDefault: boolean
  }>
}

// ─── Server → Client: Credential Management Responses ───

export interface ServerGatewayCredentialList {
  type: 'server:gateway_credential_list'
  gatewayId: string
  agentType: string
  credentials: Array<{
    id: string
    name: string
    mode: 'subscription' | 'api'
    hasApiKey: boolean
    baseUrl?: string
    model?: string
    isDefault: boolean
    createdAt: string
  }>
}

export interface ServerGatewayCredentialResult {
  type: 'server:gateway_credential_result'
  requestId: string
  success: boolean
  error?: string
  credential?: { id: string; name: string }
}

export interface ServerGatewayOAuthUrl {
  type: 'server:gateway_oauth_url'
  gatewayId: string
  requestId: string
  authUrl: string
  autoCallback?: boolean
}

export interface ServerGatewayOAuthResult {
  type: 'server:gateway_oauth_result'
  gatewayId: string
  requestId: string
  success: boolean
  error?: string
  credential?: { id: string; name: string }
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
  | ServerRoomCleared
  | ServerRoomRewound
  | ServerSpawnResult
  | ServerGatewayCredentialList
  | ServerGatewayCredentialResult
  | ServerGatewayOAuthUrl
  | ServerGatewayOAuthResult
  | ServerWorkspaceResponse
  | ServerPong
  | ServerError

// ─── Gateway → Server Messages ───

export interface GatewayAuth {
  type: 'gateway:auth'
  token: string
  gatewayId: string
  protocolVersion?: string
  deviceInfo: DeviceInfo
  ephemeral?: boolean
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
  /** When set, this message is directed at a specific agent */
  targetAgentName?: string
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
  /** When set, this message is directed at a specific agent (agent-to-agent via MCP) */
  targetAgentName?: string
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
  thinkingMode?: string
  effortLevel?: string
  sessionCostUSD?: number
  availableModels?: string[]
  availableModelInfo?: ModelOption[]
  availableEffortLevels?: string[]
  availableThinkingModes?: string[]
  planMode?: boolean
}

export interface GatewaySpawnResult {
  type: 'gateway:spawn_result'
  requestId: string
  success: boolean
  agentId?: string
  error?: string
  /** Included when error is CREDENTIAL_SELECTION_REQUIRED */
  credentials?: Array<{
    id: string
    name: string
    mode: 'subscription' | 'api'
    isDefault: boolean
  }>
}

// ─── Gateway → Server: Credential Management Responses ───

export interface GatewayCredentialList {
  type: 'gateway:credential_list'
  requestId: string
  agentType: string
  credentials: Array<{
    id: string
    name: string
    mode: 'subscription' | 'api'
    hasApiKey: boolean
    baseUrl?: string
    model?: string
    isDefault: boolean
    createdAt: string
  }>
}

export interface GatewayCredentialResult {
  type: 'gateway:credential_result'
  requestId: string
  success: boolean
  error?: string
  credential?: { id: string; name: string }
}

export interface GatewayOAuthUrl {
  type: 'gateway:oauth_url'
  requestId: string
  authUrl: string
  /** When true, the CLI handles OAuth callbacks internally (e.g. via polling).
   *  The user only needs to open the URL and authenticate — no callback paste needed. */
  autoCallback?: boolean
}

export interface GatewayOAuthResult {
  type: 'gateway:oauth_result'
  requestId: string
  success: boolean
  error?: string
  credential?: { id: string; name: string }
}

export interface GatewayWorkspaceResponse {
  type: 'gateway:workspace_response'
  agentId: string
  requestId: string
  response:
    | { kind: 'status'; data: WorkspaceStatus }
    | { kind: 'tree'; path: string; entries: DirectoryEntry[] }
    | { kind: 'file'; path: string; content: string; size: number; truncated: boolean }
    | { kind: 'error'; message: string }
}

export interface GatewayPing {
  type: 'gateway:ping'
  ts: number
}

export interface GatewayRewindResult {
  type: 'gateway:rewind_result'
  agentId: string
  roomId: string
  success: boolean
  error?: string
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
  | GatewaySpawnResult
  | GatewayCredentialList
  | GatewayCredentialResult
  | GatewayOAuthUrl
  | GatewayOAuthResult
  | GatewayWorkspaceResponse
  | GatewayPing
  | GatewayRewindResult

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

export interface ServerSpawnAgent {
  type: 'server:spawn_agent'
  requestId: string
  agentType: AgentType
  name: string
  workingDirectory?: string
  credentialId?: string
}

export interface ServerRequestWorkspace {
  type: 'server:request_workspace'
  agentId: string
  roomId: string
  requestId: string
  request: { kind: 'status' } | { kind: 'tree'; path?: string } | { kind: 'file'; path: string }
}

// ─── Server → Gateway: Credential Management ───

export interface ServerListCredentials {
  type: 'server:list_credentials'
  requestId: string
  agentType: string
}

export interface ServerAddCredential {
  type: 'server:add_credential'
  requestId: string
  agentType: string
  name: string
  mode: 'api' | 'subscription'
  apiKey?: string
  baseUrl?: string
  model?: string
}

export interface ServerManageCredential {
  type: 'server:manage_credential'
  requestId: string
  agentType: string
  credentialId: string
  action: 'rename' | 'delete' | 'set_default'
  name?: string
}

export interface ServerStartOAuth {
  type: 'server:start_oauth'
  requestId: string
  agentType: string
  credentialName: string
}

export interface ServerCompleteOAuth {
  type: 'server:complete_oauth'
  requestId: string
  callbackUrl: string
}

export interface ServerRewindAgent {
  type: 'server:rewind_agent'
  agentId: string
  roomId: string
  messageId: string
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
  | ServerSpawnAgent
  | ServerRequestWorkspace
  | ServerListCredentials
  | ServerAddCredential
  | ServerManageCredential
  | ServerStartOAuth
  | ServerCompleteOAuth
  | ServerRewindAgent
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
  'client:request_workspace',
  'client:list_gateway_credentials',
  'client:add_gateway_credential',
  'client:manage_gateway_credential',
  'client:start_gateway_oauth',
  'client:complete_gateway_oauth',
  'client:ping',
  'client:rewind_room',
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
  'gateway:spawn_result',
  'gateway:credential_list',
  'gateway:credential_result',
  'gateway:oauth_url',
  'gateway:oauth_result',
  'gateway:workspace_response',
  'gateway:ping',
  'gateway:rewind_result',
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
  'server:room_cleared',
  'server:room_rewound',
  'server:spawn_result',
  'server:gateway_credential_list',
  'server:gateway_credential_result',
  'server:gateway_oauth_url',
  'server:gateway_oauth_result',
  'server:workspace_response',
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
  'server:spawn_agent',
  'server:request_workspace',
  'server:list_credentials',
  'server:add_credential',
  'server:manage_credential',
  'server:start_oauth',
  'server:complete_oauth',
  'server:rewind_agent',
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
