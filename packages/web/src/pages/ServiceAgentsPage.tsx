import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useServiceAgentsStore } from '../stores/serviceAgents.js'
import { useAuthStore } from '../stores/auth.js'
import { Button } from '../components/ui.js'
import { toast } from '../stores/toast.js'

export default function ServiceAgentsPage() {
  const { t } = useTranslation()
  const { serviceAgents, loading, fetchServiceAgents, createServiceAgent, deleteServiceAgent } =
    useServiceAgentsStore()
  const user = useAuthStore((s) => s.user)
  const [showCreate, setShowCreate] = useState(false)
  const [formData, setFormData] = useState({
    name: '',
    type: 'openai-compatible' as const,
    description: '',
    baseUrl: '',
    apiKey: '',
    model: '',
  })
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    fetchServiceAgents()
  }, [fetchServiceAgents])

  if (user?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-text-secondary">{t('error.forbidden')}</p>
      </div>
    )
  }

  const handleCreate = async () => {
    setCreating(true)
    try {
      await createServiceAgent({
        name: formData.name,
        type: formData.type,
        description: formData.description || undefined,
        config: {
          baseUrl: formData.baseUrl,
          apiKey: formData.apiKey,
          model: formData.model,
        },
      })
      setShowCreate(false)
      setFormData({
        name: '',
        type: 'openai-compatible',
        description: '',
        baseUrl: '',
        apiKey: '',
        model: '',
      })
      toast.success(t('serviceAgent.created'))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm(t('serviceAgent.confirmDelete'))) return
    try {
      await deleteServiceAgent(id)
      toast.success(t('serviceAgent.deleted'))
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

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
          <div className="mb-6 p-5 bg-surface border border-border rounded-xl space-y-3">
            <h2 className="font-semibold text-text-primary">{t('serviceAgent.create')}</h2>
            <input
              type="text"
              placeholder={t('serviceAgent.name')}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="text"
              placeholder={t('serviceAgent.descriptionPlaceholder')}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="url"
              placeholder={t('serviceAgent.baseUrl')}
              value={formData.baseUrl}
              onChange={(e) => setFormData({ ...formData, baseUrl: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="password"
              placeholder={t('serviceAgent.apiKey')}
              value={formData.apiKey}
              onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <input
              type="text"
              placeholder={t('serviceAgent.model')}
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              className="w-full px-3 py-2 border border-border rounded-lg bg-surface text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <div className="flex gap-2 pt-1">
              <Button
                onClick={handleCreate}
                disabled={
                  creating ||
                  !formData.name ||
                  !formData.baseUrl ||
                  !formData.apiKey ||
                  !formData.model
                }
              >
                {creating ? t('common.creating') : t('common.save')}
              </Button>
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                {t('common.cancel')}
              </Button>
            </div>
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
                    <span className="text-xs px-2 py-0.5 rounded-full bg-surface-hover text-text-secondary font-medium">
                      {sa.type}
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
                      {sa.status}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => handleDelete(sa.id)}
                  className="ml-4 px-3 py-1.5 text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
