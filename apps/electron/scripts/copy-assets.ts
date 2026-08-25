/**
 * Cross-platform asset copy script.
 *
 * Stages the runtime resource allowlist into dist/resources/.
 * Build-only inputs such as installer backgrounds and icon sources stay in resources/.
 *
 * At Electron startup, setBundledAssetsRoot(__dirname) is called, and then
 * getBundledAssetsDir('docs') resolves to <__dirname>/resources/docs/, etc.
 *
 * Run: bun scripts/copy-assets.ts
 */

import { join } from 'path';
import { stageElectronResources } from '../../../scripts/electron-build-resources.ts';

const rootDir = join(import.meta.dir, '..', '..', '..');
stageElectronResources(rootDir, {
  platform: (process.env.BOAI_BUILD_PLATFORM as NodeJS.Platform | undefined) ?? process.platform,
  arch: process.env.BOAI_BUILD_ARCH ?? process.arch,
});
