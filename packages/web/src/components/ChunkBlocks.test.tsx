import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { ParsedChunk } from '@agentim/shared'
import { groupChunks, ThinkingBlock, ToolUseBlock } from './ChunkBlocks.js'

// ─── groupChunks pure function ───

describe('groupChunks', () => {
  it('returns empty array for empty input', () => {
    expect(groupChunks([])).toEqual([])
  })

  it('groups consecutive text chunks', () => {
    const chunks: ParsedChunk[] = [
      { type: 'text', content: 'Hello ' },
      { type: 'text', content: 'world' },
    ]
    const result = groupChunks(chunks)
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('text')
    expect(result[0].content).toBe('Hello world')
  })

  it('groups consecutive thinking chunks', () => {
    const chunks: ParsedChunk[] = [
      { type: 'thinking', content: 'Step 1\n' },
      { type: 'thinking', content: 'Step 2' },
    ]
    const result = groupChunks(chunks)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('Step 1\nStep 2')
  })

  it('does not group tool_use chunks', () => {
    const chunks: ParsedChunk[] = [
      { type: 'tool_use', content: 'tool A' },
      { type: 'tool_use', content: 'tool B' },
    ]
    const result = groupChunks(chunks)
    expect(result).toHaveLength(2)
  })

  it('does not group tool_result chunks', () => {
    const chunks: ParsedChunk[] = [
      { type: 'tool_result', content: 'result A' },
      { type: 'tool_result', content: 'result B' },
    ]
    const result = groupChunks(chunks)
    expect(result).toHaveLength(2)
  })

  it('does not group workspace_status chunks', () => {
    const chunks: ParsedChunk[] = [
      { type: 'workspace_status', content: 'status A' },
      { type: 'workspace_status', content: 'status B' },
    ]
    const result = groupChunks(chunks)
    expect(result).toHaveLength(2)
  })

  it('separates different types', () => {
    const chunks: ParsedChunk[] = [
      { type: 'text', content: 'Hello' },
      { type: 'thinking', content: 'thinking...' },
      { type: 'text', content: 'World' },
    ]
    const result = groupChunks(chunks)
    expect(result).toHaveLength(3)
    expect(result[0].type).toBe('text')
    expect(result[1].type).toBe('thinking')
    expect(result[2].type).toBe('text')
  })

  it('preserves metadata from first chunk in group', () => {
    const chunks: ParsedChunk[] = [
      { type: 'text', content: 'a', metadata: { key: 'val' } },
      { type: 'text', content: 'b' },
    ]
    const result = groupChunks(chunks)
    expect(result).toHaveLength(1)
    expect(result[0].metadata).toEqual({ key: 'val' })
  })

  it('handles mixed sequence with tool blocks', () => {
    const chunks: ParsedChunk[] = [
      { type: 'text', content: 'start' },
      { type: 'tool_use', content: 'cmd', metadata: { toolName: 'Bash' } },
      { type: 'tool_result', content: 'ok', metadata: { toolId: '1' } },
      { type: 'text', content: 'end' },
    ]
    const result = groupChunks(chunks)
    expect(result).toHaveLength(4)
    expect(result[0].type).toBe('text')
    expect(result[1].type).toBe('tool_use')
    expect(result[2].type).toBe('tool_result')
    expect(result[3].type).toBe('text')
  })

  it('handles single chunk', () => {
    const chunks: ParsedChunk[] = [{ type: 'error', content: 'oops' }]
    const result = groupChunks(chunks)
    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('oops')
  })
})

// ─── ThinkingBlock component ───

describe('ThinkingBlock', () => {
  it('renders collapsed by default', () => {
    render(<ThinkingBlock content="line1\nline2\nline3" />)
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('expands on click', () => {
    render(<ThinkingBlock content="line1\nline2\nline3" />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })

  it('shows summary text from last line', () => {
    render(<ThinkingBlock content="first\nsecond\nthird" />)
    expect(screen.getByText(/third/)).toBeInTheDocument()
  })

  it('truncates long summary to 60 chars', () => {
    const longLine = 'a'.repeat(80)
    render(<ThinkingBlock content={longLine} />)
    expect(screen.getByText(/\.\.\.$/)).toBeInTheDocument()
  })
})

// ─── ToolUseBlock component ───

describe('ToolUseBlock', () => {
  it('renders tool name for generic tools', () => {
    render(<ToolUseBlock content='{"query":"test"}' metadata={{ toolName: 'WebSearch' }} />)
    expect(screen.getByText(/WebSearch/)).toBeInTheDocument()
  })

  it('renders collapsed by default', () => {
    render(
      <ToolUseBlock content='{"url":"https://example.com"}' metadata={{ toolName: 'WebFetch' }} />,
    )
    const button = screen.getByRole('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('expands on click to show content', () => {
    render(<ToolUseBlock content='{"data":"value"}' metadata={{ toolName: 'CustomTool' }} />)
    const button = screen.getByRole('button')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
  })
})
