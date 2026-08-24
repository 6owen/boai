# Releasing BoAI

BoAI releases are built from version tags and published to the public
[`6owen/boai`](https://github.com/6owen/boai) repository.

## Create a release

Start from a clean, up-to-date `main` branch, then run one of:

```bash
bun run release -- --release 0.0.1
bun run release -- --release patch
bun run release -- --release minor
bun run release -- --release 1.2.3
```

`bumpp` updates the root and workspace package versions, verifies they match,
and creates a `chore: release vX.Y.Z` commit and tag. The release wrapper then
pushes only the current branch and that exact tag, so inherited local tags are
never uploaded. The tag starts the release workflow, which:

1. Creates a draft GitHub Release.
2. Builds macOS arm64 and Windows x64 packages.
3. Uploads the installers and `latest*.yml` update manifests.
4. Publishes the release only after every platform succeeds.

If a build fails, the release stays in draft form so it is never offered by the
automatic updater. A failed or skipped tag build can be restarted from Actions
with **Run workflow** and the existing version tag.

## macOS signing

macOS auto-installation requires a Developer ID signed application. Configure
these Actions secrets before shipping signed builds:

- `MACOS_CSC_LINK`: base64-encoded `.p12` certificate or a secure certificate URL
- `MACOS_CSC_KEY_PASSWORD`: certificate password
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Without them, CI can still produce an unsigned DMG, but macOS users must install
updates manually and may see Gatekeeper warnings.

## Update source

Packaged apps use the GitHub Release provider embedded by electron-builder. A
custom build can override it by setting `BOAI_UPDATE_URL` to an
electron-updater-compatible generic feed.
