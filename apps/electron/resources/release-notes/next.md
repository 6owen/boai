# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **Windows installation choices** — The assisted installer now lets users choose the BoAI installation directory.
- **Windows-native app icon** — Windows shortcuts and taskbar entries now use a larger multi-size icon tuned for Windows display scaling.

## Bug Fixes

- **Windows Git discovery** — BoAI now refreshes GUI-launched Windows PATH values and detects Git Bash in custom Git installations.
- **BoAI package identity** — Packaged apps and updater cache paths now use the BoAI name instead of the legacy workspace package name.

## Breaking Changes
