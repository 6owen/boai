import * as React from 'react'
import { useTranslation } from 'react-i18next'
import type { SkillUsageRange, SkillUsageStats } from '@craft-agent/shared/skills'
import SkillStatsPage from './SkillStatsPage'

interface SkillStatsRoutePageProps {
  workspaceId: string
}

/**
 * Route-level data boundary for Skill statistics.
 *
 * Keeping the request state out of the presentational page lets the statistics
 * layout remain easy to inspect and test independently from Electron IPC.
 */
export default function SkillStatsRoutePage({ workspaceId }: SkillStatsRoutePageProps) {
  const { t } = useTranslation()
  const [range, setRange] = React.useState<SkillUsageRange>('30d')
  const [stats, setStats] = React.useState<SkillUsageStats | null>(null)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false

    if (!workspaceId) {
      setStats(null)
      setIsLoading(false)
      setError(t('common.errorLoadingContent'))
      return () => { cancelled = true }
    }

    setIsLoading(true)
    setError(null)

    window.electronAPI.getSkillUsageStats(workspaceId, range)
      .then((nextStats) => {
        if (!cancelled) setStats(nextStats)
      })
      .catch((requestError: unknown) => {
        console.error('[SkillStats] Failed to load usage statistics:', requestError)
        if (!cancelled) setError(t('common.errorLoadingContent'))
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => { cancelled = true }
  }, [range, t, workspaceId])

  return (
    <SkillStatsPage
      stats={stats}
      range={range}
      onRangeChange={setRange}
      isLoading={isLoading}
      error={error}
    />
  )
}
