import type { Agent, Message, ParsedChunk, Task, Room, RoomMember } from './types.js'
import type { AgentStatus, TaskStatus } from './constants.js'

// ─── Client → Server Messages ───

export interface ClientAuth {
  type: 'client:auth'
  token: string
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

export type ClientMessage =
  | ClientAuth
  | ClientJoinRoom
  | ClientLeaveRoom
  | ClientSendMessage
  | ClientTyping
  | ClientStopGeneration

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

export interface ServerError {
  type: 'server:error'
  code: string
  message: string
}

export type ServerMessage =
  | ServerAuthResult
  | ServerNewMessage
  | ServerMessageChunk
  | ServerMessageComplete
  | ServerTyping
  | ServerAgentStatus
  | ServerTaskUpdate
  | ServerRoomUpdate
  | ServerError

// ─── Gateway → Server Messages ───

export interface GatewayAuth {
  type: 'gateway:auth'
  token: string
  gatewayId: string
  deviceInfo: {
    hostname: string
    platform: string
    arch: string
    nodeVersion: string
  }
}

export interface GatewayRegisterAgent {
  type: 'gateway:register_agent'
  agent: {
    id: string
    name: string
    type: string
    workingDirectory?: string
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
}

export interface GatewayAgentStatus {
  type: 'gateway:agent_status'
  agentId: string
  status: AgentStatus
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

export type GatewayMessage =
  | GatewayAuth
  | GatewayRegisterAgent
  | GatewayUnregisterAgent
  | GatewayMessageChunk
  | GatewayMessageComplete
  | GatewayAgentStatus
  | GatewayTerminalData
  | GatewayTaskUpdate

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
}

export interface ServerStopAgent {
  type: 'server:stop_agent'
  agentId: string
}

export type ServerGatewayMessage =
  | ServerGatewayAuthResult
  | ServerSendToAgent
  | ServerStopAgent

// ─── All Messages Union ───

export type WsMessage = ClientMessage | ServerMessage | GatewayMessage | ServerGatewayMessage
