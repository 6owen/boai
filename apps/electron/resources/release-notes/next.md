# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

## Bug Fixes

## Breaking Changes

- **BoAI 使用独立数据目录**：新版本默认将配置、Workspace、凭据、日志和内置资源写入 `~/.boai`；可用 `BOAI_HOME` 覆盖路径，并暂时兼容旧的 `CRAFT_CONFIG_DIR`。旧 `~/.craft-agent` 数据不会被自动覆盖、合并或删除。
