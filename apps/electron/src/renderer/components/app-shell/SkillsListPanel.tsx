import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Star, UserRound, Zap } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@craft-agent/ui'
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
import type { LoadedSkill } from '../../../shared/types'
import { SessionSearchHeader } from './SessionSearchHeader'
import { getSkillCollectionKey, isSelfAuthoredSkill } from '@/hooks/useSkillCollections'

export interface SkillsListPanelProps {
  skills: LoadedSkill[]
  onSkillClick: (skill: LoadedSkill) => void
  selectedSkillSlug?: string | null
  workspaceId?: string
  workspaceRootPath?: string
  workingDirectory?: string
  searchQuery?: string
  onSearchChange?: (query: string) => void
  onSearchClose?: () => void
  collection?: 'installed' | 'own'
  favoriteSkillKeys?: ReadonlySet<string>
  onToggleFavorite?: (skill: LoadedSkill) => void
  className?: string
}

export function SkillsListPanel({
  skills,
  onSkillClick,
  selectedSkillSlug,
  workspaceId,
  workspaceRootPath,
  workingDirectory,
  searchQuery = '',
  onSearchChange,
  onSearchClose,
  collection = 'installed',
  favoriteSkillKeys = new Set(),
  onToggleFavorite,
  className,
}: SkillsListPanelProps) {
  const { t } = useTranslation()
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer
  const normalizedSearch = searchQuery.trim().toLowerCase()
  const filteredSkills = React.useMemo(() => {
    if (!normalizedSearch) return skills
    return skills.filter(skill => [
      skill.slug,
      skill.metadata.name,
      skill.metadata.description,
    ].some(value => value.toLowerCase().includes(normalizedSearch)))
  }, [normalizedSearch, skills])

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
        <SessionSearchHeader
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onSearchClose={searchQuery ? onSearchClose : undefined}
          resultCount={filteredSkills.length}
          placeholder={t('skillsList.searchPlaceholder')}
        />
        <EntityPanel<LoadedSkill>
          items={filteredSkills}
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
                  {workspaceRootPath && (
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
            rowAction: collection === 'own'
              && favoriteSkillKeys.has(getSkillCollectionKey(skill))
              && !isSelfAuthoredSkill(skill)
              && onToggleFavorite ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label={t('skillsList.removeFromOwn')}
                      onClick={() => onToggleFavorite(skill)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <Star className="h-3.5 w-3.5 fill-current" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" sideOffset={4}>
                    {t('skillsList.removeFromOwn')}
                  </TooltipContent>
                </Tooltip>
              ) : undefined,
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
                isFavorite={favoriteSkillKeys.has(getSkillCollectionKey(skill))}
                onToggleFavorite={!isSelfAuthoredSkill(skill) && onToggleFavorite
                  ? () => onToggleFavorite(skill)
                  : undefined}
              />
            ),
          })}
        />
    </div>
  )
}
