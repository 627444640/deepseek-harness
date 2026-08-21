/**
 * The IPC contract between the desktop main process and the preload bridge:
 * channel names, the renderer-facing bridge interface, and the release-page
 * URL builder. Electron-free so both sides compile against one source.
 *
 * @module @deepseek-ai/dsh-desktop/shared/ipc
 */

import type { UpdateSnapshot } from './update-state.ts'

/** Renderer → main: reply with the current update snapshot. */
export const UPDATE_GET_STATE_CHANNEL = 'update:get-state'

/** Renderer → main: run an update check now. */
export const UPDATE_CHECK_CHANNEL = 'update:check'

/** Renderer → main: quit and run the downloaded installer (auto-install builds only). */
export const UPDATE_INSTALL_CHANNEL = 'update:install'

/** Renderer → main: open the GitHub release page in the system browser. */
export const UPDATE_OPEN_RELEASE_CHANNEL = 'update:open-release-page'

/** Renderer → main: hide the update notification until the next event. */
export const UPDATE_DISMISS_CHANNEL = 'update:dismiss'

/** Main → renderer: the update snapshot changed. */
export const UPDATE_STATE_CHANGED_CHANNEL = 'update:state-changed'

/**
 * The GitHub feed desktop installers publish to. Must match electron-builder's
 * publish section; dev builds point electron-updater at it explicitly.
 */
export const UPDATE_FEED = {
  provider: 'github',
  owner: '627444640',
  repo: 'deepseek-harness',
} as const

/** Repository the desktop installers publish to. */
export const RELEASE_REPOSITORY = `${UPDATE_FEED.owner}/${UPDATE_FEED.repo}`

/** Characters a release version may carry; anything else is refused, not interpolated. */
const RELEASE_VERSION_PATTERN = /^[0-9A-Za-z.-]+$/

/**
 * The GitHub release-page URL for one `dsh-v*` release.
 * @param version - release version without the `dsh-v` tag prefix.
 * @returns The release page URL.
 */
export function releasePageUrl(version: string): string {
  if (!RELEASE_VERSION_PATTERN.test(version)) {
    throw new Error(`update: refusing to open a release page for version ${JSON.stringify(version)}`)
  }
  return `https://github.com/${RELEASE_REPOSITORY}/releases/tag/dsh-v${version}`
}

/** Update-facing half of the bridge the preload exposes as `window.dshDesktop`. */
export interface DesktopUpdateBridge {
  /**
   * Read the current update snapshot.
   * @returns The snapshot at the time of the call.
   */
  getState(): Promise<UpdateSnapshot>
  /**
   * Ask the main process to check GitHub for an update now.
   * @returns The snapshot after the check resolves.
   */
  check(): Promise<UpdateSnapshot>
  /**
   * Quit and run the downloaded installer; rejected on notify-only builds.
   */
  install(): Promise<void>
  /**
   * Open the release page of the discovered update in the system browser.
   */
  openReleasePage(): Promise<void>
  /**
   * Hide the update notification until the next update event.
   */
  dismiss(): Promise<void>
  /**
   * Subscribe to snapshot changes.
   * @param listener - called with every new snapshot.
   * @returns An unsubscribe function.
   */
  onChange(listener: (snapshot: UpdateSnapshot) => void): () => void
}
