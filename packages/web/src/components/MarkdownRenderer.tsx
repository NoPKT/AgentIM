import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import rehypeSanitize from 'rehype-sanitize'
import { markdownSanitizeSchema } from '../lib/markdown.js'
import type { Components } from 'react-markdown'

interface MarkdownRendererProps {
  children: string
  components?: Components
}

export default function MarkdownRenderer({ children, components }: MarkdownRendererProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[[rehypeSanitize, markdownSanitizeSchema], rehypeHighlight]}
      components={components}
    >
      {children}
    </ReactMarkdown>
  )
}
