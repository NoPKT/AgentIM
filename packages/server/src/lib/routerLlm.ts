import { z } from 'zod'
import { config } from '../config.js'
import { createLogger } from './logger.js'
import type { RouterConfig } from './routerConfig.js'

const log = createLogger('RouterLLM')

const ROUTER_TIMEOUT = config.routerLlmTimeoutMs

const MAX_ROUTER_AGENTS = Math.max(1, parseInt(process.env.ROUTER_LLM_MAX_AGENTS ?? '', 10) || 20)

const llmResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string().optional() }).optional(),
      }),
    )
    .optional(),
})

const routerResultSchema = z.object({
  agentIds: z.array(z.string()),
})

/** Tokenize a string into lowercase alpha-numeric words for keyword matching. */
export function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9\u4e00-\u9fff]+/g) ?? [])
}

/** Score an agent by keyword overlap between the message and the agent's name/capabilities. */
export function scoreAgent(
  messageTokens: Set<string>,
  agent: { name: string; type: string; capabilities?: string[] },
): number {
  const agentText = [agent.name, agent.type, ...(agent.capabilities ?? [])].join(' ')
  const agentTokens = tokenize(agentText)
  let overlap = 0
  for (const token of messageTokens) {
    if (agentTokens.has(token)) overlap++
  }
  return overlap
}

/**
 * Extract the first balanced JSON object from a string.
 * Handles strings that may contain markdown code fences or prose around the JSON.
 * Uses bracket-depth counting instead of a greedy regex to avoid matching
 * across multiple objects (e.g. `{...} some text {...}`).
 */
export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start === -1) return null
  let depth = 0
  let inString = false
  let escape = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\' && inString) {
      escape = true
      continue
    }
    if (ch === '"') {
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

export async function selectAgents(
  content: string,
  agents: Array<{ id: string; name: string; type: string; capabilities?: string[] }>,
  routerConfig: Pick<RouterConfig, 'llmBaseUrl' | 'llmApiKey' | 'llmModel'>,
  roomSystemPrompt?: string,
): Promise<string[] | null> {
  if (!routerConfig.llmBaseUrl || !routerConfig.llmApiKey) return null
  if (agents.length === 0) return []

  // Pre-filter agents by keyword relevance when the list is too large for the LLM context
  if (agents.length > MAX_ROUTER_AGENTS) {
    const messageTokens = tokenize(content)
    const scored = agents
      .map((a) => ({ agent: a, score: scoreAgent(messageTokens, a) }))
      .sort((a, b) => b.score - a.score)
    agents = scored.slice(0, MAX_ROUTER_AGENTS).map((s) => s.agent)
    log.debug(`Pre-filtered ${scored.length} agents to top ${agents.length} by keyword relevance`)
  }

  const agentDescriptions = agents
    .map((a) => {
      const caps = a.capabilities?.length
        ? ` (capabilities: ${a.capabilities.slice(0, 10).join(', ')})`
        : ''
      return `- id: "${a.id}", name: "${a.name}", type: "${a.type}"${caps}`
    })
    .join('\n')

  const systemContent = [
    'You are a message router for a multi-agent chat system.',
    'Given a user message and a list of available agents, select which agent(s) should receive and respond to this message.',
    'Return ONLY a JSON object: { "agentIds": ["id1", "id2"] }',
    'Select the most relevant agent(s). If no agent is clearly suited, return an empty array.',
    roomSystemPrompt ? `\nRoom context: ${roomSystemPrompt}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const userContent = `Available agents:\n${agentDescriptions}\n\nUser message: "${content}"`

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), ROUTER_TIMEOUT)

    let res: Response
    try {
      res = await fetch(`${routerConfig.llmBaseUrl}/chat/completions`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${routerConfig.llmApiKey}`,
        },
        body: JSON.stringify({
          model: routerConfig.llmModel,
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: userContent },
          ],
          temperature: 0,
          max_tokens: 256,
        }),
        signal: controller.signal,
      })
    } catch (fetchErr) {
      clearTimeout(timeout)
      const isTimeout = (fetchErr as any)?.name === 'AbortError'
      log.warn(
        `Router LLM ${isTimeout ? 'timeout' : 'network error'}: ${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)}`,
      )
      return null
    } finally {
      clearTimeout(timeout)
    }

    if (!res.ok) {
      log.warn(`Router LLM HTTP error: status ${res.status} ${res.statusText}`)
      return null
    }

    let raw: unknown
    try {
      raw = await res.json()
    } catch {
      log.warn('Router LLM response body is not valid JSON')
      return null
    }

    const data = llmResponseSchema.safeParse(raw)
    if (!data.success) {
      log.warn(`Router LLM response schema mismatch: ${data.error.message}`)
      return null
    }
    const text = data.data.choices?.[0]?.message?.content?.trim()
    if (!text) {
      log.warn('Router LLM returned empty content')
      return null
    }

    // Extract JSON from the response (handle markdown code blocks).
    // Use a bracket-balanced scan instead of a greedy regex to avoid
    // capturing across multiple JSON objects or nested structures.
    let parsed: z.infer<typeof routerResultSchema>
    try {
      const jsonStr = extractJsonObject(text)
      if (!jsonStr) {
        log.warn('Router LLM response does not contain JSON object')
        return null
      }
      const result = routerResultSchema.safeParse(JSON.parse(jsonStr))
      if (!result.success) {
        log.warn(`Router LLM agentIds schema mismatch: ${result.error.message}`)
        return null
      }
      parsed = result.data
    } catch {
      log.warn(`Router LLM returned invalid JSON in content: ${text.slice(0, 200)}`)
      return null
    }

    // Validate that returned IDs exist in the agent list
    const validIds = new Set(agents.map((a) => a.id))
    return parsed.agentIds.filter((id) => validIds.has(id))
  } catch (err) {
    log.warn(`Router LLM unexpected error: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
