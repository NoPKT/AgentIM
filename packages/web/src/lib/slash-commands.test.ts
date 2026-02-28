import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies before importing the module under test
vi.mock('../stores/chat.js', () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      currentRoomId: 'room-1',
      messages: new Map([['room-1', [{ id: 'msg-1', content: 'hello' }]]]),
      streaming: new Map(),
    })),
    setState: vi.fn(),
  },
}))

vi.mock('../stores/agents.js', () => ({
  useAgentStore: {
    getState: vi.fn(() => ({
      agents: [{ id: 'agent-1', name: 'TestAgent', type: 'claude-code', status: 'online' }],
    })),
  },
}))

vi.mock('./ws.js', () => ({
  wsClient: {
    send: vi.fn(),
  },
}))

vi.mock('../stores/toast.js', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}))

import { parseSlashCommand, getCommand, getAllCommands, registerCommand } from './slash-commands.js'
import { useChatStore } from '../stores/chat.js'
import { wsClient } from './ws.js'
import { toast } from '../stores/toast.js'

describe('slash-commands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('parseSlashCommand', () => {
    it('returns null for non-slash input', () => {
      expect(parseSlashCommand('hello')).toBeNull()
      expect(parseSlashCommand('')).toBeNull()
    })

    it('parses command without args', () => {
      expect(parseSlashCommand('/help')).toEqual({ name: 'help', args: '' })
      expect(parseSlashCommand('/clear')).toEqual({ name: 'clear', args: '' })
    })

    it('parses command with args', () => {
      expect(parseSlashCommand('/stop @TestAgent')).toEqual({
        name: 'stop',
        args: '@TestAgent',
      })
    })

    it('handles extra whitespace', () => {
      expect(parseSlashCommand('/help ')).toEqual({ name: 'help', args: '' })
    })

    it('returns null for slash followed by only whitespace', () => {
      expect(parseSlashCommand('/ ')).toBeNull()
    })

    it('returns null for slash-only input', () => {
      expect(parseSlashCommand('/')).toBeNull()
    })

    it('trims args whitespace', () => {
      expect(parseSlashCommand('/stop   @agent  ')).toEqual({
        name: 'stop',
        args: '@agent',
      })
    })

    it('handles special characters in args', () => {
      expect(parseSlashCommand('/stop @user #tag $var')).toEqual({
        name: 'stop',
        args: '@user #tag $var',
      })
    })

    it('handles command names with hyphens', () => {
      expect(parseSlashCommand('/my-command arg1')).toEqual({
        name: 'my-command',
        args: 'arg1',
      })
    })

    it('handles unicode characters in args', () => {
      expect(parseSlashCommand('/stop 你好世界')).toEqual({
        name: 'stop',
        args: '你好世界',
      })
    })
  })

  describe('getCommand', () => {
    it('returns built-in commands', () => {
      expect(getCommand('help')).toBeDefined()
      expect(getCommand('clear')).toBeDefined()
      expect(getCommand('stop')).toBeDefined()
    })

    it('returns undefined for unknown commands', () => {
      expect(getCommand('nonexistent')).toBeUndefined()
    })
  })

  describe('getAllCommands', () => {
    it('returns all registered commands', () => {
      const commands = getAllCommands()
      expect(commands.length).toBeGreaterThanOrEqual(3)
      const names = commands.map((c) => c.command.name)
      expect(names).toContain('help')
      expect(names).toContain('clear')
      expect(names).toContain('stop')
    })
  })

  describe('command execution', () => {
    it('/clear clears messages for the current room', () => {
      const cmd = getCommand('clear')
      cmd?.execute('')
      expect(useChatStore.setState).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.any(Map),
        }),
      )
      // The new messages map should have an empty array for room-1
      const callArgs = vi.mocked(useChatStore.setState).mock.calls[0][0] as {
        messages: Map<string, unknown[]>
      }
      expect(callArgs.messages.get('room-1')).toEqual([])
    })

    it('/help shows a toast with command list', () => {
      const cmd = getCommand('help')
      cmd?.execute('')
      expect(toast.info).toHaveBeenCalled()
    })

    it('/stop with @agent sends stop_generation for that agent', () => {
      const cmd = getCommand('stop')
      cmd?.execute('@TestAgent')
      expect(wsClient.send).toHaveBeenCalledWith({
        type: 'client:stop_generation',
        roomId: 'room-1',
        agentId: 'agent-1',
      })
    })

    it('/stop without args stops all streaming agents', () => {
      // Mock streaming state with an active stream
      vi.mocked(useChatStore.getState).mockReturnValue({
        currentRoomId: 'room-1',
        messages: new Map(),
        streaming: new Map([
          [
            'room-1:agent-1',
            {
              agentId: 'agent-1',
              agentName: 'TestAgent',
              messageId: 'msg-1',
              chunks: [],
              lastChunkAt: Date.now(),
            },
          ],
        ]),
      } as ReturnType<typeof useChatStore.getState>)

      const cmd = getCommand('stop')
      cmd?.execute('')
      expect(wsClient.send).toHaveBeenCalledWith({
        type: 'client:stop_generation',
        roomId: 'room-1',
        agentId: 'agent-1',
      })
    })

    it('/stop shows error for unknown agent name', () => {
      const cmd = getCommand('stop')
      cmd?.execute('@nonexistent')
      expect(toast.error).toHaveBeenCalled()
      expect(wsClient.send).not.toHaveBeenCalled()
    })
  })

  describe('registerCommand', () => {
    it('registers a new custom command', () => {
      registerCommand({
        command: {
          name: 'custom-test' as any,
          description: 'A test command',
          usage: '/custom-test',
          clientOnly: true,
        },
        execute: vi.fn(),
      })

      const cmd = getCommand('custom-test')
      expect(cmd).toBeDefined()
      expect(cmd!.command.name).toBe('custom-test')
      expect(cmd!.command.description).toBe('A test command')
    })

    it('overrides an existing command with the same name', () => {
      const newExecute = vi.fn()
      registerCommand({
        command: {
          name: 'custom-test' as any,
          description: 'Overridden command',
          usage: '/custom-test',
          clientOnly: true,
        },
        execute: newExecute,
      })

      const cmd = getCommand('custom-test')
      expect(cmd!.command.description).toBe('Overridden command')
    })
  })
})
