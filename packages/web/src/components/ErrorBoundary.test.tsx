import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { type ReactNode } from 'react'
import { ErrorBoundary, setErrorReporter } from './ErrorBoundary.js'

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

  it('calls the error reporter when a child throws', () => {
    const reporter = vi.fn()
    setErrorReporter(reporter)

    render(
      <ErrorBoundary>
        <ThrowingChild />
      </ErrorBoundary>,
    )

    expect(reporter).toHaveBeenCalledTimes(1)
    expect(reporter).toHaveBeenCalledWith(expect.any(Error), expect.any(String))
    expect(reporter.mock.calls[0][0].message).toBe('Test render error')

    // Clean up the reporter
    setErrorReporter(() => {})
  })

  it('uses custom fallback when provided', () => {
    const customFallback = (error: Error | undefined, retry: () => void) => (
      <div>
        <span>Custom error: {error?.message}</span>
        <button onClick={retry}>Custom retry</button>
      </div>
    )

    render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowingChild />
      </ErrorBoundary>,
    )

    expect(screen.getByText('Custom error: Test render error')).toBeInTheDocument()
    expect(screen.getByText('Custom retry')).toBeInTheDocument()
  })

  it('recovers from error using custom fallback retry', () => {
    const customFallback = (error: Error | undefined, retry: () => void) => (
      <div>
        <span>Custom error: {error?.message}</span>
        <button onClick={retry}>Custom retry</button>
      </div>
    )

    const { rerender } = render(
      <ErrorBoundary fallback={customFallback}>
        <ThrowingChild />
      </ErrorBoundary>,
    )

    // Error state is shown
    expect(screen.getByText('Custom error: Test render error')).toBeInTheDocument()

    // Swap to non-throwing child before retry
    rerender(
      <ErrorBoundary fallback={customFallback}>
        <NormalChild />
      </ErrorBoundary>,
    )

    // Click custom retry to clear error state
    act(() => {
      fireEvent.click(screen.getByText('Custom retry'))
    })

    expect(screen.getByText('Child content')).toBeInTheDocument()
    expect(screen.queryByText('Custom error:')).not.toBeInTheDocument()
  })

  it('shows error.generic text when no error message is available', () => {
    function ThrowNoMessage(): ReactNode {
      throw new Error()
    }

    render(
      <ErrorBoundary>
        <ThrowNoMessage />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('alert')).toBeInTheDocument()
    // Falls back to t('error.network') when message is empty
    expect(screen.getByText('error.network')).toBeInTheDocument()
  })
})
