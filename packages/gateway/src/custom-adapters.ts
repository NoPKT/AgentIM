import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { z } from 'zod'
import { createLogger } from './lib/logger.js'

const log = createLogger('CustomAdapters')

const ADAPTERS_FILE = join(homedir(), '.agentim', 'adapters.json')

const CustomAdapterSchema = z.object({
  command: z.string().min(1, 'command must not be empty'),
  args: z.array(z.string()).optional(),
  promptVia: z.enum(['arg', 'stdin']).optional(),
  env: z.record(z.string(), z.string()).optional(),
  description: z.string().optional(),
})

export type CustomAdapterConfig = z.infer<typeof CustomAdapterSchema>

const CustomAdaptersFileSchema = z.record(z.string().min(1), CustomAdapterSchema)

export type CustomAdaptersFile = z.infer<typeof CustomAdaptersFileSchema>

let cachedAdapters: CustomAdaptersFile | null = null

/**
 * Load custom adapter configurations from ~/.agentim/adapters.json.
 * Results are cached after the first successful load.
 */
export function loadCustomAdapters(): CustomAdaptersFile {
  if (cachedAdapters) return cachedAdapters

  if (!existsSync(ADAPTERS_FILE)) {
    cachedAdapters = {}
    return cachedAdapters
  }

  try {
    const raw = JSON.parse(readFileSync(ADAPTERS_FILE, 'utf-8'))
    const parsed = CustomAdaptersFileSchema.parse(raw)
    cachedAdapters = parsed
    log.debug(`Loaded ${Object.keys(parsed).length} custom adapter(s) from ${ADAPTERS_FILE}`)
    return cachedAdapters
  } catch (err) {
    if (err instanceof z.ZodError) {
      log.error(`Invalid adapters.json: ${err.issues.map((i) => i.message).join(', ')}`)
    } else {
      log.error(`Failed to load adapters.json: ${err instanceof Error ? err.message : String(err)}`)
    }
    cachedAdapters = {}
    return cachedAdapters
  }
}

/**
 * Get a custom adapter config by name.
 * Returns undefined if not found.
 */
export function getCustomAdapter(type: string): CustomAdapterConfig | undefined {
  const adapters = loadCustomAdapters()
  return adapters[type]
}

/**
 * List all custom adapters with their names.
 */
export function listCustomAdapters(): Array<{ name: string } & CustomAdapterConfig> {
  const adapters = loadCustomAdapters()
  return Object.entries(adapters).map(([name, config]) => ({
    name,
    ...config,
  }))
}

/**
 * Get the path to the custom adapters config file.
 */
export function getCustomAdaptersPath(): string {
  return ADAPTERS_FILE
}
