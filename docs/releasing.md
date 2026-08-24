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

## Manual update installation

Packaged apps check the public GitHub Release feed on launch, but never download
or install an update automatically. When a new version is available, the user
can click **Download Update**. BoAI downloads and SHA-512 verifies the platform
installer in the system Downloads folder:

- macOS: `BoAI-arm64-vX.Y.Z.dmg`
- Windows: `BoAI-x64-vX.Y.Z.exe`

After the download completes, **Open Installer** opens the DMG/EXE and the user
finishes installation through the operating system. Quitting BoAI does not
apply a pending update.

## macOS signing

Unsigned macOS builds may show Gatekeeper warnings even with manual
installation. Configure these Actions secrets before shipping signed builds:

- `MACOS_CSC_LINK`: base64-encoded `.p12` certificate or a secure certificate URL
- `MACOS_CSC_KEY_PASSWORD`: certificate password
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Without them, CI still produces an unsigned DMG and users install it manually.

## Update source

Packaged apps use the GitHub Release provider embedded by electron-builder for
version checks and installer metadata. A custom build can override it by setting
`BOAI_UPDATE_URL` to an electron-updater-compatible generic feed.
