/**
 * Cross-platform resources copy script
 */

import { existsSync, cpSync, copyFileSync, mkdirSync, readdirSync, rmSync } from "fs";
import { dirname, join } from "path";

const ROOT_DIR = join(import.meta.dir, "..");

function copyRequiredArtifact(source: string, destination: string, label: string): void {
  if (!existsSync(source)) {
    throw new Error(`${label} build output not found at ${source}`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

export interface ElectronResourceStageOptions {
  platform?: NodeJS.Platform;
  arch?: string;
}

const RUNTIME_DIRECTORIES = [
  "docs",
  "themes",
  "permissions",
  "tool-icons",
  "release-notes",
  "scripts",
  "bridge-mcp-server",
] as const;

const RUNTIME_FILES = [
  "config-defaults.json",
  "boai-mascot.png",
  "source.png",
] as const;

function shouldCopyRuntimePath(sourceRoot: string, sourcePath: string): boolean {
  const relativePath = sourcePath.slice(sourceRoot.length).replace(/^[/\\]+/, "");
  const parts = relativePath.split(/[/\\]/);

  return !parts.some((part) =>
    part === "__tests__"
      || part === "tests"
      || part === "test"
      || part === "__pycache__"
      || part === ".DS_Store"
      || part.endsWith(".map")
      || part.endsWith(".pyc")
  );
}

function copyRuntimeEntry(sourceRoot: string, destinationRoot: string, entry: string): void {
  const source = join(sourceRoot, entry);
  if (!existsSync(source)) return;

  cpSync(source, join(destinationRoot, entry), {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    filter: (sourcePath) => shouldCopyRuntimePath(sourceRoot, sourcePath),
  });
}

function copyRuntimeBin(
  sourceRoot: string,
  destinationRoot: string,
  platform: NodeJS.Platform,
  arch: string,
): void {
  const sourceBin = join(sourceRoot, "bin");
  if (!existsSync(sourceBin)) return;

  for (const entry of readdirSync(sourceBin, { withFileTypes: true })) {
    if (entry.isFile() || entry.isSymbolicLink()) {
      copyRuntimeEntry(sourceRoot, destinationRoot, join("bin", entry.name));
    }
  }

  copyRuntimeEntry(sourceRoot, destinationRoot, join("bin", `${platform}-${arch}`));
}

export function stageElectronResources(
  rootDir = ROOT_DIR,
  options: ElectronResourceStageOptions = {},
): void {
  const electronDir = join(rootDir, "apps/electron");
  const srcDir = join(electronDir, "resources");
  const destDir = join(electronDir, "dist/resources");
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;

  if (!existsSync(srcDir)) {
    throw new Error(`Electron resources directory not found at ${srcDir}`);
  }

  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });

  for (const directory of RUNTIME_DIRECTORIES) {
    copyRuntimeEntry(srcDir, destDir, directory);
  }
  for (const file of RUNTIME_FILES) {
    copyRuntimeEntry(srcDir, destDir, file);
  }
  copyRuntimeBin(srcDir, destDir, platform, arch);

  copyRequiredArtifact(
    join(rootDir, "packages/pi-agent-server/dist/index.js"),
    join(destDir, "pi-agent-server/index.js"),
    "Pi agent server",
  );
  copyRequiredArtifact(
    join(rootDir, "packages/session-mcp-server/dist/index.js"),
    join(destDir, "session-mcp-server/index.js"),
    "Session MCP server",
  );

  const powershellParser = join(rootDir, "packages/shared/src/agent/powershell-parser.ps1");
  if (existsSync(powershellParser)) {
    copyFileSync(powershellParser, join(destDir, "powershell-parser.ps1"));
  }

  console.log(`📦 Staged Electron runtime resources for ${platform}-${arch}`);
}

if (import.meta.main) {
  stageElectronResources(ROOT_DIR, {
    platform: (process.env.BOAI_BUILD_PLATFORM as NodeJS.Platform | undefined) ?? process.platform,
    arch: process.env.BOAI_BUILD_ARCH ?? process.arch,
  });
}
