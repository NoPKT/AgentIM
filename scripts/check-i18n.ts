// i18n key completeness checker
// Compares all locale files against the English reference locale
// and reports missing or extra keys.

import { en } from '../packages/shared/src/i18n/locales/en.js'
import { zhCN } from '../packages/shared/src/i18n/locales/zh-CN.js'
import { ja } from '../packages/shared/src/i18n/locales/ja.js'
import { ko } from '../packages/shared/src/i18n/locales/ko.js'
import { fr } from '../packages/shared/src/i18n/locales/fr.js'
import { de } from '../packages/shared/src/i18n/locales/de.js'
import { ru } from '../packages/shared/src/i18n/locales/ru.js'

type NestedObject = { [key: string]: string | NestedObject }

// Flatten a nested object into dot-separated key paths
function flattenKeys(obj: NestedObject, prefix = ''): string[] {
  const keys: string[] = []
  for (const key of Object.keys(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key
    const value = obj[key]
    if (typeof value === 'object' && value !== null) {
      keys.push(...flattenKeys(value as NestedObject, fullKey))
    } else {
      keys.push(fullKey)
    }
  }
  return keys
}

const locales: Record<string, NestedObject> = {
  'zh-CN': zhCN as unknown as NestedObject,
  ja: ja as unknown as NestedObject,
  ko: ko as unknown as NestedObject,
  fr: fr as unknown as NestedObject,
  de: de as unknown as NestedObject,
  ru: ru as unknown as NestedObject,
}

const referenceKeys = new Set(flattenKeys(en as unknown as NestedObject))
let hasIssues = false

console.log(`Reference locale (en): ${referenceKeys.size} keys\n`)

for (const [name, locale] of Object.entries(locales)) {
  const localeKeys = new Set(flattenKeys(locale))

  // Keys present in EN but missing from this locale
  const missing = [...referenceKeys].filter((k) => !localeKeys.has(k))
  // Keys present in this locale but not in EN
  const extra = [...localeKeys].filter((k) => !referenceKeys.has(k))

  if (missing.length === 0 && extra.length === 0) {
    console.log(`[${name}] OK (${localeKeys.size} keys)`)
    continue
  }

  hasIssues = true

  if (missing.length > 0) {
    console.log(`[${name}] Missing ${missing.length} key(s):`)
    for (const key of missing) {
      console.log(`  - ${key}`)
    }
  }

  if (extra.length > 0) {
    console.log(`[${name}] Extra ${extra.length} key(s) (not in EN):`)
    for (const key of extra) {
      console.log(`  + ${key}`)
    }
  }

  console.log()
}

if (hasIssues) {
  console.log('\ni18n check FAILED — see issues above.')
  process.exit(1)
} else {
  console.log('\ni18n check passed — all locales are complete.')
  process.exit(0)
}
