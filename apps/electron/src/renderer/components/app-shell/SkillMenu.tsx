/**
 * SkillMenu - Shared menu content for skill actions
 *
 * Used by:
 * - SkillsListPanel (dropdown via "..." button, context menu via right-click)
 * - SkillInfoPage (title dropdown menu)
 *
 * Uses MenuComponents context to render with either DropdownMenu or ContextMenu
 * primitives, allowing the same component to work in both scenarios.
 *
 * Provides consistent skill actions:
 * - Open in New Window
 * - Show in file manager
 * - Delete
 */

import * as React from 'react'
import { useTranslation } from "react-i18next"
import {
  Trash2,
  FolderOpen,
  AppWindow,
  RefreshCw,
  PackageMinus,
  Star,
  Check,
  Folders,
} from 'lucide-react'
import { useMenuComponents } from '@/components/ui/menu-context'
import { getFileManagerName } from '@/lib/platform'
import type { SkillGroup } from '@/hooks/useSkillCollections'

export interface SkillMenuProps {
  /** Skill slug */
  skillSlug: string
  /** Skill name for display */
  skillName: string
  /** Callbacks */
  onOpenInNewWindow: () => void
  onShowInFinder: () => void | Promise<void>
  onDelete?: () => void
  onUpdate?: () => void | Promise<void>
  onUninstall?: () => void
  isFavorite?: boolean
  onToggleFavorite?: () => void
  groups?: readonly SkillGroup[]
  assignedGroupId?: string
  onAssignGroup?: (groupId?: string) => void
  canShowInFinder?: boolean
  canDelete?: boolean
  deleteLabel?: string
}

/**
 * SkillMenu - Renders the menu items for skill actions
 * This is the content only, not wrapped in a DropdownMenu or ContextMenu
 */
export function SkillMenu({
  skillSlug,
  skillName,
  onOpenInNewWindow,
  onShowInFinder,
  onDelete,
  onUpdate,
  onUninstall,
  isFavorite = false,
  onToggleFavorite,
  groups = [],
  assignedGroupId,
  onAssignGroup,
  canShowInFinder = true,
  canDelete = true,
  deleteLabel,
}: SkillMenuProps) {
  const { t } = useTranslation()

  // Get menu components from context (works with both DropdownMenu and ContextMenu)
  const { MenuItem, Separator, Sub, SubTrigger, SubContent } = useMenuComponents()

  return (
    <>
      {/* Open in New Window */}
      <MenuItem onClick={onOpenInNewWindow}>
        <AppWindow className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sidebarMenu.openInNewWindow")}</span>
      </MenuItem>

      {/* Show in file manager */}
      <MenuItem onClick={onShowInFinder} disabled={!canShowInFinder}>
        <FolderOpen className="h-3.5 w-3.5" />
        <span className="flex-1">{t("sessionMenu.showInFileManager", { fileManager: getFileManagerName() })}</span>
      </MenuItem>

      {onUpdate && (
        <MenuItem onClick={onUpdate}>
          <RefreshCw className="h-3.5 w-3.5" />
          <span className="flex-1">{t('skillsManager.update')}</span>
        </MenuItem>
      )}

      {onToggleFavorite && (
        <MenuItem onClick={onToggleFavorite}>
          <Star className={isFavorite ? "h-3.5 w-3.5 fill-current" : "h-3.5 w-3.5"} />
          <span className="flex-1">
            {isFavorite ? t('skillsList.removeFromOwn') : t('skillsList.addToOwn')}
          </span>
        </MenuItem>
      )}

      {onAssignGroup && (
        <Sub>
          <SubTrigger className="pr-2">
            <Folders className="h-3.5 w-3.5" />
            <span className="flex-1">{t('skillsGroups.moveToGroup')}</span>
          </SubTrigger>
          <SubContent>
            <MenuItem onClick={() => onAssignGroup()}>
              <span className="flex-1">{t('skillsGroups.ungrouped')}</span>
              {!assignedGroupId && <Check className="h-3.5 w-3.5" />}
            </MenuItem>
            {groups.length > 0 && <Separator />}
            {groups.map(group => (
              <MenuItem key={group.id} onClick={() => onAssignGroup(group.id)}>
                <span className="flex-1">{group.name}</span>
                {assignedGroupId === group.id && <Check className="h-3.5 w-3.5" />}
              </MenuItem>
            ))}
          </SubContent>
        </Sub>
      )}

      <Separator />

      {onUninstall ? (
        <MenuItem onClick={onUninstall} variant="destructive">
          <PackageMinus className="h-3.5 w-3.5" />
          <span className="flex-1">{t('skillsManager.uninstall')}</span>
        </MenuItem>
      ) : (
        <MenuItem onClick={canDelete ? onDelete : undefined} variant="destructive" disabled={!canDelete}>
          <Trash2 className="h-3.5 w-3.5" />
          <span className="flex-1">{deleteLabel || t("sidebarMenu.deleteSkill")}</span>
        </MenuItem>
      )}
    </>
  )
}
