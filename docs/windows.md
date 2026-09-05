# Windows

The Windows implementation prepares a separate local Codex copy. It does not take ownership of WindowsApps, modify the Store package, register a replacement MSIX, or replace the original Start menu entry. Use `Open Codex Fast.cmd` for the patched copy. Official updates, protocol handlers and file associations continue to belong to the original installation.

## Fast UI

The Fast UI uses the same transformations as macOS v0.2.4 (`87060bb`), including the compact control introduced in v0.2.3 (`6d7b55f`). The collapsed model picker keeps full model names, uses the bundled filled Fast glyph, shows Ultra effort in purple, and includes the native dropdown chevron. Both recognized picker layouts retain their model, effort and service-tier selections.

Windows patch revision 2 includes this UI. Run **install.cmd** or **Apply and Restart.cmd** to replace a revision-1 copy even when the official app version has not changed. An already enabled monitor is updated to the new patch code too. This UI revision has not been tested locally; the earlier test results predate it.

## Requirements

- Windows 10 build 19041 or later, or Windows 11, subject to the official app's requirements.
- A production Codex app using the Owl runtime, with no external MSIX runtime dependencies. Traditional Electron-only layouts are rejected until independently tested.
- Node.js 22.12 or later, from the system or the app's `resources/cua_node/bin/node.exe`.
- Space for a complete app copy on each compatible update. No administrator rights or separately installed compiler are required; Windows PowerShell builds the small window helper using the included .NET Framework.
- x64 is verified locally. ARM64 layouts are accepted by the same checks but execution on ARM64 has not been verified.

## Commands

The standalone **install.cmd** and **uninstall.cmd** each embed the complete Windows tools and dependencies. Each script verifies its embedded ZIP with SHA-256, checks archive paths, extracts to a unique temporary directory, runs the launcher, and removes the temporary tools afterward. Neither needs manual extraction or a separately downloaded Node runtime. `--help` displays CLI help without changing the installation.

**install.cmd** runs `setup`: prepare or upgrade the local copy, install or update automatic monitoring, and open Codex. A current copy is not restarted when the original app is closed. **uninstall.cmd** runs `uninstall`: request normal Quit for local copies, disable the monitor, remove the Startup entry, delete all owned installation files, and return to the official app. The launcher uses a temporary Node copy during uninstall so an installed worker runtime does not prevent its own removal.

The README includes PowerShell commands that download and run the scripts from the latest GitHub Release. Those links require publishing `dist/install.cmd` and `dist/uninstall.cmd` as Release attachments under those exact names.

| File | Effect |
| --- | --- |
| install.cmd | Install or update the copy and automatic monitoring, then open Codex |
| uninstall.cmd | Quit local copies, remove all Fast Switch installation files, and open the original app |
| Check Compatibility.cmd | Check publisher signatures, embedded archive hash, gate fingerprints, Fast glyph and compact picker layouts |
| Apply Once.cmd | Prepare a local copy; the original may remain open |
| Apply and Restart.cmd | Restore the main window, request Quit with Ctrl+Q, wait for exit, prepare and open the copy |
| Open Codex Fast.cmd | Verify and open the current patched copy |
| Enable Automatic Fast.cmd | Register and start a per-user Startup monitor |
| Disable Automatic Fast.cmd | Disable the monitor; preserve the active copy |
| Restore Original App.cmd | Disable the monitor and clear the local launch target |
| Check Status.cmd | Report source, active generation and last operation |

The original and local copy normally share Codex's existing user profile. Exit the original before opening the copy. Restart identifies the running application by executable path and uses its Ctrl+Q Quit command. If only the tray remains, it reactivates the same executable and preserves an explicit `--user-data-dir`, parsed with the Windows command-line API. It ignores tool windows and verifies the target PID and foreground window before sending the shortcut. If focus is blocked or quitting needs confirmation, use Ctrl+Q or Quit in the tray menu and retry. Closing a window can leave the app running. App settings, credentials and conversation files are never edited by the installer.

The equivalent CLI commands work through `node cli.cjs`. `--app` accepts a directory, Store package root, or executable path. An explicit path is pinned; omit `--app` to rediscover the registered Store package after updates. `--state` selects an independent state directory and must be reused for every subsequent command. Do not place it inside the source app or place the source inside the state directory.

## Integrity and Recovery

1. Verify the original `ChatGPT.exe`, `chrome.dll` and backend `codex.exe` Authenticode signatures against OpenAI, then verify the executable's embedded ASAR header hash.
2. Match and transform the same three gate/model functions, filled Fast glyph and compact picker layouts used on macOS. Check all 12 authentication, policy and loading combinations and the transformed UI fingerprints.
3. Copy the complete app using ordinary file reads, which also handle MSIX-backed source files. Reject symlinks and junctions within the source tree.
4. Patch archive entries and hashes. Parse the executable's `INTEGRITY` / `ELECTRONASAR` resource with `resedit`, update only the archive hash, and verify every unrelated resource and non-resource PE section is preserved. Regenerating the executable removes its invalid signature; ASAR validation stays enabled. This follows the [Electron integrity resource format](https://www.electronjs.org/docs/latest/tutorial/asar-integrity).
5. Recheck the original and candidate, then publish the complete generation by renaming a flushed JSON record. A failed or interrupted preparation cannot replace the previous target. Launch verifies the recorded hashes before opening the copy.

The local executable is unsigned. No certificate is installed and no system verification policy is changed. Windows application-control policies may block it. Store-only features such as updater integration, file associations, notifications, OAuth callbacks and sandbox setup can differ outside the package; they are not all validated by the Fast workflow test.

Restore does not copy an older version over a newer official update. **Restore Original App.cmd** clears the local launch target while retaining local generations. **uninstall.cmd** validates generation records, waits for the monitor to exit, and removes `versions`, `agent`, configuration, logs and the empty state directory. Cleanup stays inside the recorded installation directory and rejects unexpected items or redirected paths. It does not depend on the active launch pointer being intact. The original app and its personal profile remain unchanged.

## Monitoring and Storage

State is in `%LOCALAPPDATA%\Codex Fast Switch` by default:

```text
windows.json          configuration
windows-active.json   active local generation
windows-status.json   last check / operation
windows-monitor.log   unexpected worker errors
versions/<id>/app/    complete local copies
agent/                stable worker code and copied Node runtime
```

The Startup shortcut has a name derived from the state path. It starts the worker hidden at login. The worker polls every 10 seconds and waits until the source and current copy are both closed. An unsupported build is rejected once until its files change, the patch revision changes, or monitoring is enabled again. A live installer lock excludes another installer; a separate worker lock prevents duplicate monitors. Disable takes effect by the next poll.

Failed operations record their phase, error code and message in `windows-status.json`. Native Windows errors are returned as structured data so the CLI can show the actual cause.

Backups and state must remain trusted and local. Local generations consume disk space until **uninstall.cmd** removes the installation. Backups are not needed afterward because a reinstall copies the official app again. The package itself contains only this project's code and npm dependencies; official application binaries are copied from the user's installation at runtime.

## Development

```powershell
npm ci --ignore-scripts
npm run check
npm test
npm run build
npm run package:windows
```

Packaging produces the Windows ZIP, standalone `install.cmd` and `uninstall.cmd`, and `SHA256SUMS-windows.txt`. Upload these files to the same GitHub Release to enable the README download commands. Local packaging does not publish a release.

Core tests use synthetic archives and PE resources. They cover unchanged source data, independent generations, invalid records, tampering, updates during preparation, normal-close cancellation, retry suppression and real child-process exit before publication. The Windows CI job builds and validates the ZIP without downloading the official app. See [tested builds](tested-builds.md) for local app verification.

Optional local integration test (keep the original app running, and use an isolated state directory):

```powershell
npm run test:windows:integration -- "C:\temporary\fast-switch-test"
```

It prepares a copy, registers a temporary Startup worker, checks waiting-for-exit and worker replacement, disables the worker, removes its shortcut and restores the original launch target. It never requests that the original app quit.

`node test/windows-quit.cjs "C:\path\to\prepared\app" --close-to-tray` verifies window-close-to-tray behavior, restores the test window and requests normal Quit. It requires a stopped patched copy and a running original; only the copy uses temporary credentials and a separate profile. It checks that the original remains running.

The separate UI test accepts a prepared copy: `node lib/health.cjs "C:\path\to\prepared\app"`. It uses temporary Codex credentials, a separate browser profile and a loopback model provider. The Windows test selects the documented unelevated sandbox in read-only mode. The app itself can still contact its normal initialization services and download runtime/plugins; the probe is not a network sandbox. Do not run it against an active personal profile.
