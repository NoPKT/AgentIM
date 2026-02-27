import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MarkdownRenderer from './MarkdownRenderer.js'

describe('MarkdownRenderer', () => {
  it('renders plain text', () => {
    render(<MarkdownRenderer>Hello world</MarkdownRenderer>)
    expect(screen.getByText('Hello world')).toBeInTheDocument()
  })

  it('renders bold text', () => {
    render(<MarkdownRenderer>{'This is **bold** text'}</MarkdownRenderer>)
    const bold = screen.getByText('bold')
    expect(bold.tagName).toBe('STRONG')
  })

  it('renders italic text', () => {
    render(<MarkdownRenderer>{'This is *italic* text'}</MarkdownRenderer>)
    const italic = screen.getByText('italic')
    expect(italic.tagName).toBe('EM')
  })

  it('renders inline code', () => {
    render(<MarkdownRenderer>{'Use `console.log` for debugging'}</MarkdownRenderer>)
    const code = screen.getByText('console.log')
    expect(code.tagName).toBe('CODE')
  })

  it('renders code blocks', () => {
    const markdown = '```\nconst x = 1\n```'
    const { container } = render(<MarkdownRenderer>{markdown}</MarkdownRenderer>)
    const pre = container.querySelector('pre')
    expect(pre).toBeInTheDocument()
    const code = pre?.querySelector('code')
    expect(code).toBeInTheDocument()
    expect(code?.textContent).toContain('const x = 1')
  })

  it('renders links', () => {
    render(<MarkdownRenderer>{'Visit [example](https://example.com)'}</MarkdownRenderer>)
    const link = screen.getByText('example')
    expect(link.tagName).toBe('A')
    expect(link.getAttribute('href')).toBe('https://example.com')
  })

  it('renders unordered lists', () => {
    const markdown = '- Item 1\n- Item 2\n- Item 3'
    const { container } = render(<MarkdownRenderer>{markdown}</MarkdownRenderer>)
    const ul = container.querySelector('ul')
    expect(ul).toBeInTheDocument()
    const items = ul?.querySelectorAll('li')
    expect(items?.length).toBe(3)
  })

  it('renders ordered lists', () => {
    const markdown = '1. First\n2. Second\n3. Third'
    const { container } = render(<MarkdownRenderer>{markdown}</MarkdownRenderer>)
    const ol = container.querySelector('ol')
    expect(ol).toBeInTheDocument()
  })

  it('renders headings', () => {
    render(<MarkdownRenderer>{'# Heading 1'}</MarkdownRenderer>)
    const heading = screen.getByText('Heading 1')
    expect(heading.tagName).toBe('H1')
  })

  it('renders blockquotes', () => {
    const { container } = render(<MarkdownRenderer>{'> This is a quote'}</MarkdownRenderer>)
    const blockquote = container.querySelector('blockquote')
    expect(blockquote).toBeInTheDocument()
    expect(blockquote?.textContent).toContain('This is a quote')
  })

  it('renders GFM strikethrough', () => {
    render(<MarkdownRenderer>{'~~deleted~~'}</MarkdownRenderer>)
    const del = screen.getByText('deleted')
    expect(del.tagName).toBe('DEL')
  })

  it('strips raw HTML due to skipHtml', () => {
    const { container } = render(
      <MarkdownRenderer>{'<script>alert("xss")</script>'}</MarkdownRenderer>,
    )
    // The script tag should not be rendered
    expect(container.querySelector('script')).toBeNull()
    // The text content should not contain the script
    expect(container.textContent).not.toContain('alert')
  })

  it('accepts custom components override', () => {
    const CustomParagraph = ({ children }: { children?: React.ReactNode }) => (
      <div data-testid="custom-p">{children}</div>
    )
    render(
      <MarkdownRenderer components={{ p: CustomParagraph }}>{'Hello custom'}</MarkdownRenderer>,
    )
    expect(screen.getByTestId('custom-p')).toBeInTheDocument()
    expect(screen.getByText('Hello custom')).toBeInTheDocument()
  })

  it('renders empty string without error', () => {
    const { container } = render(<MarkdownRenderer>{''}</MarkdownRenderer>)
    expect(container).toBeInTheDocument()
  })

  it('renders multiline content', () => {
    const markdown = 'Line 1\n\nLine 2\n\nLine 3'
    render(<MarkdownRenderer>{markdown}</MarkdownRenderer>)
    expect(screen.getByText('Line 1')).toBeInTheDocument()
    expect(screen.getByText('Line 2')).toBeInTheDocument()
    expect(screen.getByText('Line 3')).toBeInTheDocument()
  })
})
