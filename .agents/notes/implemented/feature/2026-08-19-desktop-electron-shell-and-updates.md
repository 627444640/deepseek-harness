# Agent Note: Desktop Electron shell with GitHub update notifications

Status: implemented

English | [中文](2026-08-19-desktop-electron-shell-and-updates.zh.md)

## Problem

The harness GUI lived only behind `dsh web` in a browser tab: nothing kept it running as an application, and users had no notification when a new GitHub release shipped — they had to watch the repository and reinstall by hand. A desktop client needed a shell technology, a way to ship the harness runtime inside an installer, a version identity, and an update channel whose notifications reach the user without a page reload.

## Decision

**The desktop client is an Electron shell (`apps/desktop`, `@deepseek-ai/dsh-desktop`) whose window loads the URL of a `dsh web --port 0` subprocess, and whose updates come from electron-updater polling the `dsh-v*` GitHub Releases that CI uploads; the web GUI itself stays desktop-unaware and the harness never loads into the Electron process.**

- The Electron main process spawns the harness under an official Node binary bundled as `extraResources/node-runtime`, never under Electron's embedded Node: node-pty and koffi build against the official `NODE_MODULE_VERSION`. `WebRuntimeSupervisor` (`src/main/runtime.ts`) resolves the window URL from the `dsh web: http://…` ready line, reports failure with a stderr tail, and stops the child with a bounded grace period on quit. Desktop data lives under `userData/dsh-home` (`DSH_HOME`), separate from a CLI checkout's `~/.dsh`.
- The installer stages the harness runtime closure from packed release tarballs: `scripts/release/stage-desktop-runtime.ts` installs every tarball from `--from` directories as `file:` dependencies (the same mechanism `release:verify-packed-install` proves), because the vendored framework and the Landlock entry are private rescoped packages the registry cannot resolve. Native modules install under the Node series the app bundles, so CI stages the closure with that exact series.
- `@deepseek-ai/dsh-desktop` is excluded from the npm release family (`families.ts` `excludes`): it keeps `"private": true` and manifest version `0.0.0`, and CI injects the `dsh-v*` tag version through electron-builder's `--config.extraMetadata.version`. The desktop client therefore versions with the harness release it bundles, without a second release sequence.
- Update policy is platform capability, resolved at startup: Windows (NSIS) runs full auto-update; macOS runs notify-only — the banner links to the release page — until the bundle carries a real code-signing identity. The signature probe requires a `TeamIdentifier` other than "not set", because the ad-hoc signature electron-builder applies without a certificate passes `codesign --verify` while Squirrel.Mac still refuses to update it.
- Update events reduce into one pure snapshot (`src/shared/update-state.ts`) shared by main and preload; the preload injects the notification banner into the page, so `apps/web` needs no desktop knowledge. The first check runs ten seconds after startup, repeats every six hours, and the Help menu offers a manual check. Every release carries an rc pre-release segment, so `allowPrerelease` stays on.
- The [desktop workflow](../../../../.github/workflows/desktop-release.yml) builds installers on every pull request without credentials and publishes them to the tag's release on `dsh-v*` pushes: one NSIS installer on Windows, per-architecture DMG plus zip on macOS (the zip is the payload electron-updater's `latest-mac.yml` version check reads, even while macOS installs stay notify-only).

## Alternatives considered

**Tauri as the shell.** Rejected: the runtime is a Node process tree with native addons; a Rust-backed webview shell adds a second toolchain and a Node sidecar anyway, while Electron runs the same TypeScript stack and bundles the Node runtime we already require.

**Loading the harness into Electron's embedded Node.** Rejected: node-pty and koffi would need an Electron-ABI rebuild of every release, and the harness would inherit Electron's module loader constraints. The subprocess boundary keeps the official-Node ABI and lets the shell survive harness crashes.

**Publishing the desktop package to npm and installing the runtime on first run.** Rejected: a first-run download adds a network dependency to first launch and offers no rollback; staging the closure inside the installer makes the app self-contained and the staged tree exactly what release verification exercised.

**macOS auto-update on ad-hoc-signed builds.** Rejected: Squirrel.Mac refuses updates to bundles without a real identity even when `codesign --verify` passes, so an attempted silent update fails at install time; notify-only with a release-page link is the honest capability until signing identities exist.

**Teaching `apps/web` about desktop updates.** Rejected: the web GUI must keep serving browsers unchanged; the preload bridge and banner own all desktop presentation, which keeps the desktop shell droppable without touching the web app.

## Consequences

Users get a desktop application whose update notifications arrive in-app — a banner with restart-to-update on Windows, a release-page link on unsigned macOS builds — at the cost of an Electron dependency, a second build matrix in CI, and a staged runtime tree that makes each installer large. Update behavior lives behind a pure reducer with unit tests (spawn plan, ready-line parsing, state machine, release-URL validation in `apps/desktop/tests`), and every pull request builds real installers without credentials, so packaging regressions surface before a release. Adding a signed macOS identity flips that platform to auto-install by removing one probe; adding Linux means a bundled-Node layout and an update mode decision, not a redesign.
