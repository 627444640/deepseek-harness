// Bundle the Electron main and preload entries with esbuild. Both bundles
// stay CJS (`.cjs`): the main bundle requires the external `electron` module
// at runtime, and CJS keeps the packaged main free of ESM-loader edge cases.
// electron-updater is bundled into the main bundle (only `electron` stays
// external), so the installer ships one self-contained main file and never
// packs a node_modules tree. The preload must be CJS because sandboxed
// preloads have no ESM loader.
import { rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const out = path => fileURLToPath(new URL(path, import.meta.url))

rmSync(out('dist-electron'), { recursive: true, force: true })

await build({
  entryPoints: [out('src/main/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: out('dist-electron/main/index.cjs'),
  external: ['electron'],
  sourcemap: true,
  absWorkingDir: packageRoot,
})

await build({
  entryPoints: [out('src/preload/index.ts')],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: out('dist-electron/preload/index.cjs'),
  external: ['electron'],
  sourcemap: true,
  absWorkingDir: packageRoot,
})
