import { z } from 'zod'
import { createLogger } from './logger.js'
import type { RouterConfig } from './routerConfig.js'

const log = createLogger('RouterLLM')

const ROUTER_TIMEOUT = 5000

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

export async function selectAgents(
  content: string,
  agents: Array<{ id: string; name: string; type: string; capabilities?: string[] }>,
  routerConfig: Pick<RouterConfig, 'llmBaseUrl' | 'llmApiKey' | 'llmModel'>,
  roomSystemPrompt?: string,
): Promise<string[] | null> {
  if (!routerConfig.llmBaseUrl || !routerConfig.llmApiKey) return null
  if (agents.length === 0) return []

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
      const isTimeout = fetchErr instanceof DOMException && fetchErr.name === 'AbortError'
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

    // Extract JSON from the response (handle markdown code blocks)
    const jsonMatch = text.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      log.warn('Router LLM response does not contain JSON object')
      return null
    }

    let parsed: z.infer<typeof routerResultSchema>
    try {
      const result = routerResultSchema.safeParse(JSON.parse(jsonMatch[0]))
      if (!result.success) {
        log.warn(`Router LLM agentIds schema mismatch: ${result.error.message}`)
        return null
      }
      parsed = result.data
    } catch {
      log.warn(`Router LLM returned invalid JSON in content: ${jsonMatch[0].slice(0, 200)}`)
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
