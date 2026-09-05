# Tested builds

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
