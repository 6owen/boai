/**
 * SkillInfoPage
 *
 * Displays comprehensive skill details including metadata,
 * permission modes, and instructions.
 * Uses the Info_ component system for consistent styling with SourceInfoPage.
 */

import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useEffect, useState, useCallback } from 'react'
import { Check, X, Minus } from 'lucide-react'
import { EditPopover, EditButton, getEditConfig } from '@/components/ui/EditPopover'
import { toast } from 'sonner'
import { SkillMenu } from '@/components/app-shell/SkillMenu'
import { UpdateSkillPopover } from '@/components/app-shell/UpdateSkillPopover'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { routes, navigate } from '@/lib/navigate'
import { useActiveWorkspace } from '@/context/AppShellContext'
import { getFileManagerName } from '@/lib/platform'
import {
  Info_Page,
  Info_Section,
  Info_Table,
  Info_Markdown,
} from '@/components/info'
import type { LoadedSkill } from '../../shared/types'
import {
  isSkillInOwnCollection,
  useSkillFavorites,
} from '@/hooks/useSkillCollections'

interface SkillInfoPageProps {
  skillSlug: string
  workspaceId: string
  workingDirectory?: string
  collection?: 'installed' | 'own'
}

function formatPackageDate(value: string | undefined, locale: string): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export default function SkillInfoPage({ skillSlug, workspaceId, workingDirectory, collection = 'installed' }: SkillInfoPageProps) {
  const { t, i18n } = useTranslation()
  const [skill, setSkill] = useState<LoadedSkill | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const activeWorkspace = useActiveWorkspace()
  const canRevealLocally = !activeWorkspace?.remoteServer
  const { favoriteKeys, excludedOwnSkillKeys, toggleFavorite } = useSkillFavorites(workspaceId)

  // Load skill data
  useEffect(() => {
    let isMounted = true
    setLoading(true)
    setError(null)

    const loadSkill = async () => {
      try {
        const skills = await window.electronAPI.getSkills(workspaceId, workingDirectory)

        if (!isMounted) return

        // Find the skill by slug
        const found = skills.find((s) => s.slug === skillSlug)
        if (found) {
          setSkill(found)
        } else {
          setError(t('skillInfo.notFound'))
        }
      } catch (err) {
        if (!isMounted) return
        setError(err instanceof Error ? err.message : t('skillInfo.failedToLoad'))
      } finally {
        if (isMounted) setLoading(false)
      }
    }

    loadSkill()

    // Subscribe to skill changes
    const unsubscribe = window.electronAPI.onSkillsChanged?.((changedWorkspaceId, skills) => {
      if (changedWorkspaceId !== workspaceId) return
      const updated = skills.find((s) => s.slug === skillSlug)
      if (updated) {
        setSkill(updated)
      }
    })

    return () => {
      isMounted = false
      unsubscribe?.()
    }
  }, [workspaceId, skillSlug, workingDirectory, t])

  // Handle open in finder
  const handleOpenInFinder = useCallback(async () => {
    if (!skill || !canRevealLocally) return
    try {
      await window.electronAPI.showInFolder(skill.path)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), {
        description: message,
      })
    }
  }, [canRevealLocally, skill, t])

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!skill) return

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
      navigate(collection === 'own' ? routes.view.skillsOwn() : routes.view.skillsInstalled())
    } catch (err) {
      toast.error(skill.management ? t('skillsManager.uninstallFailed') : t('skillInfo.failedToDelete'), {
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }, [collection, skill, t, workspaceId, workingDirectory])

  const handleToggleFavorite = useCallback(() => {
    if (!skill) return
    const wasInOwn = isSkillInOwnCollection(skill, favoriteKeys, excludedOwnSkillKeys)
    toggleFavorite(skill)
    if (collection === 'own' && wasInOwn) {
      navigate(routes.view.skillsOwn())
    }
  }, [collection, excludedOwnSkillKeys, favoriteKeys, skill, toggleFavorite])

  // Handle opening in new window
  const handleOpenInNewWindow = useCallback(() => {
    window.electronAPI.openUrl(`craftagents://skills/skill/${skillSlug}?window=focused`)
  }, [skillSlug])

  // Get skill name for header
  const skillName = skill?.metadata.name || skillSlug
  const locale = i18n.resolvedLanguage ?? i18n.language
  const installedAt = formatPackageDate(skill?.management?.installedAt, locale)
  const updatedAt = formatPackageDate(skill?.management?.updatedAt, locale)

  // Format path to show just the skill-relative portion (skills/{slug}/)
  const formatPath = (path: string) => {
    const skillsIndex = path.indexOf('/skills/')
    if (skillsIndex !== -1) {
      return path.slice(skillsIndex + 1) // Remove leading slash, keep "skills/{slug}/..."
    }
    return path
  }

  // Open the skill folder in Finder
  const handleLocationClick = async () => {
    if (!skill || !canRevealLocally) return
    try {
      await window.electronAPI.showInFolder(skill.path)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      toast.error(t('toast.failedToReveal', { fileManager: getFileManagerName() }), {
        description: message,
      })
    }
  }

  return (
    <Info_Page
      loading={loading}
      error={error ?? undefined}
      empty={!skill && !loading && !error ? t('skillInfo.notFound') : undefined}
    >
      <Info_Page.Header
        title={skillName}
        centerTitle
        titleMenu={
          <SkillMenu
            skillSlug={skillSlug}
            skillName={skillName}
            onOpenInNewWindow={handleOpenInNewWindow}
            onShowInFinder={handleOpenInFinder}
            canShowInFinder={canRevealLocally}
            onUninstall={skill?.management ? () => void handleDelete() : undefined}
            onDelete={skill && !skill.management && skill.source !== 'plugin' && skill.source !== 'agent' ? () => void handleDelete() : undefined}
            canDelete={Boolean(skill && skill.source !== 'plugin' && skill.source !== 'agent')}
            deleteLabel={t('skillInfo.deleteSkill')}
            isFavorite={skill ? isSkillInOwnCollection(skill, favoriteKeys, excludedOwnSkillKeys) : false}
            onToggleFavorite={skill ? handleToggleFavorite : undefined}
          />
        }
      />

      {skill && (
        <Info_Page.Content>
          {/* Hero: Avatar, title, and description */}
          <Info_Page.Hero
            avatar={<SkillAvatar skill={skill} fluid workspaceId={workspaceId} />}
            title={skill.metadata.name}
            tagline={skill.metadata.description}
          />

          {/* Metadata */}
          <Info_Section
            title={t('skillInfo.metadata')}
            actions={skill.source !== 'plugin' && skill.source !== 'agent' ? (
              // EditPopover for AI-assisted metadata editing (name, description in frontmatter)
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('skill-metadata', skill.path)}
                secondaryAction={{
                  label: t('common.editFile'),
                  filePath: `${skill.path}/SKILL.md`,
                }}
              />
            ) : undefined}
          >
            <Info_Table>
              <Info_Table.Row label={t('common.slug')} value={skill.slug} />
              <Info_Table.Row label={t('common.name')}>{skill.metadata.name}</Info_Table.Row>
              <Info_Table.Row label={t('common.description')}>
                {skill.metadata.description}
              </Info_Table.Row>
              <Info_Table.Row label={t('common.source')}>
                {skill.source === 'project' ? t('skillInfo.sourceProject') :
                 skill.source === 'global' ? t('skillInfo.sourceGlobal') :
                 skill.source === 'plugin' ? t('skillInfo.sourcePlugin', { name: skill.pluginName }) :
                 skill.source === 'agent' ? t('skillInfo.sourceAgent') :
                 t('skillInfo.sourceWorkspace')}
              </Info_Table.Row>
              <Info_Table.Row label={t('common.location')}>
                <button
                  onClick={handleLocationClick}
                  className="hover:underline cursor-pointer text-left"
                >
                  {formatPath(skill.path)}
                </button>
              </Info_Table.Row>
              {skill.metadata.requiredSources && skill.metadata.requiredSources.length > 0 && (
                <Info_Table.Row label={t('skillInfo.requiredSources')}>
                  {skill.metadata.requiredSources.join(', ')}
                </Info_Table.Row>
              )}
            </Info_Table>
          </Info_Section>

          {skill.management && (
            <Info_Section
              title={t('skillInfo.packageInfo')}
              actions={skill.management.canUpdate ? (
                <UpdateSkillPopover
                  workspaceId={workspaceId}
                  workingDirectory={workingDirectory}
                  skill={skill}
                />
              ) : undefined}
            >
              <Info_Table labelWidth={136}>
                {skill.management.source && (
                  <Info_Table.Row label={t('common.source')} value={skill.management.source} />
                )}
                {skill.management.sourceUrl && (
                  <Info_Table.Row label={t('skillInfo.repository')}>
                    <button
                      type="button"
                      onClick={() => void window.electronAPI.openUrl(skill.management!.sourceUrl!)}
                      className="block w-full truncate text-left text-foreground hover:underline focus:outline-none focus-visible:underline"
                      title={skill.management.sourceUrl}
                    >
                      {skill.management.sourceUrl}
                    </button>
                  </Info_Table.Row>
                )}
                {skill.management.revision && (
                  <Info_Table.Row label={t('skillInfo.revision')}>
                    <span className="break-all font-mono text-[13px] leading-5">
                      {skill.management.revision}
                    </span>
                  </Info_Table.Row>
                )}
                {installedAt && (
                  <Info_Table.Row label={t('skillInfo.installedAt')} value={installedAt} />
                )}
                {updatedAt && (
                  <Info_Table.Row label={t('skillInfo.updatedAt')} value={updatedAt} />
                )}
              </Info_Table>
            </Info_Section>
          )}

          {/* Permission Modes */}
          {skill.metadata.alwaysAllow && skill.metadata.alwaysAllow.length > 0 && (
            <Info_Section title={t('skillInfo.permissionModes')}>
              <div className="space-y-2 px-4 py-3">
                <p className="text-xs text-muted-foreground mb-3">
                  {t('skillInfo.permissionModesDesc')}
                </p>
                <div className="rounded-[8px] border border-border/50 overflow-hidden">
                  <table className="w-full text-sm">
                    <tbody>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground w-[140px]">{t('skillInfo.explore')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <X className="h-3.5 w-3.5 text-destructive shrink-0" />
                          <span className="text-foreground/80">{t('skillInfo.exploreDesc')}</span>
                        </td>
                      </tr>
                      <tr className="border-b border-border/30">
                        <td className="px-3 py-2 font-medium text-muted-foreground">{t('skillInfo.askToEdit')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-success shrink-0" />
                          <span className="text-foreground/80">{t('skillInfo.askToEditDesc')}</span>
                        </td>
                      </tr>
                      <tr>
                        <td className="px-3 py-2 font-medium text-muted-foreground">{t('skillInfo.auto')}</td>
                        <td className="px-3 py-2 flex items-center gap-2">
                          <Minus className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="text-foreground/80">{t('skillInfo.autoDesc')}</span>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </Info_Section>
          )}

          {/* Instructions */}
          <Info_Section
            title={t('skillInfo.instructions')}
            actions={
              // EditPopover for AI-assisted editing with "Edit File" as secondary action
              <EditPopover
                trigger={<EditButton />}
                {...getEditConfig('skill-instructions', skill.path)}
                secondaryAction={{
                  label: t('common.editFile'),
                  filePath: `${skill.path}/SKILL.md`,
                }}
              />
            }
          >
            <Info_Markdown maxHeight={540} fullscreen>
              {skill.content || t('skillInfo.noInstructions')}
            </Info_Markdown>
          </Info_Section>

        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
