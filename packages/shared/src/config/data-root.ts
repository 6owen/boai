import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  APP_PATHS,
  CONFIG_DIR,
  CONFIG_DIR_SOURCE,
  LEGACY_CONFIG_DIR,
  type ConfigDirSource,
} from './paths.ts';

const MANAGED_FILES = [
  'config.json',
  'credentials.enc',
  'preferences.json',
  'drafts.json',
] as const;

const MANAGED_DIRECTORIES = ['workspaces', 'sources', 'skills'] as const;

export type DataRootStatus =
  | 'custom'
  | 'fresh'
  | 'boai-only'
  | 'legacy-only'
  | 'conflict'
  | 'migrated'
  | 'legacy-override';

export interface DataRootInspection {
  status: DataRootStatus;
  activeRoot: string;
  legacyRoot: string;
  activeHasData: boolean;
  legacyHasData: boolean;
  source: ConfigDirSource;
}

function isNonEmptyDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length > 0;
  } catch {
    return false;
  }
}

/** Detects BoAI-managed data without treating logs, docs, or hidden files as user data. */
export function hasManagedData(root: string): boolean {
  if (!existsSync(root)) return false;
  if (MANAGED_FILES.some((name) => existsSync(join(root, name)))) return true;
  return MANAGED_DIRECTORIES.some((name) => isNonEmptyDirectory(join(root, name)));
}

function hasCompletedMigrationManifest(root: string, legacyRoot: string): boolean {
  const manifestPath = join(root, 'migration-manifest.json');
  if (!existsSync(manifestPath)) return false;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
    return manifest.status === 'complete'
      && typeof manifest.sourceRoot === 'string'
      && resolve(manifest.sourceRoot) === resolve(legacyRoot);
  } catch {
    return false;
  }
}

/** Read-only startup diagnostic. It never copies, removes, or rewrites either root. */
export function inspectDataRoots(options: {
  activeRoot?: string;
  legacyRoot?: string;
  source?: ConfigDirSource;
} = {}): DataRootInspection {
  const activeRoot = options.activeRoot ?? CONFIG_DIR;
  const legacyRoot = options.legacyRoot ?? LEGACY_CONFIG_DIR;
  const source = options.source ?? CONFIG_DIR_SOURCE;
  const activeHasData = hasManagedData(activeRoot);
  const activeIsLegacyRoot = resolve(activeRoot) === resolve(legacyRoot);
  const activeIsStandardBoaiRoot = resolve(activeRoot) === resolve(join(dirname(legacyRoot), '.boai'));
  const legacyHasData = activeIsLegacyRoot
    ? activeHasData
    : hasManagedData(legacyRoot);

  let status: DataRootStatus;
  if (activeIsLegacyRoot) {
    status = 'legacy-override';
  } else if (source !== 'default' && !activeIsStandardBoaiRoot) {
    status = 'custom';
  } else if (hasCompletedMigrationManifest(activeRoot, legacyRoot)) {
    status = 'migrated';
  } else if (activeHasData && legacyHasData) {
    status = 'conflict';
  } else if (activeHasData) {
    status = 'boai-only';
  } else if (legacyHasData) {
    status = 'legacy-only';
  } else {
    status = 'fresh';
  }

  return { status, activeRoot, legacyRoot, activeHasData, legacyHasData, source };
}

export const ACTIVE_DATA_ROOT = APP_PATHS.appRoot;
