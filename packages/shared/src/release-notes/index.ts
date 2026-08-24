/**
 * BoAI roadmap utilities.
 *
 * The RPC names remain release-note flavored for compatibility, but the
 * user-facing panel now loads one BoAI roadmap document instead of historical
 * Craft release notes.
 */

import { createHash } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { getBundledAssetsDir } from '../utils/paths.ts';
import { debug } from '../utils/debug.ts';

const CONFIG_DIR = join(homedir(), '.craft-agent');
const ROADMAP_DIR = join(CONFIG_DIR, 'release-notes');
const ROADMAP_FILENAME = 'roadmap.md';

let roadmapInitialized = false;
let cachedRoadmap: string | undefined;

function getBundledRoadmapPath(): string {
  const assetsDir = getBundledAssetsDir('release-notes')
    ?? join(process.cwd(), 'resources', 'release-notes');
  return join(assetsDir, ROADMAP_FILENAME);
}

function loadRoadmap(): string | undefined {
  const bundledPath = getBundledRoadmapPath();
  const syncedPath = join(ROADMAP_DIR, ROADMAP_FILENAME);
  const roadmapPath = existsSync(bundledPath) ? bundledPath : syncedPath;

  if (!existsSync(roadmapPath)) {
    console.warn(`[roadmap] Could not find ${ROADMAP_FILENAME}`);
    return undefined;
  }

  try {
    return readFileSync(roadmapPath, 'utf-8');
  } catch (error) {
    console.error(`[roadmap] Failed to load ${roadmapPath}:`, error);
    return undefined;
  }
}

function getRoadmap(): string | undefined {
  cachedRoadmap ??= loadRoadmap();
  return cachedRoadmap;
}

/** Sync the bundled BoAI roadmap for remote/headless fallbacks. */
export function initializeReleaseNotes(): void {
  if (roadmapInitialized) return;
  roadmapInitialized = true;

  const roadmap = getRoadmap();
  if (!roadmap) return;

  if (!existsSync(ROADMAP_DIR)) {
    mkdirSync(ROADMAP_DIR, { recursive: true });
  }

  writeFileSync(join(ROADMAP_DIR, ROADMAP_FILENAME), roadmap, 'utf-8');
  debug('[roadmap] Synced BoAI roadmap');
}

export interface ReleaseNote {
  version: string;
  content: string;
}

function getRoadmapRevision(content: string): string {
  const digest = createHash('sha256').update(content).digest('hex').slice(0, 12);
  return `roadmap-${digest}`;
}

/** Compatibility shape used by existing release-note RPC consumers. */
export function getReleaseNotesList(): ReleaseNote[] {
  const content = getRoadmap();
  if (!content) return [];
  return [{ version: getRoadmapRevision(content), content }];
}

/** Changes whenever roadmap content changes, driving the sidebar unread dot. */
export function getLatestReleaseVersion(): string | undefined {
  const content = getRoadmap();
  return content ? getRoadmapRevision(content) : undefined;
}

/** Return the roadmap markdown rendered by the existing document overlay. */
export function getCombinedReleaseNotes(): string {
  return getRoadmap() ?? '';
}
