/**
 * Stage the desktop runtime: install the packed `@deepseek-ai/dsh` closure
 * into a directory electron-builder copies into the installer as
 * `extraResources/runtime`.
 *
 * The staged tree resolves every workspace package from the pack output
 * directories passed as `--from` — the same `file:` tarball installation
 * `release:verify-packed-install` proves on every pull request — because the
 * vendored framework and the Landlock entry are private packages a bare
 * `npm install` cannot resolve from the registry. Native modules (node-pty,
 * koffi) and the platform binaries behind them follow the architecture of the
 * installing process, so the caller stages under the same Node series the
 * desktop app bundles — or passes `--node` to pin the install to the exact
 * Node binary (an architecture other than the host's needs this).
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isEntry, run } from './process.ts'
import { packedDependencies } from './tarball.ts'

/** The executable the desktop shell spawns from the staged tree. */
const RUNTIME_ENTRY_PACKAGE = '@deepseek-ai/dsh'

/** Files whose presence proves the staged tree is complete enough to boot. */
const REQUIRED_FILES = [
  'node_modules/@deepseek-ai/dsh/lib/bin.js',
  'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html',
] as const

/**
 * Environment for the staging install: no host Node hooks and no ambient npm
 * user agent, so the staged tree is what the manifests describe. The harness
 * itself never executes during staging — the desktop app sets its own
 * `DSH_HOME` when it spawns the runtime — so no harness home is redirected.
 * @returns The child environment.
 */
function stagingEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env }
  delete environment.npm_config_user_agent
  delete environment.NPM_CONFIG_USER_AGENT
  delete environment.NODE_OPTIONS
  delete environment.NODE_PATH
  return environment
}

/**
 * Locate npm-cli.js in the standard layouts beside a Node binary: the Windows
 * installer keeps node_modules/npm beside node.exe, while the macOS and Linux
 * archives keep it under ../lib/node_modules.
 * @param node - absolute path of a node executable.
 * @returns The absolute path of its bundled npm-cli.js.
 */
function npmCliBeside(node: string): string {
  const base = dirname(node)
  const candidates = [
    join(base, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(base, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ]
  const cli = candidates.find(candidate => existsSync(candidate))
  if (cli === undefined) throw new Error(`stage-desktop-runtime: no npm-cli.js beside ${node}`)
  return cli
}

/**
 * Resolve how to invoke npm. Windows cannot spawnSync the `npm.cmd` shim, so
 * the npm-cli.js living in the standard npm layout beside the running Node
 * executes under `process.execPath` instead; platforms with a resolvable
 * `npm` on PATH keep the direct name. `node` (from `--node`) pins the whole
 * install to that binary instead, so optional platform packages and native
 * builds target its architecture rather than the host's.
 * @param node - absolute path of the Node the install must run under, if any.
 * @returns The command prefix that invokes npm.
 */
function npmInvocation(node: string | undefined): { command: string; args: readonly string[] } {
  if (node !== undefined) {
    return { command: node, args: [npmCliBeside(node)] }
  }
  if (process.platform === 'win32') {
    return { command: process.execPath, args: [npmCliBeside(process.execPath)] }
  }
  return { command: 'npm', args: [] }
}

/** Install the packed runtime closure into `--out` and verify the entry files. */
function main(): void {
  const { values } = parseArgs({
    options: {
      from: { type: 'string', multiple: true },
      out: { type: 'string' },
      node: { type: 'string' },
    },
    allowPositionals: false,
  })
  if (values.from === undefined || values.from.length === 0 || values.out === undefined) {
    throw new Error(
      'usage: stage-desktop-runtime.ts --from <packed directory> [--from ...] --out <staging directory> [--node <node binary>]',
    )
  }

  const root = process.cwd()
  const packed = packedDependencies(values.from.map(directory => resolve(root, directory)))
  const entry = packed.get(RUNTIME_ENTRY_PACKAGE)
  if (entry === undefined) throw new Error(`${RUNTIME_ENTRY_PACKAGE} is not among the packed tarballs`)

  const destination = resolve(root, values.out)
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  writeFileSync(join(destination, 'package.json'), `${JSON.stringify({
    name: 'dsh-desktop-runtime',
    version: entry.version,
    private: true,
    dependencies: Object.fromEntries([...packed].map(([name, tarball]) => [name, tarball.url])),
  }, null, 2)}\n`)

  console.log(`release stage-desktop-runtime: installing ${String(packed.size)} tarball(s) into ${destination}`)
  // Optional dependencies stay enabled: koffi and node-pty ship their Windows
  // and macOS binaries as platform optionals (@koromix/koffi-*,
  // node-addon-require-builtin-*), and omitting them forces source builds no
  // desktop target can complete. The Landlock linux optionals resolve nowhere
  // off-repo, and npm treats an unresolvable optional as a skip, so they stay
  // harmless where verify-packed-install omits them outright.
  const npm = npmInvocation(values.node)
  run(npm.command, [...npm.args, 'install', '--no-audit', '--no-fund', '--package-lock=false'], {
    cwd: destination,
    env: stagingEnvironment(),
  })

  for (const file of REQUIRED_FILES) {
    if (!existsSync(join(destination, file))) throw new Error(`staged runtime is missing ${file}`)
  }
  console.log(`release stage-desktop-runtime: staged ${RUNTIME_ENTRY_PACKAGE} ${entry.version} with its closure`)
}

if (isEntry(import.meta.url)) main()
