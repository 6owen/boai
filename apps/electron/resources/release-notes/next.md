# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **Windows 绿色版**：Release 现在同时提供可直接解压运行的 `BoAI-x64.zip`，无需执行安装程序。

## Improvements

## Bug Fixes

- **正式包 API 验证超时**：修复打包后的 Electron 子进程没有以 Node 模式启动，导致所有 API 配置验证等待超时的问题。

## Breaking Changes
