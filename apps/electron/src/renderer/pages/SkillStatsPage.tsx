import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type {
  SkillUsageRange,
  SkillUsageStats,
} from '@craft-agent/shared/skills'
import { Info_Page, Info_Section, Info_Table } from '@/components/info'
import { SettingsSegmentedControl } from '@/components/settings'

export interface SkillStatsPageProps {
  stats: SkillUsageStats | null
  range: SkillUsageRange
  onRangeChange: (range: SkillUsageRange) => void
  isLoading: boolean
  error?: string | null
}

interface MetricCardProps {
  label: string
  value: string
}

interface RatioBarProps {
  label: string
  value: number
  max: number
}

function MetricCard({ label, value }: MetricCardProps) {
  return (
    <div className="rounded-[8px] bg-background px-4 py-3 shadow-minimal">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-foreground">
        {value}
      </dd>
    </div>
  )
}

function RatioBar({ label, value, max }: RatioBarProps) {
  const percentage = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0
  const ariaMax = Math.max(1, max)

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={ariaMax}
      aria-valuenow={value}
      className="h-1.5 overflow-hidden rounded-full bg-foreground/[0.06]"
    >
      <div
        aria-hidden="true"
        className="h-full rounded-full bg-foreground/35"
        style={{ width: `${percentage}%` }}
      />
    </div>
  )
}

function EmptyRows({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

export default function SkillStatsPage({
  stats,
  range,
  onRangeChange,
  isLoading,
  error,
}: SkillStatsPageProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language
  const numberFormatter = React.useMemo(
    () => new Intl.NumberFormat(locale),
    [locale],
  )
  const dateFormatter = React.useMemo(
    () => new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }),
    [locale],
  )

  const rangeOptions = React.useMemo(
    () => [
      { value: '7d' as const, label: t('skillStats.last7Days') },
      { value: '30d' as const, label: t('skillStats.last30Days') },
      { value: 'all' as const, label: t('skillStats.allTime') },
    ],
    [t],
  )

  const topSkills = stats?.topSkills.slice(0, 10) ?? []
  const agentSources = stats?.agentSources.slice(0, 10) ?? []
  const maxSkillCount = Math.max(0, ...topSkills.map((item) => item.count))
  const maxAgentCount = Math.max(0, ...agentSources.map((item) => item.count))

  const formatDate = React.useCallback(
    (timestamp: number) => {
      if (timestamp <= 0) return t('skillStats.neverUsed')
      const date = new Date(timestamp)
      return Number.isNaN(date.getTime())
        ? t('skillStats.neverUsed')
        : dateFormatter.format(date)
    },
    [dateFormatter, t],
  )

  return (
    <Info_Page loading={isLoading} error={error ?? undefined}>
      <Info_Page.Header title={t('skillStats.title')} centerTitle />

      <Info_Page.Content>
        <div className="flex flex-col gap-3 px-1 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm text-foreground/70">{t('skillStats.subtitle')}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('skillStats.boaiOnlyNote')}
            </p>
          </div>
          <div className="w-fit shrink-0 rounded-[9px] bg-foreground/[0.04] p-0.5">
            <SettingsSegmentedControl
              value={range}
              onValueChange={onRangeChange}
              options={rangeOptions}
              size="sm"
            />
          </div>
        </div>

        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <MetricCard
            label={t('skillStats.totalActivations')}
            value={numberFormatter.format(stats?.totals.activations ?? 0)}
          />
          <MetricCard
            label={t('skillStats.activeSkills')}
            value={numberFormatter.format(stats?.totals.skills ?? 0)}
          />
          <MetricCard
            label={t('skillStats.agentSources')}
            value={numberFormatter.format(stats?.totals.agentSources ?? 0)}
          />
        </dl>

        <Info_Section title={t('skillStats.skillUsage')}>
          {topSkills.length === 0 ? (
            <EmptyRows>{t('skillStats.noSkillUsage')}</EmptyRows>
          ) : (
            <Info_Table labelWidth={32}>
              {topSkills.map((item, index) => (
                <Info_Table.Row
                  key={item.slug}
                  label={numberFormatter.format(index + 1)}
                  className="items-start"
                >
                  <div className="min-w-0 space-y-2">
                    <div className="flex min-w-0 items-baseline justify-between gap-3">
                      <span
                        className="truncate font-medium text-foreground"
                        title={item.slug}
                      >
                        {item.slug}
                      </span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {t('skillStats.usageCount')}: {numberFormatter.format(item.count)}
                      </span>
                    </div>
                    <RatioBar
                      label={`${item.slug}, ${t('skillStats.usageCount')}: ${numberFormatter.format(item.count)}`}
                      value={item.count}
                      max={maxSkillCount}
                    />
                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {t('skillStats.sessions')}: {numberFormatter.format(item.sessionCount)}
                      </span>
                      <span>
                        {t('skillStats.lastUsed')}: {formatDate(item.lastUsedAt)}
                      </span>
                    </div>
                  </div>
                </Info_Table.Row>
              ))}
            </Info_Table>
          )}
        </Info_Section>

        <Info_Section title={t('skillStats.agentDistribution')}>
          {agentSources.length === 0 ? (
            <EmptyRows>{t('skillStats.noAgentSources')}</EmptyRows>
          ) : (
            <Info_Table labelWidth={32}>
              {agentSources.map((item, index) => {
                const sourceName = item.label
                  || item.llmConnection
                  || item.provider
                  || item.key
                  || t('skillStats.unknownAgent')
                const sourceDetail = Array.from(new Set([
                  item.provider,
                  item.model,
                ].filter((value): value is string => Boolean(value && value !== sourceName))))
                  .join(' · ')

                return (
                  <Info_Table.Row
                    key={item.key}
                    label={numberFormatter.format(index + 1)}
                    className="items-start"
                  >
                    <div className="min-w-0 space-y-2">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p
                            className="truncate font-medium text-foreground"
                            title={sourceName}
                          >
                            {sourceName}
                          </p>
                          {sourceDetail && (
                            <p
                              className="mt-0.5 truncate text-xs text-muted-foreground"
                              title={sourceDetail}
                            >
                              {sourceDetail}
                            </p>
                          )}
                        </div>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {t('skillStats.usageCount')}: {numberFormatter.format(item.count)}
                        </span>
                      </div>
                      <RatioBar
                        label={`${sourceName}, ${t('skillStats.usageCount')}: ${numberFormatter.format(item.count)}`}
                        value={item.count}
                        max={maxAgentCount}
                      />
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>
                          {t('skillStats.activeSkills')}: {numberFormatter.format(item.skillCount)}
                        </span>
                        <span>
                          {t('skillStats.sessions')}: {numberFormatter.format(item.sessionCount)}
                        </span>
                      </div>
                    </div>
                  </Info_Table.Row>
                )
              })}
            </Info_Table>
          )}
        </Info_Section>
      </Info_Page.Content>
    </Info_Page>
  )
}
