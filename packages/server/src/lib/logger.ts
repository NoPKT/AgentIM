type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal'

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
const minLevel = LEVELS[(process.env.LOG_LEVEL as LogLevel) ?? (isProduction ? 'info' : 'debug')]

function formatDev(level: LogLevel, ctx: string, message: string, extra?: Record<string, unknown>) {
  const time = new Date().toISOString().slice(11, 23) // HH:mm:ss.SSS
  const color = COLORS[level]
  const tag = level.toUpperCase().padEnd(5)
  const ctxStr = ctx ? ` [${ctx}]` : ''
  const extraStr = extra ? ' ' + JSON.stringify(extra) : ''
  return `${color}${time} ${tag}${RESET}${ctxStr} ${message}${extraStr}`
}

function formatJson(
  level: LogLevel,
  ctx: string,
  message: string,
  extra?: Record<string, unknown>,
) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    ...(ctx ? { ctx } : {}),
    msg: message,
    ...extra,
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
