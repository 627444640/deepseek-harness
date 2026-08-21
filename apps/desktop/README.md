# `@deepseek-ai/dsh-desktop`

English | [中文](README.zh.md)

The DeepSeek Harness desktop shell: an Electron window over `dsh web`, with GitHub release update notifications. The shell loads the web GUI the harness already serves and adds the update experience the browser cannot: a staged official Node runtime beside the harness closure, a top-of-page update banner, and — on platforms that allow it — installing the next release in place.

## Runtime model

The Electron process never loads harness code. `src/main/runtime.ts` spawns `dsh web --port 0` as a subprocess under the bundled official Node binary (`extraResources/node-runtime`), because the harness's native modules (node-pty, koffi) build against the official `NODE_MODULE_VERSION`, not Electron's ABI. The supervisor resolves the window URL from the `dsh web: http://…` ready line, shows a failure page with the stderr tail when the child dies, and tears the child down with a bounded grace period on quit. Desktop sessions, settings, and profiles live under Electron's `userData/dsh-home` (`DSH_HOME`), separate from a CLI checkout's `~/.dsh`.

In dev mode (`pnpm --filter @deepseek-ai/dsh-desktop run dev`) the shell launches the CLI from the repository checkout instead of staged resources.

## Updates

`electron-updater` polls the `dsh-v*` GitHub Releases the [desktop workflow](../../.github/workflows/desktop-release.yml) uploads to. Update events reduce into one snapshot (`src/shared/update-state.ts`) that the preload banner renders: Windows (NSIS) auto-downloads and installs; macOS stays notify-only until the bundle carries a real code-signing identity, because Squirrel.Mac refuses unsigned updates — the banner then links to the release page instead. The first check runs ten seconds after startup and repeats every six hours; the Help menu offers a manual check.

The desktop package is excluded from the npm release family: its manifest version stays `0.0.0`, and CI injects the `dsh-v*` tag version into the installer through `--config.extraMetadata.version`, so the desktop client versions with the harness release it bundles.

## Layout

| Path | Purpose |
|---|---|
| `src/main/` | Electron main: entry, runtime supervision, updater, update IPC. |
| `src/preload/` | The `window.dshDesktop.updates` bridge and the update banner injected into the web GUI. |
| `src/shared/` | Electron-free update state and IPC contract, shared by main and preload. |
| `tests/` | Vitest unit tests for the pure halves (spawn plan, state reducer, release URL). |
| `scripts/build.mjs` | esbuild bundles for main and preload into `dist-electron/`. |

## Development

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build   # bundle main + preload
pnpm --filter @deepseek-ai/dsh-desktop run dev     # bundle, then launch Electron from the checkout
pnpm --filter @deepseek-ai/dsh-desktop run dist:dir  # unpackaged electron-builder run (needs staged runtime/)
```

The unit tests run from the repository root with `pnpm run test`. Building an installer additionally needs the staged runtime closure (`pnpm run release:stage-desktop-runtime`) and the Node runtime under `node-runtime/`; the CI workflow performs both and is the reference for a full local build.
