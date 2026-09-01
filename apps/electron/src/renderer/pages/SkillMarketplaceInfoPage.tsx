import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Download, ExternalLink, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { Info_Markdown, Info_Page, Info_Section, Info_Table } from '@/components/info'
import { cn } from '@/lib/utils'
import {
  getCachedSkillMarketplaceDetail,
  loadSkillMarketplaceDetail,
} from '@/lib/skill-marketplace-cache'
import type {
  LoadedSkill,
  SkillMarketplaceItem,
  SkillMarketplaceProvider,
} from '../../shared/types'
import {
  SKILL_MARKETPLACE_PROVIDER_META,
  SkillMarketplaceProviderIcon,
} from '@/components/skill-marketplace/provider-meta'

interface SkillMarketplaceInfoPageProps {
  provider: SkillMarketplaceProvider
  skillId: string
  workspaceId: string
  workingDirectory?: string
}

function formatNumber(value: number | undefined, locale: string): string | null {
  return value === undefined ? null : new Intl.NumberFormat(locale).format(value)
}

function formatDate(value: number | undefined, locale: string): string | null {
  if (!value) return null
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(value))
}

function getCliCommand(item: SkillMarketplaceItem): string | null {
  if (item.provider === 'skills-sh' && item.source) {
    return `npx skills add ${item.source} --skill ${item.slug}`
  }
  if (item.provider === 'clawhub' && item.owner) {
    return `clawhub install @${item.owner}/${item.slug}`
  }
  return null
}

export default function SkillMarketplaceInfoPage({
  provider,
  skillId,
  workspaceId,
  workingDirectory,
}: SkillMarketplaceInfoPageProps) {
  const { t, i18n } = useTranslation()
  const [initialDetail] = React.useState(() => getCachedSkillMarketplaceDetail({ provider, id: skillId }))
  const [item, setItem] = React.useState<SkillMarketplaceItem | null>(initialDetail ?? null)
  const [loading, setLoading] = React.useState(!initialDetail)
  const [error, setError] = React.useState<string | null>(null)
  const [installing, setInstalling] = React.useState(false)
  const [installed, setInstalled] = React.useState(false)
  const providerMeta = SKILL_MARKETPLACE_PROVIDER_META[provider]

  React.useEffect(() => {
    let cancelled = false
    const cachedDetail = getCachedSkillMarketplaceDetail({ provider, id: skillId })
    setItem(cachedDetail ?? null)
    setLoading(!cachedDetail)
    setError(null)
    void Promise.all([
      loadSkillMarketplaceDetail({ provider, id: skillId }),
      workspaceId
        ? window.electronAPI.getSkills(workspaceId, workingDirectory)
        : Promise.resolve([] as LoadedSkill[]),
    ]).then(([detail, installedSkills]) => {
      if (cancelled) return
      setItem(detail)
      setInstalled(installedSkills.some(skill => skill.slug === detail.slug))
    }).catch(reason => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [provider, skillId, workspaceId, workingDirectory])

  const install = React.useCallback(async () => {
    if (!item?.install || !workspaceId || installing) return
    setInstalling(true)
    try {
      if (item.install.kind === 'git') {
        await window.electronAPI.installSkill(workspaceId, {
          source: item.install.source,
          slug: item.install.slug,
          scope: 'global',
          workingDirectory,
        })
      } else {
        const scan = await window.electronAPI.scanSkillSource(workspaceId, {
          source: item.install.source,
          kind: 'url',
        })
        const candidate = scan.candidates.find(value => value.slug === item.install!.slug)
          ?? (scan.candidates.length === 1 ? scan.candidates[0] : undefined)
        if (!candidate) throw new Error(t('skillMarketplace.installCandidateMissing'))
        await window.electronAPI.installSkill(workspaceId, {
          source: candidate.installSource ?? scan.installSource,
          slug: candidate.slug,
          scope: 'global',
          workingDirectory,
        })
      }
      setInstalled(true)
      toast.success(t('skillMarketplace.installSuccess', { name: item.name }))
    } catch (reason) {
      toast.error(t('skillMarketplace.installFailed'), {
        description: reason instanceof Error ? reason.message : String(reason),
      })
    } finally {
      setInstalling(false)
    }
  }, [installing, item, t, workspaceId, workingDirectory])

  const command = item ? getCliCommand(item) : null
  const metricInstalls = item ? formatNumber(item.installs, i18n.language) : null
  const metricDownloads = item ? formatNumber(item.downloads, i18n.language) : null
  const metricStars = item ? formatNumber(item.stars, i18n.language) : null
  const updatedAt = item ? formatDate(item.updatedAt, i18n.language) : null

  return (
    <Info_Page loading={loading} error={error ?? undefined} empty={!item && !loading ? t('skillMarketplace.notFound') : undefined}>
      <Info_Page.Header
        title={item?.name || skillId}
        actions={item ? (
          <HeaderIconButton
            icon={<ExternalLink className="h-4 w-4" />}
            tooltip={t('skillMarketplace.openProvider', { provider: t(providerMeta.labelKey) })}
            aria-label={t('skillMarketplace.openProvider', { provider: t(providerMeta.labelKey) })}
            onClick={() => void window.electronAPI.openUrl(item.homepage)}
          />
        ) : undefined}
      />

      {item && (
        <Info_Page.Content>
          <Info_Page.Hero
            avatar={(
              <div className="flex h-full w-full items-center justify-center bg-foreground/[0.04] text-muted-foreground">
                <SkillMarketplaceProviderIcon provider={provider} className="h-4 w-4" />
              </div>
            )}
            title={item.name}
            tagline={item.description || item.source || item.owner || t(providerMeta.labelKey)}
          />

          <Info_Section title={t('skillMarketplace.marketInfo')}>
            <Info_Table labelWidth={136}>
              <Info_Table.Row label={t('skillMarketplace.skillId')} value={item.slug} />
              <Info_Table.Row label={t('common.source')} value={item.source || item.owner || t(providerMeta.labelKey)} />
              {item.repository && (
                <Info_Table.Row label={t('skillMarketplace.repository')}>
                  <button
                    type="button"
                    onClick={() => void window.electronAPI.openUrl(item.repository!)}
                    className="block w-full truncate text-left hover:underline focus-visible:outline-none focus-visible:underline"
                    title={item.repository}
                  >
                    {item.repository}
                  </button>
                </Info_Table.Row>
              )}
              {item.version && <Info_Table.Row label={t('skillMarketplace.version')} value={item.version} />}
              {metricInstalls && <Info_Table.Row label={t('skillMarketplace.installs')} value={metricInstalls} />}
              {metricDownloads && <Info_Table.Row label={t('skillMarketplace.downloads')} value={metricDownloads} />}
              {metricStars && <Info_Table.Row label={t('skillMarketplace.stars')} value={metricStars} />}
              {updatedAt && <Info_Table.Row label={t('skillMarketplace.updatedAt')} value={updatedAt} />}
            </Info_Table>
          </Info_Section>

          <Info_Section title={t('skillMarketplace.actions')}>
            <div className="space-y-2.5 p-3">
              <div className="flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant={installed ? 'secondary' : 'default'}
                  className={cn(
                    'h-7 gap-1.5 rounded-[7px] px-2.5 text-xs [&_svg]:size-3.5',
                    !installed && 'bg-accent text-white hover:bg-accent/90',
                  )}
                  onClick={() => void install()}
                  disabled={!item.install || installed || installing}
                >
                  {installed ? <CheckCircle2 /> : <Download />}
                  {installed
                    ? t('skillMarketplace.installed')
                    : installing
                      ? t('skillMarketplace.installing')
                      : t('skillMarketplace.install')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 rounded-[7px] border-foreground/10 px-2.5 text-xs [&_svg]:size-3.5"
                  onClick={() => void window.electronAPI.openUrl(item.homepage)}
                >
                  <ExternalLink />
                  {t('skillMarketplace.openProvider', { provider: t(providerMeta.labelKey) })}
                </Button>
              </div>
              {command && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">{t('skillMarketplace.cliCommand')}</p>
                  <code className="block overflow-x-auto rounded-[6px] bg-foreground/[0.035] px-2.5 py-1.5 font-mono text-xs leading-5">
                    {command}
                  </code>
                </div>
              )}
            </div>
          </Info_Section>

          {item.securityReports && item.securityReports.length > 0 && (
            <Info_Section title={t('skillMarketplace.security')}>
              <div className="divide-y divide-border/30">
                {item.securityReports.map(report => (
                  <div key={report.provider} className="flex items-start gap-3 px-4 py-3 text-sm">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{report.provider}</p>
                      <p className="text-muted-foreground">{report.statusText || report.status}</p>
                    </div>
                    {report.reportUrl && (
                      <button
                        type="button"
                        onClick={() => void window.electronAPI.openUrl(report.reportUrl!)}
                        className="text-xs text-muted-foreground hover:text-foreground hover:underline focus-visible:outline-none focus-visible:underline"
                      >
                        {t('skillMarketplace.viewReport')}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </Info_Section>
          )}

          <Info_Section title={t('skillMarketplace.skillContent')}>
            {item.content ? (
              <Info_Markdown maxHeight={640} fullscreen>{item.content}</Info_Markdown>
            ) : (
              <div className="px-4 py-5 text-sm text-muted-foreground">
                {t('skillMarketplace.contentUnavailable', { provider: t(providerMeta.labelKey) })}
              </div>
            )}
          </Info_Section>
        </Info_Page.Content>
      )}
    </Info_Page>
  )
}
