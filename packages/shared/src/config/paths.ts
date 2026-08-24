/**
 * Canonical BoAI application paths.
 *
 * Resolution order:
 *   1. BOAI_HOME
 *   2. CRAFT_CONFIG_DIR (deprecated compatibility alias)
 *   3. ~/.boai
 *
 * All runtime filesystem access to BoAI-owned data must flow through this
 * module. The legacy ~/.craft-agent directory is exposed only for migration
 * diagnostics and must never be used as a write target by default.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export type ConfigDirSource = 'BOAI_HOME' | 'CRAFT_CONFIG_DIR' | 'default';

export interface ConfigDirResolution {
  path: string;
  source: ConfigDirSource;
}

export interface ConfigDirEnv {
  BOAI_HOME?: string;
  CRAFT_CONFIG_DIR?: string;
}

function resolveConfiguredPath(value: string, homeDir: string): string {
  const trimmed = value.trim();
  const expanded = trimmed === '~'
    ? homeDir
    : trimmed.startsWith('~/') || trimmed.startsWith('~\\')
      ? join(homeDir, trimmed.slice(2))
      : trimmed;
  return resolve(expanded);
}

/** Pure resolver kept injectable for tests and non-process consumers. */
export function resolveConfigDir(
  env: ConfigDirEnv = {
    BOAI_HOME: process.env.BOAI_HOME,
    CRAFT_CONFIG_DIR: process.env.CRAFT_CONFIG_DIR,
  },
  homeDir = homedir(),
): ConfigDirResolution {
  const boaiHome = env.BOAI_HOME?.trim();
  if (boaiHome) {
    return { path: resolveConfiguredPath(boaiHome, homeDir), source: 'BOAI_HOME' };
  }

  const legacyOverride = env.CRAFT_CONFIG_DIR?.trim();
  if (legacyOverride) {
    return { path: resolveConfiguredPath(legacyOverride, homeDir), source: 'CRAFT_CONFIG_DIR' };
  }

  return { path: join(homeDir, '.boai'), source: 'default' };
}

const resolution = resolveConfigDir();

export const CONFIG_DIR = resolution.path;
export const CONFIG_DIR_SOURCE = resolution.source;
export const LEGACY_CONFIG_DIR = join(homedir(), '.craft-agent');

/** Single source of truth for all BoAI-owned filesystem locations. */
export const APP_PATHS = Object.freeze({
  appRoot: CONFIG_DIR,
  configFile: join(CONFIG_DIR, 'config.json'),
  configDefaultsFile: join(CONFIG_DIR, 'config-defaults.json'),
  credentialsFile: join(CONFIG_DIR, 'credentials.enc'),
  preferencesFile: join(CONFIG_DIR, 'preferences.json'),
  draftsFile: join(CONFIG_DIR, 'drafts.json'),
  workspacesDir: join(CONFIG_DIR, 'workspaces'),
  logsDir: join(CONFIG_DIR, 'logs'),
  docsDir: join(CONFIG_DIR, 'docs'),
  themesDir: join(CONFIG_DIR, 'themes'),
  permissionsDir: join(CONFIG_DIR, 'permissions'),
  toolIconsDir: join(CONFIG_DIR, 'tool-icons'),
  releaseNotesDir: join(CONFIG_DIR, 'release-notes'),
  feedbackDir: join(CONFIG_DIR, 'feedback'),
  windowStateFile: join(CONFIG_DIR, 'window-state.json'),
  migrationManifestFile: join(CONFIG_DIR, 'migration-manifest.json'),
});

if (CONFIG_DIR_SOURCE === 'CRAFT_CONFIG_DIR') {
  process.emitWarning(
    'CRAFT_CONFIG_DIR is deprecated; use BOAI_HOME instead.',
    { code: 'BOAI_LEGACY_CONFIG_DIR' },
  );
}
