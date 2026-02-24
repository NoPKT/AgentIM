/**
 * Reset all stores on logout. Uses dynamic imports to avoid circular dependencies
 * between auth store and other stores.
 */
export async function resetAllStores(): Promise<void> {
  const [{ useChatStore }, { useAgentStore }, { useRouterStore }] = await Promise.all([
    import('./chat.js'),
    import('./agents.js'),
    import('./routers.js'),
  ])

  useChatStore.getState().reset()
  useAgentStore.setState({ agents: [], sharedAgents: [], isLoading: false, loadError: false })
  useRouterStore.setState({ routers: [], loading: false })
}
