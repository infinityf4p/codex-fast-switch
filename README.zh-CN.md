# Codex Fast Switch

[English](README.md)

在使用 API Key 登录 Codex 桌面端时，启用 App 内已有的 **Standard / Fast** 切换。继续打开原来的 App 图标，无需另一个启动器。可选的 macOS LaunchAgent 会在 App 退出后，为兼容的新版本重新应用补丁。

这是独立的非官方补丁。它不提供 OAuth 身份、订阅或优先处理额度。实际速度和费用取决于 API 服务商是否支持相应模型及 `service_tier: "priority"`。

## 支持范围

- 目前仅支持 **macOS**，要求 macOS 13 及以上、支持克隆的 APFS 卷；官方 App 可能要求更高版本系统。
- Apple Silicon 已实测。辅助程序包含 Intel 架构，但尚未在 Intel Mac 上验证完整流程。Windows、Linux 不支持安装补丁；CI 额外在 Linux 上检查可移植的核心逻辑。
- 当前补丁已验证 App **26.901.41600 (7982)**，早期补丁还验证过 **26.901.41123 (7942)**，Bundle ID 为 `com.openai.codex`。支持名为 `Codex.app` 或 `ChatGPT.app` 的对应桌面应用，不接受其他 Bundle ID 的消费版 ChatGPT。
- 所选模型须在 App 自带目录中拥有 priority 元数据，不会自动支持服务商自定义的任意模型别名。
- 新版本须匹配三个完整函数结构及 Fast 图标组件。文件名、压缩变量名、空白和引号变化可以兼容；不保证适配任意未来版本。

## 使用

从 [Releases](https://github.com/infinityf4p/codex-fast-switch/releases) 下载 macOS ZIP，解压后运行 **Enable Automatic Fast.command**。发布包含依赖和通用架构辅助程序，Node 运行时取自本机已安装的 App 或系统，不包含官方 App 和 Node 分发包。

接着运行 **Apply and Restart.command**：正常退出 App、应用补丁、自动重新打开。安装没有固定的文件稳定等待，也不再启动临时 App 做 UI 测试。重开后在 **Settings > General > Speed** 中切换，运行 Check Status.command 可查看结果。

两套收起后的模型控件均使用 App 内置的实心闪电。升级旧补丁时，从新包运行 Enable Automatic Fast.command，再运行 Apply and Restart.command；程序会恢复对应原版备份，再自动应用新修订。

自动服务会监听退出事件，为后续兼容更新应用补丁；每 10 秒的兜底检查用于补充遗漏事件，不会让直接重启命令等待。如果手动重开恰好撞上正在修改，后台会等下次退出。使用 Apply and Restart.command 可由程序完成整个顺序。

- **Apply and Restart.command**：正常退出、应用一次并自动重开。
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
node cli.cjs enable
node cli.cjs restart
```

`doctor` 仅检查签名及代码是否可识别；`restart` 负责退出、安装和重开，`install` 用于 App 已经退出的情况。自定义路径示例：

```sh
node cli.cjs enable --app "/path/to/Codex.app"
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
