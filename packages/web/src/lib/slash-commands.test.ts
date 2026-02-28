import { describe, it, expect, vi } from 'vitest'
import { parseSlashCommand, getCommand, getAllCommands, registerCommand } from './slash-commands.js'

describe('slash-commands', () => {
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
      expect(parseSlashCommand('/task Create a new feature')).toEqual({
        name: 'task',
        args: 'Create a new feature',
      })
    })

    it('handles extra whitespace', () => {
      expect(parseSlashCommand('/help ')).toEqual({ name: 'help', args: '' })
    })

    it('returns name with empty args for slash followed by command only', () => {
      expect(parseSlashCommand('/ ')).toEqual({ name: '', args: '' })
    })

    it('handles slash-only input', () => {
      expect(parseSlashCommand('/')).toEqual({ name: '', args: '' })
    })

    it('trims args whitespace', () => {
      expect(parseSlashCommand('/task   hello world  ')).toEqual({
        name: 'task',
        args: 'hello world',
      })
    })

    it('handles special characters in args', () => {
      expect(parseSlashCommand('/task @user #tag $var')).toEqual({
        name: 'task',
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
      expect(parseSlashCommand('/task 你好世界')).toEqual({
        name: 'task',
        args: '你好世界',
      })
    })
  })

  describe('getCommand', () => {
    it('returns built-in commands', () => {
      expect(getCommand('help')).toBeDefined()
      expect(getCommand('clear')).toBeDefined()
      expect(getCommand('stop')).toBeDefined()
      expect(getCommand('agents')).toBeDefined()
    })

    it('returns undefined for unknown commands', () => {
      expect(getCommand('nonexistent')).toBeUndefined()
    })
  })

  describe('getAllCommands', () => {
    it('returns all registered commands', () => {
      const commands = getAllCommands()
      expect(commands.length).toBeGreaterThanOrEqual(4)
      const names = commands.map((c) => c.command.name)
      expect(names).toContain('help')
      expect(names).toContain('clear')
      expect(names).toContain('stop')
      expect(names).toContain('agents')
    })
  })

  describe('command execution', () => {
    it('dispatches CustomEvent for clear command', () => {
      const handler = vi.fn()
      window.addEventListener('slash:clear', handler)
      const cmd = getCommand('clear')
      cmd?.execute('')
      expect(handler).toHaveBeenCalled()
      window.removeEventListener('slash:clear', handler)
    })

    it('dispatches CustomEvent for help command', () => {
      const handler = vi.fn()
      window.addEventListener('slash:help', handler)
      const cmd = getCommand('help')
      cmd?.execute('')
      expect(handler).toHaveBeenCalled()
      window.removeEventListener('slash:help', handler)
    })

    it('dispatches CustomEvent for stop command with args', () => {
      const handler = vi.fn()
      window.addEventListener('slash:stop', handler)
      const cmd = getCommand('stop')
      cmd?.execute('@myagent')
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { args: '@myagent' },
        }),
      )
      window.removeEventListener('slash:stop', handler)
    })

    it('dispatches CustomEvent for agents command', () => {
      const handler = vi.fn()
      window.addEventListener('slash:agents', handler)
      const cmd = getCommand('agents')
      cmd?.execute('')
      expect(handler).toHaveBeenCalled()
      window.removeEventListener('slash:agents', handler)
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
