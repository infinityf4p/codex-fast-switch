# Codex Fast Switch

[English](README.md)

在使用 API Key 登录 Codex 桌面端时，启用 App 内已有的 **Standard / Fast** 切换。macOS 修改原有 App；Windows 创建本地副本，通过 **Open Codex Fast.cmd** 启动。两者都可选择在 App 退出后，为兼容的新版本自动应用补丁。

这是独立的非官方补丁。它不提供 OAuth 身份、订阅或优先处理额度。实际速度和费用取决于 API 服务商是否支持相应模型及 `service_tier: "priority"`。

## 支持范围

- **macOS** 要求 macOS 13 及以上、支持克隆的 APFS 卷；官方 App 可能要求更高版本系统。
- **Windows** 支持 Windows 10 2004 / Windows 11 上使用 Owl 运行时的兼容客户端，自动识别 Microsoft Store 安装。Windows x64 在本机验证，ARM64 尚未实测。
- Apple Silicon 已实测。macOS 辅助程序包含 Intel 架构，但尚未在 Intel Mac 上验证完整流程。Linux 仅运行核心测试。
- 已验证 App **26.901.41123 (7942)** 和 **26.901.41600 (7982)**，Bundle ID 为 `com.openai.codex`。支持名为 `Codex.app` 或 `ChatGPT.app` 的对应桌面应用，不接受其他 Bundle ID 的消费版 ChatGPT。
- 所选模型须在 App 自带目录中拥有 priority 元数据，不会自动支持服务商自定义的任意模型别名。
- 新版本须匹配三个权限与模型函数、Fast 图标和紧凑模型选择器的完整结构。文件名、压缩变量名、空白和引号变化可以兼容；不保证适配任意未来版本。

## Windows 使用

下载后双击 [install.cmd](https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/install.cmd) 即可安装或升级；卸载时双击 [uninstall.cmd](https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/uninstall.cmd)。两个脚本均自带工具和 npm 依赖，无需解压或运行 npm 命令。

也可以像 macOS 一样用一条命令完成。在 **PowerShell** 中安装或升级：

```powershell
& { $p = Join-Path $env:TEMP 'install.cmd'; Invoke-WebRequest 'https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/install.cmd' -OutFile $p -UseBasicParsing -ErrorAction Stop; & $p }
```

卸载：

```powershell
& { $p = Join-Path $env:TEMP 'uninstall.cmd'; Invoke-WebRequest 'https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/uninstall.cmd' -OutFile $p -UseBasicParsing -ErrorAction Stop; & $p }
```

`install.cmd` 会校验内置发布包、准备本地 Fast 副本、安装或更新自动适配监控并打开 Codex。副本已经是当前版本且原版没有运行时，不会重复重启。需要退出时会唤回主窗口，核对进程与焦点后通过 **Ctrl+Q** 正常退出；若 App 等待确认，请完成确认后重试。

`uninstall.cmd` 会正常退出所有本地补丁副本、停用自动适配、移除开机启动项，并删除 Fast Switch 的全部副本、后台程序、运行时、配置和日志，最后清除安装目录并尝试打开官方原版。无需保留补丁备份，重装时可从官方 App 重新生成。Codex 自身的个人配置、登录信息和会话保持不变。

Windows 的 Fast UI 已同步 macOS v0.2.4：实心闪电、完整模型名、紫色 Ultra 标识和原生下拉箭头。重新运行新版脚本即可升级旧副本，无需等待官方 App 更新；已经开启的自动监控也会同步升级。本次 UI 改动尚未实测，由使用者自行验证。

也可从 [Releases](https://github.com/infinityf4p/codex-fast-switch/releases) 下载 Windows ZIP，解压后双击 **install.cmd**，卸载时双击 **uninstall.cmd**。点击窗口关闭按钮可能只让 Codex 驻留托盘；手动退出时请用 Ctrl+Q 或托盘中的 Quit。

之后用 **Open Codex Fast.cmd** 打开补丁版，在 **Settings > General > Speed** 中选择 Standard / Fast。原来的开始菜单图标仍打开官方原版。

- **Apply Once.cmd**：只准备本地副本，不启动或关闭原版。
- **Apply and Restart.cmd**：只应用补丁并重开，不主动开启自动监控。
- **Enable Automatic Fast.cmd**：在当前用户登录后运行监控，每 10 秒检查一次，App 退出后适配兼容更新。
- **Disable Automatic Fast.cmd**：停止监控，保留当前副本。
- **Restore Original App.cmd**：停用监控并清除补丁版启动目标，随后从开始菜单打开原版。
- **Check Status.cmd**：查看副本路径、版本和最后一次操作结果。

Windows 版本不会修改 `WindowsApps` 权限、商店包或系统文件关联。副本的 `ChatGPT.exe` 更新了内嵌 ASAR 校验资源，因此会变为**未签名的本地程序**；ASAR 校验仍然启用，原版签名不变。企业应用控制策略可能阻止未签名程序运行。

状态和完整副本保存在 `%LOCALAPPDATA%\Codex Fast Switch`。每次兼容更新会生成新副本，可能占用数 GB；`uninstall.cmd` 会清理此安装目录。若目录中混入不属于本项目的文件或重定向路径，卸载会报告问题并保留这些内容。发布包包含 npm 依赖，不包含官方 App 或 Node，运行时取自本机 Node.js 22.12+ 或 App 自带 Node。

源码运行：

```powershell
npm ci --ignore-scripts
node cli.cjs doctor
node cli.cjs setup
node cli.cjs uninstall
npm run package:windows
```

`--app "C:\path\to\app"` 可指定应用目录或 `ChatGPT.exe`。不传 `--app` 时自动跟随商店更新；显式指定的路径会保持固定。`--state PATH` 自定义状态目录后，启动、停用和恢复也要使用相同参数。更完整的实现与验证说明见 [Windows 文档](docs/windows.md)。

打包会生成 `dist/install.cmd`、`dist/uninstall.cmd`、Windows ZIP 和校验文件。在线命令需要将这两个同名脚本上传到 GitHub 最新 Release；本地构建不会自动发布。

## macOS 使用

在终端执行一条命令，即可下载最新版并完成安装或升级：

```sh
curl -fsSL https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/install.sh | /bin/sh
```

脚本会校验发布包的 SHA-256、安装自动补丁服务、正常退出 App、应用补丁并重开。当前补丁已经是最新版时，不会重复重启。可以先查看 [install.sh](install.sh) 的源码。

也可从 [Releases](https://github.com/infinityf4p/codex-fast-switch/releases) 下载 macOS ZIP，解压后只需双击 **Install or Update.command**。发布包含依赖和通用架构辅助程序，复用 App、旧安装或系统中的 Node 运行时，不分发官方 App 和 Node。

安装没有固定的文件稳定等待，也不启动临时 App 做 UI 测试。重开后在 **Settings > General > Speed** 中切换。两套收起后的模型控件均使用 App 内置的实心闪电，旧补丁会通过对应原版备份自动升级。Check Status.command 可查看结果。

自动服务会监听退出事件，为后续兼容更新应用补丁；每 10 秒的兜底检查用于补充遗漏事件，不会让直接重启命令等待。如果手动重开恰好撞上正在修改，后台会等下次退出。使用 Apply and Restart.command 可由程序完成整个顺序。

- **Apply and Restart.command**：正常退出、应用一次并自动重开。
- **Install or Update.command**：一次完成自动服务安装或更新、应用补丁和重开。
- **Apply Once.command**：App 已退出时直接应用一次。
- **Enable Automatic Fast.command**：开启更新后自动适配。
- **Disable Automatic Fast.command**：停止自动适配，保留当前补丁。
- **Restore Original App.command**：停用监控，恢复此次安装的完整原版。

发布包未进行 Apple 公证，macOS 可能要求在“系统设置 > 隐私与安全性”中批准运行。不要全局关闭 Gatekeeper。也可以审阅源码后使用 CLI。

### 源码安装

需要 Node.js 22.12+ 和 Xcode Command Line Tools（`xcode-select --install`）。

```sh
git clone https://github.com/infinityf4p/codex-fast-switch.git
cd codex-fast-switch
npm ci --ignore-scripts
npm run build
node cli.cjs doctor
node cli.cjs setup
```

`doctor` 仅检查签名及代码是否可识别；`restart` 负责退出、安装和重开，`install` 用于 App 已经退出的情况。自定义路径示例：

```sh
node cli.cjs setup --app "/path/to/Codex.app"
node cli.cjs status
node cli.cjs restore
```

`--state PATH` 可指定备份目录，之后查看、停用和恢复也要使用同一参数。每个 macOS 用户只支持一个自动服务。旧版 `--model` 参数保留兼容，但安装过程已不再测试模型。

当前用户须有权限写入 App 的父目录。App 和备份目录须处于同一文件系统，以便原子交换；安装器不会自动提权或修改所有者。

## 修改与回退

安装器先校验原版签名、Bundle ID 和签名团队，再唯一匹配三个完整函数及 Fast 图标，校验变换后的结构，检查 12 组登录、策略和加载状态。旧版收起控件复用 App 内置的实心图标。已有的 `fast_mode = false` 限制仍然有效。

随后克隆完整 App，修改归档、重算完整性校验并进行本地签名。确认原版仍已退出且未被更新器替换后，交换完整 App 并保留原版备份。

安装不会访问中转站或发送模型请求。开发者可以单独运行本机 mock UI 测试，检查 Fast 请求携带 `priority`、Standard 新任务省略该参数；此测试与安装分开，也不能证明真实 TPS 提升。详见 [验证说明](docs/validation.md)。

识别或修改失败会保留当前原版；交换后失败会尝试恢复**同一版本**的原版。直接重启命令会在失败后重新打开保留或恢复的 App；恢复尚未完成时会保留退出状态并报告错误。进程中断可在后续检查恢复。退出采用正常 macOS 请求，不会强制终止；退出被取消时不修改 App。失败构建不会自动反复尝试，文件变化、重新启用或显式运行重启命令可触发重试。

## 签名与备份

补丁使用 **ad-hoc 签名**，替换原版的根签名，去掉受限 Apple 权限并关闭库验证。这可能影响钥匙串、推送、App Groups、系统权限和后续更新。当前仅验证了启动与 Speed 流程。向 OpenAI 报告问题，或遇到更新器拒绝修改版时，请先恢复原版。

状态、日志、独立工作进程、复制的运行时和完整备份位于：

```text
~/Library/Application Support/Codex Fast Switch/
~/Library/LaunchAgents/io.github.infinityf4p.codex-fast-switch.plist
```

备份会持续保留，多次更新可能占用数 GB。删除状态目录前先恢复原版并停用服务；App 仍被修改时不要删除当前原版备份。早期私用版 Codex Fast Patch 需先使用原来的安装包恢复，再迁移到本项目。

## 开发

```sh
npm run check
npm run build
npm test
npm run test:transactions
npm run test:restart
npm run test:e2e
npm run test:launchagent
npm run package
```

核心测试不依赖官方 App。事务测试和 UI 测试仅操作临时副本，需要本机已有受支持的原版；可用 `CODEX_FAST_TEST_APP` 指定。CI 不下载或运行官方 App。

项目不会下载适配规则或自行更新补丁程序。官方代码发生实质变化时，需要发布经过审阅的新规则。返回 `busy` 表示已有操作持锁，请等待完成后再试。源码采用 MIT 协议，依赖保留各自许可。本项目与 OpenAI 无隶属关系。
