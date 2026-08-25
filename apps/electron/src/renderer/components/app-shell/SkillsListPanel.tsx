import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Search, UserRound, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { skillSelection } from '@/hooks/useEntitySelection'
import { SkillMenu } from './SkillMenu'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import { cn } from '@/lib/utils'
import * as storage from '@/lib/local-storage'
import { KEYS } from '@/lib/local-storage'
import type { LoadedSkill } from '../../../shared/types'
import { SessionSearchHeader } from './SessionSearchHeader'
import {
  getSkillCollectionKey,
  isSkillInOwnCollection,
  type SkillGroup,
  type SkillGroupAssignments,
} from '@/hooks/useSkillCollections'
import type { EntityListGroup } from '@/components/ui/entity-list'

export interface SkillsListPanelProps {
  skills: LoadedSkill[]
  onSkillClick: (skill: LoadedSkill) => void
  selectedSkillSlug?: string | null
  workspaceId?: string
  workspaceRootPath?: string
  workingDirectory?: string
  searchActive?: boolean
  searchQuery?: string
  onSearchChange?: (query: string) => void
  onSearchClose?: () => void
  collection?: 'installed' | 'own'
  favoriteSkillKeys?: ReadonlySet<string>
  excludedOwnSkillKeys?: ReadonlySet<string>
  onToggleFavorite?: (skill: LoadedSkill) => void
  groups?: readonly SkillGroup[]
  groupAssignments?: Readonly<SkillGroupAssignments>
  onAssignGroup?: (skill: LoadedSkill, groupId?: string) => void
  className?: string
}

const UNGROUPED_SKILLS_KEY = 'ungrouped'

function readCollapsedSkillGroups(scope: string): Set<string> {
  return new Set(
    storage.get<unknown[]>(KEYS.collapsedSkillGroups, [], scope)
      .filter((value): value is string => typeof value === 'string'),
  )
}

export function SkillsListPanel({
  skills,
  onSkillClick,
  selectedSkillSlug,
  workspaceId,
  workspaceRootPath,
  workingDirectory,
  searchActive = false,
  searchQuery = '',
  onSearchChange,
  onSearchClose,
  collection = 'installed',
  favoriteSkillKeys = new Set(),
  excludedOwnSkillKeys = new Set(),
  onToggleFavorite,
  groups = [],
  groupAssignments = {},
  onAssignGroup,
  className,
}: SkillsListPanelProps) {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const collapseScope = workspaceId ?? 'default'
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(
    () => readCollapsedSkillGroups(collapseScope),
  )
  const collapseScopeRef = React.useRef(collapseScope)

  React.useEffect(() => {
    if (collapseScopeRef.current === collapseScope) return
    setCollapsedGroups(readCollapsedSkillGroups(collapseScope))
    collapseScopeRef.current = collapseScope
  }, [collapseScope])

  React.useEffect(() => {
    if (collapseScopeRef.current !== collapseScope) return
    storage.set(KEYS.collapsedSkillGroups, Array.from(collapsedGroups), collapseScope)
  }, [collapseScope, collapsedGroups])

  const toggleGroupCollapse = React.useCallback((groupKey: string) => {
    setCollapsedGroups(previous => {
      const next = new Set(previous)
      if (next.has(groupKey)) next.delete(groupKey)
      else next.add(groupKey)
      return next
    })
  }, [])
  const filteredSkills = React.useMemo(() => {
    if (!normalizedSearch) return skills
    return skills.filter(skill => [
      skill.slug,
      skill.metadata.name,
      skill.metadata.description,
    ].some(value => value.toLowerCase().includes(normalizedSearch)))
  }, [normalizedSearch, skills])
  const groupedPresentation = React.useMemo((): {
    items: LoadedSkill[]
    groups?: EntityListGroup<LoadedSkill>[]
  } => {
    if (collection !== 'own') return { items: filteredSkills }

    const validGroupIds = new Set(groups.map(group => group.id))
    const groupedSkills = new Map(groups.map(group => [group.id, [] as LoadedSkill[]]))
    const ungroupedSkills: LoadedSkill[] = []
    for (const skill of filteredSkills) {
      const groupId = groupAssignments[getSkillCollectionKey(skill)]
      if (groupId && validGroupIds.has(groupId)) groupedSkills.get(groupId)?.push(skill)
      else ungroupedSkills.push(skill)
    }
    const canCollapse = !normalizedSearch
    const presentationGroups: EntityListGroup<LoadedSkill>[] = groups.flatMap(group => {
      const items = groupedSkills.get(group.id) ?? []
      if (items.length === 0) return []
      const isCollapsed = canCollapse && collapsedGroups.has(group.id)
      return [{
        key: group.id,
        label: group.name,
        items: isCollapsed ? [] : items,
        collapsible: canCollapse,
        ...(isCollapsed ? { collapsedCount: items.length } : {}),
      }]
    })
    if (ungroupedSkills.length > 0) {
      const isCollapsed = canCollapse && collapsedGroups.has(UNGROUPED_SKILLS_KEY)
      presentationGroups.push({
        key: UNGROUPED_SKILLS_KEY,
        label: t('skillsGroups.ungrouped'),
        items: isCollapsed ? [] : ungroupedSkills,
        collapsible: canCollapse,
        ...(isCollapsed ? { collapsedCount: ungroupedSkills.length } : {}),
      })
    }
    return {
      items: presentationGroups.flatMap(group => group.items),
      groups: presentationGroups,
    }
  }, [collapsedGroups, collection, filteredSkills, groupAssignments, groups, normalizedSearch, t])

  const collapseAllGroups = React.useCallback(() => {
    setCollapsedGroups(new Set(
      groupedPresentation.groups
        ?.filter(group => group.collapsible)
        .map(group => group.key) ?? [],
    ))
  }, [groupedPresentation.groups])

  const expandAllGroups = React.useCallback(() => {
    setCollapsedGroups(new Set())
  }, [])

  React.useEffect(() => {
    if (searchActive) searchInputRef.current?.focus()
  }, [searchActive])

  const handleRemoveSkill = React.useCallback(async (skill: LoadedSkill) => {
    if (!workspaceId) return
    try {
      if (skill.management) {
        await window.electronAPI.uninstallSkill(workspaceId, {
          slug: skill.slug,
          scope: skill.management.scope,
          workingDirectory,
        })
        toast.success(t('skillsManager.uninstalled', { name: skill.metadata.name }))
      } else if (skill.source !== 'plugin') {
        await window.electronAPI.deleteSkill(workspaceId, {
          slug: skill.slug,
          source: skill.source,
          workingDirectory,
        })
        toast.success(t('skillInfo.deletedSkill', { name: skill.metadata.name }))
      }
    } catch (error) {
      toast.error(
        skill.management ? t('skillsManager.uninstallFailed') : t('skillInfo.failedToDelete'),
        { description: error instanceof Error ? error.message : String(error) },
      )
    }
  }, [t, workspaceId, workingDirectory])

  return (
    <div className={cn('flex min-h-0 flex-1 flex-col', className)}>
      {searchActive && (
        <SessionSearchHeader
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onSearchClose={onSearchClose}
          onKeyDown={(event) => {
            if (event.key === 'Escape') searchInputRef.current?.blur()
          }}
          resultCount={filteredSkills.length}
          placeholder={t('skillsList.searchPlaceholder')}
          inputRef={searchInputRef}
        />
      )}
        <EntityPanel<LoadedSkill>
          items={groupedPresentation.items}
          groups={groupedPresentation.groups}
          collapsedGroups={normalizedSearch ? new Set() : collapsedGroups}
          onToggleCollapse={collection === 'own' && !normalizedSearch ? toggleGroupCollapse : undefined}
          onCollapseAll={collection === 'own' && !normalizedSearch ? collapseAllGroups : undefined}
          onExpandAll={collection === 'own' && !normalizedSearch ? expandAllGroups : undefined}
          getId={(s) => s.slug}
          selection={skillSelection}
          selectedId={selectedSkillSlug}
          onItemClick={onSkillClick}
          className="min-h-0 flex-1"
          containerProps={{ 'data-list-role': 'skills' }}
          emptyState={
            normalizedSearch
              ? <EntityListEmptyScreen
                  icon={<Search />}
                  title={t('skillsList.noSearchResults')}
                  description={t('skillsList.noSearchResultsDescription')}
                />
              : <EntityListEmptyScreen
                  icon={collection === 'own' ? <UserRound /> : <Zap />}
                  title={collection === 'own' ? t('skillsList.noOwnSkills') : t('skillsList.noSkillsConfigured')}
                  description={collection === 'own' ? t('skillsList.ownEmptyDescription') : t('skillsList.emptyDescription')}
                  docKey="skills"
                >
                  {collection === 'installed' && workspaceRootPath && (
                    <EditPopover
                      align="center"
                      trigger={
                        <button className="inline-flex h-7 items-center rounded-[8px] bg-background px-3 text-xs font-medium shadow-minimal transition-colors hover:bg-foreground/[0.03]">
                          {t('skillsList.addSkill')}
                        </button>
                      }
                      {...getEditConfig('add-skill', workspaceRootPath)}
                    />
                  )}
                </EntityListEmptyScreen>
          }
          mapItem={(skill) => ({
            icon: <SkillAvatar skill={skill} size="sm" workspaceId={workspaceId} />,
            title: skill.metadata.name,
            badges: (
              <span className="flex min-w-0 items-center gap-1.5">
                {skill.source === 'project' && (
                  <span className="shrink-0 rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t('skillsList.projectBadge')}
                  </span>
                )}
                {skill.source === 'plugin' && (
                  <span className="shrink-0 rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {skill.pluginName}
                  </span>
                )}
                <span className="truncate">{skill.metadata.description}</span>
              </span>
            ),
            menu: (
              <SkillMenu
                skillSlug={skill.slug}
                skillName={skill.metadata.name}
                onOpenInNewWindow={() => window.electronAPI.openUrl(`craftagents://skills/skill/${skill.slug}?window=focused`)}
                onShowInFinder={async () => {
                  if (!canRevealLocally) return
                  try {
                    await window.electronAPI.showInFolder(skill.path)
                  } catch (err) {
                    const message = err instanceof Error ? err.message : String(err)
                    toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), {
                      description: message,
                    })
                  }
                }}
                canShowInFinder={canRevealLocally}
                onUninstall={skill.management ? () => void handleRemoveSkill(skill) : undefined}
                onDelete={!skill.management && skill.source !== 'plugin' ? () => void handleRemoveSkill(skill) : undefined}
                canDelete={skill.source !== 'plugin'}
                deleteLabel={t('skillsList.deleteSkill')}
                isFavorite={isSkillInOwnCollection(skill, favoriteSkillKeys, excludedOwnSkillKeys)}
                onToggleFavorite={onToggleFavorite ? () => onToggleFavorite(skill) : undefined}
                groups={collection === 'own' ? groups : undefined}
                assignedGroupId={collection === 'own'
                  ? groupAssignments[getSkillCollectionKey(skill)]
                  : undefined}
                onAssignGroup={collection === 'own' && onAssignGroup
                  ? groupId => onAssignGroup(skill, groupId)
                  : undefined}
              />
            ),
          })}
        />
    </div>
  )
}
