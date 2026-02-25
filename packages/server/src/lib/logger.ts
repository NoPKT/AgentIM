type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

const SENSITIVE_KEYS = new Set([
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'encryptionkey',
  'encryption_key',
  'accesstoken',
  'refreshtoken',
  'tokenhash',
  'llmapikey',
  's3accesskeyid',
  's3secretaccesskey',
  'vapidpublickey',
  'vapidprivatekey',
  'privatekey',
  'secretkey',
  'secret_key',
  'p256dh',
  'auth',
])

function redactSensitive(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]'
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = redactSensitive(value as Record<string, unknown>)
    } else {
      result[key] = value
    }
  }
  return result
}

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  fatal: 4,
}

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m', // gray
  info: '\x1b[36m', // cyan
  warn: '\x1b[33m', // yellow
  error: '\x1b[31m', // red
  fatal: '\x1b[35m', // magenta
}
const RESET = '\x1b[0m'

const isProduction = process.env.NODE_ENV === 'production'
const envLevel = process.env.LOG_LEVEL as LogLevel | undefined
const defaultLevel: LogLevel = isProduction ? 'info' : 'debug'
const minLevel = (() => {
  if (!envLevel) return LEVELS[defaultLevel]
  if (envLevel in LEVELS) return LEVELS[envLevel]
  console.warn(
    `[Logger] Invalid LOG_LEVEL "${envLevel}", expected one of: ${Object.keys(LEVELS).join(', ')}. Falling back to "${defaultLevel}".`,
  )
  return LEVELS[defaultLevel]
})()

function formatDev(level: LogLevel, ctx: string, message: string, extra?: Record<string, unknown>) {
  const time = new Date().toISOString().slice(11, 23) // HH:mm:ss.SSS
  const color = COLORS[level]
  const tag = level.toUpperCase().padEnd(5)
  const ctxStr = ctx ? ` [${ctx}]` : ''
  const safe = extra ? redactSensitive(extra) : undefined
  const extraStr = safe ? ' ' + JSON.stringify(safe) : ''
  return `${color}${time} ${tag}${RESET}${ctxStr} ${message}${extraStr}`
}

function formatJson(
  level: LogLevel,
  ctx: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  const safe = extra ? redactSensitive(extra) : undefined
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...(ctx ? { ctx } : {}),
    msg: message,
    ...safe,
  })
}

const format = isProduction ? formatJson : formatDev

function log(level: LogLevel, ctx: string, message: string, extra?: Record<string, unknown>) {
  if (LEVELS[level] < minLevel) return
  const line = format(level, ctx, message, extra)
  if (level === 'error' || level === 'fatal') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
}

export function createLogger(ctx: string) {
  return {
    debug: (msg: string, extra?: Record<string, unknown>) => log('debug', ctx, msg, extra),
    info: (msg: string, extra?: Record<string, unknown>) => log('info', ctx, msg, extra),
    warn: (msg: string, extra?: Record<string, unknown>) => log('warn', ctx, msg, extra),
    error: (msg: string, extra?: Record<string, unknown>) => log('error', ctx, msg, extra),
    fatal: (msg: string, extra?: Record<string, unknown>) => log('fatal', ctx, msg, extra),
  }
}
