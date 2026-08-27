import type * as React from 'react'

interface EntityRowInteractionOptions {
  deferUntilClick: boolean
  onSelection: (event: React.MouseEvent) => void
  onActivate: () => void
}

interface EntityRowInteractionHandlers {
  onMouseDown?: (event: React.MouseEvent) => void
  onClick?: (event: React.MouseEvent) => void
}

function isPlainPrimaryMouseEvent(event: React.MouseEvent): boolean {
  return event.button !== 2 && !event.metaKey && !event.ctrlKey && !event.shiftKey
}

export function createEntityRowInteractionHandlers({
  deferUntilClick,
  onSelection,
  onActivate,
}: EntityRowInteractionOptions): EntityRowInteractionHandlers {
  const selectAndActivate = (event: React.MouseEvent) => {
    onSelection(event)
    if (isPlainPrimaryMouseEvent(event)) onActivate()
  }

  if (!deferUntilClick) {
    return { onMouseDown: selectAndActivate }
  }

  return {
    // Preserve right-click multi-selection before the context menu opens.
    onMouseDown: (event) => {
      if (event.button === 2) onSelection(event)
    },
    // DndKit suppresses this click once a pointer drag has activated.
    onClick: selectAndActivate,
  }
}
