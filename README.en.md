# Codex Fast Switch

[简体中文](README.md)

Enable the existing **Standard / Fast** control in the Codex desktop app when using API-key authentication. macOS patches the existing app. Windows prepares a local copy. Optional per-user monitoring reapplies compatible patches after app updates, while the app is closed.

This is an independent, unofficial patch. It does not provide OAuth access, priority capacity, or a subscription. Your API provider must support the requested model and `service_tier: "priority"`; speed and pricing depend on that provider.

## Compatibility

- **macOS:** macOS 13 or newer and an APFS volume with clone support. The official app may require a newer OS.
- **Windows:** Windows 10 2004 / Windows 11 and a supported Codex Owl runtime. Microsoft Store installations are discovered automatically. The Windows build uses a writable local copy and leaves WindowsApps and package registration unchanged. See [Windows details](docs/windows.md).
- Apple Silicon has been tested. The macOS helper also builds for Intel; Intel end-to-end behavior is unverified. Windows x64 is tested locally; Windows ARM64 is unverified. Linux runs core tests only.
- Verified apps: **26.901.41123 (7942)** and **26.901.41600 (7982)**, bundle ID `com.openai.codex`. It can be named `Codex.app` or `ChatGPT.app`; a consumer ChatGPT bundle with a different ID is rejected.
- The selected model must have priority metadata in the app's built-in catalog. Arbitrary provider aliases are not automatically supported.
- New builds are accepted when the three gate/model functions, Fast glyph and compact picker layouts remain recognizable. Changed filenames, identifier names, whitespace and quote styles can be tolerated. Arbitrary future updates are not guaranteed.

## Install on Windows

Download and double-click [install.cmd](https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/install.cmd) to install or update. Use [uninstall.cmd](https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/uninstall.cmd) to uninstall. Both standalone scripts include the tools and npm dependencies, with no manual extraction or npm command required.

Alternatively, install or update with one command in **PowerShell**:

```powershell
& { $p = Join-Path $env:TEMP 'install.cmd'; Invoke-WebRequest 'https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/install.cmd' -OutFile $p -UseBasicParsing -ErrorAction Stop; & $p }
```

Uninstall:

```powershell
& { $p = Join-Path $env:TEMP 'uninstall.cmd'; Invoke-WebRequest 'https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/uninstall.cmd' -OutFile $p -UseBasicParsing -ErrorAction Stop; & $p }
```

`install.cmd` checks its embedded package, prepares the local Fast copy, installs or updates automatic monitoring, and opens Codex. A current copy is not restarted when the original app is closed. When a restart is needed, it restores the main window, checks its process and focus, and quits normally with **Ctrl+Q**. Complete any pending app confirmation before retrying.

`uninstall.cmd` quits all local Fast copies normally, disables monitoring, removes its Startup entry, and deletes every Fast Switch copy, worker, copied runtime, configuration file and log. It removes the installation directory and attempts to open the official app. Patch backups are unnecessary because reinstalling creates a fresh copy from the official app. Codex's own settings, credentials and conversations are preserved. Unexpected files or redirected paths in the installation directory are reported and preserved.

The Windows Fast UI now follows macOS v0.2.4: a filled Fast glyph, full model names, purple Ultra effort and a native dropdown chevron. Re-running the updated script upgrades older copies even without an official app update, and refreshes an already enabled monitor. This UI revision has not been tested locally.

You can also download the Windows ZIP from [Releases](https://github.com/infinityf4p/codex-fast-switch/releases), extract it, and double-click **install.cmd** or **uninstall.cmd** in the package root. Additional scripts are in **launchers/windows** (the package root in older releases); use **Open Codex Fast.cmd** there for subsequent launches, then choose **Settings > General > Speed**. A window close can leave Codex running in the tray; use Ctrl+Q or the tray's Quit command to exit manually.

**Apply and Restart.cmd** applies the patch and reopens the app without enabling monitoring. **Enable Automatic Fast.cmd** adds a per-user Startup monitor with a 10-second poll. **Disable Automatic Fast.cmd** stops monitoring. **Restore Original App.cmd** disables monitoring and clears the local launch target after you exit the copy manually.

The local executable becomes **unsigned** because its embedded ASAR integrity resource is updated. The archive's integrity checks remain enabled. The signed Microsoft Store installation is untouched. Windows may block unsigned executables under managed application-control policies.

The ZIP includes dependencies, but no official app or Node runtime. It uses Node.js 22.12+ from the installed app or system. From a source checkout, run `npm ci --ignore-scripts`, then `node cli.cjs setup`; use `node cli.cjs uninstall` to uninstall. See [Windows usage, storage and limitations](docs/windows.md).

`npm run package:windows` produces `dist/install.cmd`, `dist/uninstall.cmd`, the Windows ZIP and checksums. Publish these assets to the latest GitHub Release to enable the online commands. The standalone Release scripts embed dependencies; the same-named scripts in a source checkout use that checkout's dependencies. Local packaging does not publish them automatically.

## Install on macOS

Install or update the latest release with one command:

```sh
curl -fsSL https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/install.sh | /bin/sh
```

The script checks the release ZIP's SHA-256 digest, installs automatic patching, requests a normal quit, applies the patch, and reopens the app. An already current patch is left running. You can inspect [install.sh](install.sh) before running it.

Alternatively, download the macOS ZIP from [Releases](https://github.com/infinityf4p/codex-fast-switch/releases), unzip it, and double-click **Install or Update.command** in **launchers/macos** (the package root in older releases). All additional `.command` scripts are in that folder. The package contains dependencies and universal native helpers. A suitable Node runtime is reused from your app, an earlier installation, or the system; Node and the official app are not redistributed.

There is no fixed stability delay or temporary-app UI test during installation. Use **Settings > General > Speed** after it reopens. Fast uses the app's bundled filled lightning glyph in both collapsed model controls. Older patch revisions are upgraded through their matching original backup. Check Status.command shows the result.

The automatic monitor listens for app exit events and applies compatible patches after future updates. A 10-second fallback poll covers missed events; it does not impose a delay on the restart command. If you manually reopen while a patch is being made, the monitor waits for another exit. Apply and Restart.command coordinates the entire sequence.

For a single installation, quit the app and run **Apply Once.command**. **Restore Original App.command** disables monitoring and restores the verified original for that installation. **Disable Automatic Fast.command** only stops monitoring; it leaves an already applied patch in place.

Downloaded scripts and the helper are not notarized. macOS may require approval under System Settings > Privacy & Security. Do not disable Gatekeeper globally. Running the CLI from a reviewed source checkout is another option.

### From source

Requires Node.js 22.12+ and Xcode Command Line Tools (`xcode-select --install`).

```sh
git clone https://github.com/infinityf4p/codex-fast-switch.git
cd codex-fast-switch
npm ci --ignore-scripts
npm run build
node cli.cjs doctor
node cli.cjs setup
```

Use `node cli.cjs restart` for one-time patching with automatic quit and reopen, or `install` when the app is already closed. To select another app location:

```sh
node cli.cjs setup --app "/path/to/Codex.app"
node cli.cjs status
node cli.cjs restore
```

`--state PATH` selects a different backup directory; use that same flag for status, disable and restore. One automatic service is supported per macOS account. The legacy `--model` option is accepted for compatibility but installation no longer runs a model probe.

The current user must be able to write to the app's parent directory. The app and backup directory must be on the same filesystem for atomic exchange. The installer does not elevate itself or change ownership.

## Patching and recovery

1. Verify the original app's full code signature against the expected bundle ID and OpenAI signing team.
2. Find three unique whole-function AST fingerprints and the Fast icon fingerprints, then verify the transformed structures. Reuse the app's bundled filled glyph for the legacy collapsed control. Existing `fast_mode = false` policy restrictions remain effective.
3. Exercise API-key, ChatGPT and absent authentication across blocked/loading states: 12 cases, each checked against both UI and request gates.
4. Clone the complete app, patch the archive with integrity hashes, and sign the copy locally.
5. Confirm the original is still closed and unchanged, then atomically exchange complete bundles and retain the original backup.

Installation does not contact your relay or send model requests. The optional developer UI test checks Fast and Standard requests against a loopback mock. It is separate from installation and does not prove a TPS improvement. See [validation details](docs/validation.md).

If recognition or patching fails, the current original stays in place. If activation fails, recovery attempts to restore the original from **that same app version**. The restart command reopens the preserved or restored app after a failure. An interrupted transaction is recovered on a later run. If recovery is pending or a backup is missing, it reports the problem. Quit requests are normal macOS requests and never force termination. Failed builds are not retried automatically until their files change or you re-enable monitoring; an explicit restart command can retry immediately.

## Signing and storage

The patched app has an **ad-hoc signature**, replacing the original root signature. Restricted Apple entitlements are omitted and library validation is disabled for the local patch. This can affect Keychain access, push notifications, app groups, permissions, and future updater behavior. Only startup and the Speed workflow have been tested. Restore before reporting issues to OpenAI or installing an update that rejects the modified app.

State, logs, worker code, a copied runtime, and full app backups live in:

```text
~/Library/Application Support/Codex Fast Switch/
~/Library/LaunchAgents/io.github.infinityf4p.codex-fast-switch.plist
```

Backups are retained and can consume several GB over time. Restore and disable first before removing the state directory. Do not delete the active original backup while the app is patched. Earlier private **Codex Fast Patch** packages use a different state directory and must be restored with their original package first.

## Development

Shared patching code and Fast UI rules live in `src/core`; operating-system implementations live in `src/platforms/macos` and `src/platforms/windows`. Auxiliary launchers are in `launchers`, development tools in `scripts`, and tests in `test/unit`, `test/integration` and `test/support`. Generated native helpers go in `build/macos` and release packages in `dist`; both are ignored by Git.

```sh
npm run check
npm run build    # Native helpers on macOS; script checks on Windows
npm test
npm run package  # Release assets for the current platform
```

Run development commands from a source checkout with dependencies installed. Packaging recreates its staging directory and includes the shared runtime, one platform, launchers, dependencies and documentation. Test tools and the other platform are excluded. The runtime file list is shared with installed workers in `src/core/runtime.cjs`. See [validation](docs/validation.md), [Windows validation](docs/windows.md#validation) and [tested builds](docs/tested-builds.md) for optional integration flows and recorded results. CI does not download or launch the official app.

There is no rule download or patch self-update. Support for substantive new app code requires a reviewed project update. See [SECURITY.md](SECURITY.md). A `busy` result means another operation holds the lock; let it finish and retry.

MIT license for this project's code. Third-party dependencies retain their licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). OpenAI and Codex are trademarks of their respective owners; this project is not affiliated with OpenAI.
