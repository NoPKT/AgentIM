import { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminSettingsStore, type SettingItem } from '../stores/adminSettings.js'
import { toast } from '../stores/toast.js'
import { Button, Input, Select, FormField } from '../components/ui.js'

const GROUP_ORDER = [
  'general',
  'security',
  'storage',
  'rateLimit',
  'connections',
  'aiRouter',
  'maintenance',
] as const

const GROUP_LABEL_KEYS: Record<string, string> = {
  general: 'adminSettings.groupGeneral',
  security: 'adminSettings.groupSecurity',
  storage: 'adminSettings.groupStorage',
  rateLimit: 'adminSettings.groupRateLimit',
  connections: 'adminSettings.groupConnections',
  aiRouter: 'adminSettings.groupAiRouter',
  maintenance: 'adminSettings.groupMaintenance',
}

export default function AdminSettingsPage() {
  const { t } = useTranslation()
  const { groups, loading, saving, loadSettings, saveSettings } = useAdminSettingsStore()
  const [localValues, setLocalValues] = useState<Record<string, string>>({})
  const [dirty, setDirty] = useState<Set<string>>(new Set())

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Sync localValues when groups load
  useEffect(() => {
    const vals: Record<string, string> = {}
    for (const items of Object.values(groups)) {
      for (const item of items) {
        vals[item.key] = item.value
      }
    }
    setLocalValues(vals)
    setDirty(new Set())
  }, [groups])

  const handleChange = useCallback(
    (key: string, value: string) => {
      setLocalValues((prev) => ({ ...prev, [key]: value }))
      setDirty((prev) => {
        const next = new Set(prev)
        // Check if value differs from server value
        const serverValue =
          Object.values(groups)
            .flat()
            .find((item) => item.key === key)?.value ?? ''
        if (value !== serverValue) {
          next.add(key)
        } else {
          next.delete(key)
        }
        return next
      })
    },
    [groups],
  )

  const handleSaveGroup = useCallback(
    async (groupKey: string) => {
      const items = groups[groupKey] ?? []
      const changes: Record<string, string> = {}
      for (const item of items) {
        if (dirty.has(item.key)) {
          changes[item.key] = localValues[item.key] ?? item.value
        }
      }
      if (Object.keys(changes).length === 0) return

      const result = await saveSettings(changes)
      if (result.ok) {
        toast.success(t('adminSettings.saved'))
        await loadSettings()
      } else {
        toast.error(result.error || t('adminSettings.saveFailed'))
      }
    },
    [groups, dirty, localValues, saveSettings, loadSettings, t],
  )

  if (loading && Object.keys(groups).length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{t('adminSettings.title')}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t('adminSettings.description')}</p>
      </div>

      {/* Setting Groups */}
      {GROUP_ORDER.map((groupKey) => {
        const items = groups[groupKey]
        if (!items || items.length === 0) return null
        const groupDirty = items.some((item) => dirty.has(item.key))

        return (
          <div
            key={groupKey}
            className="bg-surface rounded-lg border border-border shadow-sm"
          >
            <div className="px-6 py-4 border-b border-border">
              <h2 className="text-lg font-semibold text-text-primary">
                {t(GROUP_LABEL_KEYS[groupKey])}
              </h2>
            </div>
            <div className="px-6 py-5 space-y-5">
              {items.map((item) => (
                <SettingField
                  key={item.key}
                  item={item}
                  value={localValues[item.key] ?? item.value}
                  isDirty={dirty.has(item.key)}
                  onChange={(v) => handleChange(item.key, v)}
                />
              ))}
            </div>
            <div className="px-6 py-3 border-t border-border flex justify-end">
              <Button
                size="sm"
                disabled={!groupDirty || saving}
                onClick={() => handleSaveGroup(groupKey)}
              >
                {saving ? t('common.saving') : t('common.save')}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function SettingField({
  item,
  value,
  isDirty,
  onChange,
}: {
  item: SettingItem
  value: string
  isDirty: boolean
  onChange: (v: string) => void
}) {
  const { t } = useTranslation()

  const sourceLabel =
    item.source === 'db'
      ? t('adminSettings.sourceDb')
      : item.source === 'env'
        ? t('adminSettings.sourceEnv')
        : t('adminSettings.sourceDefault')

  const label = (
    <span className="flex items-center gap-2">
      {t(item.labelKey)}
      {isDirty && <span className="w-2 h-2 rounded-full bg-warning-text inline-block" />}
      <span className="text-xs text-text-muted font-normal">({sourceLabel})</span>
    </span>
  )

  if (item.type === 'boolean') {
    return (
      <FormField label={label} helperText={t(item.descKey)}>
        <button
          type="button"
          role="switch"
          aria-checked={value === 'true'}
          onClick={() => onChange(value === 'true' ? 'false' : 'true')}
          className={`
            relative inline-flex h-6 w-11 items-center rounded-full transition-colors
            ${value === 'true' ? 'bg-accent' : 'bg-surface-hover'}
          `}
        >
          <span
            className={`
              inline-block h-4 w-4 transform rounded-full bg-white transition-transform
              ${value === 'true' ? 'translate-x-6' : 'translate-x-1'}
            `}
          />
        </button>
      </FormField>
    )
  }

  if (item.type === 'enum' && item.enumValues) {
    return (
      <FormField label={label} helperText={t(item.descKey)}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {item.enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </Select>
      </FormField>
    )
  }

  return (
    <FormField label={label} helperText={t(item.descKey)}>
      <Input
        type={item.sensitive ? 'password' : item.type === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={item.min}
        max={item.max}
        placeholder={item.sensitive ? '••••••••' : undefined}
      />
    </FormField>
  )
}
