/** Public Skill marketplace providers supported by BoAI. */
export type SkillMarketplaceProvider = 'skills-sh' | 'clawhub' | 'skillhub';

/** Sort modes are mapped to the closest native capability of each provider. */
export type SkillMarketplaceSort =
  | 'all-time'
  | 'recommended'
  | 'downloads'
  | 'trending'
  | 'hot'
  | 'updated';

export interface SkillMarketplaceListRequest {
  provider: SkillMarketplaceProvider;
  query?: string;
  sort?: SkillMarketplaceSort;
  limit?: number;
  /** Zero-based page for page-oriented providers. */
  page?: number;
  /** Opaque continuation token for cursor-oriented providers. */
  cursor?: string;
}

export interface SkillMarketplaceDetailRequest {
  provider: SkillMarketplaceProvider;
  /** Provider-stable identity returned by the list endpoint. */
  id: string;
}

export interface SkillMarketplaceInstallTarget {
  /** Install a known Git repository directly, or scan a provider ZIP first. */
  kind: 'git' | 'url';
  source: string;
  slug: string;
}

export interface SkillMarketplaceSecurityReport {
  provider: string;
  status: string;
  statusText?: string;
  reportUrl?: string;
}

export interface SkillMarketplaceItem {
  id: string;
  provider: SkillMarketplaceProvider;
  slug: string;
  name: string;
  owner?: string;
  source?: string;
  description?: string;
  homepage: string;
  repository?: string;
  iconUrl?: string;
  version?: string;
  installs?: number;
  downloads?: number;
  stars?: number;
  updatedAt?: number;
  verified?: boolean;
  suspicious?: boolean;
  content?: string;
  install?: SkillMarketplaceInstallTarget;
  securityReports?: SkillMarketplaceSecurityReport[];
}

export interface SkillMarketplaceListResult {
  items: SkillMarketplaceItem[];
  total?: number;
  /** True when the provider can continue returning more results. */
  hasMore?: boolean;
  /** Zero-based page to request next, when the provider uses pages. */
  nextPage?: number;
  /** Opaque cursor to request next, when the provider uses cursors. */
  nextCursor?: string;
}
