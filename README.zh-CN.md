# Codex Fast Switch

[English](README.md)

在使用 API Key 登录 Codex 桌面端时，启用 App 内已有的 **Standard / Fast** 切换。继续打开原来的 App 图标，无需另一个启动器。可选的 macOS LaunchAgent 会在 App 退出后，为兼容的新版本重新应用补丁。

这是独立的非官方补丁。它不提供 OAuth 身份、订阅或优先处理额度。实际速度和费用取决于 API 服务商是否支持相应模型及 `service_tier: "priority"`。

## 支持范围

- 目前仅支持 **macOS**，要求 macOS 13 及以上、支持克隆的 APFS 卷；官方 App 可能要求更高版本系统。
- Apple Silicon 已实测。辅助程序包含 Intel 架构，但尚未在 Intel Mac 上验证完整流程。Windows、Linux 不支持安装补丁；CI 额外在 Linux 上检查可移植的核心逻辑。
- 已验证 App **26.901.41123 / build 7942**，Bundle ID 为 `com.openai.codex`。支持名为 `Codex.app` 或 `ChatGPT.app` 的对应桌面应用，不接受其他 Bundle ID 的消费版 ChatGPT。
- 所选模型须在 App 自带目录中拥有 priority 元数据，不会自动支持服务商自定义的任意模型别名。
- 新版本须通过完整函数结构匹配和实际 UI 验证。文件名、压缩变量名、空白和引号变化可以兼容；不保证适配任意未来版本。

## 使用

从 [Releases](https://github.com/infinityf4p/codex-fast-switch/releases) 下载 macOS ZIP，解压后运行 **Enable Automatic Fast.command**。发布包含依赖和通用架构辅助程序，Node 运行时取自本机已安装的 App 或系统，不包含官方 App 和 Node 分发包。

用 Command-Q 完全退出官方 App。监控每分钟检查一次，等待文件稳定后验证临时副本。**测试副本可能短暂显示引导页面并抢占焦点**，请等待测试完成后再打开原 App。运行 Check Status.command 查看状态；完成后在 **Settings > General > Speed** 中切换。

- **Apply Once.command**：退出 App 后，验证并应用一次。
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
```

`doctor` 仅检查签名及代码是否可识别；`install` 会验证临时副本并安装一次。自定义路径示例：

```sh
node cli.cjs enable --app "/path/to/Codex.app"
node cli.cjs status
node cli.cjs restore
```

`--model ID` 只选择本地验证使用的模型；默认从 App 自带后端返回的、支持 priority 的模型中选择。`--state PATH` 可指定备份目录，之后查看、停用和恢复也要使用同一参数。每个 macOS 用户只支持一个自动服务。

当前用户须有权限写入 App 的父目录。App 和备份目录须处于同一文件系统，以便原子交换；安装器不会自动提权或修改所有者。

## 验证与回退

安装器先校验原版签名、Bundle ID 和签名团队，再唯一匹配三个完整函数，校验变换后的结构，检查 12 组登录、策略和加载状态。已有的 `fast_mode = false` 限制仍然有效。

随后克隆完整 App，修改归档、重算完整性校验并进行本地签名。测试使用临时 HOME、独立配置、文件形式的假凭据及本机 mock API，通过真实 UI 切换 Fast 和 Standard，检查配置、请求参数和完整回复。Fast 必须发出 `priority`，Standard 的新任务请求必须省略该参数。验证通过后再次确认原版未变化且已经退出，才交换完整 App 并保留原版备份。

验证不需要你的中转站、API Key 或服务器权限，也不能证明真实 TPS 提升。它**不是网络沙箱**：App 仍可能发起更新检查或遥测等非模型请求。详见 [验证说明](docs/validation.md)。

识别失败或 UI 测试失败会保留当前原版。交换后失败会尝试恢复**同一版本**的原版，进程中断则在后续检查恢复。如果 App 正在运行或备份缺失，会等待或报告错误；不会强制退出用户 App，也不会覆盖无关的新更新。失败的构建在文件变化或手动重新启用前不会反复尝试。

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
npm run test:e2e
npm run test:launchagent
npm run package
```

核心测试不依赖官方 App。事务测试和 UI 测试仅操作临时副本，需要本机已有受支持的原版；可用 `CODEX_FAST_TEST_APP` 指定。CI 不下载或运行官方 App。

项目不会下载适配规则或自行更新补丁程序。官方代码发生实质变化时，需要发布经过审阅的新规则。返回 `busy` 表示已有操作持锁，请等待完成后再试。源码采用 MIT 协议，依赖保留各自许可。本项目与 OpenAI 无隶属关系。
