/**
 * Desktop shell entry: the single-instance lock, the BrowserWindow over
 * `dsh web`, update supervision wiring, and bounded subprocess teardown on
 * quit. Runs only inside Electron; every testable half lives in sibling
 * modules.
 *
 * @module @deepseek-ai/dsh-desktop/main
 */

import { app, BrowserWindow, Menu, Notification, shell, type MenuItemConstructorOptions } from 'electron'
import { autoUpdater } from 'electron-updater'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { registerUpdateIpc } from './ipc.ts'
import { WebRuntimeSupervisor, type DesktopRuntimePaths } from './runtime.ts'
import {
  DesktopUpdater,
  macAppBundlePath,
  probeMacCodeSignature,
  resolveUpdateMode,
  type UpdateMode,
} from './updater.ts'
import { UPDATE_FEED, UPDATE_STATE_CHANGED_CHANNEL } from '../shared/ipc.ts'
import type { UpdateSnapshot } from '../shared/update-state.ts'

/** Dev mode runs the harness from the repository checkout instead of resources. */
const dev = !app.isPackaged

const here = dirname(fileURLToPath(import.meta.url))
const preloadPath = join(here, '..', 'preload', 'index.cjs')
const repoRoot = join(here, '..', '..', '..', '..')

let mainWindow: BrowserWindow | undefined
let supervisor: WebRuntimeSupervisor | undefined
let quitting = false

function pageDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

function escapeHtml(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** Placeholder page while the harness boots; swapped for the real URL on ready. */
const STARTING_PAGE_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>DeepSeek Harness</title></head>
<body style="margin:0;display:flex;align-items:center;justify-content:center;height:100vh;background:#0f172a;color:#e2e8f0;font:14px system-ui,sans-serif;">
正在启动 DeepSeek Harness…
</body></html>`

/**
 * The failure page shown when the harness never became ready or died.
 * @param message - supervisor failure message, with the stderr tail appended.
 * @returns The page HTML.
 */
function failurePageHtml(message: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>DeepSeek Harness</title></head>
<body style="margin:0;padding:32px;background:#0f172a;color:#e2e8f0;font:14px system-ui,sans-serif;">
<h1 style="font-size:18px;">DeepSeek Harness 启动失败</h1>
<pre style="white-space:pre-wrap;word-break:break-all;background:#1e293b;padding:16px;border-radius:8px;color:#fca5a5;">${escapeHtml(message)}</pre>
<p>请重新启动应用；如果问题持续出现，请查看运行日志或提交 issue。</p>
</body></html>`
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'DeepSeek Harness',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow.on('closed', () => {
    mainWindow = undefined
  })
  void mainWindow.loadURL(pageDataUrl(STARTING_PAGE_HTML))
}

function startRuntime(): void {
  const paths: DesktopRuntimePaths = {
    platform: process.platform,
    resourcesPath: process.resourcesPath,
    repoRoot,
    userData: app.getPath('userData'),
    dev,
  }
  const runtime = new WebRuntimeSupervisor({
    paths,
    env: process.env,
    log: (chunk) => {
      const text = chunk.trimEnd()
      if (text !== '') console.log(`[dsh web] ${text}`)
    },
  })
  supervisor = runtime
  runtime.on('ready', (url: string) => {
    void mainWindow?.loadURL(url)
  })
  runtime.on('failed', (message: string) => {
    void mainWindow?.loadURL(pageDataUrl(failurePageHtml(message)))
  })
  runtime.start()
}

/**
 * Whether the packaged macOS bundle is signed; Squirrel.Mac updates only
 * signed builds, and an unsigned one degrades to notify-only.
 */
async function macSigned(): Promise<boolean> {
  if (!app.isPackaged || process.platform !== 'darwin') return false
  return probeMacCodeSignature(macAppBundlePath(process.execPath))
}

async function startUpdater(): Promise<void> {
  // Dev builds have no app-update.yml from electron-builder; point the feed
  // at GitHub explicitly so manual checks work while developing.
  if (dev) autoUpdater.setFeedURL(UPDATE_FEED)
  const mode: UpdateMode = dev ? 'notify-only' : resolveUpdateMode(process.platform, await macSigned())
  const updater = new DesktopUpdater({
    source: autoUpdater,
    mode,
    onSnapshot: broadcastUpdateSnapshot,
    notify: (title, body) => {
      if (Notification.isSupported()) new Notification({ title, body }).show()
    },
    log: (message) => {
      console.log(`[updater] ${message}`)
    },
  })
  installApplicationMenu(updater)
  registerUpdateIpc({ updater, openExternal: url => shell.openExternal(url) })
  updater.start()
}

function broadcastUpdateSnapshot(snapshot: UpdateSnapshot): void {
  const win = mainWindow
  if (win !== undefined && !win.isDestroyed()) win.webContents.send(UPDATE_STATE_CHANGED_CHANNEL, snapshot)
}

/**
 * Application menu: standard edit/view roles plus the manual update check.
 * @param updater - the updater the "check for updates" item triggers.
 */
function installApplicationMenu(updater: DesktopUpdater): void {
  const isMac = process.platform === 'darwin'
  // A separately typed spread keeps `role` a literal; inline in the template it
  // widens to string, which MenuItemConstructorOptions rejects.
  const appMenu: MenuItemConstructorOptions[] = isMac ? [{ role: 'appMenu' }] : []
  const template: MenuItemConstructorOptions[] = [
    ...appMenu,
    {
      label: '编辑',
      submenu: [
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        { role: 'toggleDevTools', label: '开发者工具' },
        { type: 'separator' },
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { role: 'togglefullscreen', label: '切换全屏' },
      ],
    },
    {
      label: '帮助',
      submenu: [
        { label: '检查更新…', click: () => void updater.checkNow() },
        { type: 'separator' },
        { label: `版本 ${app.getVersion()}`, enabled: false },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindow
    if (win === undefined) return
    if (win.isMinimized()) win.restore()
    win.focus()
  })

  void app.whenReady().then(() => {
    createMainWindow()
    void startUpdater()
    startRuntime()
  })

  app.on('window-all-closed', () => {
    // The harness subprocess exists to serve the window; with no window left
    // there is nothing to keep alive on any platform.
    app.quit()
  })

  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    const runtime = supervisor
    if (runtime === undefined) return
    // Bound the child teardown so a wedged harness cannot block quit; the
    // re-issued quit proceeds once the child exited or was force-killed.
    event.preventDefault()
    void runtime.stop().finally(() => {
      app.quit()
    })
  })
}
