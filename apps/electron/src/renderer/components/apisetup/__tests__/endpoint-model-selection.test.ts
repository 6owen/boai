import { expect, it } from 'bun:test'
import { initialEndpointModelSelection, applyDiscoveredModels, endpointModelSubmitValues } from '../endpoint-model-selection'

it('opens an old comma-separated configuration with one default and the complete catalog', () => {
  const selection = initialEndpointModelSelection('glm-5.3, glm-4.5, glm-5.2', ['glm-4.5', 'glm-5.2', 'glm-5.3'])
  expect(selection.defaultModel).toBe('glm-5.3')
  expect(selection.models.map(m => m.id)).toEqual(['glm-5.3', 'glm-4.5', 'glm-5.2'])
})

it('keeps the chosen default across refresh even when the server changes the list order', () => {
  const selection = applyDiscoveredModels(initialEndpointModelSelection('glm-5.3'), [{ id: 'glm-5.2', name: 'GLM 5.2' }, { id: 'glm-5.3', name: 'GLM 5.3' }])
  expect(selection.defaultModel).toBe('glm-5.3')
})

it('chooses the first discovered model for a fresh form', () => {
  expect(applyDiscoveredModels(initialEndpointModelSelection(), [{ id: 'relay-a', name: 'Relay A' }]).defaultModel).toBe('relay-a')
})

it('saving another default preserves every fetched model', () => {
  const selection = initialEndpointModelSelection('glm-5.3', ['glm-5.2', 'glm-4.7'])
  const values = endpointModelSubmitValues({ ...selection, defaultModel: 'glm-4.7' })
  expect(values.connectionDefaultModel).toBe('glm-4.7')
  expect(values.models).toEqual(['glm-4.7', 'glm-5.3', 'glm-5.2'])
})

it('accepts a manually entered model without losing existing choices', () => {
  const values = endpointModelSubmitValues({ ...initialEndpointModelSelection('relay-a'), defaultModel: ' relay-private ' })
  expect(values).toEqual({ connectionDefaultModel: 'relay-private', models: ['relay-private', 'relay-a'] })
})

it('does not silently restore a default that the user cleared', () => {
  expect(endpointModelSubmitValues({ ...initialEndpointModelSelection('relay-a'), defaultModel: '' }).connectionDefaultModel).toBeUndefined()
})
