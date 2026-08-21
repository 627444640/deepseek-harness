/**
 * The update banner the preload injects into the web GUI: a fixed strip at
 * the top of the page whose text and actions follow the update snapshot.
 * `apps/web` stays desktop-unaware; this module owns all presentation. Only
 * actionable states raise a banner — a completed download, a discovered
 * update on notify-only builds, or a failed check. Background checking and
 * downloading stay silent behind the system notification on completion.
 *
 * @module @deepseek-ai/dsh-desktop/preload/banner
 */

import type { UpdateSnapshot } from '../shared/update-state.ts'

/** Actions the banner forwards to the main process. */
export interface BannerActions {
  /** Quit and run the downloaded installer (auto-install builds only). */
  install(): void
  /** Open the release page of the discovered update. */
  openReleasePage(): void
  /** Hide the banner until the next update event. */
  dismiss(): void
}

const BANNER_ID = 'dsh-desktop-update-banner'

const BANNER_STYLE = [
  'position:fixed',
  'top:0',
  'left:0',
  'right:0',
  'z-index:2147483647',
  'display:flex',
  'align-items:center',
  'justify-content:center',
  'gap:12px',
  'padding:10px 16px',
  'box-sizing:border-box',
  'background:#1e293b',
  'color:#f1f5f9',
  'font:13px/1.5 system-ui,-apple-system,sans-serif',
  'box-shadow:0 2px 10px rgba(0,0,0,.4)',
].join(';')

const SECONDARY_BUTTON_STYLE = [
  'padding:4px 14px',
  'border:1px solid #475569',
  'border-radius:6px',
  'background:transparent',
  'color:#cbd5e1',
  'cursor:pointer',
  'font:inherit',
].join(';')

const PRIMARY_BUTTON_STYLE = [
  'padding:4px 14px',
  'border:1px solid #2563eb',
  'border-radius:6px',
  'background:#2563eb',
  'color:#ffffff',
  'cursor:pointer',
  'font:inherit',
].join(';')

/** One actionable button on the banner. */
interface BannerButton {
  readonly label: string
  readonly run: () => void
  readonly primary: boolean
}

/**
 * The banner text for the current snapshot.
 * @param snapshot - the update snapshot to describe.
 * @returns The human-readable banner text.
 */
function bannerText(snapshot: UpdateSnapshot): string {
  const version = snapshot.version ?? ''
  switch (snapshot.phase) {
    case 'ready':
      return `新版本 v${version} 已就绪，重启后生效。`
    case 'notify-only':
      return `发现新版本 v${version}。`
    case 'idle':
      return `检查更新失败：${snapshot.error ?? ''}`
    case 'available':
    case 'downloading':
    case 'checking':
      return ''
  }
}

/**
 * The buttons for the current snapshot, or `undefined` when no banner is due.
 * @param snapshot - the update snapshot to act on.
 * @param actions - callbacks the buttons forward to.
 * @returns The button list, or `undefined` for silent phases.
 */
function bannerButtons(snapshot: UpdateSnapshot, actions: BannerActions): readonly BannerButton[] | undefined {
  switch (snapshot.phase) {
    case 'ready':
      return [
        { label: '立即重启更新', run: () => { actions.install() }, primary: true },
        { label: '稍后', run: () => { actions.dismiss() }, primary: false },
      ]
    case 'notify-only':
      return [
        { label: '查看更新', run: () => { actions.openReleasePage() }, primary: true },
        { label: '稍后', run: () => { actions.dismiss() }, primary: false },
      ]
    case 'idle':
      // Only a failed check is actionable; a plain idle snapshot stays silent.
      if (snapshot.error === undefined) return undefined
      return [{ label: '稍后', run: () => { actions.dismiss() }, primary: false }]
    case 'available':
    case 'downloading':
    case 'checking':
      return undefined
  }
}

function bannerButton(document: Document, button: BannerButton): HTMLButtonElement {
  const element = document.createElement('button')
  element.type = 'button'
  element.textContent = button.label
  element.style.cssText = button.primary ? PRIMARY_BUTTON_STYLE : SECONDARY_BUTTON_STYLE
  element.addEventListener('click', button.run)
  return element
}

/**
 * Replace any existing banner with one for `snapshot`, or remove it when no
 * notification is due.
 * @param document - the page document the banner attaches to.
 * @param snapshot - the current update snapshot.
 * @param actions - callbacks for the banner's buttons.
 */
export function renderUpdateBanner(document: Document, snapshot: UpdateSnapshot, actions: BannerActions): void {
  document.getElementById(BANNER_ID)?.remove()
  const buttons = bannerButtons(snapshot, actions)
  if (buttons === undefined) return
  const banner = document.createElement('div')
  banner.id = BANNER_ID
  banner.style.cssText = BANNER_STYLE
  const text = document.createElement('span')
  text.textContent = bannerText(snapshot)
  banner.appendChild(text)
  for (const button of buttons) banner.appendChild(bannerButton(document, button))
  document.body.appendChild(banner)
}
