/**
 * Preload bridge: exposes `window.dshDesktop.updates` over the update IPC and
 * renders the update banner. Runs sandboxed with context isolation; it touches
 * no harness APIs, so the web GUI stays unchanged.
 *
 * @module @deepseek-ai/dsh-desktop/preload
 */

import { contextBridge, ipcRenderer } from 'electron'
import { renderUpdateBanner, type BannerActions } from './banner.ts'
import {
  UPDATE_CHECK_CHANNEL,
  UPDATE_DISMISS_CHANNEL,
  UPDATE_GET_STATE_CHANNEL,
  UPDATE_INSTALL_CHANNEL,
  UPDATE_OPEN_RELEASE_CHANNEL,
  UPDATE_STATE_CHANGED_CHANNEL,
  type DesktopUpdateBridge,
} from '../shared/ipc.ts'
import type { UpdateSnapshot } from '../shared/update-state.ts'

const bridge: DesktopUpdateBridge = {
  getState: () => ipcRenderer.invoke(UPDATE_GET_STATE_CHANNEL),
  check: () => ipcRenderer.invoke(UPDATE_CHECK_CHANNEL),
  install: () => ipcRenderer.invoke(UPDATE_INSTALL_CHANNEL),
  openReleasePage: () => ipcRenderer.invoke(UPDATE_OPEN_RELEASE_CHANNEL),
  dismiss: () => ipcRenderer.invoke(UPDATE_DISMISS_CHANNEL),
  onChange: (listener) => {
    const handler = (_event: unknown, snapshot: UpdateSnapshot): void => {
      listener(snapshot)
    }
    ipcRenderer.on(UPDATE_STATE_CHANGED_CHANNEL, handler)
    return () => {
      ipcRenderer.removeListener(UPDATE_STATE_CHANGED_CHANNEL, handler)
    }
  },
}

contextBridge.exposeInMainWorld('dshDesktop', { updates: bridge })

const actions: BannerActions = {
  install: () => {
    void bridge.install()
  },
  openReleasePage: () => {
    void bridge.openReleasePage()
  },
  dismiss: () => {
    void bridge.dismiss()
  },
}

function render(snapshot: UpdateSnapshot): void {
  renderUpdateBanner(document, snapshot, actions)
}

/**
 * Snapshots can arrive while the page is still loading; queue the latest and
 * render once the DOM is ready.
 */
function receive(snapshot: UpdateSnapshot): void {
  if (document.readyState === 'loading') {
    pending = snapshot
    return
  }
  render(snapshot)
}

let pending: UpdateSnapshot | undefined

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (pending !== undefined) render(pending)
  })
} else {
  void bridge.getState().then(render)
}

ipcRenderer.on(UPDATE_STATE_CHANGED_CHANNEL, (_event, snapshot: UpdateSnapshot) => {
  receive(snapshot)
})
