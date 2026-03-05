/**
 * Check if an agent is visible to a given user based on its visibility settings.
 * Owner check is not included — callers should check ownership separately.
 */
export function isAgentVisibleToUser(
  agent: { visibility: string; visibilityList: string[] },
  userId: string,
): boolean {
  if (agent.visibility === 'private') return false
  if (agent.visibility === 'all') return true
  if (agent.visibility === 'whitelist') return agent.visibilityList.includes(userId)
  return false
}
