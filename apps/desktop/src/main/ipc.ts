/**
 * Update IPC: the invoke handlers behind `window.dshDesktop.updates`. Snapshot
 * broadcasting lives in the entry (it owns the window), so this module only
 * translates bridge calls into updater actions.
 *
 * @module @deepseek-ai/dsh-desktop/main/ipc
 */

import { ipcMain } from 'electron'
import {
  releasePageUrl,
  UPDATE_CHECK_CHANNEL,
  UPDATE_DISMISS_CHANNEL,
  UPDATE_GET_STATE_CHANNEL,
  UPDATE_INSTALL_CHANNEL,
  UPDATE_OPEN_RELEASE_CHANNEL,
} from '../shared/ipc.ts'
import type { DesktopUpdater } from './updater.ts'

/** Dependencies of {@link registerUpdateIpc}. */
export interface UpdateIpcOptions {
  /** The updater owning the update snapshot. */
  readonly updater: DesktopUpdater
  /** Opens a URL in the system browser; main injects `shell.openExternal`. */
  readonly openExternal: (url: string) => Promise<void>
}

/**
 * Register every update channel on `ipcMain`. Handlers reject with the thrown
 * error, which the preload surfaces to the caller.
 * @param options - updater and browser-opening dependencies.
 */
export function registerUpdateIpc(options: UpdateIpcOptions): void {
  const { updater } = options
  ipcMain.handle(UPDATE_GET_STATE_CHANNEL, () => updater.current)
  ipcMain.handle(UPDATE_CHECK_CHANNEL, () => updater.checkNow())
  ipcMain.handle(UPDATE_INSTALL_CHANNEL, () => {
    updater.install()
  })
  ipcMain.handle(UPDATE_DISMISS_CHANNEL, () => {
    updater.dismiss()
  })
  ipcMain.handle(UPDATE_OPEN_RELEASE_CHANNEL, async () => {
    const version = updater.current.version
    if (version === undefined) throw new Error('update: no release version discovered yet')
    await options.openExternal(releasePageUrl(version))
  })
}
