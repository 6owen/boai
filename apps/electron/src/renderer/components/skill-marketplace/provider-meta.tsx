import { Boxes, Cat, SquareTerminal, type LucideIcon } from 'lucide-react'
import type { SkillMarketplaceProvider, SkillMarketplaceSort } from '../../../shared/types'

export interface SkillMarketplaceProviderMeta {
  label: string
  labelKey: string
  Icon: LucideIcon
  homepage: string
  sorts: readonly SkillMarketplaceSort[]
}

export const SKILL_MARKETPLACE_PROVIDER_META: Record<SkillMarketplaceProvider, SkillMarketplaceProviderMeta> = {
  'skills-sh': {
    label: 'skills.sh',
    labelKey: 'skillMarketplace.providers.skillsSh',
    Icon: SquareTerminal,
    homepage: 'https://skills.sh',
    sorts: ['all-time', 'trending', 'hot'],
  },
  clawhub: {
    label: 'ClawHub',
    labelKey: 'skillMarketplace.providers.clawHub',
    Icon: Cat,
    homepage: 'https://clawhub.ai',
    sorts: ['recommended', 'downloads', 'trending', 'updated'],
  },
  skillhub: {
    label: '腾讯 SkillHub',
    labelKey: 'skillMarketplace.providers.skillHub',
    Icon: Boxes,
    homepage: 'https://skillhub.cn',
    sorts: ['recommended', 'downloads', 'updated'],
  },
}

export function SkillMarketplaceProviderIcon({
  provider,
  className,
}: {
  provider: SkillMarketplaceProvider
  className?: string
}) {
  const Icon = SKILL_MARKETPLACE_PROVIDER_META[provider].Icon
  return <Icon className={className} aria-hidden="true" />
}
