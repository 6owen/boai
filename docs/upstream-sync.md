# Craft Agents upstream sync

This Phase 1 branch is based on Craft Agents `v0.12.0` at commit `abdc281a75926da136ebe306f6331b0739246673`.

The local `upstream` remote should point to:

```text
https://github.com/craft-ai-agents/craft-agents-oss.git
```

After creating a personal fork, add it as `origin`:

```bash
git remote add origin <your-fork-url>
```

Use a dedicated sync branch instead of merging upstream directly into feature work:

```bash
git fetch upstream --tags
git switch -c sync/craft-<version>
git merge --no-ff upstream/main
```

Resolve conflicts with these boundaries in mind:

- Keep Craft's `loadAllSkills()` effective-resolution behavior intact.
- Keep Skills Manager mutations behind the server RPC boundary.
- Recheck Skills channel names, `ElectronAPI`, the channel map, and IPC inventory together.
- Recheck global/workspace/project watcher coverage and runtime cache invalidation.
- Preserve the `BoAI` identity, `boai://` scheme, `~/.boai` profile, LICENSE, and NOTICE.
- Run the verification commands in `docs/skills-manager.md` before merging the sync branch.
