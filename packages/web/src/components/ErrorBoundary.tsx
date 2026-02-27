import { Component, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui.js'

type ErrorReporter = (error: Error, componentStack?: string) => void

let _errorReporter: ErrorReporter | null = null

/** Register an external error reporter (e.g. Sentry) for production use. */
export function setErrorReporter(reporter: ErrorReporter) {
  _errorReporter = reporter
}

interface Props {
  children: ReactNode
  fallback?: (error: Error | undefined, retry: () => void) => ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

function ErrorFallback({
  error,
  onRetry,
  onGoHome,
}: {
  error?: Error
  onRetry: () => void
  onGoHome: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-secondary px-4">
      <div className="text-center max-w-md" role="alert">
        <div className="mx-auto w-16 h-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4">
          <svg
            className="w-8 h-8 text-red-600 dark:text-red-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-text-primary mb-2">{t('error.generic')}</h1>
        <p className="text-sm text-text-secondary mb-4">{error?.message || t('error.network')}</p>
        <div className="flex gap-3 justify-center">
          <Button onClick={onRetry}>{t('common.retry')}</Button>
          <Button variant="secondary" onClick={onGoHome}>
            {t('common.back')}
          </Button>
        </div>
      </div>
    </div>
  )
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
    _errorReporter?.(error, info.componentStack ?? undefined)
  }

  componentDidMount() {
    this._onError = (event: ErrorEvent) => {
      console.error('[ErrorBoundary] Uncaught error:', event.error)
      _errorReporter?.(event.error instanceof Error ? event.error : new Error(String(event.error)))
      this.setState({
        hasError: true,
        error: event.error instanceof Error ? event.error : new Error(String(event.error)),
      })
    }
    this._onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const err = event.reason instanceof Error ? event.reason : new Error(String(event.reason))
      console.error('[ErrorBoundary] Unhandled rejection:', err)
      _errorReporter?.(err)
      this.setState({ hasError: true, error: err })
    }
    window.addEventListener('error', this._onError)
    window.addEventListener('unhandledrejection', this._onUnhandledRejection)
  }

  componentWillUnmount() {
    if (this._onError) {
      window.removeEventListener('error', this._onError)
    }
    if (this._onUnhandledRejection) {
      window.removeEventListener('unhandledrejection', this._onUnhandledRejection)
    }
  }

  private _onError: ((event: ErrorEvent) => void) | null = null
  private _onUnhandledRejection: ((event: PromiseRejectionEvent) => void) | null = null

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, () =>
          this.setState({ hasError: false, error: undefined }),
        )
      }
      return (
        <ErrorFallback
          error={this.state.error}
          onRetry={() => this.setState({ hasError: false, error: undefined })}
          onGoHome={() => {
            this.setState({ hasError: false, error: undefined })
            window.location.href = '/'
          }}
        />
      )
    }

    return this.props.children
  }
}
