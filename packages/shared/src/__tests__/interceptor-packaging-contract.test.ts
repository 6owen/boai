import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(import.meta.dir, '..', '..', '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot, relativePath), 'utf-8');
}

describe('interceptor packaging contract', () => {
  it('bundles the interceptor and packages only the compiled output', () => {
    const builderYml = readRepoFile('apps/electron/electron-builder.yml');
    const buildMain = readRepoFile('scripts/electron-build-main.ts');
    const dmgScript = readRepoFile('apps/electron/scripts/build-dmg.sh');
    const linuxScript = readRepoFile('apps/electron/scripts/build-linux.sh');
    const winScript = readRepoFile('apps/electron/scripts/build-win.ps1');

    expect(buildMain).toContain('packages/shared/src/unified-network-interceptor.ts');
    expect(buildMain).toContain('interceptor.cjs');
    expect(builderYml).toContain('dist/**/*');
    expect(builderYml).not.toContain('interceptor-request-utils.ts');
    expect(dmgScript).toContain('bun run electron:build');
    expect(linuxScript).toContain('bun run electron:build');
    expect(winScript).toContain('bun run electron:build');
  });
});
