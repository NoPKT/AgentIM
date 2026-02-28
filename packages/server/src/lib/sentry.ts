import * as sentry from '@sentry/node'
import { config } from '../config.js'
import { createLogger } from './logger.js'

const log = createLogger('Sentry')

let initialized = false

export async function initSentry(): Promise<void> {
  if (!config.sentryDsn) return

  sentry.init({
    dsn: config.sentryDsn,
    environment: config.isProduction ? 'production' : 'development',
    tracesSampleRate: config.isProduction ? 0.1 : 1.0,
  })
  initialized = true
  log.info('Sentry initialized')
}

/**
 * Re-initialize Sentry with a new DSN. Called when admin updates sentry.dsn.
 * Empty DSN disables Sentry.
 */
export async function reinitSentry(dsn: string): Promise<void> {
  if (!dsn) {
    initialized = false
    log.info('Sentry disabled (DSN cleared)')
    return
  }

  sentry.init({
    dsn,
    environment: config.isProduction ? 'production' : 'development',
    tracesSampleRate: config.isProduction ? 0.1 : 1.0,
  })
  initialized = true
  log.info('Sentry re-initialized with new DSN')
}

export function captureException(err: unknown): void {
  if (initialized) sentry.captureException(err)
}

export function captureMessage(message: string): void {
  if (initialized) sentry.captureMessage(message)
}
