/**
 * Update checker with explicit, user-triggered installer downloads.
 * Checking never starts a download, and opening an installer never quits BoAI.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { UpdateInfo } from '../../shared/types'

interface UseUpdateCheckerResult {
  updateInfo: UpdateInfo | null
  updateAvailable: boolean
  canDownload: boolean
  isDownloading: boolean
  isReadyToOpen: boolean
  downloadProgress: number
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  openDownloadedUpdate: () => Promise<void>
}

const UPDATE_TOAST_ID = 'update-available'

export function useUpdateChecker(): UseUpdateCheckerResult {
  const { t } = useTranslation()
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const shownToastStateRef = useRef<string | null>(null)

  const openDownloadedUpdate = useCallback(async () => {
    try {
      toast.dismiss(UPDATE_TOAST_ID)
      await window.electronAPI.installUpdate()
    } catch (error) {
      console.error('[useUpdateChecker] Failed to open installer:', error)
      toast.error(t('toast.failedToOpenUpdateInstaller'), {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [t])

  const showUpdateToast = useCallback((info: UpdateInfo, onDownload: () => void, onOpen: () => void) => {
    if (!info.latestVersion || !info.available) return
    if (info.downloadState !== 'idle' && info.downloadState !== 'ready' && info.downloadState !== 'error') return

    const toastState = `${info.latestVersion}:${info.downloadState}`
    if (shownToastStateRef.current === toastState) return
    shownToastStateRef.current = toastState

    if (info.downloadState === 'ready') {
      toast.success(t('toast.updateDownloaded', { version: info.latestVersion }), {
        id: UPDATE_TOAST_ID,
        description: t('toast.updateDownloadedDescription'),
        duration: 15000,
        action: {
          label: t('toast.openInstaller'),
          onClick: onOpen,
        },
      })
      return
    }

    toast.info(t('toast.updateAvailable', { version: info.latestVersion }), {
      id: UPDATE_TOAST_ID,
      description: info.error || t('toast.updateAvailableDescription'),
      duration: 15000,
      action: {
        label: t('toast.downloadUpdate'),
        onClick: onDownload,
      },
      onDismiss: () => {
        window.electronAPI.dismissUpdate(info.latestVersion!)
      },
    })
  }, [t])

  const downloadUpdate = useCallback(async () => {
    try {
      toast.dismiss(UPDATE_TOAST_ID)
      toast.info(t('toast.downloadingUpdate'), { duration: 3000 })
      const info = await window.electronAPI.downloadUpdate()
      setUpdateInfo(info)
      shownToastStateRef.current = null
      showUpdateToast(info, downloadUpdate, openDownloadedUpdate)
    } catch (error) {
      console.error('[useUpdateChecker] Download failed:', error)
      toast.error(t('toast.failedToDownloadUpdate'), {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [openDownloadedUpdate, showUpdateToast, t])

  useEffect(() => {
    const checkAndNotify = async (info: UpdateInfo) => {
      if (!info.available || !info.latestVersion) return

      const dismissedVersion = await window.electronAPI.getDismissedUpdateVersion()
      if (dismissedVersion === info.latestVersion && info.downloadState !== 'ready') return

      showUpdateToast(info, downloadUpdate, openDownloadedUpdate)
    }

    window.electronAPI.getUpdateInfo().then((info) => {
      setUpdateInfo(info)
      checkAndNotify(info)
    })

    const cleanupAvailable = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateInfo(info)
      checkAndNotify(info)
    })

    const cleanupProgress = window.electronAPI.onUpdateDownloadProgress((progress) => {
      setUpdateInfo((prev) => prev ? { ...prev, downloadProgress: progress } : prev)
    })

    return () => {
      cleanupAvailable()
      cleanupProgress()
    }
  }, [downloadUpdate, openDownloadedUpdate, showUpdateToast])

  const checkForUpdates = useCallback(async () => {
    try {
      const info = await window.electronAPI.checkForUpdates()
      setUpdateInfo(info)

      if (!info.available) {
        toast.success(t('toast.upToDate'), {
          description: t('toast.versionIsLatest', { version: info.currentVersion }),
          duration: 3000,
        })
      } else {
        shownToastStateRef.current = null
        showUpdateToast(info, downloadUpdate, openDownloadedUpdate)
      }
    } catch (error) {
      console.error('[useUpdateChecker] Check failed:', error)
      toast.error(t('toast.failedToCheckUpdates'), {
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [downloadUpdate, openDownloadedUpdate, showUpdateToast, t])

  return {
    updateInfo,
    updateAvailable: updateInfo?.available ?? false,
    canDownload: Boolean(updateInfo?.available && (updateInfo.downloadState === 'idle' || updateInfo.downloadState === 'error')),
    isDownloading: updateInfo?.downloadState === 'downloading',
    isReadyToOpen: updateInfo?.downloadState === 'ready',
    downloadProgress: updateInfo?.downloadProgress ?? 0,
    checkForUpdates,
    downloadUpdate,
    openDownloadedUpdate,
  }
}
