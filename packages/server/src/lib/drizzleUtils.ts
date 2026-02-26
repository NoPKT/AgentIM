/**
 * Extract the affected row count from a Drizzle ORM mutation result.
 * Drizzle's pg driver returns { rowCount: number } but the type definition
 * does not expose it, requiring a cast. This helper centralises the workaround.
 */
export function getAffectedRowCount(result: unknown): number {
  return (result as { rowCount?: number }).rowCount ?? 0
}
