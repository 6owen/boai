/**
 * Cross-platform resources copy script
 */

import { existsSync, cpSync, copyFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";

const ROOT_DIR = join(import.meta.dir, "..");

function copyRequiredArtifact(source: string, destination: string, label: string): void {
  if (!existsSync(source)) {
    throw new Error(`${label} build output not found at ${source}`);
  }

  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

export function stageElectronResources(rootDir = ROOT_DIR): void {
  const electronDir = join(rootDir, "apps/electron");
  const srcDir = join(electronDir, "resources");
  const destDir = join(electronDir, "dist/resources");

  if (!existsSync(srcDir)) {
    throw new Error(`Electron resources directory not found at ${srcDir}`);
  }

  cpSync(srcDir, destDir, { recursive: true, force: true });

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

  console.log("📦 Copied resources and agent subprocesses to dist");
}

if (import.meta.main) {
  stageElectronResources();
}
