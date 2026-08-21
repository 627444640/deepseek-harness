/**
 * Supervision of the `dsh web` subprocess: spawn-plan construction, the stdout
 * readiness-line contract, and bounded teardown. Electron-free by design; the
 * app entry passes Electron's paths in, and the pure halves stay unit-testable.
 *
 * The subprocess runs under the bundled official Node runtime, never under
 * Electron's embedded Node: the harness loads native modules (node-pty, koffi)
 * built for the official `NODE_MODULE_VERSION`, which differ from Electron's
 * ABI.
 *
 * @module @deepseek-ai/dsh-desktop/main/runtime
 */

import { type ChildProcess, spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Directory name of the desktop-owned `DSH_HOME` under Electron's userData. */
const DSH_HOME_DIR_NAME = 'dsh-home'

/** The ready line `dsh web` prints to stdout once its Loader tree settles. */
const WEB_URL_LINE = /^dsh web: (http:\/\/\S+)/

/** How long the supervisor waits for the ready line before failing. */
const READY_TIMEOUT_MS = 30_000

/** How long a stop request waits on graceful termination before force-killing. */
const STOP_TIMEOUT_MS = 5_000

/** Bytes of stderr retained for the failure page. */
const STDERR_TAIL_BYTES = 4_096

/**
 * Extract the web URL from one stdout line of `dsh web`.
 * @param line - a single stdout line, without its newline.
 * @returns The URL, or `undefined` when the line is not the ready line.
 */
export function parseWebUrlLine(line: string): string | undefined {
  return WEB_URL_LINE.exec(line)?.[1]
}

/** Platform and path inputs the spawn plan derives from. */
export interface DesktopRuntimePaths {
  /** `process.platform` of the Electron main process. */
  readonly platform: NodeJS.Platform
  /** Electron `process.resourcesPath`: where the installer staged runtime and Node. */
  readonly resourcesPath: string
  /** Repository checkout root; dev mode launches the CLI from source. */
  readonly repoRoot: string
  /** Electron `app.getPath('userData')`. */
  readonly userData: string
  /** Dev mode: run the harness from the repository checkout. */
  readonly dev: boolean
}

/** The fully resolved `dsh web` launch. */
export interface RuntimeSpawnPlan {
  /** Executable to spawn: the bundled Node, or `node` from PATH in dev mode. */
  readonly command: string
  /** Arguments: the harness entry plus `web --port 0`. */
  readonly args: readonly string[]
  /** Working directory the harness boots in (its initial workspace). */
  readonly cwd: string
  /** Child environment; adds `DSH_HOME` pointing desktop data at userData. */
  readonly env: NodeJS.ProcessEnv
}

/**
 * Path of the Node executable inside the bundled official runtime.
 * @param platform - host platform of the Electron main process.
 * @param resourcesPath - Electron resources path holding `node-runtime/`.
 * @returns The executable path.
 * @throws On a platform with no bundled runtime layout.
 */
export function bundledNodeExecutable(platform: NodeJS.Platform, resourcesPath: string): string {
  if (platform === 'win32') return join(resourcesPath, 'node-runtime', 'node.exe')
  if (platform === 'darwin') return join(resourcesPath, 'node-runtime', 'bin', 'node')
  throw new Error(`desktop runtime: no bundled Node layout for platform ${platform}`)
}

/**
 * The desktop-owned harness home: keeps desktop sessions, settings, and
 * profiles separate from a CLI checkout's `~/.dsh`.
 * @param userData - Electron `app.getPath('userData')`.
 * @returns The `DSH_HOME` path for the subprocess.
 */
export function desktopDshHome(userData: string): string {
  return join(userData, DSH_HOME_DIR_NAME)
}

/**
 * Resolve the `dsh web` launch for packaged or dev mode.
 * @param paths - platform and path inputs.
 * @param baseEnv - environment inherited by the child.
 * @returns The spawn plan.
 */
export function buildRuntimeSpawn(paths: DesktopRuntimePaths, baseEnv: NodeJS.ProcessEnv): RuntimeSpawnPlan {
  const env: NodeJS.ProcessEnv = { ...baseEnv, DSH_HOME: desktopDshHome(paths.userData) }
  if (paths.dev) {
    return {
      command: 'node',
      args: ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web', '--port', '0'],
      cwd: paths.repoRoot,
      env,
    }
  }
  return {
    command: bundledNodeExecutable(paths.platform, paths.resourcesPath),
    args: [
      join(paths.resourcesPath, 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      'web',
      '--port',
      '0',
    ],
    cwd: homedir(),
    env,
  }
}

/** Options for {@link WebRuntimeSupervisor}. */
export interface WebRuntimeSupervisorOptions {
  /** Platform and path inputs for the spawn plan. */
  readonly paths: DesktopRuntimePaths
  /** Environment inherited by the child process. */
  readonly env: NodeJS.ProcessEnv
  /** Where stderr chunks are forwarded; main wires it to Electron's logger. */
  readonly log: (message: string) => void
  /** Readiness deadline override so tests can probe the timeout path quickly. */
  readonly readyTimeoutMs?: number
  /** Force-kill grace override so tests need not wait the full five seconds. */
  readonly stopTimeoutMs?: number
  /** Spawn override for tests; defaults to {@link defaultSpawnChild}. */
  readonly spawnChild?: (plan: RuntimeSpawnPlan) => ChildProcess
}

/**
 * Launch the resolved plan as a piped child process.
 * @param plan - the spawn plan from {@link buildRuntimeSpawn}.
 * @returns The child process.
 */
function defaultSpawnChild(plan: RuntimeSpawnPlan): ChildProcess {
  return spawn(plan.command, plan.args, {
    cwd: plan.cwd,
    env: plan.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

/**
 * Supervises the `dsh web` child: resolves the window URL from the ready line,
 * reports failure with a stderr tail, and stops the child with a bounded
 * grace period.
 *
 * Events: `ready(url: string)` once the URL line is observed, `failed(message:
 * string)` on launch error, readiness timeout, or unexpected exit.
 */
export class WebRuntimeSupervisor extends EventEmitter {
  private child: ChildProcess | undefined
  private readyTimer: NodeJS.Timeout | undefined
  private stderrTail = ''
  private stopping = false
  private failed = false
  private readonly readyTimeoutMs: number
  private readonly stopTimeoutMs: number

  constructor(private readonly options: WebRuntimeSupervisorOptions) {
    super()
    this.readyTimeoutMs = options.readyTimeoutMs ?? READY_TIMEOUT_MS
    this.stopTimeoutMs = options.stopTimeoutMs ?? STOP_TIMEOUT_MS
  }

  /**
   * Spawn the harness subprocess and begin watching for the ready line.
   */
  start(): void {
    const plan = buildRuntimeSpawn(this.options.paths, this.options.env)
    const child = (this.options.spawnChild ?? defaultSpawnChild)(plan)
    this.child = child
    this.readyTimer = setTimeout(() => {
      this.fail(`dsh web did not report readiness within ${String(this.readyTimeoutMs)}ms`)
    }, this.readyTimeoutMs)

    // stdio is piped above, so a null stream means the spawn contract broke.
    const { stdout, stderr } = child
    if (stdout === null || stderr === null) {
      this.fail('desktop runtime: piped child is missing stdout/stderr')
      return
    }
    stdout.setEncoding('utf8')
    let pending = ''
    stdout.on('data', (chunk: string) => {
      // Only complete lines carry the ready-line contract; a partial tail waits
      // for more output instead of matching half a URL.
      pending += chunk
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) {
        const url = parseWebUrlLine(line)
        if (url !== undefined) this.succeed(url)
      }
    })

    stderr.setEncoding('utf8')
    stderr.on('data', (chunk: string) => {
      this.options.log(chunk)
      this.stderrTail = (this.stderrTail + chunk).slice(-STDERR_TAIL_BYTES)
    })

    child.on('error', (error) => {
      this.fail(`failed to launch dsh web: ${error.message}`)
    })
    child.on('exit', (code, signal) => {
      if (this.stopping) return
      const reason = signal ?? `exit code ${String(code)}`
      this.fail(`dsh web exited unexpectedly (${reason})`)
    })
  }

  /**
   * Terminate the child: signal, wait up to the configured grace period, then
   * force-kill. Resolves once the child exited or the kill signal was sent.
   */
  async stop(): Promise<void> {
    const child = this.child
    this.stopping = true
    this.clearReadyTimer()
    if (child === undefined || child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>((resolve) => {
      let settled = false
      const done = (): void => {
        if (settled) return
        settled = true
        clearTimeout(killTimer)
        resolve()
      }
      const killTimer = setTimeout(() => {
        // SIGKILL cannot be trapped, and a child that failed to spawn never
        // emits exit, so resolve after the signal rather than waiting for it.
        child.kill('SIGKILL')
        done()
      }, this.stopTimeoutMs)
      child.once('exit', done)
      child.kill()
    })
  }

  private succeed(url: string): void {
    if (this.readyTimer === undefined) return
    this.clearReadyTimer()
    this.emit('ready', url)
  }

  private fail(message: string): void {
    // The readiness timeout and the exit it leads to both land here; only the
    // first failure is reported, and a stop the app asked for is not one.
    if (this.failed || this.stopping) return
    this.failed = true
    this.clearReadyTimer()
    const tail = this.stderrTail.trim()
    this.emit('failed', tail === '' ? message : `${message}\n\n${tail}`)
  }

  private clearReadyTimer(): void {
    if (this.readyTimer !== undefined) {
      clearTimeout(this.readyTimer)
      this.readyTimer = undefined
    }
  }
}
