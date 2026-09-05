export interface EndpointModelOption { id: string; name: string }
export interface EndpointModelSelection {
  defaultModel: string
  models: EndpointModelOption[]
}

/** Accept old comma-separated defaults while keeping the full catalog separate from the selection. */
export function initialEndpointModelSelection(defaultValue = '', models: string[] = []): EndpointModelSelection {
  const defaults = defaultValue.split(',').map(id => id.trim()).filter(Boolean)
  const ids = [...new Set([...defaults, ...models].filter(Boolean))]
  return { defaultModel: defaults[0] ?? ids[0] ?? '', models: ids.map(id => ({ id, name: id })) }
}

export function applyDiscoveredModels(current: EndpointModelSelection, models: EndpointModelOption[]): EndpointModelSelection {
  return {
    defaultModel: models.some(m => m.id === current.defaultModel) ? current.defaultModel : models[0]?.id ?? '',
    models,
  }
}

/** Selecting a default must never turn the connection's model list into a one-model allowlist. */
export function endpointModelSubmitValues(selection: EndpointModelSelection) {
  const defaultModel = selection.defaultModel.trim()
  return {
    connectionDefaultModel: defaultModel || undefined,
    models: [...new Set([defaultModel, ...selection.models.map(m => m.id)].filter(Boolean))],
  }
}
