# Tested builds

## 2026-09-16: repeated Windows update prompt

On the personal **26.908.40834 (8881)** installation, the native updater completed with the same active generation but continued reporting an update. The official files matched the installed original fingerprints; only the change timestamp of the 104-byte `owl-shell-runtime.json` file differed. Timestamp changes now trigger content comparison for the affected files instead of marking the build as new.

The regression reproduced the false positive before the fix. The **30 Windows update and installation tests** then passed, including unchanged content, repeated checks, changed content with the same version, and records without a saved stamp. Source and PowerShell syntax checks passed. Deploying the corrected helper changed the real check from `available: true` to `available: false` without changing the running app process, active generation, installation records, configuration or official/patched app fingerprints. No native update or app restart was triggered during this repair.

## 2026-09-16: Windows application icons

On Windows x64 with app **26.908.40834 (8881)**, the shortcut's extracted icon contained only one 32px image and appeared distorted on the taskbar. The native window icon already matched the official artwork. Shortcuts now use the official themed ICO files byte-for-byte; both light and dark selections retained all **15 resolutions**. Theme selection was exercised without changing the personal Windows theme.

The repaired shortcuts and a Shell icon-cache notification visibly restored the running taskbar icon. The active generation, monitor configuration, official and patched app fingerprints, and app process IDs were unchanged. The app was not restarted. Source/PowerShell checks, both existing Windows shortcut tests, and Windows installer packaging passed.

## 2026-09-15: Windows 8881 compatibility and cross-version update

Verification used Windows x64, installed Store package **26.908.4834.0**, app **26.908.40834 (8881)** and Windows patch revision **4**. The previous personal Fast copy was **26.901.51231 (8109)**, revision **3**.

- The update error `Cannot uniquely identify the Windows ASAR integrity resource` occurred during source verification. Build 8881 no longer embeds the old `INTEGRITY/ELECTRONASAR` manifest. Its reviewed EXE/DLL hash pair and OpenAI signatures passed; patching retained those binaries and their signatures. Older embedded-manifest validation remains required, and unknown runtime pairs are rejected.
- The new model-settings wrapper, both compact picker variants and the native updater initializer matched reviewed whole-function fingerprints. The saved-speed request path now recognizes API-key accounts in both renderer and main bundles while retaining feature-policy, Copilot and personal-access-token restrictions. Synthetic tests reject a missing or duplicate required bundle copy.
- The complete integration run copied the old installed Fast app into a disposable state, clicked its native Update button, installed 8881 and observed a new process with the same isolated user-data directory and profile marker. A subsequent probe of the updated generation sent `priority` for Fast and omitted the tier for Standard using `gpt-6-astra`; both mock responses completed. The visible compact control retained the full model label and chevron, displayed a 14px filled Fast icon and hid it for Standard, with no clipping or overlap.
- Early UI attempts were blocked by a fresh-profile announcement or submitted before refreshed authentication state reached the composer. The harness now closes that specific announcement and waits for the visible selected speed before sending. One final-run attempt failed to establish the test-only DevTools connection before clicking Update; a fresh retry passed. These failed attempts are not counted as successful integration runs.
- The personal app and monitor retained their process IDs and creation times; the personal active record, monitor configuration and existing ChatGPT shortcut retained their hashes. Integration copies, temporary profiles and test shortcuts were removed.
- The targeted shared-core and Windows unit suites passed **53 tests**, with **1 macOS-only skip** and **0 failures**. JavaScript, JSON and Windows PowerShell syntax checks passed.

The repaired revision-4 worker was then deployed to the personal installation without quitting its app. Installed worker hashes matched the source, compatibility recognition passed, and the update check reported 8881 available with no recorded failure. One new monitor replaced the old one. The personal app retained its PID and creation time, active revision-3 generation and file hashes; the official package was also unchanged. The personal app itself remained on 8109, ready for the user's next native Update click.

The test used an already-installed official package; it did not download an update from Microsoft Store. App background initialization was allowed, while all model requests used a dummy key and a loopback mock. It does not measure provider performance, test every model or tool-using follow-up turn, or establish new macOS/ARM64 compatibility. Readiness during an in-progress authentication refresh remains the app's native behavior.

## 2026-09-08: Windows shortcut routing

The Windows shortcut, update and installation unit suites passed **30 tests**. Real `.lnk` fixtures covered executable and Explorer-based Store targets, implicit pinned-shortcut folders, repeated maintenance, app-rewritten paths, custom profiles, unrelated same-name links, original-byte restoration, preservation of user changes, isolated states and rejection of restoration records outside the configured shortcut roots. Source and PowerShell syntax checks passed.

The personal app's `ChatGPT.lnk` had been rewritten to its concrete generation path after activation. The installed launcher and monitor were updated, and both that shortcut and `Codex Fast.lnk` were verified to use the stable launcher after a real shortcut activation and two monitor checks. The app PID, creation time, active generation and official/patched file hashes were retained. No matching Desktop or public shortcuts were present on this machine. Store-generated Start entries and packaged pins were not redirected. This check did not exercise a full app restart or uninstall the personal installation.

## 2026-09-08: Windows installation recovery

The personal installation upgrade on September 7 published app **26.901.51231 (8109)** with Windows patch revision **3**, replacing the active pointer from **26.901.41600 (7982)**, revision **2**. The CLI then detected a reopened previous copy or official app and raised `APP_RUNNING`, skipping monitor migration. The new generation and stable shortcuts had already been installed. This was a partially completed setup, not a successful end-to-end update.

- A controlled test called the old installed launch function with simulated reopen timing and reproduced the recorded exception. The corrected flow returns the installed result with `restartRequired: true` and completes monitor migration. Regression tests also cover activating an existing copy and repairing its stale monitor during normal launch.
- The personal installation's worker was upgraded to revision **3**, layout **1**, through normal launch. The original app process ID, creation time and open window were retained. The legacy monitor exited, one new monitor started, and the Startup entry moved to `agent/src/platforms/windows/native.ps1`.
- The active generation record, patched app hashes and official source hashes were unchanged during repair. The updater check reported no newer locally installed source. No model requests or app Quit commands were issued by the repair.
- Source and PowerShell syntax checks passed. The targeted Windows unit suites passed **28 tests**, with **0 failures** and **0 skips**.

The user's separately reported startup dialog was not reproduced. Activating the existing window succeeded; the controlled exception test does not establish the cause of that unknown dialog. This recovery did not rerun the complete native update cycle or Microsoft Store download.

## 2026-09-07: Windows native update button, revision 3

Local verification used Windows x64, Store package **26.901.6511.0**, app **26.901.51231 (8109)** and patch revision **3**. `test/integration/windows/updates.cjs` created independent app copies, browser data, `CODEX_HOME` and Windows profile directories, with a dummy key and a loopback model provider.

- The native Update icon appeared and was clicked through the test window's own loopback DevTools connection. The updater waited for that app to quit, created and verified another patched generation, repaired its shortcut and launched a new process with the same isolated user-data directory.
- The running personal app and its backend/monitor processes retained their PIDs and creation times. SHA-256 hashes of the personal active record, monitor configuration and existing ChatGPT shortcut were unchanged. All test processes, copies and test shortcuts were removed.
- An earlier attempt showed that a directly spawned detached helper also exited when Owl quit. Starting the helper through Windows Explorer and using an atomic handoff file fixed the failure. The handoff preserves the isolated profile/home environment without inheriting Explorer's personal configuration.
- A subsequent shortcut failure in an incomplete temporary Windows profile exercised reopening the previous verified copy. Shortcut setup now creates a missing Programs directory. The final full run completed successfully after the test environment and cleanup process checks were corrected.
- Source and PowerShell syntax checks passed. Unit tests: **60 passed**, **10 platform-specific skips**, **0 failed**.

The old official build was no longer installed, so the update trigger was a source-path change between signed copies of the **same official version**. The test did not download a Microsoft Store package, exercise a real version-number upgrade, verify the relaunched renderer through DevTools, or rerun Fast/Standard model request checks. The relaunch check verified the new executable, integrity and process arguments with the retained profile marker. Normal app background initialization and plugin/runtime downloads were allowed.

## 2026-09-05: reported existing-session Fast switching, Windows revision 2

The supplied test report covers Windows app **26.901.41600 (7982)**, patch revision **2**, and `gpt-6-astra`, tested at **23:06-23:10 Asia/Shanghai**. An isolated app copy, profile and Codex home used a dummy key and a loopback Responses server. All nine ordinary conversation replies completed across two fixed thread IDs; two title requests were excluded.

Global Speed changes affected new conversations. Each existing conversation retained its own setting until changed in its model menu. Fast sent `priority`; Standard omitted the tier. A switch during one held stream left that submitted request unchanged, while the next message used the new choice. Another conversation completed a reply during the held stream.

This is a reported app test, not a rerun during the README update. Provider throughput, billing, and follow-up model calls within a tool-using turn were not tested. The raw request JSON referenced by the report was not supplied to this repository.

## 2026-09-05: repository layout, not tested

Shared and platform code, launchers and test tools were moved into dedicated directories. CLI dispatch, worker file lists, native helper locations, packaging and Windows legacy Startup-path handling were updated. Existing test imports and commands follow the new paths. At the user's request, no tests or app installation, upgrade, launch or uninstall flows were run for this change. Earlier results below apply to the previous layout.

## 2026-09-05: Windows install and uninstall scripts, not tested

The standalone Windows scripts are now `install.cmd` and `uninstall.cmd`. Setup enables monitoring and opens the copy; uninstall removes all Fast Switch installation files after normal Quit and worker shutdown, while retaining Codex's own profile. README download commands and packaging were updated. At the user's request, the scripts, cleanup logic and installation flows were not executed for testing.

## 2026-09-05: Windows Fast UI synchronization, not tested

Windows patch revision 2 imports the Fast glyph and compact model control from macOS v0.2.4 (`87060bb`), with the UI introduced by v0.2.1 and v0.2.3. It also upgrades previous Windows copies and enabled monitor code when the official app is unchanged. At the user's request, no tests, compatibility probe or app launch were run for this revision. The results and Speed screenshot recorded below apply to the earlier Windows implementation.

## 2026-09-05: Windows local-copy support

Local verification used Windows x64, Store package **26.901.5280.0**, app **26.901.41600 (7982)** with the Owl runtime.

- Core tests: **39 passed**, with the two macOS-only tests skipped. Includes the Windows PowerShell 5.1 launcher, profile-argument preservation, failure recording, synthetic PE resources and child-process interruption before publication.
- The initial Windows restart used `CloseMainWindow`, which left Codex running in the tray and timed out. The corrected flow uses the application's Ctrl+Q Quit command. A local test reproduced window-close-to-tray behavior, reactivated the same isolated profile and exited successfully with code 0. Direct Quit also passed, and the original app's processes remained running.
- The standalone one-click script was tested with spaces, Unicode and ampersands in its path. Normal invocation delegates to restart; help mode, exit-code propagation, temporary cleanup, payload corruption and archive traversal rejection passed using a harmless fixture launcher.
- JavaScript, JSON and Windows PowerShell syntax checks passed.
- Store discovery and OpenAI Authenticode validation passed, including a WindowsApps path redirected to another drive.
- A complete local copy was installed. The embedded executable hash matched the patched ASAR; other PE resources and non-resource sections were preserved. The resulting local executable was unsigned, while the source signatures and recorded source hashes were unchanged.
- The isolated UI test passed on **2026-09-05**, with the Speed menu screenshot captured at **10:33:17 UTC**: `gpt-6-astra` sent `priority` for Fast and omitted the tier for Standard. Both requests received complete loopback mock replies. Title requests also used the mock.
- Per-user Startup monitoring, re-enabling an existing worker, waiting for the original app to exit, disabling and restoration passed. The temporary Startup shortcut was removed and the original app remained running and unchanged.
- The UI harness uses a temporary Windows profile layout, ignores the avatar-overlay page, and selects read-only / unelevated sandbox configuration. No administrator sandbox initialization was performed. Normal app background initialization and plugin/runtime downloads can still occur.

No personal API credentials were used. This verifies request selection, not actual provider throughput. Windows ARM64, managed application-control policies, original Store file associations and all package-specific integrations remain unverified. CI has been configured for Windows; hosted CI was not run as part of this local verification.

## 2026-09-05: persistent signing identity, 0.2.4

Local verification used **26.901.41600 (7982)** on **arm64**.

- Source checks and 37 core/native tests passed.
- Nine signing integration checks passed at **11:44:19 UTC**: different builds with the same certificate decrypted the same dummy item while Keychain UI was prohibited; another certificate was rejected. Changed certificates stopped signing before target modification, missing identities were not regenerated, and temporary keychains were removed with the original search list and default restored.
- The imported test private key was independently checked as non-extractable and sign-only, with decrypt, derive and unwrap disabled.
- The isolated App UI test passed at **11:38:47 UTC**, including Fast/Standard request tiers, the compact control, successful activation and exact restoration of the official signature. The UI copy used a mock Keychain and a loopback API.
- All 12 transaction and process-interruption tests passed at **11:39:41 UTC**.
- A separate revision 3-to-4 upgrade passed at **11:40:56 UTC**, retained the pinned certificate on repeated installation, and restored the exact official signature.
- No real Keychain item contents, user API credentials or relay were used. Migrating the installed app to a new identity still requires the user's initial macOS authorization.

## 2026-09-05: native compact control, 0.2.3

Local verification used **26.901.41600 (7982)** on **arm64**.

- Source checks and 35 core/native tests passed, including dynamic model, effort, tier and hidden-label cases for both compact layouts.
- The optional UI test passed at **11:04:45 UTC**. A light-theme screenshot confirmed the full `GPT-5.6 Sol` label, native purple `Ultra`, a 14px filled Fast icon and the native chevron without overlap or clipping.
- Fast sent `priority`; Standard omitted the tier and hid the icon. Both requests used `gpt-5.6-sol` and the app's normal Ultra-to-`max` effort mapping through the loopback mock.
- The final UI test installed the patch on a copy and restored the exact officially signed original. A separate revision 2-to-3 upgrade and repeated installation also passed during development.
- Earlier screenshot checks caught the legacy label's 16px SVG override. The final implementation uses the native direct-icon layout and does not override the app's font size.
- Test model, theme, credentials and profile were temporary. The UI test used a mock Keychain; no relay or real account credentials were used.

## 2026-09-05: one-command installation, 0.2.2

- Source, shell syntax and 32 core/native tests passed.
- Installer tests cover forwarding the selected app to setup, rejecting damaged downloads before extraction, and rejecting unexpected download URLs.
- Combined `setup` updated the local automatic worker successfully on app **26.901.41600 (7982)**. The existing revision 2 patch returned `already-installed` with `reopened: false`, preserving the running app.
- The patch recipes and transaction logic are unchanged from 0.2.1. No relay or model request is involved in setup.

## 2026-09-05: filled Fast icon, 0.2.1

Local verification used **26.901.41600 (7982)** on **arm64**.

- Source checks and 29 core/native tests passed, including filled glyph rendering with preserved dimensions and props.
- All 12 transaction and interruption tests passed at **10:05:24 UTC**.
- A separate copy was installed using the previous 0.2.0 implementation, upgraded to revision 2, verified to contain the filled icon, and restored to the exact officially signed original. Repeated installation was idempotent.
- The optional UI test passed at **10:07:59 UTC**. The collapsed model control screenshot showed a filled lightning glyph. `gpt-6-astra` sent `priority` for Fast and omitted the tier for Standard through the loopback mock.
- An earlier UI attempt timed out during onboarding, and a separate restart probe timed out attaching CDP during relaunch. Those attempts are not counted as passing. The later UI run completed successfully; the test harness now captures renderer diagnostics on UI timeouts.
- Test copies were cleaned up and the installed app was not modified by these tests. No relay credentials or private server were used.

## 2026-09-05: direct restart, 0.2.0

Local verification used **26.901.41600 (7982)** on **arm64**.

- Core and native tests: 22 passed.
- Transaction and interruption tests: 12 passed at **08:50:37 UTC**, including default installation without a UI probe.
- Optional UI test passed at **08:58:46 UTC**: `gpt-6-astra` sent `priority` for Fast and omitted the tier for Standard, with complete local mock responses.
- The normal quit, patch, and reopen test passed at **09:00:21 UTC**, using the same isolated profile before and after patching. The reopened window loaded and the macOS exit notification arrived. Installation did not invoke the UI checker.
- Time from exit to the reopened test window loading: **38.6 seconds**. This includes patching and window startup, with no fixed stability wait; it is not a guarantee of startup time on other machines.
- The test copy was restored and the installed official app remained unchanged throughout the tests.

The restart test uses a reachable loopback mock and the bundled backend's model metadata. No relay, user credentials, or server changes are involved. Intel remains unverified.

## 2026-09-05: initial release

Local verification used the official macOS app **26.901.41123 (7942)** on **arm64**.

| Check | Result |
| --- | --- |
| Source syntax and JSON | Passed |
| Core and native tests | 15 passed |
| Transaction and process-interruption checks | 12 passed |
| Automatic monitor, real UI, activation and restoration on a copy | Passed |
| Copied Node runtime started by a temporary LaunchAgent | Passed; test service removed |
| Installed official app identity after integration tests | Unchanged |

The UI test completed at **2026-09-05 06:54:51 UTC**. Model discovery selected `gpt-5.6-sol` from the bundled backend. A new Fast task sent `priority` to the loopback mock; a new Standard task omitted the field. Both received complete mock replies. Additional title requests used the same mock. The original signature was restored on the test copy.

Transaction checks completed at **2026-09-05 06:57:08 UTC**. They injected thrown failures and process exits at prepared, exchanged and activated phases, checked subsequent recovery, idempotency and refusal to overwrite a changed app. The UI checker was stubbed for fault injection; actual UI verification ran separately.

No relay credentials or private server were involved. These results do not measure real API throughput. The universal helper was compiled for arm64 and x86_64; only arm64 execution was tested. Later CI results are available in the repository's Actions tab.
