# BoAI Skills Manager

## What Phase 1 provides

The Skills navigation entry opens a management workspace that shows every physical Skill placement from these precedence tiers:

1. Global: `~/.agents/skills`
2. Workspace: `<workspace>/skills`
3. Current project: `<project>/.agents/skills`

The Agent runtime still resolves `project > workspace > global`. The management inventory deliberately does not collapse matching slugs, so shadowed, duplicate, divergent, and invalid directories remain visible.

The page supports:

- All, Managed, External, Invalid, Modified, and Conflict views
- search across metadata, scope, status, provenance, tags, and paths
- adoption of an existing placement without moving its files
- individual or bulk adoption, source editing, favorites, and tags
- local-directory or `npx skills`/Git installation into any available scope
- staging, validation, command preview, file Diff, and atomic replacement
- baseline/local/upstream state and explicit confirmation before overwriting local changes
- safe removal into the app backup area and guarded restore
- operation-log export as JSON
- live refresh for global, workspace, and project filesystem changes

## Data locations

BoAI's app profile is isolated from Craft Agents:

```text
~/.boai/
├── config.json and app settings
├── workspaces/
└── skill-manager/
    └── skills/
        ├── catalog.json
        ├── operations.jsonl
        ├── baselines/
        ├── backups/
        └── cli-staging/
```

Global universal Skills intentionally remain in `~/.agents/skills`, because sharing them with compatible agents is one of the product's core goals. BoAI metadata never replaces a Skill directory as the content source of truth.

Set `CRAFT_CONFIG_DIR` to override the BoAI profile root for development or testing.

## Install transaction

For an `npx skills`/Git source, the server runs an argument-array command without a shell:

```text
npx --yes skills add <source> --skill <slug> --agent universal --yes --copy
```

The command runs in an isolated temporary project. BoAI validates the acquired tree, rejects symlinks and unsupported file types, limits total size, prepares a Diff, and only then commits the directory into the selected real scope. Renderer requests describe a scope; they cannot supply the actual global or workspace destination root.

Updates capture immutable baseline snapshots. The preview compares baseline→local and baseline→upstream. If local content changed, the UI requires an explicit overwrite decision; changing the slug provides a save-as path.

## Restore guarantees

Every managed content mutation records a JSONL operation. Update and removal operations keep snapshots. Restore refuses to overwrite a target that was created or modified after the original operation. Catalog provenance is restored together with content.

## Main implementation map

```text
packages/shared/src/skills/
├── inventory.ts       full three-tier inventory, validation, hashing, conflicts
├── catalog.ts         versioned ownership/provenance metadata and baselines
├── command-adapter.ts isolated npx skills acquisition
├── diff.ts            deterministic file Diff
├── operations.ts      preview, transactions, history, removal, restore
└── watcher.ts         debounced three-tier filesystem refresh

packages/server-core/src/handlers/rpc/skills.ts
  trusted path resolution, typed operations, cache invalidation, broadcasts

apps/electron/src/renderer/pages/SkillsManagerPage.tsx
  inventory, details, install/update preview, management, and history UI
```

The original runtime loader in `packages/shared/src/skills/storage.ts` remains the final effective-Skill resolver used by sessions.

## Verification

Run the focused Phase 1 checks:

```bash
bun test packages/shared/src/skills/__tests__/*.test.ts
bun test packages/server-core/src/handlers/rpc/skills-manager.test.ts
bun test apps/electron/src/renderer/lib/__tests__/skills-manager-model.test.ts
bun test apps/electron/src/shared/__tests__/ipc-channels.test.ts
bun run --cwd packages/shared tsc --noEmit
bun run --cwd packages/server-core tsc --noEmit
bun run --cwd apps/electron tsc --noEmit
bun run electron:build
```

To launch locally after dependencies and the Electron runtime are present:

```bash
bun run electron:start
```
