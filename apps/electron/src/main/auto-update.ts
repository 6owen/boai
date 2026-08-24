/**
 * Auto-update module using electron-updater
 *
 * Checks for updates with electron-updater, then lets the user explicitly
 * download a platform installer into their Downloads folder. Installation is
 * always manual: BoAI never calls quitAndInstall and never installs on quit.
 *
 * Platform installers:
 * - macOS: DMG
 * - Windows: NSIS EXE
 */

import { autoUpdater } from 'electron-updater'
import { app, net, shell } from 'electron'
import { createHash } from 'crypto'
import { platform } from 'os'
import * as path from 'path'
import * as fs from 'fs'
import { mainLog, autoUpdateLog } from './logger'
import { getAppVersion } from '@craft-agent/shared/version'
import {
  getDismissedUpdateVersion,
  clearDismissedUpdateVersion,
} from '@craft-agent/shared/config'
import { RPC_CHANNELS, type UpdateInfo } from '../shared/types'
import type { EventSink } from '@craft-agent/server-core/transport'
import type { UpdateFileInfo } from 'builder-util-runtime'

// Platform detection
const PLATFORM = platform()
const IS_MAC = PLATFORM === 'darwin'
const IS_WINDOWS = PLATFORM === 'win32'
const UPDATE_FEED_URL = process.env.BOAI_UPDATE_URL?.trim()
const GITHUB_RELEASE_DOWNLOAD_BASE = 'https://github.com/6owen/boai/releases/download'

if (UPDATE_FEED_URL) {
  autoUpdater.setFeedURL({ provider: 'generic', url: UPDATE_FEED_URL })
}

export function isAutoUpdateConfigured(): boolean {
  // Packaged builds receive app-update.yml from electron-builder. Development
  // builds stay offline unless a custom feed is explicitly supplied.
  return app.isPackaged || Boolean(UPDATE_FEED_URL)
}

// Module state — keeps track of update info for IPC queries
let updateInfo: UpdateInfo = {
  available: false,
  currentVersion: getAppVersion(),
  latestVersion: null,
  downloadState: 'idle',
  downloadProgress: 0,
}

let eventSink: EventSink | null = null
let availableUpdateFiles: UpdateFileInfo[] = []
let manualDownloadPromise: Promise<UpdateInfo> | null = null

/**
 * Set the event sink for broadcasting update events to renderer windows
 */
export function setAutoUpdateEventSink(sink: EventSink): void {
  eventSink = sink
}

/**
 * Get current update info (called by IPC handler)
 */
export function getUpdateInfo(): UpdateInfo {
  return { ...updateInfo }
}

/**
 * Broadcast update info to all renderer windows.
 * Creates a snapshot to avoid race conditions during broadcast.
 */
function broadcastUpdateInfo(): void {
  if (!eventSink) return

  const snapshot = { ...updateInfo }
  eventSink(RPC_CHANNELS.update.AVAILABLE, { to: 'all' }, snapshot)
}

/**
 * Broadcast download progress to all renderer windows.
 */
function broadcastDownloadProgress(progress: number): void {
  if (!eventSink) return

  eventSink(RPC_CHANNELS.update.DOWNLOAD_PROGRESS, { to: 'all' }, progress)
}

// ─── Configure electron-updater ───────────────────────────────────────────────

// Update checks never start a download. The user must click Download Update.
autoUpdater.autoDownload = false

// Downloaded installers are opened manually and are never applied on app quit.
autoUpdater.autoInstallOnAppQuit = false

// Use the logger for electron-updater internal logging
autoUpdater.logger = {
  info: (msg: unknown) => mainLog.info('[electron-updater]', msg),
  warn: (msg: unknown) => mainLog.warn('[electron-updater]', msg),
  error: (msg: unknown) => mainLog.error('[electron-updater]', msg),
  debug: (msg: unknown) => mainLog.info('[electron-updater:debug]', msg),
}

// ─── Event handlers ───────────────────────────────────────────────────────────

autoUpdater.on('checking-for-update', () => {
  mainLog.info('[auto-update] Checking for updates...')
})

autoUpdater.on('update-available', async (info) => {
  autoUpdateLog.info(`Update available: ${updateInfo.currentVersion} → ${info.version}`)
  availableUpdateFiles = info.files
  const existingDownloadPath = updateInfo.latestVersion === info.version
    && updateInfo.downloadPath
    && fs.existsSync(updateInfo.downloadPath)
    ? updateInfo.downloadPath
    : undefined

  updateInfo = {
    ...updateInfo,
    available: true,
    latestVersion: info.version,
    downloadState: existingDownloadPath ? 'ready' : 'idle',
    downloadProgress: existingDownloadPath ? 100 : 0,
    downloadPath: existingDownloadPath,
    error: undefined,
  }
  broadcastUpdateInfo()

  const { rebuildMenu } = await import('./menu')
  rebuildMenu()
})

autoUpdater.on('update-not-available', (info) => {
  mainLog.info(`[auto-update] Already up to date (${info.version})`)

  updateInfo = {
    ...updateInfo,
    available: false,
    latestVersion: info.version,
    downloadState: 'idle',
    downloadProgress: 0,
    downloadPath: undefined,
    error: undefined,
  }
  availableUpdateFiles = []
  broadcastUpdateInfo()
})

autoUpdater.on('error', (error) => {
  autoUpdateLog.error('electron-updater error', error)

  updateInfo = {
    ...updateInfo,
    downloadState: 'error',
    error: error.message,
  }
  broadcastUpdateInfo()
})

// ─── Exported API ─────────────────────────────────────────────────────────────

/**
 * Options for checkForUpdates
 */
interface CheckOptions {
  /** Kept for call-site compatibility. Downloads are always user-triggered. */
  autoDownload?: boolean
}

/**
 * Check for available updates.
 * Returns the current UpdateInfo state after check completes.
 *
 * @param options.autoDownload - If false, only checks without downloading (for manual "Check Now")
 */
export async function checkForUpdates(_options: CheckOptions = {}): Promise<UpdateInfo> {
  if (!isAutoUpdateConfigured()) {
    mainLog.info('[auto-update] Skipping update check in development: BOAI_UPDATE_URL is not configured')
    return getUpdateInfo()
  }

  try {
    // Keep this assignment here as a guard against future call sites changing
    // the global updater configuration.
    autoUpdater.autoDownload = false
    await autoUpdater.checkForUpdates()
  } catch (error) {
    autoUpdateLog.error('Update check failed', error)
    updateInfo = {
      ...updateInfo,
      downloadState: 'error',
      error: error instanceof Error ? error.message : 'Check failed',
    }
    broadcastUpdateInfo()
  }

  return getUpdateInfo()
}

/**
 * Pick the user-facing installer rather than electron-updater's internal ZIP.
 */
function selectInstallerFile(): UpdateFileInfo {
  const extension = IS_MAC ? '.dmg' : IS_WINDOWS ? '.exe' : null
  if (!extension) {
    throw new Error(`Manual update downloads are not supported on ${PLATFORM}`)
  }

  const candidates = availableUpdateFiles.filter(file => {
    const pathname = new URL(file.url, 'https://boai.invalid/').pathname.toLowerCase()
    return pathname.endsWith(extension)
  })
  const exactArchitecture = candidates.find(file => {
    const pathname = new URL(file.url, 'https://boai.invalid/').pathname.toLowerCase()
    return pathname.includes(`-${process.arch}${extension}`)
  })
  if (exactArchitecture) return exactArchitecture

  if (candidates.length === 1) {
    const pathname = new URL(candidates[0].url, 'https://boai.invalid/').pathname
    if (!/(?:arm64|x64|ia32)/i.test(pathname)) return candidates[0]
  }

  throw new Error(`No ${process.arch}${extension} installer is available for this update`)
}

function getAssetName(file: UpdateFileInfo): string {
  const pathname = new URL(file.url, 'https://boai.invalid/').pathname
  return path.basename(decodeURIComponent(pathname))
}

function resolveInstallerUrl(file: UpdateFileInfo, version: string): string {
  if (/^https?:\/\//i.test(file.url)) return file.url
  if (UPDATE_FEED_URL) {
    const feedBase = UPDATE_FEED_URL.endsWith('/') ? UPDATE_FEED_URL : `${UPDATE_FEED_URL}/`
    return new URL(file.url, feedBase).toString()
  }
  return `${GITHUB_RELEASE_DOWNLOAD_BASE}/v${encodeURIComponent(version)}/${encodeURIComponent(getAssetName(file))}`
}

function createDownloadPath(assetName: string, version: string): string {
  const parsed = path.parse(assetName)
  const versionedName = `${parsed.name}-v${version}${parsed.ext}`
  const downloadsDir = app.getPath('downloads')
  let destination = path.join(downloadsDir, versionedName)
  let suffix = 1
  while (fs.existsSync(destination)) {
    destination = path.join(downloadsDir, `${parsed.name}-v${version} (${suffix})${parsed.ext}`)
    suffix += 1
  }
  return destination
}

async function performManualDownload(): Promise<UpdateInfo> {
  const version = updateInfo.latestVersion
  if (!updateInfo.available || !version) throw new Error('No update is available to download')

  if (updateInfo.downloadState === 'ready' && updateInfo.downloadPath && fs.existsSync(updateInfo.downloadPath)) {
    return getUpdateInfo()
  }

  const file = selectInstallerFile()
  const assetName = getAssetName(file)
  const installerUrl = resolveInstallerUrl(file, version)
  const destination = createDownloadPath(assetName, version)
  const partialDestination = `${destination}.download`

  updateInfo = {
    ...updateInfo,
    downloadState: 'downloading',
    downloadProgress: 0,
    downloadPath: undefined,
    error: undefined,
  }
  broadcastUpdateInfo()
  broadcastDownloadProgress(0)

  autoUpdateLog.info(`Downloading update installer: ${installerUrl} → ${destination}`)

  try {
    const response = await net.fetch(installerUrl, { redirect: 'follow' })
    if (!response.ok || !response.body) {
      throw new Error(`Download failed with HTTP ${response.status}`)
    }

    const contentLength = Number(response.headers.get('content-length')) || file.size || 0
    const reader = response.body.getReader()
    const output = await fs.promises.open(partialDestination, 'w')
    const hash = createHash('sha512')
    let received = 0
    let lastProgress = -1

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        let offset = 0
        while (offset < value.byteLength) {
          const { bytesWritten } = await output.write(value, offset, value.byteLength - offset)
          if (bytesWritten === 0) throw new Error('Failed to write the downloaded installer')
          offset += bytesWritten
        }
        hash.update(value)
        received += value.byteLength
        const progress = contentLength > 0 ? Math.min(99, Math.round((received / contentLength) * 100)) : 0
        if (progress !== lastProgress) {
          lastProgress = progress
          updateInfo = { ...updateInfo, downloadProgress: progress }
          broadcastDownloadProgress(progress)
        }
      }
    } finally {
      await output.close()
    }

    const actualSha512 = hash.digest('base64')
    if (actualSha512 !== file.sha512) {
      throw new Error('Downloaded installer failed SHA-512 verification')
    }

    await fs.promises.rename(partialDestination, destination)
    updateInfo = {
      ...updateInfo,
      downloadState: 'ready',
      downloadProgress: 100,
      downloadPath: destination,
      error: undefined,
    }
    broadcastDownloadProgress(100)
    broadcastUpdateInfo()

    const { rebuildMenu } = await import('./menu')
    rebuildMenu()
    return getUpdateInfo()
  } catch (error) {
    await fs.promises.unlink(partialDestination).catch(() => {})
    const message = error instanceof Error ? error.message : 'Download failed'
    autoUpdateLog.error('Manual update download failed', error)
    updateInfo = { ...updateInfo, downloadState: 'error', error: message }
    broadcastUpdateInfo()
    throw error
  }
}

/** Download the installer only after an explicit user action. */
export async function downloadUpdate(): Promise<UpdateInfo> {
  if (manualDownloadPromise) return manualDownloadPromise
  manualDownloadPromise = performManualDownload().finally(() => {
    manualDownloadPromise = null
  })
  return manualDownloadPromise
}

/**
 * Open the downloaded DMG/EXE. The operating system performs installation and
 * BoAI remains running until the user closes it.
 */
export async function installUpdate(): Promise<void> {
  const installerPath = updateInfo.downloadPath
  if (updateInfo.downloadState !== 'ready' || !installerPath || !fs.existsSync(installerPath)) {
    throw new Error('No downloaded update installer is available')
  }

  clearDismissedUpdateVersion()
  const openError = await shell.openPath(installerPath)
  if (openError) throw new Error(openError)
}

/**
 * Result of update check on launch
 */
export interface UpdateOnLaunchResult {
  action: 'none' | 'skipped' | 'available'
  reason?: string
  version?: string | null
}

/**
 * Check for updates on app launch.
 * - Checks immediately (no delay)
 * - Respects dismissed version (skips notification but allows manual check)
 * - Never downloads until the user clicks Download Update
 */
export async function checkForUpdatesOnLaunch(): Promise<UpdateOnLaunchResult> {
  if (!isAutoUpdateConfigured()) {
    return { action: 'skipped', reason: 'not-configured' }
  }

  autoUpdateLog.info('Checking for updates on launch...')

  const info = await checkForUpdates({ autoDownload: false })

  if (!info.available) {
    return { action: 'none' }
  }

  // Check if this version was dismissed by user
  const dismissedVersion = getDismissedUpdateVersion()
  if (dismissedVersion === info.latestVersion) {
    mainLog.info(`[auto-update] Update ${info.latestVersion} was dismissed, skipping notification`)
    return { action: 'skipped', reason: 'dismissed', version: info.latestVersion }
  }

  return { action: 'available', version: info.latestVersion }
}
