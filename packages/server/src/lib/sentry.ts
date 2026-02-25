import { config } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('Sentry')

let sentryCaptureException: ((err: unknown) => void) | null = null
let sentryCaptureMessage: ((msg: string, level?: string) => void) | null = null

export async function initSentry(): Promise<void> {
  if (!config.sentryDsn) return

  try {
    // @ts-expect-error — @sentry/node is an optional peer dependency
    const sentry = await import('@sentry/node')
    sentry.init({
      dsn: config.sentryDsn,
      environment: config.isProduction ? 'production' : 'development',
      tracesSampleRate: config.isProduction ? 0.1 : 1.0,
    })
    sentryCaptureException = sentry.captureException
    sentryCaptureMessage = sentry.captureMessage
    log.info('Sentry initialized')
  } catch {
    log.warn('Sentry SDK not installed. Run: pnpm add @sentry/node')
  }
}

/**
 * Re-initialize Sentry with a new DSN. Called when admin updates sentry.dsn.
 * Empty DSN disables Sentry.
 */
export async function reinitSentry(dsn: string): Promise<void> {
  if (!dsn) {
    sentryCaptureException = null
    sentryCaptureMessage = null
    log.info('Sentry disabled (DSN cleared)')
    return
  }

  try {
    // @ts-expect-error — @sentry/node is an optional peer dependency
    const sentry = await import('@sentry/node')
    sentry.init({
      dsn,
      environment: config.isProduction ? 'production' : 'development',
      tracesSampleRate: config.isProduction ? 0.1 : 1.0,
    })
    sentryCaptureException = sentry.captureException
    sentryCaptureMessage = sentry.captureMessage
    log.info('Sentry re-initialized with new DSN')
  } catch {
    log.warn('Sentry SDK not installed. Run: pnpm add @sentry/node')
  }
}

export function captureException(err: unknown): void {
  sentryCaptureException?.(err)
}

export function captureMessage(message: string): void {
  sentryCaptureMessage?.(message)
}
