# Agent Note: 桌面 Electron 壳与 GitHub 更新提示

Status: implemented

[English](2026-08-19-desktop-electron-shell-and-updates.md) | 中文

## 问题

harness 的 GUI 此前只存在于浏览器标签页中的 `dsh web` 之后：没有任何机制把它作为应用程序持续运行，用户也不会在新 GitHub release 发布时收到通知——只能自己盯住仓库并手动重装。桌面客户端需要选定壳技术、把 harness 运行时装进安装器的途径、版本身份，以及无需页面重载即可触达用户的更新通知渠道。

## 决策

**桌面客户端是一个 Electron 壳（`apps/desktop`，`@deepseek-ai/dsh-desktop`）：窗口加载 `dsh web --port 0` 子进程的 URL，更新来自 electron-updater 轮询 CI 上传的 `dsh-v*` GitHub Releases；web GUI 本身保持对桌面无感知，harness 绝不加载进 Electron 进程。**

- Electron 主进程在随附为 `extraResources/node-runtime` 的官方 Node 二进制下运行 harness，绝不在 Electron 内嵌 Node 下运行：node-pty 与 koffi 按官方 `NODE_MODULE_VERSION` 构建。`WebRuntimeSupervisor`（`src/main/runtime.ts`）从 `dsh web: http://…` 就绪行解析窗口 URL，失败时带 stderr 尾部上报，退出时在限定宽限期内停止子进程。桌面数据存于 `userData/dsh-home`（`DSH_HOME`），与 CLI checkout 的 `~/.dsh` 分离。
- 安装器从打包好的 release tarball 暂存 harness runtime 闭包：`scripts/release/stage-desktop-runtime.ts` 把 `--from` 目录下的每个 tarball 作为 `file:` 依赖安装（与 `release:verify-packed-install` 所验证的机制相同），因为 vendored 框架与 Landlock 入口是 registry 无法解析的私有重作用域包。可选依赖保持启用：koffi 与 node-pty 的 Windows/macOS 二进制以平台可选包（`@koromix/koffi-*`、`node-addon-require-builtin-*`）分发，省略它们会强制源码构建，而桌面目标无一能完成（koffi 在 MinGW 下无法解析 `-lnode`）；Landlock 的 linux 可选包在仓库外无处解析，npm 会跳过无法解析的可选依赖，因此无害。`--node` 让安装在应用随附的确切 Node 二进制下运行，异架构主机（arm64 runner 上的 macOS x64 轮次）由此安装目标架构的二进制，而 tsx 及其 esbuild 二进制仍留在主机架构上。
- `@deepseek-ai/dsh-desktop` 被排除在 npm release family 之外（`families.ts` 的 `excludes`）：它保持 `"private": true` 与 manifest 版本 `0.0.0`，CI 通过 electron-builder 的 `--config.extraMetadata.version` 注入 `dsh-v*` tag 版本。桌面客户端因此与其捆绑的 harness release 同版本，而无需第二条 release 序列。
- 更新策略按平台能力在启动时判定：Windows（NSIS）运行完整自动更新；macOS 在 bundle 携带真实代码签名身份前保持仅通知——横幅链接到 release 页面。签名探针要求 `TeamIdentifier` 不是 "not set"，因为无证书时 electron-builder 施加的 ad-hoc 签名能通过 `codesign --verify`，而 Squirrel.Mac 仍拒绝对其更新。
- 更新事件归约为单一纯快照（`src/shared/update-state.ts`），主进程与 preload 共用；preload 把通知横幅注入页面，`apps/web` 因此无需任何桌面知识。首次检查在启动十秒后运行，每六小时重复一次，帮助菜单提供手动检查。每个 release 都带 rc 预发布段，因此 `allowPrerelease` 保持开启。
- [桌面工作流](../../../../.github/workflows/desktop-release.yml) 在每个 pull request 上无凭据构建安装器，并在 `dsh-v*` push 时发布到该 tag 的 release：Windows 一个 NSIS 安装器，macOS 按架构各出 DMG 加 zip（zip 是 electron-updater 经 `latest-mac.yml` 做版本检查读取的载荷，即使 macOS 安装保持仅通知）。

## 考虑过的替代方案

**Tauri 作为壳。** 已拒：运行时是带原生插件的 Node 进程树；Rust 支撑的 webview 壳引入第二套工具链，反正还需要 Node 边车，而 Electron 运行同一 TypeScript 技术栈并随附我们本就需要的 Node 运行时。

**把 harness 加载进 Electron 内嵌 Node。** 已拒：node-pty 与 koffi 需要为每个 release 做 Electron-ABI 重构建，harness 还会继承 Electron 的模块加载器限制。子进程边界保住官方 Node ABI，并让壳在 harness 崩溃时存活。

**把桌面包发布到 npm 并在首次运行时安装运行时。** 已拒：首启即引入网络依赖且无法回滚；把闭包暂存进安装器让应用自包含，暂存树也正是 release 验证所检验过的内容。

**在 ad-hoc 签名的 macOS 构建上自动更新。** 已拒：即使 `codesign --verify` 通过，Squirrel.Mac 也拒绝更新无真实身份的 bundle，静默更新只会在安装时失败；在签名身份就位前，仅通知加 release 页链接才是如实的表达能力。

**让 `apps/web` 感知桌面更新。** 已拒：web GUI 必须继续原样服务浏览器；preload 桥与横幅拥有全部桌面呈现，因此移除桌面壳不必改动 web 应用。

## 后果

用户获得一个更新通知直达应用的桌面应用——Windows 上是带"重启即更新"的横幅，未签名 macOS 构建上是 release 页链接——代价是引入 Electron 依赖、CI 中第二条构建矩阵，以及让每个安装器变大的暂存运行时树。更新行为位于带单元测试的纯归约器之后（`apps/desktop/tests` 覆盖 spawn 计划、就绪行解析、状态机、release URL 校验），且每个 pull request 都无凭据构建真实安装器，打包回归因此在 release 之前暴露。补上 macOS 签名身份只需移除一个探针即可让该平台转为自动安装；新增 Linux 支持意味着补一个随附 Node 布局与一次更新模式决策，而非重新设计。
