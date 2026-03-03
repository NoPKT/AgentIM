import { useState, useMemo, useCallback } from 'react'
import type { LogEntry } from './use-logs.js'

// Strip ANSI escape codes for matching
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

export function useLogSearch(logs: LogEntry[]) {
  const [active, setActive] = useState(false)
  const [query, setQuery] = useState('')
  const [confirmedQuery, setConfirmedQuery] = useState('')
  const [currentMatch, setCurrentMatch] = useState(-1)

  // Compute matching line indices whenever confirmed query or logs change
  const matchIndices = useMemo(() => {
    if (!confirmedQuery) return []
    const lowerQuery = confirmedQuery.toLowerCase()
    const indices: number[] = []
    for (let i = 0; i < logs.length; i++) {
      const plain = stripAnsi(logs[i].line).toLowerCase()
      if (plain.includes(lowerQuery)) {
        indices.push(i)
      }
    }
    return indices
  }, [confirmedQuery, logs])

  const activate = useCallback(() => {
    setActive(true)
    setQuery(confirmedQuery)
  }, [confirmedQuery])

  const deactivate = useCallback(() => {
    setActive(false)
    setQuery('')
  }, [])

  const confirm = useCallback(() => {
    const trimmed = query.trim()
    setActive(false)
    setConfirmedQuery(trimmed)
    setQuery('')
    if (trimmed) {
      // Will set to first match after matchIndices recomputes
      setCurrentMatch(0)
    } else {
      setCurrentMatch(-1)
    }
  }, [query])

  const clearSearch = useCallback(() => {
    setActive(false)
    setQuery('')
    setConfirmedQuery('')
    setCurrentMatch(-1)
  }, [])

  const nextMatch = useCallback(() => {
    if (matchIndices.length === 0) return
    setCurrentMatch((i) => (i + 1) % matchIndices.length)
  }, [matchIndices.length])

  const prevMatch = useCallback(() => {
    if (matchIndices.length === 0) return
    setCurrentMatch((i) => (i - 1 + matchIndices.length) % matchIndices.length)
  }, [matchIndices.length])

  return {
    active,
    query,
    setQuery,
    confirmedQuery,
    matchIndices,
    currentMatch,
    /** The line index of the current match (or -1 if none) */
    currentMatchLine:
      matchIndices.length > 0 && currentMatch >= 0 ? matchIndices[currentMatch] : -1,
    activate,
    deactivate,
    confirm,
    clearSearch,
    nextMatch,
    prevMatch,
  }
}
