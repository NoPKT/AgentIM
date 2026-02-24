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
  })

  describe('getCommand', () => {
    it('returns built-in commands', () => {
      expect(getCommand('help')).toBeDefined()
      expect(getCommand('clear')).toBeDefined()
      expect(getCommand('task')).toBeDefined()
      expect(getCommand('status')).toBeDefined()
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
      expect(names).toContain('task')
      expect(names).toContain('status')
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

    it('dispatches CustomEvent for task command with args', () => {
      const handler = vi.fn()
      window.addEventListener('slash:task', handler)
      const cmd = getCommand('task')
      cmd?.execute('My task title')
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          detail: { title: 'My task title' },
        }),
      )
      window.removeEventListener('slash:task', handler)
    })

    it('dispatches CustomEvent for status command', () => {
      const handler = vi.fn()
      window.addEventListener('slash:status', handler)
      const cmd = getCommand('status')
      cmd?.execute('')
      expect(handler).toHaveBeenCalled()
      window.removeEventListener('slash:status', handler)
    })
  })

  describe('registerCommand', () => {
    it('registers a new custom command', () => {
      registerCommand({
        command: { name: 'custom-test', description: 'A test command', usage: '/custom-test' },
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
          name: 'custom-test',
          description: 'Overridden command',
          usage: '/custom-test',
        },
        execute: newExecute,
      })

      const cmd = getCommand('custom-test')
      expect(cmd!.command.description).toBe('Overridden command')
    })
  })
})
