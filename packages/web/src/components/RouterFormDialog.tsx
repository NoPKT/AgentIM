import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { Router } from '@agentim/shared'
import { useRouterStore } from '../stores/routers.js'
import { useAuthStore } from '../stores/auth.js'
import { toast } from '../stores/toast.js'
import { Button, Input, Modal } from './ui.js'

interface RouterFormDialogProps {
  isOpen: boolean
  onClose: () => void
  router?: Router | null
}

export function RouterFormDialog({ isOpen, onClose, router }: RouterFormDialogProps) {
  const { t } = useTranslation()
  const createRouter = useRouterStore((s) => s.createRouter)
  const updateRouter = useRouterStore((s) => s.updateRouter)
  const testRouter = useRouterStore((s) => s.testRouter)
  const user = useAuthStore((s) => s.user)
  const isAdmin = user?.role === 'admin'
  const isEditing = !!router

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<'personal' | 'global'>('personal')
  const [llmBaseUrl, setLlmBaseUrl] = useState('')
  const [llmApiKey, setLlmApiKey] = useState('')
  const [llmModel, setLlmModel] = useState('')
  const [maxChainDepth, setMaxChainDepth] = useState(5)
  const [rateLimitWindow, setRateLimitWindow] = useState(60)
  const [rateLimitMax, setRateLimitMax] = useState(20)
  const [visibility, setVisibility] = useState<'all' | 'whitelist' | 'blacklist'>('all')
  const [visibilityList, setVisibilityList] = useState('')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (router) {
      setName(router.name)
      setDescription(router.description ?? '')
      setScope(router.scope as 'personal' | 'global')
      setLlmBaseUrl(router.llmBaseUrl)
      setLlmApiKey('')
      setLlmModel(router.llmModel)
      setMaxChainDepth(router.maxChainDepth)
      setRateLimitWindow(router.rateLimitWindow)
      setRateLimitMax(router.rateLimitMax)
      setVisibility(router.visibility as 'all' | 'whitelist' | 'blacklist')
      setVisibilityList(Array.isArray(router.visibilityList) ? router.visibilityList.join(', ') : '')
    } else {
      setName('')
      setDescription('')
      setScope('personal')
      setLlmBaseUrl('')
      setLlmApiKey('')
      setLlmModel('')
      setMaxChainDepth(5)
      setRateLimitWindow(60)
      setRateLimitMax(20)
      setVisibility('all')
      setVisibilityList('')
    }
  }, [router, isOpen])

  const handleSubmit = async () => {
    if (!name.trim() || !llmBaseUrl.trim() || !llmModel.trim()) return
    if (!isEditing && !llmApiKey.trim()) return

    // URL format validation
    try {
      new URL(llmBaseUrl.trim())
    } catch {
      toast.error(t('router.invalidUrl'))
      return
    }

    // Number range validation (clamp to valid range)
    const clampedDepth = Math.max(1, Math.min(100, maxChainDepth))
    const clampedWindow = Math.max(1, Math.min(3600, rateLimitWindow))
    const clampedMax = Math.max(1, Math.min(1000, rateLimitMax))

    setSaving(true)
    try {
      const visListArr = [...new Set(
        visibilityList
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )]

      if (isEditing) {
        const data: Record<string, unknown> = {
          name: name.trim(),
          description: description.trim() || null,
          llmBaseUrl: llmBaseUrl.trim(),
          llmModel: llmModel.trim(),
          maxChainDepth: clampedDepth,
          rateLimitWindow: clampedWindow,
          rateLimitMax: clampedMax,
          visibility,
          visibilityList: visListArr,
        }
        if (llmApiKey.trim()) data.llmApiKey = llmApiKey.trim()
        await updateRouter(router!.id, data)
        toast.success(t('router.updated'))
      } else {
        await createRouter({
          name: name.trim(),
          description: description.trim() || undefined,
          scope,
          llmBaseUrl: llmBaseUrl.trim(),
          llmApiKey: llmApiKey.trim(),
          llmModel: llmModel.trim(),
          maxChainDepth: clampedDepth,
          rateLimitWindow: clampedWindow,
          rateLimitMax: clampedMax,
          visibility,
          visibilityList: visListArr,
        })
        toast.success(t('router.created'))
      }
      onClose()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('error.generic'))
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    if (!router) return
    setTesting(true)
    try {
      const success = await testRouter(router.id)
      if (success) {
        toast.success(t('router.testSuccess'))
      } else {
        toast.error(t('router.testFailed'))
      }
    } catch {
      toast.error(t('router.testFailed'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} aria-labelledby="router-form-title">
      <div className="bg-surface rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-border">
          <h2 id="router-form-title" className="text-lg font-semibold text-text-primary">
            {isEditing ? t('router.editRouter') : t('router.createRouter')}
          </h2>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              {t('router.name')} *
            </label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('router.enterName') || ''}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-text-primary mb-1">
              {t('router.description')}
            </label>
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('router.enterDescription') || ''}
            />
          </div>

          {/* Scope (only on create, admin only) */}
          {!isEditing && isAdmin && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                {t('router.scope')}
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setScope('personal')}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    scope === 'personal'
                      ? 'bg-accent text-white'
                      : 'bg-surface-hover text-text-secondary'
                  }`}
                >
                  {t('router.scopePersonal')}
                </button>
                <button
                  onClick={() => setScope('global')}
                  className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                    scope === 'global'
                      ? 'bg-accent text-white'
                      : 'bg-surface-hover text-text-secondary'
                  }`}
                >
                  {t('router.scopeGlobal')}
                </button>
              </div>
            </div>
          )}

          {/* LLM Config */}
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3">
              {t('router.llmConfig')}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  {t('router.llmBaseUrl')} *
                </label>
                <Input
                  type="url"
                  value={llmBaseUrl}
                  onChange={(e) => setLlmBaseUrl(e.target.value)}
                  placeholder={t('router.enterLlmBaseUrl') || ''}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  {t('router.llmApiKey')} {isEditing ? '' : '*'}
                </label>
                <Input
                  type="password"
                  value={llmApiKey}
                  onChange={(e) => setLlmApiKey(e.target.value)}
                  placeholder={
                    isEditing
                      ? t('router.leaveEmptyToKeep') || ''
                      : t('router.enterLlmApiKey') || ''
                  }
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  {t('router.llmModel')} *
                </label>
                <Input
                  type="text"
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                  placeholder={t('router.enterLlmModel') || ''}
                />
              </div>
            </div>
          </div>

          {/* Routing Protection */}
          <div className="border-t border-border pt-4">
            <h3 className="text-sm font-semibold text-text-primary mb-3">
              {t('router.routingProtection')}
            </h3>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  {t('router.maxChainDepth')}
                </label>
                <Input
                  type="number"
                  value={maxChainDepth}
                  onChange={(e) => setMaxChainDepth(parseInt(e.target.value) || 5)}
                  min={1}
                  max={100}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  {t('router.rateLimitWindow')}
                </label>
                <Input
                  type="number"
                  value={rateLimitWindow}
                  onChange={(e) => setRateLimitWindow(parseInt(e.target.value) || 60)}
                  min={1}
                  max={3600}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-muted mb-1">
                  {t('router.rateLimitMax')}
                </label>
                <Input
                  type="number"
                  value={rateLimitMax}
                  onChange={(e) => setRateLimitMax(parseInt(e.target.value) || 20)}
                  min={1}
                  max={1000}
                />
              </div>
            </div>
          </div>

          {/* Visibility (only for global scope) */}
          {(scope === 'global' || (isEditing && router?.scope === 'global')) && isAdmin && (
            <div className="border-t border-border pt-4">
              <h3 className="text-sm font-semibold text-text-primary mb-3">
                {t('router.visibility')}
              </h3>
              <div className="flex gap-1 mb-3">
                {(['all', 'whitelist', 'blacklist'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setVisibility(v)}
                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                      visibility === v
                        ? 'bg-accent text-white'
                        : 'bg-surface-hover text-text-secondary'
                    }`}
                  >
                    {t(`router.visibility${v.charAt(0).toUpperCase() + v.slice(1)}`)}
                  </button>
                ))}
              </div>
              {visibility !== 'all' && (
                <div>
                  <label className="block text-xs font-medium text-text-muted mb-1">
                    {t('router.visibilityList')}
                  </label>
                  <Input
                    type="text"
                    value={visibilityList}
                    onChange={(e) => setVisibilityList(e.target.value)}
                    placeholder="user-id-1, user-id-2"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border flex items-center justify-between">
          <div>
            {isEditing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleTest}
                disabled={testing}
              >
                {testing ? t('testing') : t('router.testConnection')}
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={saving || !name.trim() || !llmBaseUrl.trim() || !llmModel.trim() || (!isEditing && !llmApiKey.trim())}
            >
              {saving
                ? isEditing
                  ? t('common.saving')
                  : t('common.creating')
                : isEditing
                  ? t('common.save')
                  : t('common.create')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
