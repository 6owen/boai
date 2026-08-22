import { createHash } from 'crypto';
import { lstatSync, readFileSync, readdirSync } from 'fs';
import { join, relative } from 'path';
import type { SkillDirectoryDiff, SkillFileDiff } from './types.ts';

interface FileSnapshot {
  hash: string;
  content?: string;
}

const TEXT_PREVIEW_LIMIT = 256 * 1024;

function snapshotFiles(root: string): Map<string, FileSnapshot> {
  const files = new Map<string, FileSnapshot>();

  function visit(directory: string): void {
    for (const name of readdirSync(directory).sort()) {
      if (name === '.DS_Store') continue;
      const fullPath = join(directory, name);
      const stats = lstatSync(fullPath);
      if (stats.isSymbolicLink()) continue;
      if (stats.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!stats.isFile()) continue;
      const buffer = readFileSync(fullPath);
      const snapshot: FileSnapshot = { hash: createHash('sha256').update(buffer).digest('hex') };
      if (buffer.length <= TEXT_PREVIEW_LIMIT && !buffer.includes(0)) {
        snapshot.content = buffer.toString('utf8');
      }
      files.set(relative(root, fullPath).split('\\').join('/'), snapshot);
    }
  }

  visit(root);
  return files;
}

export function diffSkillDirectories(beforeRoot: string, afterRoot: string): SkillDirectoryDiff {
  const before = snapshotFiles(beforeRoot);
  const after = snapshotFiles(afterRoot);
  const paths = Array.from(new Set([...before.keys(), ...after.keys()])).sort();
  const files: SkillFileDiff[] = paths.map(path => {
    const previous = before.get(path);
    const next = after.get(path);
    const status: SkillFileDiff['status'] = !previous
      ? 'added'
      : !next
        ? 'removed'
        : previous.hash === next.hash
          ? 'unchanged'
          : 'modified';
    return {
      path,
      status,
      beforeHash: previous?.hash,
      afterHash: next?.hash,
      beforeContent: previous?.content,
      afterContent: next?.content,
    };
  });
  return { changed: files.some(file => file.status !== 'unchanged'), files };
}
