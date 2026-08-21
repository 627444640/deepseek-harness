/**
 * Pure update-notification state shared by the main process and the preload
 * banner. The main process owns the single current snapshot and reduces
 * electron-updater callbacks into it; the renderer renders snapshots and never
 * mutates them. Electron-free so the reducer stays unit-testable.
 *
 * @module @deepseek-ai/dsh-desktop/shared/update-state
 */

/** Where the update flow stands; the banner derives its text and actions from it. */
type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'notify-only'

/** The one update fact the renderer needs at any moment. */
export interface UpdateSnapshot {
  /** Current phase of the update flow. */
  readonly phase: UpdatePhase
  /** Version of the discovered update, when one is known. */
  readonly version: string | undefined
  /** Download progress in `[0, 1]` while downloading. */
  readonly progress: number | undefined
  /** Last check or download failure, so a manual check is never silent. */
  readonly error: string | undefined
}

/** Events electron-updater callbacks and user actions reduce into snapshots. */
export type UpdateEvent =
  | { readonly type: 'check-started' }
  | { readonly type: 'check-available'; readonly version: string; readonly autoInstall: boolean }
  | { readonly type: 'check-up-to-date' }
  | { readonly type: 'check-error'; readonly message: string }
  | { readonly type: 'download-started' }
  | { readonly type: 'download-progress'; readonly progress: number }
  | { readonly type: 'download-done' }
  | { readonly type: 'dismissed' }

/** The snapshot every session starts from. */
export const initialUpdateSnapshot: UpdateSnapshot = {
  phase: 'idle',
  version: undefined,
  progress: undefined,
  error: undefined,
}

/**
 * Clamp a progress fraction into `[0, 1]`, treating non-finite input as zero.
 * @param value - raw fraction from electron-updater's percent field.
 * @returns The clamped fraction.
 */
function clampProgress(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

/**
 * Reduce one update event into the next snapshot.
 * @param snapshot - the snapshot before the event.
 * @param event - the updater callback or user action.
 * @returns The snapshot after the event.
 */
export function reduceUpdate(snapshot: UpdateSnapshot, event: UpdateEvent): UpdateSnapshot {
  switch (event.type) {
    case 'check-started':
      return { phase: 'checking', version: undefined, progress: undefined, error: undefined }
    case 'check-available':
      return {
        // Without an auto-install-capable build the banner offers the release
        // page instead of a restart, which is the notify-only phase.
        phase: event.autoInstall ? 'available' : 'notify-only',
        version: event.version,
        progress: undefined,
        error: undefined,
      }
    case 'check-up-to-date':
    case 'dismissed':
      return initialUpdateSnapshot
    case 'check-error':
      return { phase: 'idle', version: undefined, progress: undefined, error: event.message }
    case 'download-started':
      return { ...snapshot, phase: 'downloading', progress: 0, error: undefined }
    case 'download-progress':
      return { ...snapshot, phase: 'downloading', progress: clampProgress(event.progress) }
    case 'download-done':
      return { ...snapshot, phase: 'ready', progress: undefined }
  }
}
