import { type ChildProcess, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  bundledNodeExecutable,
  buildRuntimeSpawn,
  desktopDshHome,
  parseWebUrlLine,
  WebRuntimeSupervisor,
  type DesktopRuntimePaths,
} from '../src/main/runtime.ts'

function makePaths(overrides: Partial<DesktopRuntimePaths> = {}): DesktopRuntimePaths {
  return {
    platform: 'win32',
    resourcesPath: 'C:\\resources',
    repoRoot: 'D:\\repo',
    userData: 'C:\\userData',
    dev: false,
    ...overrides,
  }
}

describe('parseWebUrlLine', () => {
  it('extracts the URL from the ready line', () => {
    expect(parseWebUrlLine('dsh web: http://127.0.0.1:4123')).toBe('http://127.0.0.1:4123')
  })

  it('stops at a trailing LAN hint', () => {
    expect(parseWebUrlLine('dsh web: http://127.0.0.1:4123 (LAN: http://192.168.1.4:4123)')).toBe(
      'http://127.0.0.1:4123',
    )
  })

  it('ignores other output lines', () => {
    expect(parseWebUrlLine('some plugin log row')).toBeUndefined()
    expect(parseWebUrlLine('prefix dsh web: http://127.0.0.1:1')).toBeUndefined()
    expect(parseWebUrlLine('')).toBeUndefined()
  })
})

describe('bundledNodeExecutable', () => {
  it('resolves the per-platform runtime layout', () => {
    expect(bundledNodeExecutable('win32', 'R')).toBe(join('R', 'node-runtime', 'node.exe'))
    expect(bundledNodeExecutable('darwin', 'R')).toBe(join('R', 'node-runtime', 'bin', 'node'))
  })

  it('refuses platforms without a bundled runtime layout', () => {
    expect(() => bundledNodeExecutable('linux', 'R')).toThrow('linux')
  })
})

describe('desktopDshHome', () => {
  it('keeps the desktop home under userData', () => {
    expect(desktopDshHome('C:\\userData')).toBe(join('C:\\userData', 'dsh-home'))
  })
})

describe('buildRuntimeSpawn', () => {
  it('launches the staged runtime under the bundled Node when packaged', () => {
    const plan = buildRuntimeSpawn(makePaths(), { HOME: '/home/u' })
    expect(plan.command).toBe(join('C:\\resources', 'node-runtime', 'node.exe'))
    expect(plan.args).toEqual([
      join('C:\\resources', 'runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      'web',
      '--port',
      '0',
    ])
    expect(plan.cwd).toBe(homedir())
    expect(plan.env.DSH_HOME).toBe(join('C:\\userData', 'dsh-home'))
    expect(plan.env.HOME).toBe('/home/u')
  })

  it('launches the CLI from source in dev mode', () => {
    const plan = buildRuntimeSpawn(makePaths({ dev: true }), {})
    expect(plan.command).toBe('node')
    expect(plan.args).toEqual(['--import', 'tsx/esm', 'apps/cli/src/bin.ts', 'web', '--port', '0'])
    expect(plan.cwd).toBe('D:\\repo')
    expect(plan.env.DSH_HOME).toBe(join('C:\\userData', 'dsh-home'))
  })
})

/** A supervisor whose child is a small node script instead of the harness. */
function scriptedSupervisor(script: string, readyTimeoutMs = 5_000): WebRuntimeSupervisor {
  const spawnScripted = (): ChildProcess =>
    spawn(process.execPath, ['-e', script], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  return new WebRuntimeSupervisor({
    paths: makePaths({ dev: true }),
    env: process.env,
    log: () => {},
    readyTimeoutMs,
    spawnChild: spawnScripted,
  })
}

function waitFor<T>(emitter: WebRuntimeSupervisor, event: string): Promise<T> {
  return new Promise((resolve) => {
    emitter.on(event, (payload: T) => {
      resolve(payload)
    })
  })
}

describe('WebRuntimeSupervisor', () => {
  it('resolves the URL from the ready line and stops cleanly', async () => {
    const supervisor = scriptedSupervisor(
      "console.log('booting rows'); console.log('dsh web: http://127.0.0.1:4567'); setInterval(() => {}, 1000)",
    )
    supervisor.start()
    await expect(waitFor<string>(supervisor, 'ready')).resolves.toBe('http://127.0.0.1:4567')
    await supervisor.stop()
  })

  it('reassembles a ready line split across stdout chunks', async () => {
    const supervisor = scriptedSupervisor(
      "process.stdout.write('dsh web: http://127.0.0.1:77');"
      + " setTimeout(() => { process.stdout.write('88\\n'); setInterval(() => {}, 1000) }, 50)",
    )
    supervisor.start()
    await expect(waitFor<string>(supervisor, 'ready')).resolves.toBe('http://127.0.0.1:7788')
    await supervisor.stop()
  })

  it('reports an early exit with the stderr tail', async () => {
    const supervisor = scriptedSupervisor("console.error('boom: bad config'); process.exit(3)")
    supervisor.start()
    const failure = await waitFor<string>(supervisor, 'failed')
    expect(failure).toContain('exit code 3')
    expect(failure).toContain('boom: bad config')
  })

  it('fails once on readiness timeout even though the child keeps running', async () => {
    const supervisor = scriptedSupervisor('setInterval(() => {}, 1000)', 150)
    const failures: string[] = []
    supervisor.on('failed', (message: string) => failures.push(message))
    supervisor.start()
    const failure = await waitFor<string>(supervisor, 'failed')
    expect(failure).toContain('did not report readiness')
    // The child is still alive at this point; stopping it must not add a second failure.
    await supervisor.stop()
    expect(failures).toHaveLength(1)
  })
})
