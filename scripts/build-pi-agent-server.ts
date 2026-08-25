#!/usr/bin/env bun

import { mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { build } from 'esbuild'

export interface BuildPiAgentServerOptions {
  rootDir?: string
  outfile?: string
  logLevel?: 'silent' | 'info'
}

const DEFAULT_ROOT_DIR = join(import.meta.dir, '..')

/**
 * Build the self-contained PI subprocess for Electron 39's embedded Node 22.
 *
 * A small createRequire bridge is required because a few transitive packages
 * still perform guarded CommonJS loads from an otherwise ESM-only dependency
 * graph. `koffi` remains external so its platform-specific N-API binary can be
 * staged beside the bundle.
 */
export async function buildPiAgentServer(
  options: BuildPiAgentServerOptions = {},
): Promise<string> {
  const rootDir = options.rootDir ?? DEFAULT_ROOT_DIR
  const outfile = options.outfile
    ?? join(rootDir, 'packages', 'pi-agent-server', 'dist', 'index.js')

  mkdirSync(dirname(outfile), { recursive: true })
  await build({
    absWorkingDir: rootDir,
    entryPoints: ['packages/pi-agent-server/src/index.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    external: ['koffi'],
    banner: {
      js: "import { createRequire as __boaiCreateRequire } from 'node:module'; const require = __boaiCreateRequire(import.meta.url);",
    },
    legalComments: 'none',
    sourcemap: false,
    logLevel: options.logLevel ?? 'silent',
  })

  return outfile
}

if (import.meta.main) {
  const outfile = await buildPiAgentServer({ logLevel: 'info' })
  const sizeMiB = statSync(outfile).size / 1024 / 1024
  console.log(`PI Agent Server Node bundle: ${outfile} (${sizeMiB.toFixed(2)} MiB)`)
}
