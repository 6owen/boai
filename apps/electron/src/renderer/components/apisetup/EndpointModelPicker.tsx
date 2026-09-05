import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, Loader2, RefreshCcw } from 'lucide-react'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import type { CustomEndpointApi } from '@config/llm-connections'
import { applyDiscoveredModels, type EndpointModelSelection } from './endpoint-model-selection'

interface EndpointModelPickerProps {
  baseUrl: string
  apiKey: string
  api: CustomEndpointApi
  connectionSlug?: string
  selection: EndpointModelSelection
  onChange: (selection: EndpointModelSelection) => void
  onDiscovered: () => void
  disabled?: boolean
  error?: string | null
}

export function EndpointModelPicker({ baseUrl, apiKey, api, connectionSlug, selection, onChange, onDiscovered, disabled, error }: EndpointModelPickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState(false)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string>()
  const requestId = useRef(0)
  const request = useMemo(() => ({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), customEndpoint: { api }, connectionSlug }), [baseUrl, apiKey, api, connectionSlug])
  const currentRequest = useRef(request)
  currentRequest.current = request
  const currentSelection = useRef(selection)
  currentSelection.current = selection
  const invalidateRequests = useCallback(() => { requestId.current++ }, [])
  useEffect(() => {
    setLoading(false)
    setFetchError(undefined)
    setOpen(false)
    return invalidateRequests
  }, [request, invalidateRequests])

  const refresh = async () => {
    if (loading || disabled || !request.baseUrl) return
    const id = ++requestId.current
    setLoading(true)
    setFetchError(undefined)
    try {
      const result = await window.electronAPI.discoverLlmConnectionModels(request)
      if (id !== requestId.current || request !== currentRequest.current) return
      if (!result.success) { setFetchError(result.error); return }
      onChange(applyDiscoveredModels(currentSelection.current, result.models))
      onDiscovered()
      setManual(false)
      setOpen(true)
    } catch {
      if (id === requestId.current && request === currentRequest.current) setFetchError(t('apiSetup.models.fetchFailed'))
    } finally {
      if (id === requestId.current && request === currentRequest.current) setLoading(false)
    }
  }
  const selected = selection.models.find(model => model.id === selection.defaultModel)

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor="connection-default-model">{t('apiSetup.models.defaultModel')}</Label>
        <button type="button" onClick={() => void refresh()} disabled={disabled || loading || !request.baseUrl} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
          {t(loading ? 'apiSetup.models.loading' : selection.models.length ? 'apiSetup.models.refresh' : 'apiSetup.models.fetch')}
        </button>
      </div>
      {manual ? (
        <Input id="connection-default-model" value={selection.defaultModel} disabled={disabled} autoFocus
          onChange={event => onChange({ ...selection, defaultModel: event.target.value })}
          placeholder={t('apiSetup.models.manualPlaceholder')} aria-invalid={!!error} />
      ) : (
        <Popover open={open} onOpenChange={next => {
          setOpen(next)
          if (next && !selection.models.length) void refresh()
        }}>
          <PopoverTrigger asChild>
            <button type="button" id="connection-default-model" role="combobox" aria-expanded={open} aria-label={t('apiSetup.models.defaultModel')} aria-invalid={!!error} disabled={disabled}
              className={cn('flex h-9 w-full items-center justify-between gap-2 rounded-md bg-foreground-2 px-3 text-sm shadow-minimal text-left disabled:opacity-50', error && 'ring-1 ring-destructive/40')}>
              <span className={cn('truncate', !selection.defaultModel && 'text-muted-foreground')}>
                {selected?.name || selection.defaultModel || t('apiSetup.models.select')}
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="z-floating-menu w-[var(--radix-popover-trigger-width)] p-0">
            <Command>
              <CommandInput placeholder={t('apiSetup.models.search')} aria-label={t('apiSetup.models.search')} />
              <CommandList>
                <CommandEmpty>{t(loading ? 'apiSetup.models.loading' : 'apiSetup.models.noResults')}</CommandEmpty>
                {selection.models.map(model => (
                  <CommandItem key={model.id} value={model.id} keywords={[model.name]} onSelect={() => {
                    onChange({ ...selection, defaultModel: model.id })
                    setOpen(false)
                  }} className="cursor-pointer px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{model.name}</div>
                      {model.name !== model.id && <div className="truncate text-xs text-muted-foreground">{model.id}</div>}
                    </div>
                    {selection.defaultModel === model.id && <Check className="size-3.5 shrink-0" />}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      {fetchError && <p role="status" className="text-xs text-destructive">{t('apiSetup.models.fetchFailed')}{fetchError !== t('apiSetup.models.fetchFailed') && ` ${fetchError}`}</p>}
      <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
        <p>{t(selection.models.length ? 'apiSetup.models.available' : 'apiSetup.models.hint', { count: selection.models.length })}</p>
        <button type="button" disabled={disabled} className="shrink-0 underline underline-offset-2 hover:text-foreground disabled:opacity-50" onClick={() => setManual(!manual)}>
          {t(manual ? 'apiSetup.models.chooseFromList' : 'apiSetup.models.enterManually')}
        </button>
      </div>
    </div>
  )
}
