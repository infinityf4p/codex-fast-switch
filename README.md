# Codex Fast Switch

[English](README.en.md)

让使用 **API Key 或中转服务** 的 Codex 桌面端也能使用原生 **Standard / Fast** 开关，包括设置页和会话内的模型菜单。支持 macOS、Windows，以及 App 更新后的兼容补丁自动应用。

补丁开启的是客户端已有的控件，不提供 OAuth 登录、订阅或优先处理额度。Fast 请求发送 `service_tier: "priority"`，实际速度和费用取决于模型与服务商支持。

## 界面预览

原生 Speed 菜单、展开的模型与推理强度菜单，以及收起后的会话模型控件：

<img src="docs/assets/fast-speed-menu.png" alt="Codex 设置页的原生 Standard / Fast 速度菜单" width="780">

<p>
  <img src="docs/assets/fast-model-menu.png" alt="展开的会话模型菜单：6 Astra、Ultra 推理强度、Fast 开关和推理强度滑块" width="245" align="middle">
  &nbsp;&nbsp;
  <img src="docs/assets/fast-model-control.png" alt="实心 Fast 闪电、完整模型名和紫色 Ultra 标识" width="180" align="middle">
</p>

## 一键安装

先安装官方 Codex 桌面端。以下命令用于安装或升级，会自动应用补丁、开启更新监控，并在需要时正常退出和重开 App。

### macOS

在终端执行：

```sh
curl -fsSL https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/install.sh | /bin/sh
```

安装后继续从原来的 App 图标启动。首次切换到本地签名时，若出现 `Codex Storage Key` 钥匙串提示，请选择“始终允许”；后续补丁复用同一张本机证书。[签名说明](docs/local-signing.md)

### Windows

在 PowerShell 执行：

```powershell
& { $fastInstaller = Join-Path $env:TEMP 'codex-fast-install.cmd'; Invoke-WebRequest 'https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/install.cmd' -OutFile $fastInstaller -UseBasicParsing -ErrorAction Stop; & $fastInstaller }
```

也可以直接下载并双击 [install.cmd](https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/install.cmd)，无需手动解压或安装 npm 依赖。

Windows 会创建并打开本地补丁副本，原开始菜单图标仍打开官方原版。之后可再次运行 `install.cmd` 打开副本，或使用 ZIP 包中的 `Open Codex Fast.cmd`。退出时使用 `Ctrl+Q` 或托盘菜单的 Quit，关闭窗口可能只是最小化到托盘。

## 怎么切换 Fast

| 操作位置 | 生效范围 |
| --- | --- |
| Settings > General > Speed | 设置新会话的默认速度，已有会话保持原选择 |
| 当前会话的模型菜单 | 开关该会话的 Fast，下一条消息生效，其他会话不受影响 |
| 回复正在生成时切换 | 已提交的请求保持原档位，下一条消息使用新选择 |

部分版本的会话内开关显示为 **More usage**。关闭 Fast 后，请求省略 `service_tier`，由服务商的默认策略决定处理档位。

上述会话行为依据 2026-09-05 的 Windows App **26.901.41600 (7982)**、补丁 revision 2、`gpt-6-astra` 九次普通回复测试，包括一次生成中切换；尚未覆盖工具调用回合中的后续模型请求，也不代表速度或计费保证。

## 其他安装方式

从 [Releases](https://github.com/infinityf4p/codex-fast-switch/releases/latest) 下载对应平台的 ZIP，解压后运行：

- **macOS：** `Install or Update.command`。
- **Windows：** 根目录的 `install.cmd`。

辅助脚本位于 `launchers/macos` 或 `launchers/windows`；旧版发布包放在根目录。`Apply and Restart` 用于单次应用并重开，`Check Status` 查看状态，`Disable Automatic Fast` 停止自动监控并保留已安装的补丁。

## 源码安装与编译

需要 Git、Node.js **22.12+**。macOS 还需 Xcode Command Line Tools（`xcode-select --install`）；Windows 无需另外安装编译器。

```sh
git clone https://github.com/infinityf4p/codex-fast-switch.git
cd codex-fast-switch
npm ci --ignore-scripts
npm run build
node cli.cjs setup
```

`node cli.cjs doctor` 只检查兼容性，`node cli.cjs status` 查看状态。自定义安装位置可使用 `node cli.cjs setup --app "应用路径"`。

检查、测试和生成当前平台的发布包：

```sh
npm run check
npm test
npm run package
```

## 卸载

### macOS

先用 **Command-Q** 完全退出 Codex，再在终端执行：

```sh
curl -fsSL https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/uninstall.sh | /bin/sh
```

脚本调用已安装的恢复程序，停用自动监控并恢复原 App，随后可从原图标打开。保留 Codex 的个人配置、会话，以及补丁的恢复记录和本地签名证书，便于恢复或以后重装时复用签名。不要在恢复成功前删除备份。

ZIP 安装也可运行 `Restore Original App.command`；源码安装可执行 `node cli.cjs restore`。自定义状态目录使用 `sh uninstall.sh --state "目录"`，自定义 App 使用 `--app "应用路径"`。

### Windows

在 PowerShell 执行，或直接下载并双击 [uninstall.cmd](https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/uninstall.cmd)：

```powershell
& { $fastUninstaller = Join-Path $env:TEMP 'codex-fast-uninstall.cmd'; Invoke-WebRequest 'https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/uninstall.cmd' -OutFile $fastUninstaller -UseBasicParsing -ErrorAction Stop; & $fastUninstaller }
```

正常退出补丁副本，移除监控和补丁安装文件，保留 Codex 的个人配置和会话。源码安装也可执行 `node cli.cjs uninstall`。

## App 版本支持

截至 **2026-09-05** 的实际 App 测试记录：

| 平台 | 已测试的 App 版本 | 验证范围 |
| --- | --- | --- |
| macOS Apple Silicon | **26.901.41600 (7982)** | 补丁 v0.2.4：Fast/Standard 请求、原生模型控件、本地签名和恢复原版 |
| macOS Apple Silicon | **26.901.41123 (7942)** | 补丁 v0.1.0：Fast/Standard 请求、自动监控和恢复原版 |
| Windows x64 | **26.901.41600 (7982)**，Store 包 **26.901.5280.0** | 本地副本、Fast/Standard 请求；revision 2 另有已有会话切换测试 |

补丁按 App 内部代码结构识别兼容性，不是只允许表内版本。结构仍兼容的新版本可在退出 App 后自动应用；无法识别时停止修改并提示，保留或恢复该版本的官方原版，不会为打补丁降级 App。表外版本、Intel Mac 和 Windows ARM64 尚未实测，不保证所有未来版本都可用。可运行 `node cli.cjs doctor` 检查本机版本是否可识别。

系统要求：macOS 13+ 和支持克隆的 APFS；Windows 10 2004+ / 11 及 Owl 客户端。官方 App 自身的系统要求仍然适用，Linux 不支持安装。macOS 使用本地证书重签名，Windows 副本是未签名程序，可能受到系统权限或应用控制策略限制。

以上为对应补丁版本的测试记录，不代表每次文档或目录调整都重新完成了 App 集成测试。安装和卸载不调用模型 API，也不修改中转站配置。

更多说明：[Windows](docs/windows.md) · [验证方式](docs/validation.md) · [测试记录](docs/tested-builds.md) · [安全说明](SECURITY.md)。

本项目由 infinityf4p 维护，采用 [MIT](LICENSE) 协议，与 OpenAI 无隶属关系。[第三方许可](THIRD_PARTY_NOTICES.md)
