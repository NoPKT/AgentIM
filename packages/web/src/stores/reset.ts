/**
 * Registration-based store reset.
 * Each store registers its own reset function at creation time,
 * avoiding circular dependency issues with dynamic imports.
 */
type ResetFn = () => void
const resetFns: ResetFn[] = []

/** Called by each store at module init to register a cleanup function. */
export function registerStoreReset(fn: ResetFn): void {
  resetFns.push(fn)
}

/** Reset all registered stores (called on logout / auth expiry). */
export function resetAllStores(): void {
  for (const fn of resetFns) {
    fn()
  }
}
