/**
 * EntityPanel<T> — Config-driven entity list with built-in keyboard nav + multi-select.
 *
 * Wraps EntityList + EntityRow + useEntityListInteractions so consumers
 * only provide a data mapping via `mapItem`.
 */

import * as React from 'react'
import { useAction } from '@/actions'
import { EntityList, type EntityListGroup } from './entity-list'
import { EntityRow } from './entity-row'
import { createEntityRowInteractionHandlers } from './entity-panel-interactions'
import { useEntityListInteractions } from '@/hooks/useEntityListInteractions'
import type { createEntitySelection } from '@/hooks/useEntitySelection'

export interface EntityPanelItem {
  icon?: React.ReactNode
  title: React.ReactNode
  badges?: React.ReactNode
  trailing?: React.ReactNode
  /** A directly accessible row action, rendered outside the main row button. */
  rowAction?: React.ReactNode
  menu?: React.ReactNode
  dataAttributes?: Record<string, string | undefined>
}

export interface EntityPanelProps<T> {
  items: T[]
  /** Optional grouped presentation. `items` must contain the same entries in visual order. */
  groups?: EntityListGroup<T>[]
  /** Set of collapsed group keys for collapsible grouped presentations. */
  collapsedGroups?: Set<string>
  onToggleCollapse?: (groupKey: string) => void
  onCollapseAll?: () => void
  onExpandAll?: () => void
  getId: (item: T) => string
  mapItem: (item: T) => EntityPanelItem
  selection: ReturnType<typeof createEntitySelection>
  onItemClick: (item: T) => void
  selectedId?: string | null
  emptyState?: React.ReactNode
  className?: string
  /** Extra data/aria attributes merged onto the inner list container.
   *  Use to set `data-list-role` so compact-mode CSS can target the right list. */
  containerProps?: Record<string, string>
  /** Optional domain-specific wrapper around a rendered group. */
  wrapGroup?: (group: EntityListGroup<T>, content: React.ReactNode) => React.ReactNode
  /** Optional domain-specific wrapper around a rendered group header. */
  wrapGroupHeader?: (group: EntityListGroup<T>, content: React.ReactNode) => React.ReactNode
  /** Optional domain-specific wrapper around a rendered item. */
  wrapItem?: (item: T, content: React.ReactNode) => React.ReactNode
  /** Delay pointer selection until click so an activated drag does not select the pressed row. */
  deferItemInteractionUntilClick?: boolean
}

export function EntityPanel<T>({
  items,
  groups,
  collapsedGroups,
  onToggleCollapse,
  onCollapseAll,
  onExpandAll,
  getId,
  mapItem,
  selection,
  onItemClick,
  selectedId,
  emptyState,
  className,
  containerProps,
  wrapGroup,
  wrapGroupHeader,
  wrapItem,
  deferItemInteractionUntilClick = false,
}: EntityPanelProps<T>) {
  const selectionStore = selection.useSelectionStore()
  const interactions = useEntityListInteractions<T>({
    items,
    getId,
    keyboard: {
      onNavigate: (item) => onItemClick(item),
      onActivate: (item) => onItemClick(item),
    },
    multiSelect: true,
    selectionStore,
  })

  useAction('navigator.clearSelection', () => {
    interactions.selection.clear()
  }, {
    enabled: () => interactions.selection.isMultiSelectActive,
  }, [interactions.selection])

  const mergedContainerProps = containerProps
    ? { ...interactions.listProps.containerProps, ...containerProps }
    : interactions.listProps.containerProps
  const itemIndexes = React.useMemo(
    () => new Map(items.map((item, index) => [getId(item), index])),
    [getId, items],
  )

  const renderItem = (item: T, index: number, isFirst: boolean) => {
    const mapped = mapItem(item)
    const globalIndex = itemIndexes.get(getId(item)) ?? index
    const rowProps = interactions.getRowProps(item, globalIndex)
    const mouseHandlers = createEntityRowInteractionHandlers({
      deferUntilClick: deferItemInteractionUntilClick,
      onSelection: rowProps.onMouseDown,
      onActivate: () => onItemClick(item),
    })
    return (
      <EntityRow
        icon={mapped.icon}
        title={mapped.title}
        badges={mapped.badges}
        trailing={mapped.trailing}
        rowAction={mapped.rowAction}
        isSelected={selectedId === getId(item)}
        isInMultiSelect={rowProps.isInMultiSelect}
        showSeparator={!isFirst}
        onMouseDown={mouseHandlers.onMouseDown}
        onClick={mouseHandlers.onClick}
        buttonProps={rowProps.buttonProps}
        menuContent={mapped.menu}
        dataAttributes={mapped.dataAttributes}
      />
    )
  }

  return (
    <EntityList
      items={items}
      groups={groups}
      collapsedGroups={collapsedGroups}
      onToggleCollapse={onToggleCollapse}
      onCollapseAll={onCollapseAll}
      onExpandAll={onExpandAll}
      wrapGroup={wrapGroup}
      wrapGroupHeader={wrapGroupHeader}
      wrapItem={wrapItem}
      getKey={getId}
      containerRef={interactions.listProps.containerRef}
      containerProps={mergedContainerProps}
      className={className}
      emptyState={emptyState}
      renderItem={renderItem}
    />
  )
}
