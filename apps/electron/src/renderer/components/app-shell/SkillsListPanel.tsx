import * as React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Folder, GripVertical, Search, UserRound, Zap } from 'lucide-react'
import { toast } from 'sonner'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  closestCenter,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
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
  onReorderGroup?: (groupId: string, targetGroupId: string) => void
  className?: string
}

const UNGROUPED_SKILLS_KEY = 'ungrouped'
const SKILL_GROUP_DROP_PREFIX = 'skill-group:'
const SKILL_GROUP_SORT_PREFIX = 'skill-group-sort:'

function getSkillGroupDropId(groupKey: string): string {
  return `${SKILL_GROUP_DROP_PREFIX}${groupKey}`
}

function getSkillGroupKeyFromDropId(dropId: string | number): string | undefined {
  const value = String(dropId)
  return value.startsWith(SKILL_GROUP_DROP_PREFIX)
    ? value.slice(SKILL_GROUP_DROP_PREFIX.length)
    : undefined
}

function getSkillGroupSortId(groupId: string): string {
  return `${SKILL_GROUP_SORT_PREFIX}${groupId}`
}

function getSkillGroupIdFromSortId(sortId: string | number): string | undefined {
  const value = String(sortId)
  return value.startsWith(SKILL_GROUP_SORT_PREFIX)
    ? value.slice(SKILL_GROUP_SORT_PREFIX.length)
    : undefined
}

const skillGroupCollisionDetection: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type
  const targetType = activeType === 'skill-group-sort' ? 'skill-group-sort' : 'skill-group-drop'
  const scopedArgs = {
    ...args,
    droppableContainers: args.droppableContainers.filter(
      container => container.data.current?.type === targetType,
    ),
  }
  if (activeType === 'skill-group-sort') return closestCenter(scopedArgs)
  const pointerCollisions = pointerWithin(scopedArgs)
  return pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(scopedArgs)
}

function DraggableSkill({
  dragId,
  children,
}: {
  dragId: string
  children: React.ReactNode
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: dragId,
    data: { type: 'skill' },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'cursor-grab touch-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/40',
        isDragging && 'opacity-20 cursor-grabbing',
      )}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}

function DroppableSkillGroup({
  groupKey,
  children,
}: {
  groupKey: string
  children: React.ReactNode
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: getSkillGroupDropId(groupKey),
    data: { type: 'skill-group-drop' },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative rounded-[8px] transition-[background-color,box-shadow] duration-100',
        isOver && 'bg-accent/[0.06] ring-1 ring-inset ring-accent/30',
      )}
    >
      {children}
    </div>
  )
}

function SortableSkillGroupHeader({
  groupId,
  groupName,
  children,
}: {
  groupId: string
  groupName: string
  children: React.ReactNode
}) {
  const { attributes, listeners, setActivatorNodeRef, setNodeRef, isDragging, isOver } = useSortable({
    id: getSkillGroupSortId(groupId),
    data: { type: 'skill-group-sort' },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'group/group-sort relative rounded-[6px] outline-none',
        isDragging && 'opacity-20',
        isOver && 'bg-foreground/[0.03]',
      )}
    >
      {children}
      <button
        ref={setActivatorNodeRef}
        type="button"
        aria-label={groupName}
        title={groupName}
        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 cursor-grab items-center justify-center rounded-[5px] text-muted-foreground/45 opacity-0 transition-[color,opacity] hover:bg-foreground/[0.05] hover:text-foreground active:cursor-grabbing group-hover/group-sort:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

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
  onReorderGroup,
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
  const [activeDragKey, setActiveDragKey] = React.useState<string | null>(null)
  const [activeDragGroupId, setActiveDragGroupId] = React.useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  )

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
    const showEmptyDropTargets = activeDragKey !== null
    const presentationGroups: EntityListGroup<LoadedSkill>[] = groups.map(group => {
      const items = groupedSkills.get(group.id) ?? []
      const isCollapsed = canCollapse && collapsedGroups.has(group.id)
      return {
        key: group.id,
        label: group.name,
        items: isCollapsed ? [] : items,
        collapsible: canCollapse,
        ...(isCollapsed ? { collapsedCount: items.length } : {}),
      }
    })
    if (ungroupedSkills.length > 0 || showEmptyDropTargets) {
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
  }, [activeDragKey, collapsedGroups, collection, filteredSkills, groupAssignments, groups, normalizedSearch, t])

  const activeDragSkill = React.useMemo(
    () => skills.find(skill => getSkillCollectionKey(skill) === activeDragKey),
    [activeDragKey, skills],
  )
  const activeDragGroup = React.useMemo(
    () => groups.find(group => group.id === activeDragGroupId),
    [activeDragGroupId, groups],
  )

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    if (event.active.data.current?.type === 'skill-group-sort') {
      setActiveDragGroupId(getSkillGroupIdFromSortId(event.active.id) ?? null)
    } else {
      setActiveDragKey(String(event.active.id))
    }
  }, [])

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    setActiveDragKey(null)
    setActiveDragGroupId(null)
    if (event.active.data.current?.type === 'skill-group-sort') {
      const groupId = getSkillGroupIdFromSortId(event.active.id)
      const targetGroupId = event.over ? getSkillGroupIdFromSortId(event.over.id) : undefined
      if (groupId && targetGroupId && groupId !== targetGroupId) {
        onReorderGroup?.(groupId, targetGroupId)
      }
      return
    }
    if (!event.over || !onAssignGroup) return

    const skill = skills.find(candidate => getSkillCollectionKey(candidate) === String(event.active.id))
    const targetGroupKey = getSkillGroupKeyFromDropId(event.over.id)
    if (!skill || !targetGroupKey) return

    const targetGroupId = targetGroupKey === UNGROUPED_SKILLS_KEY ? undefined : targetGroupKey
    const currentGroupId = groupAssignments[getSkillCollectionKey(skill)]
    if (currentGroupId === targetGroupId || (!currentGroupId && !targetGroupId)) return
    onAssignGroup(skill, targetGroupId)
  }, [groupAssignments, onAssignGroup, onReorderGroup, skills])

  const handleDragCancel = React.useCallback(() => {
    setActiveDragKey(null)
    setActiveDragGroupId(null)
  }, [])

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
          workingDirectory: skill.management.projectRoot ?? workingDirectory,
        })
        toast.success(t('skillsManager.uninstalled', { name: skill.metadata.name }))
      } else if (skill.source !== 'plugin' && skill.source !== 'agent') {
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
      <DndContext
        sensors={sensors}
        collisionDetection={skillGroupCollisionDetection}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
      >
        <SortableContext
          items={groups.map(group => getSkillGroupSortId(group.id))}
          strategy={verticalListSortingStrategy}
        >
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
          wrapGroup={collection === 'own' && onAssignGroup
            ? (group, content) => (
                <DroppableSkillGroup groupKey={group.key}>{content}</DroppableSkillGroup>
              )
            : undefined}
          wrapGroupHeader={collection === 'own' && onReorderGroup && groups.length > 1
            ? (group, content) => group.key === UNGROUPED_SKILLS_KEY
              ? content
              : (
                  <SortableSkillGroupHeader groupId={group.key} groupName={group.label}>
                    {content}
                  </SortableSkillGroupHeader>
                )
            : undefined}
          wrapItem={collection === 'own' && onAssignGroup
            ? (skill, content) => (
                <DraggableSkill dragId={getSkillCollectionKey(skill)}>{content}</DraggableSkill>
              )
            : undefined}
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
                {skill.source === 'agent' && (
                  <span className="shrink-0 rounded-full bg-foreground/5 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t('skillsList.agentBadge')}
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
                onDelete={!skill.management && skill.source !== 'plugin' && skill.source !== 'agent' ? () => void handleRemoveSkill(skill) : undefined}
                canDelete={skill.source !== 'plugin' && skill.source !== 'agent'}
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
        </SortableContext>
        {createPortal(
          <DragOverlay dropAnimation={null} style={{ zIndex: 'var(--z-floating-menu, 400)' }}>
            {activeDragSkill ? (
              <div
                className="flex w-[360px] max-w-[calc(100vw-32px)] cursor-grabbing items-center gap-2 rounded-[10px] bg-background px-4 py-3 shadow-modal-small"
              >
                <SkillAvatar skill={activeDragSkill} size="sm" workspaceId={workspaceId} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{activeDragSkill.metadata.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {activeDragSkill.metadata.description}
                  </div>
                </div>
              </div>
            ) : null}
            {activeDragGroup ? (
              <div className="flex w-[280px] max-w-[calc(100vw-32px)] cursor-grabbing items-center gap-2 rounded-[10px] bg-background px-4 py-3 shadow-modal-small">
                <Folder className="h-4 w-4 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{activeDragGroup.name}</span>
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground/50" />
              </div>
            ) : null}
          </DragOverlay>,
          document.body,
        )}
      </DndContext>
    </div>
  )
}
