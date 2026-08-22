import { existsSync, statSync, watch, type FSWatcher } from 'fs';
import { dirname, join, resolve } from 'path';
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts';
import { PROJECT_AGENT_SKILLS_DIR } from './storage.ts';
import type { SkillInventoryRoots } from './types.ts';

function nearestExistingDirectory(path: string): string | undefined {
  let candidate = resolve(path);
  while (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    const parent = dirname(candidate);
    if (parent === candidate) return undefined;
    candidate = parent;
  }
  return candidate;
}

function skillRoots(roots: SkillInventoryRoots): string[] {
  const paths = [
    roots.globalSkillsRoot,
    getWorkspaceSkillsPath(roots.workspaceRoot),
  ];
  if (roots.projectRoot) paths.push(join(roots.projectRoot, PROJECT_AGENT_SKILLS_DIR));
  return paths;
}

/** Watches all Skill precedence tiers and rebinds when a previously-missing tier is created. */
export class SkillInventoryWatcher {
  private watchers: FSWatcher[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(
    private roots: SkillInventoryRoots,
    private readonly onChange: () => void,
    private readonly debounceMs = 150,
  ) {
    this.bind();
  }

  updateRoots(roots: SkillInventoryRoots): void {
    this.roots = roots;
    this.bind();
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.closeWatchers();
  }

  private closeWatchers(): void {
    for (const watcher of this.watchers) watcher.close();
    this.watchers = [];
  }

  private bind(): void {
    if (this.disposed) return;
    this.closeWatchers();
    const paths = new Set(skillRoots(this.roots).flatMap(path => {
      const existing = nearestExistingDirectory(path);
      return existing ? [existing] : [];
    }));
    for (const path of paths) {
      const handleEvent = () => this.scheduleChange();
      try {
        this.watchers.push(watch(path, { recursive: true }, handleEvent));
      } catch {
        this.watchers.push(watch(path, handleEvent));
      }
    }
  }

  private scheduleChange(): void {
    if (this.disposed) return;
    // Coalesce a burst without postponing refresh forever. A trailing-edge
    // debounce can starve while package managers emit a continuous stream of
    // filesystem events.
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.bind();
      this.onChange();
    }, this.debounceMs);
  }
}
