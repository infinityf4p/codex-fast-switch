# Windows

The Windows implementation prepares a separate local Codex copy. It does not take ownership of WindowsApps, modify the Store package, register a replacement MSIX, or replace the official Store entry. Use the stable **Codex Fast** Start menu shortcut or `launchers/windows/Open Codex Fast.cmd` for the patched copy. Official downloads, protocol handlers and file associations continue to belong to the original installation.

Each update publishes a new directory under `versions` and changes `windows-active.json` to select it. Stable shortcuts read this record when opened; old generations remain available for recovery. A repaired legacy `ChatGPT.lnk` also opens the active Fast copy, while the Store-registered ChatGPT entry opens the official app. Identical shortcut names or icons do not identify the executable. The copy normally shares the original app's personal profile and conversations, so it is not an independent user environment.

## Native Update Button

Patch revision 5 recognizes the Windows updater by its interface as well as the previously reviewed whole-method fingerprints. The structural check requires unique instance methods, readiness state storage and notifications, lifecycle callbacks, public check/install delegation, and a consistently initialized native updater binding. Internal implementation changes and renamed variables can therefore be accepted without adding each build's hash. The renderer's update button, status labels, menu handlers and confirmation UI remain intact. The injected adapter feeds readiness and lifecycle events back to the existing update manager. Missing or ambiguous interfaces stop installation before any generation is published.

The adapter checks at startup and every minute whether the registered official installation differs from the running generation, including when an old shortcut bypasses the active pointer. File timestamp changes are confirmed against the original content hashes before an update is offered, so runtime metadata changes cannot repeatedly offer the same build. Only files whose metadata changed are hashed; older records without a usable stamp receive a complete content comparison. It does not use the official updater's package-identity APIs. A manual check with no newer local version offers to open Microsoft Store; downloading the official package still belongs to the Store.

Clicking Update starts a Node helper through Windows Explorer. A directly spawned detached child did not survive Owl shutdown in real-app testing. A unique, atomically written handoff file carries readiness and approval between the app and the independent helper. The helper acquires the installer lock, validates the source and running copy, and completes Fast/updater compatibility checks before acknowledging readiness. Incompatible updates leave the current app running. The app then uses its existing preparation and Quit callbacks. The helper waits for actual process exit, rediscovers the official source, installs the patched generation, repairs shortcuts and reopens the app with the same user-data directory. It restores the app's profile and home environment, including `CODEX_HOME`, without copying API keys or Node injection variables into the handoff. Cancellation before handoff leaves the app running; failures after exit attempt to reopen the previous verified copy. A persisted failure is reported in a native dialog on the next check.

The Start menu shortcut launches the installed worker at its stable path and uses the official app icon with all resolutions and transparency preserved. Regular shortcut maintenance selects the light or dark icon for the Windows system theme; content-based filenames avoid reusing Explorer's cached icon after a theme or app update. Older apps fall back to their bundled icon or executable icon. Default-state installation redirects recognized original-app and direct-copy `.lnk` files in the user's Start menu, Desktop and pinned-shortcut folders, including implicit taskbar shortcuts. Recognition uses executable paths and Store application identities, not shortcut names. Links with additional app arguments are preserved. Custom state directories repair only their own copy links. The worker synchronizes a stopped copy before launch, so immediately reopening the app no longer relies on the background monitor winning a polling race.

Original links are backed up under `agent/shortcut-backups` before replacement. Uninstall restores their exact bytes when they still point to Fast; it preserves subsequent user changes to unrelated targets. The monitor repairs shortcuts rewritten by app startup during its regular checks and leaves unchanged links untouched. Shared all-user shortcuts and Store-generated application registrations are outside this per-user shortcut operation. A pin to the packaged Store entry needs to be replaced with the Codex Fast shortcut; changing a `.lnk` does not replace that package registration.

Run a revision-5 `install.cmd` once to migrate older tools. Compatible future official builds can then use the same installed helper. Microsoft Store downloads remain separate from the local copy update. See [tested builds](tested-builds.md) for real update and request checks and their limitations.

## Fast UI

The Fast UI uses the same transformations as macOS v0.2.4 (`87060bb`), including the compact control introduced in v0.2.3 (`6d7b55f`). The collapsed model picker keeps full model names, uses the bundled filled Fast glyph, shows Ultra effort in purple, and includes the native dropdown chevron. Both recognized picker layouts retain their model, effort and service-tier selections.

Revision 4 adds reviewed fingerprints for the reorganized picker and nested model settings in app 8881. The new shared request path also permits API-key accounts to read the saved speed; its main-process and renderer copies must both match their reviewed function fingerprint. Existing Fast policy restrictions, Copilot selection and personal-access-token restrictions remain in place. It retains the same Fast glyph, full model label and compact-control transformations for older builds. Run **install.cmd** or **Apply and Restart.cmd** to update an older patch and its enabled monitor.

Starting with revision 5, cosmetic recognition is optional on Windows. If the icon, compact picker or model-label styling changes, the script replans the original archive with native appearance and still requires all Fast gate and request checks. `doctor` and the installed generation's `compatibility.nativeAppearance` field report this fallback. Missing or ambiguous core Fast logic still stops installation. macOS retains its existing appearance requirements.

## Requirements

- Windows 10 build 19041 or later, or Windows 11, subject to the official app's requirements.
- A production Codex app using the Owl runtime, with no external MSIX runtime dependencies. Traditional Electron-only layouts are rejected until independently tested.
- Node.js 22.12 or later, from the system or the app's `resources/cua_node/bin/node.exe`.
- Space for a complete app copy on each compatible update. No administrator rights or separately installed compiler are required; Windows PowerShell builds the small window helper using the included .NET Framework.
- x64 is verified locally. ARM64 layouts are accepted by the same checks but execution on ARM64 has not been verified.

## Commands

The standalone **install.cmd** and **uninstall.cmd** each embed the complete Windows tools and dependencies. Each script verifies its embedded ZIP with SHA-256, checks archive paths, extracts to a unique temporary directory, runs the launcher, and removes the temporary tools afterward. Neither needs manual extraction or a separately downloaded Node runtime. `--help` displays CLI help without changing the installation.

**install.cmd** runs `setup`: prepare or upgrade the local copy, install or update automatic monitoring, and open Codex. Setup and manual restart check compatibility before requesting Quit. A current copy is not restarted when the original app is closed. **uninstall.cmd** runs `uninstall`: request normal Quit for local copies, disable the monitor, remove the Startup entry, delete all owned installation files, and return to the official app. The launcher uses a temporary Node copy during uninstall so an installed worker runtime does not prevent its own removal.

If the previous copy or official app reopens after the new generation is published, setup finishes monitor migration and reports `restartRequired: true`. Quit that reopened app and use Codex Fast to select the new generation. Normal launch also activates an already running copy and repairs an enabled monitor left on an older revision or directory layout, without restarting the app.

The README includes PowerShell commands that download and run the scripts from the latest GitHub Release. Those links require publishing `dist/install.cmd` and `dist/uninstall.cmd` as Release attachments under those exact names.

In a source checkout or extracted Windows ZIP, `install.cmd` and `uninstall.cmd` are at the root. The other scripts below are in `launchers/windows` alongside their PowerShell runner. Source checkouts require `npm ci --ignore-scripts`; release packages include dependencies.

| File | Effect |
| --- | --- |
| install.cmd | Install or update the copy and automatic monitoring, then open Codex |
| uninstall.cmd | Quit local copies, remove all Fast Switch installation files, and open the original app |
| Check Compatibility.cmd | Check publisher signatures, recognized runtime integrity, gate fingerprints, Fast glyph and compact picker layouts |
| Apply Once.cmd | Prepare a local copy; the original may remain open |
| Apply and Restart.cmd | Restore the main window, request Quit with Ctrl+Q, wait for exit, prepare and open the copy |
| Open Codex Fast.cmd | Verify the copy, synchronize a newer local official version when stopped, and open it |
| Enable Automatic Fast.cmd | Register and start a per-user Startup monitor |
| Disable Automatic Fast.cmd | Disable the monitor; preserve the active copy |
| Restore Original App.cmd | Disable the monitor and clear the local launch target |
| Check Status.cmd | Report source, active generation and last operation |

The original and local copy normally share Codex's existing user profile. Exit the original before opening the copy. Restart identifies the running application by executable path and uses its Ctrl+Q Quit command. If only the tray remains, it reactivates the same executable and preserves an explicit `--user-data-dir`, parsed with the Windows command-line API. It ignores tool windows and verifies the target PID and foreground window before sending the shortcut. If focus is blocked or quitting needs confirmation, use Ctrl+Q or Quit in the tray menu and retry. Closing a window can leave the app running. App settings, credentials and conversation files are never edited by the installer.

The equivalent CLI commands work through `node cli.cjs`. `--app` accepts a directory, Store package root, or executable path. An explicit path is pinned; omit `--app` to rediscover the registered Store package after updates. `--state` selects an independent state directory and must be reused for every subsequent command. Do not place it inside the source app or place the source inside the state directory.

## Integrity and Recovery

1. Verify the original `ChatGPT.exe`, `chrome.dll` and backend `codex.exe` Authenticode signatures against OpenAI. Older Owl runtimes must also have a matching embedded ASAR header hash. Without that resource, require production Owl app metadata and equal, nonempty EXE/DLL file versions and product names. Binary hashes are recorded for source/copy consistency, not used as a per-version allowlist.
2. Match and transform the shared gate/model functions. Newer apps also require the saved-speed request gate in both process bundles. Check all 12 authentication, policy and loading combinations and transformed fingerprints. Missing or duplicate core functions stop installation; unrecognized cosmetic changes retain the native appearance.
3. Copy the complete app using ordinary file reads, which also handle MSIX-backed source files. Reject symlinks and junctions within the source tree.
4. Patch archive entries and hashes. For an embedded manifest, parse the executable's `INTEGRITY` / `ELECTRONASAR` resource with `resedit`, update only the archive hash, and verify every unrelated resource and non-resource PE section is preserved. Regenerating that executable removes its invalid signature; embedded ASAR validation stays enabled. This follows the [Electron integrity resource format](https://www.electronjs.org/docs/latest/tutorial/asar-integrity). For the signed Owl layout without this manifest, leave the EXE and DLL unchanged and retain their official signatures. Invalid or duplicate manifests remain errors.
5. Recheck the original and candidate, then publish the complete generation by renaming a flushed JSON record. A failed or interrupted preparation cannot replace the previous target. Launch verifies the recorded hashes before opening the copy.

The older layout produces an unsigned local executable; the reviewed newer Owl layout preserves the signed executable. No certificate is installed and no system verification policy is changed. Windows application-control policies may block local copies. Native update UI is connected to Fast Switch's own copy updater; official MSIX updating, file associations, notifications, OAuth callbacks and sandbox setup can differ outside the package and are not all validated by the Fast workflow test.

App 26.908.40834 (8881) removed the old embedded resource. Revision-3 tools rejected the missing resource, while revision 4 required a reviewed EXE/DLL hash pair and rejected later builds such as 9647. Update the Fast Switch tools with a revision-5 `install.cmd`; no original-app repair or removal of Codex user data is needed. Routine signed runtime changes no longer require adding hashes, but incompatible runtime layouts or core request/update interfaces can still require newer tools.

Restore does not copy an older version over a newer official update. **Restore Original App.cmd** clears the local launch target while retaining local generations. **uninstall.cmd** validates generation records, waits for the monitor to exit, and removes `versions`, `agent`, configuration, logs and the empty state directory. Cleanup stays inside the recorded installation directory and rejects unexpected items or redirected paths. It does not depend on the active launch pointer being intact. The original app and its personal profile remain unchanged.

## Monitoring and Storage

State is in `%LOCALAPPDATA%\Codex Fast Switch` by default:

```text
windows.json          configuration
windows-active.json   active local generation
windows-status.json   last check / operation
windows-update.json   in-app update handoff and result
windows-monitor.log   unexpected worker errors
versions/<id>/app/    complete local copies
agent/                stable worker code and copied Node runtime
```

The Startup shortcut has a name derived from the state path. It starts the worker hidden at login. The worker polls every 10 seconds and waits until the source and current copy are both closed. Unrecognized patch or updater structures are rejected until their files or the patch revision change, or monitoring is enabled again. Other failures retry with exponential backoff from 30 seconds to 15 minutes. Failed staging copies are removed while their recovery records remain. A live installer lock excludes another installer; a separate worker lock prevents duplicate monitors. Disable takes effect by the next poll.

Worker code is under `agent/src`, with the copied runtime still at `agent/node.exe`. Setup rewrites older Startup entries to `agent/src/platforms/windows/native.ps1`. Both setup and uninstall recognize the earlier `agent/windows/native.ps1` entry. A separate `workerLayout` field refreshes an enabled monitor after a directory-layout change even when the app patch revision is unchanged. Existing generations, state paths and personal Codex data retain their locations; full uninstall also removes older files remaining under `agent`.

Failed operations record their phase, error code and message in `windows-status.json`; in-app updates also keep `windows-update.json`. Native Windows errors are returned as structured data so the CLI can show the actual cause. Full uninstall removes the update record, the stable launcher and matching copy shortcuts along with the other owned installation files.

Backups and state must remain trusted and local. Local generations consume disk space until **uninstall.cmd** removes the installation. Backups are not needed afterward because a reinstall copies the official app again. The package itself contains only this project's code and npm dependencies; official application binaries are copied from the user's installation at runtime.

## Development

The implementation is in `src/platforms/windows`; patching and Fast UI rules are shared through `src/core`. The standalone installer template is `scripts/windows-standalone.ps1`. See the [README](../README.en.md#development) for source setup, checks and release packaging. Release ZIPs contain the shared runtime and Windows implementation; development tools and tests are available in the source checkout.

## Validation

Core tests use synthetic archives and PE resources. They cover unchanged source data, independent generations, invalid records, tampering, updates during preparation, normal-close cancellation, retry suppression and real child-process exit before publication. The Windows CI job builds and validates the ZIP without downloading the official app. See [tested builds](tested-builds.md) for local app verification.

Optional local integration test (keep the original app running, and use an isolated state directory):

```powershell
npm run test:windows:integration -- "C:\temporary\fast-switch-test"
```

The native update test creates and removes its own app copies, Codex home and browser profile. The selected official source must be stopped; a personal Fast copy may keep running. It retains screenshots and a JSON report in the supplied artifact directory:

```powershell
node test/integration/windows/updates.cjs "C:\path\to\official\app" "C:\temporary\update-test-results"
```

By default, this tests a same-version source change through the real native button and installer. Add the previous Fast installation's state directory as the third argument to test a cross-version upgrade. The harness copies that installed app into a disposable generation and changes only its updater binding to the test state; it never launches the personal profile. This mode also probes Fast/Standard requests after the upgrade. It does not download or install a Store package. Normal background initialization is allowed; model configuration uses a dummy key and loopback mock. Cleanup targets only executables inside the freshly created test directory and checks the existing personal installation afterward.

It prepares a copy, registers a temporary Startup worker, checks waiting-for-exit and worker replacement, disables the worker, removes its shortcut and restores the original launch target. It never requests that the original app quit.

`node test/integration/windows/quit.cjs "C:\path\to\prepared\app" --close-to-tray` verifies window-close-to-tray behavior, restores the test window and requests normal Quit. It requires a stopped patched copy and a running original; only the copy uses temporary credentials and a separate profile. It checks that the original remains running.

The separate UI test accepts a prepared copy: `node test/support/health.cjs "C:\path\to\prepared\app"`. It uses temporary Codex credentials, a separate browser profile and a loopback model provider. The Windows test selects the documented unelevated sandbox in read-only mode. The app itself can still contact its normal initialization services and download runtime/plugins; the probe is not a network sandbox. Do not run it against an active personal profile.
