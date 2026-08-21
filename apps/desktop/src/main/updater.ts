/**
 * Update supervision over electron-updater: wires its callbacks into the
 * shared update-state reducer, schedules background checks, and exposes the
 * actions the IPC layer forwards from the renderer. The electron-updater
 * instance is injected and only its types are imported, so the state machine
 * runs under vitest without an Electron runtime.
 *
 * @module @deepseek-ai/dsh-desktop/main/updater
 */

import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ProgressInfo, UpdateInfo } from 'electron-updater'
import { reduceUpdate, initialUpdateSnapshot, type UpdateEvent, type UpdateSnapshot } from '../shared/update-state.ts'

const execFileAsync = promisify(execFile)

/** Delay before the first background check after startup. */
const FIRST_CHECK_DELAY_MS = 10_000

/** Period between background update checks. */
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** How the banner may act on a discovered update. */
export type UpdateMode = 'auto-install' | 'notify-only'

/**
 * The update capability per platform: NSIS installs unsigned updates, while
 * Squirrel.Mac refuses them without a code signature.
 * @param platform - the Electron main-process platform.
 * @param macSigned - whether the macOS bundle passed `codesign --verify`.
 * @returns The mode the updater and banner run in.
 */
export function resolveUpdateMode(platform: NodeJS.Platform, macSigned: boolean): UpdateMode {
  if (platform === 'win32') return 'auto-install'
  if (platform === 'darwin') return macSigned ? 'auto-install' : 'notify-only'
  return 'notify-only'
}

/**
 * The `.app` bundle containing a packaged macOS executable.
 * @param execPath - `process.execPath`, shaped `…/Foo.app/Contents/MacOS/Foo`.
 * @returns The bundle path.
 */
export function macAppBundlePath(execPath: string): string {
  return resolve(dirname(dirname(dirname(execPath))))
}

/**
 * Whether the macOS app bundle carries a real code-signing identity. Squirrel.Mac
 * refuses to update unsigned builds, and an ad-hoc signature — which
 * electron-builder applies to arm64 bundles without a certificate — passes
 * `codesign --verify` while still being unupdatable, so the probe requires a
 * team identifier, which only a real identity carries.
 * @param appBundlePath - the `.app` bundle path.
 * @returns Whether the bundle is signed with an identity Squirrel.Mac can update.
 */
export async function probeMacCodeSignature(appBundlePath: string): Promise<boolean> {
  try {
    await execFileAsync('codesign', ['--verify', '--deep', '--strict', appBundlePath])
    const { stdout } = await execFileAsync('codesign', ['-d', '--verbose=2', appBundlePath])
    return /TeamIdentifier=(?!not set)/.test(stdout)
  } catch {
    // A non-zero exit means an unsigned or broken bundle, and ENOENT means
    // no codesign binary on this host; both answer "cannot update".
    return false
  }
}

/**
 * The electron-updater surface {@link DesktopUpdater} drives. Declared here so
 * tests inject a fake; the real `autoUpdater` satisfies it structurally through
 * its EventEmitter `on`.
 */
interface UpdateSource {
  allowPrerelease: boolean
  autoDownload: boolean
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown
  on(event: 'update-available' | 'update-downloaded', listener: (info: UpdateInfo) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'download-progress', listener: (progress: ProgressInfo) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(): void
}

/** Options for {@link DesktopUpdater}. */
export interface DesktopUpdaterOptions {
  /** The electron-updater instance callbacks are wired to. */
  readonly source: UpdateSource
  /** Update capability of this build. */
  readonly mode: UpdateMode
  /** Receives every reduced snapshot; main broadcasts it to the renderer. */
  readonly onSnapshot: (snapshot: UpdateSnapshot) => void
  /** Shows a system notification once an update finished downloading. */
  readonly notify: (title: string, body: string) => void
  /** Receives check failures; main wires it to Electron's logger. */
  readonly log: (message: string) => void
  /** First-check delay override for tests. */
  readonly firstCheckDelayMs?: number
  /** Check period override for tests. */
  readonly checkIntervalMs?: number
}

/** Owns the update snapshot: reduces electron-updater events and schedules checks. */
export class DesktopUpdater {
  private snapshot: UpdateSnapshot = initialUpdateSnapshot
  private checkTimer: NodeJS.Timeout | undefined
  private stopped = false

  constructor(private readonly options: DesktopUpdaterOptions) {}

  /** The current update snapshot. */
  get current(): UpdateSnapshot {
    return this.snapshot
  }

  /**
   * Configure the update source, wire its callbacks, and schedule checks.
   */
  start(): void {
    const { mode, source } = this.options
    // Every current release carries an rc pre-release segment; without this
    // semver comparison would never see them as update candidates.
    source.allowPrerelease = true
    source.autoDownload = mode === 'auto-install'
    source.on('checking-for-update', () => {
      this.apply({ type: 'check-started' })
    })
    source.on('update-available', (info: UpdateInfo) => {
      this.apply({ type: 'check-available', version: info.version, autoInstall: mode === 'auto-install' })
      // autoDownload begins the download as soon as the update is seen.
      if (mode === 'auto-install') this.apply({ type: 'download-started' })
    })
    source.on('update-not-available', () => {
      this.apply({ type: 'check-up-to-date' })
    })
    source.on('error', (error: Error) => {
      this.apply({ type: 'check-error', message: error.message })
    })
    source.on('download-progress', (progress: ProgressInfo) => {
      this.apply({ type: 'download-progress', progress: progress.percent / 100 })
    })
    source.on('update-downloaded', (info: UpdateInfo) => {
      this.apply({ type: 'download-done' })
      this.options.notify('DeepSeek Harness', `新版本 v${info.version} 已下载完成，重启后生效。`)
    })
    this.schedule(this.options.firstCheckDelayMs ?? FIRST_CHECK_DELAY_MS)
  }

  /**
   * Run one update check now; the reduced snapshot follows from the callbacks.
   * @returns The snapshot after the check settled.
   */
  async checkNow(): Promise<UpdateSnapshot> {
    try {
      await this.options.source.checkForUpdates()
    } catch (error) {
      // The 'error' callback usually reduced this already; reducing again
      // keeps a rejection without a preceding event from passing silently.
      const message = error instanceof Error ? error.message : String(error)
      this.options.log(`update check failed: ${message}`)
      this.apply({ type: 'check-error', message })
    }
    return this.snapshot
  }

  /**
   * Quit and run the downloaded installer.
   * @throws On notify-only builds, and before an update finished downloading.
   */
  install(): void {
    if (this.options.mode !== 'auto-install') {
      throw new Error('update: this build installs updates only through the release page')
    }
    if (this.snapshot.phase !== 'ready') {
      throw new Error('update: no downloaded update to install')
    }
    this.options.source.quitAndInstall()
  }

  /** Hide the update notification until the next update event. */
  dismiss(): void {
    this.apply({ type: 'dismissed' })
  }

  /** Cancel scheduled checks. */
  stop(): void {
    this.stopped = true
    if (this.checkTimer !== undefined) clearTimeout(this.checkTimer)
  }

  private schedule(delayMs: number): void {
    this.checkTimer = setTimeout(() => {
      void this.checkNow().finally(() => {
        if (!this.stopped) this.schedule(this.options.checkIntervalMs ?? CHECK_INTERVAL_MS)
      })
    }, delayMs)
  }

  private apply(event: UpdateEvent): void {
    this.snapshot = reduceUpdate(this.snapshot, event)
    this.options.onSnapshot(this.snapshot)
  }
}
