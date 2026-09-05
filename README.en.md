# Codex Fast Switch

[简体中文](README.md)

Enable Codex's native **Standard / Fast** controls when using an **API key or relay**, both in settings and in each conversation's model menu. Supports macOS, Windows, and automatic reapplication after compatible app updates.

The patch exposes controls already in the app. It does not provide OAuth access, a subscription, or priority capacity. Fast sends `service_tier: "priority"`; actual speed and pricing depend on the model and provider.

## Preview

The native Speed menu and conversation model control, captured on macOS app 26.901.41600:

<img src="docs/assets/fast-speed-menu.png" alt="Codex settings with the native Standard / Fast speed menu" width="780">

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

## Restore and Compatibility

- **macOS:** Quit the app, then run `Restore Original App.command` or `node cli.cjs restore` from the source checkout to stop monitoring and restore the original. Keep the original backup and local signing files until restoration.
- **Windows:** Download and run [uninstall.cmd](https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/uninstall.cmd), or use `node cli.cjs uninstall`, to remove patched copies and monitoring while preserving Codex's personal settings and conversations.
- macOS requires 13+ and APFS clone support; Windows requires Windows 10 2004+ / 11 and a compatible Owl client. The official app's own requirements still apply. Apple Silicon and Windows x64 have been tested; Intel Mac and Windows ARM64 are unverified. Linux installation is unsupported.
- Compatible app updates are patched after exit. Unrecognized builds are left unmodified and reported; update this project for new support. Future compatibility is not guaranteed.
- macOS uses a local signing certificate; Windows copies are unsigned. System permissions or application-control policies may restrict them. Installation makes no model API calls and does not change relay configuration.

More details: [Windows](docs/windows.md), [validation](docs/validation.md), [tested builds](docs/tested-builds.md), and [security](SECURITY.md).

Maintained by infinityf4p. [MIT license](LICENSE). Not affiliated with OpenAI. [Third-party notices](THIRD_PARTY_NOTICES.md).
