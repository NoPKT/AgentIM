/**
 * Build a name→agent map, preferring online agents when duplicates exist.
 */
export function buildAgentNameMap<T extends { name: string; status: string }>(
  agents: T[],
): Map<string, T> {
  const map = new Map<string, T>()
  for (const a of agents) {
    const existing = map.get(a.name)
    if (!existing || (existing.status !== 'online' && a.status === 'online')) {
      map.set(a.name, a)
    }
  }
  return map
}
