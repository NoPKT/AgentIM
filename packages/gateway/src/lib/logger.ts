type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
}

const COLORS: Record<LogLevel, string> = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
}
const RESET = '\x1b[0m'

const envLevel = process.env.LOG_LEVEL as LogLevel | undefined
const minLevel = (envLevel && envLevel in LEVELS) ? LEVELS[envLevel] : LEVELS.info

function log(level: LogLevel, ctx: string, message: string) {
  if (LEVELS[level] < minLevel) return
  const time = new Date().toISOString().slice(11, 23)
  const color = COLORS[level]
  const tag = level.toUpperCase().padEnd(5)
  const ctxStr = ctx ? ` [${ctx}]` : ''
  const line = `${color}${time} ${tag}${RESET}${ctxStr} ${message}`
  if (level === 'error') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
}

export function createLogger(ctx: string) {
  return {
    debug: (msg: string) => log('debug', ctx, msg),
    info: (msg: string) => log('info', ctx, msg),
    warn: (msg: string) => log('warn', ctx, msg),
    error: (msg: string) => log('error', ctx, msg),
  }
}
