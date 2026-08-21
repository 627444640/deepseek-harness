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
 * koffi) build against the official Node ABI of the installing process, so
 * the caller must stage under the same Node major version the desktop app
 * bundles.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

/** Install the packed runtime closure into `--out` and verify the entry files. */
function main(): void {
  const { values } = parseArgs({
    options: { from: { type: 'string', multiple: true }, out: { type: 'string' } },
    allowPositionals: false,
  })
  if (values.from === undefined || values.from.length === 0 || values.out === undefined) {
    throw new Error(
      'usage: stage-desktop-runtime.ts --from <packed directory> [--from ...] --out <staging directory>',
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
  // Optional dependencies are omitted for the Landlock platform packages' sake,
  // as in verify-packed-install; the entry tarball arrives through --from.
  run('npm', ['install', '--no-audit', '--no-fund', '--package-lock=false', '--omit=optional'], {
    cwd: destination,
    env: stagingEnvironment(),
  })

  for (const file of REQUIRED_FILES) {
    if (!existsSync(join(destination, file))) throw new Error(`staged runtime is missing ${file}`)
  }
  console.log(`release stage-desktop-runtime: staged ${RUNTIME_ENTRY_PACKAGE} ${entry.version} with its closure`)
}

if (isEntry(import.meta.url)) main()
