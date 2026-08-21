# `@deepseek-ai/dsh-desktop`

[English](README.md) | 中文

DeepSeek Harness 的桌面壳：一个承载 `dsh web` 的 Electron 窗口，附带 GitHub release 更新提示。壳加载 harness 既有 web GUI，并补上浏览器给不了的更新体验：随安装器发布的官方 Node 运行时与 harness 闭包、页面顶部的更新横幅，以及在平台允许时原地安装下一个版本。

## 运行时模型

Electron 进程从不加载 harness 代码。`src/main/runtime.ts` 以子进程方式在随附的官方 Node 二进制（`extraResources/node-runtime`）下运行 `dsh web --port 0`，因为 harness 的原生模块（node-pty、koffi）按官方 `NODE_MODULE_VERSION` 构建，与 Electron 的 ABI 不同。监督器从 `dsh web: http://…` 就绪行解析窗口 URL；子进程死亡时展示带 stderr 尾部的失败页；退出时在限定的宽限期内完成子进程回收。桌面的会话、设置与 profile 存放在 Electron 的 `userData/dsh-home`（`DSH_HOME`）下，与 CLI checkout 的 `~/.dsh` 相互独立。

开发模式（`pnpm --filter @deepseek-ai/dsh-desktop run dev`）下，壳直接从仓库 checkout 启动 CLI，而不是从暂存的资源启动。

## 更新

`electron-updater` 轮询[桌面工作流](../../.github/workflows/desktop-release.yml)上传的 `dsh-v*` GitHub Releases。更新事件归约为单一快照（`src/shared/update-state.ts`），由 preload 横幅渲染：Windows（NSIS）自动下载并安装；macOS 在 bundle 携带真实代码签名身份前保持仅通知——Squirrel.Mac 拒绝未签名更新——此时横幅改为链接到 release 页面。首次检查在启动十秒后运行，每六小时重复一次；帮助菜单提供手动检查。

桌面包被排除在 npm release family 之外：其 manifest 版本保持 `0.0.0`，CI 通过 `--config.extraMetadata.version` 把 `dsh-v*` tag 版本注入安装器，桌面客户端因此与其捆绑的 harness release 同版本。

## 目录结构

| 路径 | 用途 |
|---|---|
| `src/main/` | Electron 主进程：入口、运行时监督、更新器、更新 IPC。 |
| `src/preload/` | `window.dshDesktop.updates` 桥与注入 web GUI 的更新横幅。 |
| `src/shared/` | 不依赖 Electron 的更新状态与 IPC 契约，主进程与 preload 共用。 |
| `tests/` | 纯逻辑部分（spawn 计划、状态归约、release URL）的 vitest 单元测试。 |
| `scripts/build.mjs` | 用 esbuild 把主进程与 preload 打包到 `dist-electron/`。 |

## 开发

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build   # bundle main + preload
pnpm --filter @deepseek-ai/dsh-desktop run dev     # bundle, then launch Electron from the checkout
pnpm --filter @deepseek-ai/dsh-desktop run dist:dir  # unpackaged electron-builder run (needs staged runtime/)
```

单元测试在仓库根目录用 `pnpm run test` 运行。构建安装器还需要暂存的 runtime 闭包（`pnpm run release:stage-desktop-runtime`）与 `node-runtime/` 下的 Node 运行时；CI 工作流完成这两步，是完整本地构建的参考。
