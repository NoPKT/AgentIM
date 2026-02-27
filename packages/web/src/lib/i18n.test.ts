import { describe, it, expect } from 'vitest'
import i18n from './i18n'

describe('i18n configuration', () => {
  it('has fallback language set to en', () => {
    expect(i18n.options.fallbackLng).toEqual(['en'])
  })

  it('all 7 languages are loaded', () => {
    const langs = Object.keys(i18n.options.resources ?? {})
    expect(langs).toEqual(expect.arrayContaining(['en', 'zh-CN', 'ja', 'ko', 'fr', 'de', 'ru']))
    expect(langs).toHaveLength(7)
  })

  it('translation keys are accessible via t()', () => {
    const result = i18n.t('common.save', { lng: 'en' })
    expect(result).toBeTruthy()
    expect(result).not.toBe('common.save')
  })
})
