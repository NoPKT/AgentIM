import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { useState, type ReactNode } from 'react'
import { ErrorBoundary } from './ErrorBoundary.js'

const consoleError = console.error
beforeEach(() => {
  console.error = vi.fn()
})
afterEach(() => {
  console.error = consoleError
})

vi.mock('./ui.js', () => ({
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}))

function NormalChild() {
  return <div>Child content</div>
}

function ThrowingChild(): ReactNode {
  throw new Error('Test render error')
}

/**
 * A wrapper that lets us toggle whether the child throws from outside.
 * This avoids the re-throw problem when clicking "retry" while the
 * original throwing child is still in the tree.
 */
function ToggleWrapper() {
  const [throwing, setThrowing] = useState(true)
  return (
    <ErrorBoundary>
      {throwing ? (
        <div>
          <ThrowingChild />
          {/* This won't render but keeps TypeScript happy */}
          <button onClick={() => setThrowing(false)}>stop</button>
        </div>
      ) : (
        <NormalChild />
      )}
    </ErrorBoundary>
  )
}

describe('ErrorBoundary', () => {
  it('renders children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <NormalChild />
      </ErrorBoundary>,
    )
    expect(screen.getByText('Child content')).toBeInTheDocument()
  })

  it('renders fallback UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Test render error')).toBeInTheDocument()
  })

  it('clears error state when retry button is clicked and child no longer throws', () => {
    // Render ErrorBoundary with a child that does NOT throw
    const { rerender } = render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    )

    // Confirm error boundary caught the error
    expect(screen.getByRole('alert')).toBeInTheDocument()

    // Re-render with a non-throwing child BEFORE clicking retry,
    // so that when ErrorBoundary resets its state, it renders the safe child
    rerender(
      <ErrorBoundary>
        <NormalChild />
      </ErrorBoundary>,
    )

    // Click retry — resets hasError → false, triggers re-render with NormalChild
    act(() => {
      fireEvent.click(screen.getByText('common.retry'))
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByText('Child content')).toBeInTheDocument()
  })
})
