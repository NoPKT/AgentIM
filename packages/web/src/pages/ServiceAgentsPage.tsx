import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useServiceAgentsStore } from '../stores/serviceAgents.js'
import { useAuthStore } from '../stores/auth.js'
import { Button } from '../components/ui.js'
import { toast } from '../stores/toast.js'
import { api } from '../lib/api.js'
import type { ServiceAgentCategory } from '@agentim/shared'

interface ProviderMeta {
  type: string
  displayName: string
  category: ServiceAgentCategory
  description?: string
  configSchema: {
    type: string
    properties?: Record<
      string,
      {
        type: string
        default?: unknown
        enum?: string[]
        format?: string
        minimum?: number
        maximum?: number
        minLength?: number
        maxLength?: number
      }
    >
    required?: string[]
  }
}

const CATEGORY_LABELS: Record<ServiceAgentCategory, string> = {
  chat: 'serviceAgent.category.chat',
  search: 'serviceAgent.category.search',
  image: 'serviceAgent.category.image',
  audio: 'serviceAgent.category.audio',
  video: 'serviceAgent.category.video',
  music: 'serviceAgent.category.music',
  '3d': 'serviceAgent.category.3d',
}

const CATEGORY_COLORS: Record<ServiceAgentCategory, string> = {
  chat: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  search: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
  image: 'bg-pink-100 text-pink-800 dark:bg-pink-900/30 dark:text-pink-300',
  audio: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  video: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
  music: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300',
  '3d': 'bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-300',
}

function ConfigField({
  name,
  schema,
  value,
  onChange,
  required,
}: {
  name: string
  schema: NonNullable<ProviderMeta['configSchema']['properties']>[string]
  value: unknown
  onChange: (v: unknown) => void
  required: boolean
}) {
  const { t } = useTranslation()
  const label = t(`serviceAgent.configField.${name}`, { defaultValue: name })
  const isSecret = name.toLowerCase().includes('key') || name.toLowerCase().includes('secret')

  if (schema.enum) {
    return (
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">
          {label}
          {required && <span className="text-danger-text ml-0.5">*</span>}
        </label>
        <select
          value={String(value ?? schema.default ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-accent text-sm"
        >
          {schema.enum.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
    )
  }

  if (schema.type === 'number' || schema.type === 'integer') {
    return (
      <div>
        <label className="block text-xs font-medium text-text-secondary mb-1">
          {label}
          {required && <span className="text-danger-text ml-0.5">*</span>}
        </label>
        <input
          type="number"
          value={value != null ? String(value) : String(schema.default ?? '')}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : undefined)}
          min={schema.minimum}
          max={schema.maximum}
          step={schema.type === 'integer' ? 1 : undefined}
          className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent text-sm"
        />
      </div>
    )
  }

  if (schema.type === 'boolean') {
    return (
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={Boolean(value ?? schema.default)}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded border-border"
        />
        <span className="text-sm text-text-primary">{label}</span>
      </label>
    )
  }

  // String
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">
        {label}
        {required && <span className="text-danger-text ml-0.5">*</span>}
      </label>
      <input
        type={isSecret ? 'password' : schema.format === 'url' ? 'url' : 'text'}
        value={String(value ?? schema.default ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder={schema.default ? String(schema.default) : undefined}
        className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent text-sm"
      />
    </div>
  )
}

export default function ServiceAgentsPage() {
  const { t } = useTranslation()
  const { serviceAgents, loading, fetchServiceAgents, createServiceAgent, deleteServiceAgent } =
    useServiceAgentsStore()
  const user = useAuthStore((s) => s.user)
  const [showCreate, setShowCreate] = useState(false)
  const [providers, setProviders] = useState<ProviderMeta[]>([])
  const [selectedType, setSelectedType] = useState('')
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [configValues, setConfigValues] = useState<Record<string, unknown>>({})
  const [creating, setCreating] = useState(false)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)

  useEffect(() => {
    fetchServiceAgents()
  }, [fetchServiceAgents])

  const fetchProviders = useCallback(async () => {
    try {
      const res = await api.get<ProviderMeta[]>('/service-agents/providers')
      if (res.ok && res.data) {
        setProviders(res.data)
        if (res.data.length > 0 && !selectedType) {
          setSelectedType(res.data[0].type)
        }
      }
    } catch {
      // ignore
    }
  }, [selectedType])

  useEffect(() => {
    if (showCreate && providers.length === 0) {
      fetchProviders()
    }
  }, [showCreate, providers.length, fetchProviders])

  const selectedProvider = providers.find((p) => p.type === selectedType)

  if (user?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-text-secondary">{t('error.forbidden')}</p>
      </div>
    )
  }

  const handleCreate = async () => {
    if (!selectedProvider) return
    setCreating(true)
    try {
      // Build config with defaults
      const config: Record<string, unknown> = {}
      const props = selectedProvider.configSchema.properties ?? {}
      for (const [key, schema] of Object.entries(props)) {
        const val = configValues[key]
        if (val !== undefined && val !== '') {
          config[key] = val
        } else if (schema.default !== undefined) {
          config[key] = schema.default
        }
      }

      await createServiceAgent({
        name: formName,
        type: selectedType,
        description: formDescription || undefined,
        config,
      })
      setShowCreate(false)
      setFormName('')
      setFormDescription('')
      setConfigValues({})
      toast.success(t('serviceAgent.created'))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = (id: string) => {
    setConfirmDeleteId(id)
  }

  const confirmDelete = async () => {
    if (!confirmDeleteId) return
    try {
      await deleteServiceAgent(confirmDeleteId)
      toast.success(t('serviceAgent.deleted'))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setConfirmDeleteId(null)
    }
  }

  const cancelDelete = () => setConfirmDeleteId(null)

  const isFormValid = () => {
    if (!formName.trim() || !selectedProvider) return false
    const required = selectedProvider.configSchema.required ?? []
    for (const key of required) {
      const val = configValues[key]
      if (val === undefined || val === '' || val === null) return false
    }
    return true
  }

  // Group providers by category
  const categorized = providers.reduce(
    (acc, p) => {
      if (!acc[p.category]) acc[p.category] = []
      acc[p.category].push(p)
      return acc
    },
    {} as Record<string, ProviderMeta[]>,
  )

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin bg-surface-secondary px-4 sm:px-6 py-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-text-primary">{t('serviceAgent.title')}</h1>
            <p className="mt-1 text-sm text-text-secondary">{t('serviceAgent.description')}</p>
          </div>
          <Button onClick={() => setShowCreate(!showCreate)}>{t('serviceAgent.create')}</Button>
        </div>

        {showCreate && (
          <div className="mb-6 p-5 bg-surface border border-border rounded-xl space-y-4">
            <h2 className="font-semibold text-text-primary">{t('serviceAgent.create')}</h2>

            {/* Provider type selector */}
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-2">
                {t('serviceAgent.providerType')}
              </label>
              <div className="space-y-2">
                {Object.entries(categorized).map(([cat, catProviders]) => (
                  <div key={cat}>
                    <span
                      className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded mb-1 ${CATEGORY_COLORS[cat as ServiceAgentCategory] ?? 'bg-gray-100 text-gray-700'}`}
                    >
                      {t(CATEGORY_LABELS[cat as ServiceAgentCategory] ?? cat)}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {catProviders.map((p) => (
                        <button
                          key={p.type}
                          onClick={() => {
                            setSelectedType(p.type)
                            setConfigValues({})
                          }}
                          className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                            selectedType === p.type
                              ? 'border-accent bg-accent/10 text-accent font-medium'
                              : 'border-border text-text-secondary hover:bg-surface-hover'
                          }`}
                        >
                          {p.displayName}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedProvider && (
              <>
                {selectedProvider.description && (
                  <p className="text-xs text-text-secondary">{selectedProvider.description}</p>
                )}

                {/* Name and description */}
                <input
                  type="text"
                  placeholder={t('serviceAgent.name')}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                />
                <input
                  type="text"
                  placeholder={t('serviceAgent.descriptionPlaceholder')}
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
                />

                {/* Dynamic config fields */}
                <div className="space-y-3 pt-1">
                  <h3 className="text-sm font-medium text-text-primary">
                    {t('serviceAgent.configureApi')}
                  </h3>
                  {Object.entries(selectedProvider.configSchema.properties ?? {}).map(
                    ([key, schema]) => (
                      <ConfigField
                        key={key}
                        name={key}
                        schema={schema}
                        value={configValues[key]}
                        onChange={(v) => setConfigValues((prev) => ({ ...prev, [key]: v }))}
                        required={(selectedProvider.configSchema.required ?? []).includes(key)}
                      />
                    ),
                  )}
                </div>

                <div className="flex gap-2 pt-1">
                  <Button onClick={handleCreate} disabled={creating || !isFormValid()}>
                    {creating ? t('common.creating') : t('common.save')}
                  </Button>
                  <Button variant="secondary" onClick={() => setShowCreate(false)}>
                    {t('common.cancel')}
                  </Button>
                </div>
              </>
            )}
          </div>
        )}

        {loading && serviceAgents.length === 0 ? (
          <div className="text-center py-8 text-text-secondary">{t('common.loading')}</div>
        ) : serviceAgents.length === 0 ? (
          <div className="text-center py-12">
            <svg
              className="mx-auto h-16 w-16 text-text-muted"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01"
              />
            </svg>
            <h3 className="mt-4 text-lg font-semibold text-text-primary">
              {t('serviceAgent.empty')}
            </h3>
            <p className="mt-2 text-sm text-text-secondary">{t('serviceAgent.emptyDesc')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {serviceAgents.map((sa) => (
              <div
                key={sa.id}
                className="flex items-center justify-between p-4 bg-surface border border-border rounded-xl hover:shadow-sm transition-all"
              >
                <div className="min-w-0">
                  <div className="font-medium text-text-primary">{sa.name}</div>
                  {sa.description && (
                    <div className="text-sm text-text-secondary mt-1">{sa.description}</div>
                  )}
                  <div className="flex items-center gap-2 mt-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${CATEGORY_COLORS[sa.category] ?? 'bg-gray-100 text-gray-700'}`}
                    >
                      {t(CATEGORY_LABELS[sa.category] ?? sa.category)}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-surface-hover text-text-secondary font-medium">
                      {t(`serviceAgent.providers.${sa.type}`, { defaultValue: sa.type })}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        sa.status === 'active'
                          ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                          : sa.status === 'error'
                            ? 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300'
                            : 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {t(`serviceAgent.${sa.status}`)}
                    </span>
                  </div>
                </div>
                {confirmDeleteId === sa.id ? (
                  <div className="flex items-center gap-2 ml-4">
                    <span className="text-xs text-red-500">{t('serviceAgent.confirmDelete')}</span>
                    <button
                      onClick={confirmDelete}
                      className="text-xs text-red-600 dark:text-red-400 font-medium hover:underline"
                    >
                      {t('common.confirm')}
                    </button>
                    <button
                      onClick={cancelDelete}
                      className="text-xs text-text-secondary hover:underline"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleDelete(sa.id)}
                    className="ml-4 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                  >
                    {t('common.delete')}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
