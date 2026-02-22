import { lazy, Suspense } from 'react'
import type { Components } from 'react-markdown'

const MarkdownRenderer = lazy(() => import('./MarkdownRenderer.js'))

interface LazyMarkdownProps {
  children: string
  components?: Components
}

export function LazyMarkdown({ children, components }: LazyMarkdownProps) {
  return (
    <Suspense fallback={<div className="whitespace-pre-wrap">{children}</div>}>
      <MarkdownRenderer components={components}>{children}</MarkdownRenderer>
    </Suspense>
  )
}
