import { createRequire } from 'node:module'
import { Hono } from 'hono'

const require = createRequire(import.meta.url)
const { version: pkgVersion } = require('../../package.json')

const spec = {
  openapi: '3.0.3',
  info: {
    title: 'AgentIM API',
    version: pkgVersion,
    description:
      'Unified IM-style platform for managing and orchestrating multiple AI coding agents.',
  },
  servers: [{ url: '/api', description: 'Default server' }],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      ApiResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          data: {},
          error: { type: 'string' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          username: { type: 'string' },
          displayName: { type: 'string' },
          avatarUrl: { type: 'string', nullable: true },
          role: { type: 'string', enum: ['admin', 'user'] },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Room: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['private', 'group'] },
          broadcastMode: { type: 'boolean' },
          systemPrompt: { type: 'string', nullable: true },
          createdById: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      Message: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          roomId: { type: 'string' },
          senderId: { type: 'string' },
          senderType: { type: 'string', enum: ['user', 'agent', 'system'] },
          senderName: { type: 'string' },
          type: { type: 'string', enum: ['text', 'system', 'agent_response', 'terminal'] },
          content: { type: 'string' },
          replyToId: { type: 'string', nullable: true },
          mentions: { type: 'array', items: { type: 'string' } },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      Agent: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          type: { type: 'string', enum: ['claude-code', 'codex', 'gemini', 'opencode', 'generic'] },
          status: { type: 'string', enum: ['online', 'offline', 'busy', 'error'] },
          gatewayId: { type: 'string' },
          workingDirectory: { type: 'string', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Task: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          roomId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'completed', 'failed', 'cancelled'],
          },
          assigneeId: { type: 'string', nullable: true },
          assigneeType: { type: 'string', enum: ['user', 'agent'], nullable: true },
          createdById: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        security: [],
        responses: { '200': { description: 'Server is healthy' } },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login',
        security: [],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['username', 'password'],
                properties: {
                  username: { type: 'string' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Login successful, returns tokens' },
          '401': { description: 'Invalid credentials' },
        },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh access token',
        security: [],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['refreshToken'],
                properties: { refreshToken: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'New tokens' } },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['Auth'],
        summary: 'Logout (revoke all tokens)',
        responses: { '200': { description: 'Logged out' } },
      },
    },
    '/users/me': {
      get: {
        tags: ['Users'],
        summary: 'Get current user',
        responses: { '200': { description: 'Current user info' } },
      },
      put: {
        tags: ['Users'],
        summary: 'Update current user profile',
        responses: { '200': { description: 'User updated' } },
      },
    },
    '/users/me/password': {
      put: {
        tags: ['Users'],
        summary: 'Change current user password',
        responses: { '200': { description: 'Password changed' } },
      },
    },
    '/users': {
      get: {
        tags: ['Users'],
        summary: 'List users (admin)',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'List of users' } },
      },
      post: {
        tags: ['Users'],
        summary: 'Create user (admin)',
        responses: { '201': { description: 'User created' } },
      },
    },
    '/users/{id}': {
      put: {
        tags: ['Users'],
        summary: 'Update user (admin)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'User updated' } },
      },
      delete: {
        tags: ['Users'],
        summary: 'Delete user (admin)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'User deleted' } },
      },
    },
    '/rooms': {
      get: {
        tags: ['Rooms'],
        summary: 'List rooms for current user',
        responses: { '200': { description: 'Room list' } },
      },
      post: {
        tags: ['Rooms'],
        summary: 'Create a room',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: { type: 'string' },
                  type: { type: 'string', enum: ['private', 'group'] },
                  broadcastMode: { type: 'boolean' },
                  systemPrompt: { type: 'string' },
                  memberIds: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Room created' } },
      },
    },
    '/rooms/{id}': {
      get: {
        tags: ['Rooms'],
        summary: 'Get room details',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Room details with members' } },
      },
      put: {
        tags: ['Rooms'],
        summary: 'Update room',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Room updated' } },
      },
      delete: {
        tags: ['Rooms'],
        summary: 'Delete room',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Room deleted' } },
      },
    },
    '/rooms/{id}/members': {
      get: {
        tags: ['Rooms'],
        summary: 'Get room members',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Member list' } },
      },
      post: {
        tags: ['Rooms'],
        summary: 'Add member to room',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Member added' } },
      },
    },
    '/rooms/{id}/members/{memberId}': {
      delete: {
        tags: ['Rooms'],
        summary: 'Remove member from room',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'memberId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '200': { description: 'Member removed' } },
      },
    },
    '/rooms/{id}/pin': {
      put: {
        tags: ['Rooms'],
        summary: 'Toggle room pin',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Pin toggled' } },
      },
    },
    '/rooms/{id}/archive': {
      put: {
        tags: ['Rooms'],
        summary: 'Toggle room archive',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Archive toggled' } },
      },
    },
    '/rooms/{id}/notification-pref': {
      put: {
        tags: ['Rooms'],
        summary: 'Update notification preference',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Preference updated' } },
      },
    },
    '/messages/rooms/{roomId}': {
      get: {
        tags: ['Messages'],
        summary: 'Get messages for a room (cursor-based)',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'cursor', in: 'query', schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          {
            name: 'after',
            in: 'query',
            schema: { type: 'string', description: 'ISO timestamp for forward sync' },
          },
        ],
        responses: { '200': { description: 'Paginated messages' } },
      },
    },
    '/messages/search': {
      get: {
        tags: ['Messages'],
        summary: 'Search messages across rooms',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string', minLength: 2 } },
          { name: 'roomId', in: 'query', schema: { type: 'string' } },
          { name: 'sender', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
        ],
        responses: { '200': { description: 'Search results' } },
      },
    },
    '/messages/recent': {
      get: {
        tags: ['Messages'],
        summary: 'Get latest message + unread count per room',
        responses: { '200': { description: 'Recent messages map' } },
      },
    },
    '/messages/rooms/{roomId}/read': {
      post: {
        tags: ['Messages'],
        summary: 'Mark room as read',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Room marked as read' } },
      },
    },
    '/messages/mark-all-read': {
      post: {
        tags: ['Messages'],
        summary: 'Mark all rooms as read',
        responses: { '200': { description: 'All rooms marked as read' } },
      },
    },
    '/messages/{id}': {
      put: {
        tags: ['Messages'],
        summary: 'Edit a message',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Message edited' } },
      },
      delete: {
        tags: ['Messages'],
        summary: 'Delete a message',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Message deleted' } },
      },
    },
    '/messages/{id}/history': {
      get: {
        tags: ['Messages'],
        summary: 'Get edit history for a message',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Edit history' } },
      },
    },
    '/messages/{id}/reactions': {
      post: {
        tags: ['Messages'],
        summary: 'Toggle reaction on a message',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Reactions updated' } },
      },
    },
    '/messages/batch-delete': {
      post: {
        tags: ['Messages'],
        summary: 'Batch delete messages',
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['messageIds'],
                properties: {
                  messageIds: {
                    type: 'array',
                    items: { type: 'string' },
                    maxItems: 100,
                    description: 'IDs of messages to delete (must all be in the same room)',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Messages deleted, returns count' },
          '400': { description: 'Messages from multiple rooms or validation error' },
          '403': { description: 'No permission to delete' },
        },
      },
    },
    '/metrics': {
      get: {
        tags: ['System'],
        summary: 'Prometheus metrics',
        security: [],
        responses: {
          '200': {
            description: 'Prometheus-format metrics (client connections, gateways, agents, memory)',
            content: { 'text/plain': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/admin/metrics': {
      get: {
        tags: ['Admin'],
        summary: 'Admin dashboard metrics',
        responses: {
          '200': {
            description:
              'System metrics: user/room/message/agent counts, active connections, memory usage',
          },
          '403': { description: 'Admin access required' },
        },
      },
    },
    '/admin/settings': {
      get: {
        tags: ['Admin'],
        summary: 'Get all system settings',
        responses: {
          '200': { description: 'Key-value settings map' },
          '403': { description: 'Admin access required' },
        },
      },
      put: {
        tags: ['Admin'],
        summary: 'Update system settings',
        responses: {
          '200': { description: 'Settings updated' },
          '403': { description: 'Admin access required' },
        },
      },
    },
    '/agents': {
      get: {
        tags: ['Agents'],
        summary: 'List agents owned by current user',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
          { name: 'offset', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Agent list' } },
      },
    },
    '/agents/shared': {
      get: {
        tags: ['Agents'],
        summary: 'List agents shared by other users',
        responses: { '200': { description: 'Shared agent list' } },
      },
    },
    '/agents/{id}': {
      get: {
        tags: ['Agents'],
        summary: 'Get agent details',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Agent details' },
          '404': { description: 'Agent not found or not accessible' },
        },
      },
      put: {
        tags: ['Agents'],
        summary: 'Update agent settings',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Agent updated' } },
      },
    },
    '/agents/gateways/list': {
      get: {
        tags: ['Agents'],
        summary: 'List connected gateways',
        responses: { '200': { description: 'Gateway list with connected agent counts' } },
      },
    },
    '/tasks': {
      get: {
        tags: ['Tasks'],
        summary: 'List tasks for current user',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { '200': { description: 'Task list' } },
      },
    },
    '/tasks/rooms/{roomId}': {
      get: {
        tags: ['Tasks'],
        summary: 'List tasks for a room',
        parameters: [
          { name: 'roomId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { '200': { description: 'Task list for room' } },
      },
      post: {
        tags: ['Tasks'],
        summary: 'Create a task in a room',
        parameters: [{ name: 'roomId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: 'Task created' } },
      },
    },
    '/tasks/{id}': {
      put: {
        tags: ['Tasks'],
        summary: 'Update a task',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Task updated' } },
      },
      delete: {
        tags: ['Tasks'],
        summary: 'Delete a task',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Task deleted' } },
      },
    },
    '/upload': {
      post: {
        tags: ['Upload'],
        summary: 'Upload a file',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: { '200': { description: 'File uploaded' } },
      },
    },
    '/upload/avatar': {
      post: {
        tags: ['Upload'],
        summary: 'Upload an avatar',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Avatar uploaded' } },
      },
    },
    '/routers': {
      get: {
        tags: ['Routers'],
        summary: 'List routers visible to current user',
        responses: { '200': { description: 'Router list' } },
      },
      post: {
        tags: ['Routers'],
        summary: 'Create a router configuration',
        responses: { '201': { description: 'Router created' } },
      },
    },
    '/routers/{id}': {
      get: {
        tags: ['Routers'],
        summary: 'Get router details',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Router details' } },
      },
      put: {
        tags: ['Routers'],
        summary: 'Update router configuration',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Router updated' } },
      },
      delete: {
        tags: ['Routers'],
        summary: 'Delete a router',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Router deleted' } },
      },
    },
    '/routers/{id}/test': {
      post: {
        tags: ['Routers'],
        summary: 'Test LLM connection for a router',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Connection test result' } },
      },
    },
  },
  tags: [
    { name: 'System', description: 'System endpoints' },
    { name: 'Admin', description: 'Admin-only endpoints' },
    { name: 'Auth', description: 'Authentication' },
    { name: 'Users', description: 'User management' },
    { name: 'Rooms', description: 'Room management' },
    { name: 'Messages', description: 'Messaging' },
    { name: 'Agents', description: 'AI agent management' },
    { name: 'Tasks', description: 'Task management' },
    { name: 'Upload', description: 'File uploads' },
    { name: 'Routers', description: 'AI router configuration' },
  ],
}

export const docsRoutes = new Hono()

docsRoutes.get('/openapi.json', (c) => c.json(spec))
