import { useState, useCallback } from 'react'

export type FocusRegion = 'agents' | 'status' | 'logs'

const REGIONS: FocusRegion[] = ['agents', 'status', 'logs']

export function useFocusRegion(initial: FocusRegion = 'agents') {
  const [region, setRegion] = useState<FocusRegion>(initial)

  const cycleNext = useCallback(() => {
    setRegion((r) => {
      const idx = REGIONS.indexOf(r)
      return REGIONS[(idx + 1) % REGIONS.length]
    })
  }, [])

  const cyclePrev = useCallback(() => {
    setRegion((r) => {
      const idx = REGIONS.indexOf(r)
      return REGIONS[(idx - 1 + REGIONS.length) % REGIONS.length]
    })
  }, [])

  return { region, setRegion, cycleNext, cyclePrev }
}
