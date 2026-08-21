import { describe, expect, it } from 'vitest'
import { initialUpdateSnapshot, reduceUpdate } from '../src/shared/update-state.ts'

describe('reduceUpdate', () => {
  it('starts idle with nothing known', () => {
    expect(initialUpdateSnapshot).toEqual({
      phase: 'idle',
      version: undefined,
      progress: undefined,
      error: undefined,
    })
  })

  it('tracks a check from start to an auto-installable update', () => {
    const checking = reduceUpdate(initialUpdateSnapshot, { type: 'check-started' })
    expect(checking.phase).toBe('checking')
    const available = reduceUpdate(checking, {
      type: 'check-available',
      version: '0.2.0-rc.1',
      autoInstall: true,
    })
    expect(available).toEqual({
      phase: 'available',
      version: '0.2.0-rc.1',
      progress: undefined,
      error: undefined,
    })
  })

  it('downgrades to notify-only when the build cannot auto-install', () => {
    const snapshot = reduceUpdate(initialUpdateSnapshot, {
      type: 'check-available',
      version: '0.2.0',
      autoInstall: false,
    })
    expect(snapshot.phase).toBe('notify-only')
    expect(snapshot.version).toBe('0.2.0')
  })

  it('returns to the initial snapshot when up to date', () => {
    const checking = reduceUpdate(initialUpdateSnapshot, { type: 'check-started' })
    expect(reduceUpdate(checking, { type: 'check-up-to-date' })).toEqual(initialUpdateSnapshot)
  })

  it('keeps the message of a failed check while returning to idle', () => {
    const snapshot = reduceUpdate(initialUpdateSnapshot, { type: 'check-error', message: 'network down' })
    expect(snapshot).toEqual({
      phase: 'idle',
      version: undefined,
      progress: undefined,
      error: 'network down',
    })
  })

  it('clamps download progress into [0, 1]', () => {
    let snapshot = reduceUpdate(initialUpdateSnapshot, {
      type: 'check-available',
      version: '1.0.0',
      autoInstall: true,
    })
    snapshot = reduceUpdate(snapshot, { type: 'download-started' })
    expect(snapshot.phase).toBe('downloading')
    expect(snapshot.progress).toBe(0)
    expect(reduceUpdate(snapshot, { type: 'download-progress', progress: 0.5 }).progress).toBe(0.5)
    expect(reduceUpdate(snapshot, { type: 'download-progress', progress: 1.5 }).progress).toBe(1)
    expect(reduceUpdate(snapshot, { type: 'download-progress', progress: -1 }).progress).toBe(0)
    expect(reduceUpdate(snapshot, { type: 'download-progress', progress: Number.NaN }).progress).toBe(0)
  })

  it('marks a finished download ready and keeps the version', () => {
    let snapshot = reduceUpdate(initialUpdateSnapshot, {
      type: 'check-available',
      version: '1.1.0',
      autoInstall: true,
    })
    snapshot = reduceUpdate(snapshot, { type: 'download-progress', progress: 0.4 })
    snapshot = reduceUpdate(snapshot, { type: 'download-done' })
    expect(snapshot).toEqual({
      phase: 'ready',
      version: '1.1.0',
      progress: undefined,
      error: undefined,
    })
  })

  it('dismisses back to the initial snapshot', () => {
    const snapshot = reduceUpdate(initialUpdateSnapshot, {
      type: 'check-available',
      version: '1.1.0',
      autoInstall: false,
    })
    expect(reduceUpdate(snapshot, { type: 'dismissed' })).toEqual(initialUpdateSnapshot)
  })
})
