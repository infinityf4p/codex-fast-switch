# Codex Fast Switch

[简体中文](README.md)

Enable Codex's native **Standard / Fast** controls when using an **API key or relay**, both in settings and in each conversation's model menu. Supports macOS, Windows, and automatic reapplication after compatible app updates.

The patch exposes controls already in the app. It does not provide OAuth access, a subscription, or priority capacity. Fast sends `service_tier: "priority"`; actual speed and pricing depend on the model and provider.

## Preview

Native Speed settings, expanded model and reasoning controls, and the collapsed conversation model picker:

<img src="docs/assets/fast-speed-menu.png" alt="Codex settings with the native Standard / Fast speed menu" width="780">

<img src="docs/assets/fast-model-menu.png" alt="Expanded conversation model menu with 6 Astra, Ultra reasoning effort, a Fast toggle, and an effort slider" width="245">

<img src="docs/assets/fast-model-control.png" alt="Filled Fast lightning icon, full model name, and purple Ultra label" width="180">

## One-Click Installation

Install the official Codex desktop app first. These commands install or update the patch, enable update monitoring, and normally quit and reopen the app when needed.

### macOS

Run in Terminal:

```sh
curl -fsSL https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/install.sh | /bin/sh
```

Keep opening the usual app icon. On the first switch to local signing, choose **Always Allow** if macOS asks for `Codex Storage Key` access. Later patches reuse the same local certificate. [Signing details](docs/local-signing.md)

### Windows

Run in PowerShell:

```powershell
& { $fastInstaller = Join-Path $env:TEMP 'codex-fast-install.cmd'; Invoke-WebRequest 'https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/install.cmd' -OutFile $fastInstaller -UseBasicParsing -ErrorAction Stop; & $fastInstaller }
```

Or download and double-click [install.cmd](https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/install.cmd). No manual extraction or npm dependency installation is required.

Windows creates and opens a local patched copy. The original Start menu icon still opens the official app. To reopen the copy, run `install.cmd` again or use `Open Codex Fast.cmd` from the ZIP package. Quit with **Ctrl+Q** or the tray's Quit command; closing a window may leave the app running in the tray.

## Switching Fast

| Control | Effect |
| --- | --- |
| Settings > General > Speed | Sets the default for new conversations; existing conversations keep their selections |
| Model menu inside a conversation | Changes that conversation's Fast setting for its next message; other conversations are unaffected |
| Switching while a reply is streaming | Leaves the submitted request unchanged; the next message uses the new setting |

Some builds label the conversation toggle **More usage**. Disabling Fast omits `service_tier`, leaving the processing tier to the provider's default policy.

These observations come from a 2026-09-05 Windows test on app **26.901.41600 (7982)**, patch revision 2, and `gpt-6-astra`: nine ordinary replies, including a switch during one held stream. Follow-up model requests within a tool-using turn were not covered. This does not establish provider speed or billing.

## Other Installation Options

Download your platform's ZIP from [Releases](https://github.com/infinityf4p/codex-fast-switch/releases/latest), extract it, and run:

- **macOS:** `Install or Update.command`.
- **Windows:** `install.cmd` in the package root.

Helper scripts are in `launchers/macos` or `launchers/windows`, or the package root in older releases. `Apply and Restart` applies once and reopens the app, `Check Status` reports the installation state, and `Disable Automatic Fast` stops monitoring while keeping the installed patch.

## Development

Requires Git and Node.js **22.12+**. macOS also needs Xcode Command Line Tools (`xcode-select --install`). Windows needs no separately installed compiler.

```sh
git clone https://github.com/infinityf4p/codex-fast-switch.git
cd codex-fast-switch
npm ci --ignore-scripts
npm run build
node cli.cjs setup
```

`node cli.cjs doctor` checks compatibility without patching; `node cli.cjs status` reports the current state. Use `node cli.cjs setup --app "app path"` for a custom installation location.

Check, test, and package for the current platform:

```sh
npm run check
npm test
npm run package
```

## Uninstall

### macOS

Fully quit Codex with **Command-Q**, then run in Terminal:

```sh
curl -fsSL https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/uninstall.sh | /bin/sh
```

The script uses the installed recovery program to stop monitoring and restore the original app. Reopen it using the usual icon. Codex's personal settings and conversations are kept, along with patch recovery records and the local signing identity for recovery or later reinstallation. Keep the backup until restoration succeeds.

ZIP users can also run `Restore Original App.command`; source users can run `node cli.cjs restore`. Use `sh uninstall.sh --state "directory"` for a custom state directory, or `--app "app path"` for a custom app location.

### Windows

Run in PowerShell, or download and double-click [uninstall.cmd](https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/uninstall.cmd):

```powershell
& { $fastUninstaller = Join-Path $env:TEMP 'codex-fast-uninstall.cmd'; Invoke-WebRequest 'https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/uninstall.cmd' -OutFile $fastUninstaller -UseBasicParsing -ErrorAction Stop; & $fastUninstaller }
```

This normally quits the patched copy and removes monitoring and patch installation files, keeping Codex's personal settings and conversations. Source users can also run `node cli.cjs uninstall`.

## Supported App Versions

Actual app testing recorded as of **2026-09-05**:

| Platform | Tested app version | Coverage |
| --- | --- | --- |
| macOS Apple Silicon | **26.901.41600 (7982)** | Patch v0.2.4: Fast/Standard requests, native model control, local signing, and restoration |
| macOS Apple Silicon | **26.901.41123 (7942)** | Patch v0.1.0: Fast/Standard requests, monitoring, and restoration |
| Windows x64 | **26.901.41600 (7982)**, Store package **26.901.5280.0** | Local copy and Fast/Standard requests; separate existing-session switching tests on revision 2 |

Compatibility is detected from the app's code structure, not a version allowlist. New builds with compatible structures can be patched automatically after exit. Unrecognized builds stop with a notification and keep or restore the official app for that version; the patch does not downgrade the app. Unlisted versions, Intel Mac, and Windows ARM64 are unverified. Future compatibility is not guaranteed. Run `node cli.cjs doctor` to check whether your installed build is recognized.

System requirements: macOS 13+ with APFS clone support, or Windows 10 2004+ / 11 with the Owl client. The official app's own requirements still apply. Linux installation is unsupported. macOS uses a local signing certificate; Windows copies are unsigned and may be restricted by system permissions or application-control policies.

These records apply to the patch revisions tested; documentation or layout changes do not imply a fresh app integration run. Installation and uninstall make no model API calls and do not change relay configuration.

More details: [Windows](docs/windows.md), [validation](docs/validation.md), [tested builds](docs/tested-builds.md), and [security](SECURITY.md).

Maintained by infinityf4p. [MIT license](LICENSE). Not affiliated with OpenAI. [Third-party notices](THIRD_PARTY_NOTICES.md).
