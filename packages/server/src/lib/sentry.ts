import { config } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('Sentry')

let sentryCaptureException: ((err: unknown) => void) | null = null
let sentryCaptureMessage: ((msg: string, level?: string) => void) | null = null

export async function initSentry(): Promise<void> {
  if (!config.sentryDsn) return

  try {
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — @sentry/node is an optional dependency
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

export function captureException(err: unknown): void {
  sentryCaptureException?.(err)
}

export function captureMessage(message: string): void {
  sentryCaptureMessage?.(message)
}
