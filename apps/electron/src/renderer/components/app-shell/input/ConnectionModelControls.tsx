import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCcw, Settings2 } from 'lucide-react'
import { useOptionalAppShellContext } from '@/context/AppShellContext'
import { navigate, routes } from '@/lib/navigate'
import type { LlmConnection } from '@config/llm-connections'

/** Shared by desktop and compact model pickers; refreshing never changes the session's selection. */
export function ConnectionModelControls({ connection }: { connection: LlmConnection | null }) {
  const { t } = useTranslation()
  const refreshConnections = useOptionalAppShellContext()?.refreshLlmConnections
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const inFlight = useRef(false)
  const slug = connection?.customEndpoint ? connection.slug : undefined
  const automatic = connection?.modelSelectionMode === 'automaticallySyncedFromProvider'
  const refresh = useCallback(async () => {
    if (!slug || inFlight.current) return
    inFlight.current = true
    setLoading(true)
    setFailed(false)
    try {
      const result = await window.electronAPI.refreshLlmConnectionModels(slug)
      setFailed(!result.success)
      await refreshConnections?.()
    } catch { setFailed(true) }
    finally { inFlight.current = false; setLoading(false) }
  }, [slug, refreshConnections])
  useEffect(() => { if (automatic) void refresh() }, [automatic, refresh])
  if (!slug) return null
  return (
    <div className="border-t border-foreground/5 mt-1 pt-1">
      {failed && <p role="status" className="px-2 py-1 text-xs text-muted-foreground max-w-[280px]">{t('chat.modelPicker.discoveryUnavailable')}</p>}
      <button type="button" onClick={() => void refresh()} disabled={loading} className="flex items-center gap-2 w-full px-2 py-2 text-sm rounded-lg hover:bg-foreground/5 disabled:opacity-50">
        <RefreshCcw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
        {t(loading ? 'chat.modelPicker.refreshingModels' : 'chat.modelPicker.refreshModels')}
      </button>
      <button type="button" onClick={() => navigate(routes.view.settings('ai'))} className="flex items-center gap-2 w-full px-2 py-2 text-sm rounded-lg hover:bg-foreground/5">
        <Settings2 className="size-3.5" />{t('chat.modelPicker.manageModels')}
      </button>
    </div>
  )
}
