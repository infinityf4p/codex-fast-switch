# Tested builds

## 2026-09-21: installation from tested main builds

The local suite passed **194 tests**, with **11 platform-specific skips** and **0 failures**. Source, PowerShell and generated-bootstrap checks passed; workflow YAML parsed; the Windows ZIP and fixed standalone scripts packaged successfully.

Installer checks exercise both macOS's embedded Node script and Windows's real PowerShell download/extraction path with simulated network responses. They cover selecting a commit without a version bump, forwarding setup/uninstall, archive SHA-256 verification, rejecting unexpected URLs and traversal paths, checking the embedded build commit, retrying when a deployment changes between metadata and archive requests, and offline bootstrap help. The download-site builder refuses incomplete platform pairs or mismatched embedded commits before creating a publishable manifest. These tests do not reinstall the personal app.

The first CI run passed all six platform/Node jobs but exposed Windows PowerShell's backslash ZIP entries during Linux publishing. The packager now writes standard forward-slash entry names. A real Windows ZIP regression checks exact metadata and launcher paths, and Info-ZIP successfully read the rebuilt full package's embedded build information using the publication command.

## 2026-09-20: Windows package identity cleanup and recovery

The local suite passed **184 tests**, with **11 platform-specific skips** and **0 failures**. JavaScript/JSON and PowerShell checks passed, and the Windows ZIP plus standalone install/uninstall scripts built successfully.

Temporary generation directories and mocked package operations exercise the real PowerShell identity actions: exact installation/name/publisher matching, case-insensitive Windows paths, missing registrations, removal failure and residual-registration checks, redirected paths, cross-state conflicts, running-copy refusal, and restoring the old registration after a failed switch. CLI checks verify unregistration before file deletion, preserving copies and the active pointer on failure, restoring the original while retaining generations, recovering the previous pointer after registration or shortcut failure, and repairing identity on launch without repatching a current copy. A compiled activation helper test parses seven profile argument cases with `CommandLineToArgvW` and checks error propagation through an injected activation transport.

Additional cases cover synchronous activation failure after a successful installation: restore the previous launch record and existing package resources before reopening, preserve the update's user-data directory, retain a running generation rather than switching its identity, and return to the official app if no previous active copy exists. A successful activation followed by a status-write error does not trigger identity rollback. These checks do not detect an app that starts successfully and crashes later.

These checks did not uninstall the personal app, register a second real package, or perform another live update/activation cycle. The earlier build-9922 icon repair is recorded separately below.

## 2026-09-20: Windows package identity icons on build 9922

The running **26.915.31945 (9922)** copy had been registered as `CodexFast.Switch` to satisfy the newer Owl runtime's package-identity requirement. Its PNG assets were present, but `resources.pri` was missing. The taskbar showed a blue plate, while its window HICON and shortcut ICO files already used the official artwork.

A generated PRI for the local package name indexes 35 official image paths and preserves their target-size and unplated theme qualifiers. Adding this index and sending a Shell cache notification changed the Shell's resolved **32px, 48px and 96px** icon images to byte-identical renders of the official package on the current dark theme. The existing taskbar button still cached its blue plate; rebuilding only that window's button through `ITaskbarList::DeleteTab` / `AddTab` cleared it. A `PrintWindow` taskbar capture confirmed the transparent official artwork, without bringing the app in front of the user's full-screen application. This moved the unpinned button to the end of the running apps. Temporary window-property diagnostics were restored to their original empty values. The running app retained its PID and creation time, active-generation record, and program-file hashes; official files were unchanged. No app restart, Explorer restart or package re-registration was performed.

The installed helper was then synchronized with the corrected resource preparation, and one replacement monitor started. The local suite passed **152 tests**, with **11 platform-specific skips** and **0 failures**; source and PowerShell syntax checks passed. Twelve resource checks use temporary directories and simulated registration, including retry after failed registration and rejecting redirected refresh markers. The PRI generation was deterministic across two builds and rejected invalid identity, embedded data, absolute paths and lost theme qualifiers. This repair did not repeat a full native-update cycle or test package activation with an isolated profile.

## 2026-09-20: Windows compact model colors

Windows patch revision **7** on app **26.911.61220 (9647)** applies the independent structural color adapter while retaining the native compact layout. In a disposable copy, both dark and light themes displayed **GPT-6 Astra** with a solid Fast glyph using the native primary text color. Ultra used the native purple in both Fast and Standard; Standard hid the glyph. Dark-theme text/icon and Ultra colors were `rgb(223, 223, 223)` and `rgb(173, 123, 249)`; light-theme values were `rgb(26, 28, 31)` and `rgb(146, 79, 247)`. These are observed theme values, not hardcoded patch colors.

Each theme completed Fast and Standard responses against a loopback provider: Fast sent `priority`, Standard omitted the tier. The first attempt failed to connect to the test-only DevTools socket before reaching the UI; a fresh full retry passed both themes. Temporary app copies and profiles were removed, and the personal app retained its PID/creation time, active generation, configuration and patched hashes; official source fingerprints were unchanged. This run checked installation and rendering, not another native update cycle or a Microsoft Store download.

The local suite passed **140 tests**, with **11 platform-specific skips** and **0 failures**. Source/PowerShell syntax checks and Windows one-click packaging passed. Structural tests cover renamed identifiers, repeated adaptation, Ultra/other efforts, native cache updates, ambiguity and independent color fallback. macOS keeps its existing full-layout adapter.

## 2026-09-19: Windows model names and filled Fast glyph

Windows patch revision **6** on app **26.911.61220 (9647)** retains the macOS model-name and filled-icon transformations when only the compact layout changes. Revision 5 had disabled all appearance patches after one unsupported layout; revision 6 records and skips individual incompatible features. On this build only `compact-model-control` uses native appearance. The existing model-name, Default preset and Fast-icon recipes match without new build-specific fingerprints.

An isolated copy of the installed revision-5 app updated to revision 6 through its native Update button, preserved its profile and reported no remaining update. The subsequent UI probe observed **GPT-6 Astra** in both modes and a filled, single-contour Fast glyph with `viewBox="0 0 24 24"`; Standard hid the glyph. Fast sent `priority` and Standard omitted the tier to the loopback provider. The native layout uses a 16px icon; the older 14px compact spacing, colors and chevron were not applied or claimed as verified on this build.

All test copies were removed. The personal app/monitor processes, active generation, configuration and existing shortcut remained unchanged during the test. The local suite passed **135 tests**, with **11 platform-specific skips** and **0 failures**; source and PowerShell syntax checks passed.

## 2026-09-19: Windows 9647 and update compatibility

Verification used Windows x64, Store package **26.911.7940.0**, app **26.911.61220 (9647)** and Windows patch revision **5**. The installed previous Fast app was **26.908.40834 (8881)**, revision **4**.

- Revision 4 rejected the new runtime because its EXE/DLL hashes were not listed. Revision 5 verified all three OpenAI executable signatures and the matching EXE/DLL versions without adding the new build's hashes. The copied EXE and DLL retained their official signatures. Embedded-manifest validation remains required whenever present.
- The updater's initializer changed but its interface passed the new structural checks. Fast logic passed all 12 local cases. Changed compact-picker styling selected native appearance automatically, without adding 9647 cosmetic fingerprints or changing macOS requirements.
- A disposable copy of 8881 clicked its native Update button, checked compatibility before quitting, installed 9647 and reopened with the same isolated profile marker. The updated generation reported no remaining update. A separate UI probe then selected Fast and Standard and completed loopback responses with `gpt-6-astra`: Fast sent `service_tier: "priority"`; Standard omitted it.
- The first run completed installation and relaunch but its request probe timed out because the test located the model label through the old CSS class. The native Fast icon was visible. After updating the test selector for the native model-label container, a fresh complete run passed both request checks. Native appearance was tested; the old compact styling assertions were deliberately inapplicable.
- Normal app initialization was allowed, and the first probe logged an upstream primary-runtime download checksum mismatch. No download verification was bypassed. Model requests used a dummy key and a loopback provider. The test did not download or install a Microsoft Store package or verify a future app build.

Unit regressions cover new signed runtime versions, invalid signatures and mismatched binaries, changed updater implementations, incompatible interfaces, appearance fallback without suppressing Fast failures, and compatibility failure before Quit in both native update and installer paths.

The final local suite passed **134 tests**, with **11 platform-specific skips** and **0 failures**. Source and PowerShell syntax checks and Windows packaging passed. Both integration runs removed their test copies and preserved the personal app/monitor processes, active record, monitor configuration and existing ChatGPT shortcut.

The revision-5 helper was then deployed to the personal installation. Its installed files matched the source; compatibility recognition accepted 9647, and the update check reported it available with no recorded failure. One replacement monitor was running. The personal app retained its PID and creation time, active 8881 generation and patched file hashes; the official files were unchanged. The app can use its next native Update click to activate 9647 without running the installer again.

## 2026-09-16: repeated Windows update prompt

On the personal **26.908.40834 (8881)** installation, the native updater completed with the same active generation but continued reporting an update. The official files matched the installed original fingerprints; only the change timestamp of the 104-byte `owl-shell-runtime.json` file differed. Timestamp changes now trigger content comparison for the affected files instead of marking the build as new.

The regression reproduced the false positive before the fix. The **30 Windows update and installation tests** then passed, including unchanged content, repeated checks, changed content with the same version, and records without a saved stamp. Source and PowerShell syntax checks passed. Deploying the corrected helper changed the real check from `available: true` to `available: false` without changing the running app process, active generation, installation records, configuration or official/patched app fingerprints. No native update or app restart was triggered during this repair.

## 2026-09-16: Windows application icons

On Windows x64 with app **26.908.40834 (8881)**, the shortcut's extracted icon contained only one 32px image and appeared distorted on the taskbar. The native window icon already matched the official artwork. Shortcuts now use the official themed ICO files byte-for-byte; both light and dark selections retained all **15 resolutions**. Theme selection was exercised without changing the personal Windows theme.

The repaired shortcuts and a Shell icon-cache notification visibly restored the running taskbar icon. The active generation, monitor configuration, official and patched app fingerprints, and app process IDs were unchanged. The app was not restarted. Source/PowerShell checks, both existing Windows shortcut tests, and Windows installer packaging passed.

## 2026-09-16: recorded production installation on build 9275

Read-only inspection found revision **10** installed on **26.908.70816 (9275)** at **17:21:44 Asia/Shanghai**. The installed fingerprint matches its transaction record and deep signature verification passes. The new app process read the Storage Key successfully at **17:21:46** and reported an active Sparkle hook at **17:21:53**. The fixed helper's files still match its recorded hashes. These observations verify installation and helper access; this inspection did not repeat the UI, provider-request or full update-cycle tests.

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

## 2026-09-12: build 8881 compatibility repair and production activation

The production app updated from **26.903.71938 (8576)** to **26.908.40834 (8881)** through the official updater. Revision 9's handoff ran, but compact-picker recognition rejected the changed legacy layout before modifying the app. The official app reopened with its Apple signature intact. Process sampling observed **11.319 seconds** from the old process disappearing to the new process appearing; the handoff reported **21.455 seconds**, including its failure notification. These are not window-readiness measurements.

Revision **10** adds the reviewed legacy-layout fingerprint and target paths for 8881. Its modern layout still matches an existing recipe. All patch targets were recognized and the 12 permission-gate cases passed. The 14 compact, picker and startup unit checks passed, as did 18 combinations of the actual 8881 compact rendering statements evaluated with stubbed JSX and component dependencies. These cover Fast/Standard/UltraFast, reasoning labels, hidden labels, GPT-prefix props and the new button accessibility properties; repeated adaptation is unchanged. The 8881 primary bundle no longer imports the authed-route chunk that caused the earlier startup cycle, so no route-initialization edit is applied to this build.

A signed revision 10 candidate passed deep signature verification, and the production worker was updated with a retained previous-worker backup. The official app and fixed Storage helper remained unchanged during preparation. The user-run installation entry activated the candidate at **17:00:22 Asia/Shanghai**, reporting **1.170 seconds** for activation. The observer recorded the reopened app, a successful Storage Key read at **17:00:24**, and an active Sparkle hook at **17:00:32**, with no recorded renderer startup error. UI confirmation and absence of Keychain prompts were not supplied. This was a manual compatibility repair after the failed official update, not a successful 8881 automatic-update cycle.

## 2026-09-11: builds 8690 and 8720, official update and startup repair

The official **26.908.31457 (8690)** and **26.908.31748 (8720)** full archives passed the appcast's Ed25519 signature check and Apple's app signing requirement. Reviewed per-layout paths recognize their changed compact picker while preserving older recipes.

The complete official-update cycle was repeated with **revision 9** and passed. The isolated **8576** app started at **14:07:12 Asia/Shanghai**; after the user triggered the official update, the worker automatically patched **8720** and launched it at **14:09:00**, without a manual patch command. The restart handoff reported **23.302 seconds**, which measures the handoff through relaunch, not download time or window readiness. Both app processes read the dummy Storage Key through the unchanged helper. The user confirmed that the interface and Fast controls worked and that no Keychain prompt appeared. Final signature and backup checks passed, no renderer startup errors were present through **14:10:53**, and the production app's fingerprint remained unchanged.

A user-triggered official update from **26.903.71938 (8576)** to **8720** installed revision 8 and reopened the same isolated app automatically. The restart handoff reported **20.187 seconds**. Both app processes read the dummy Storage Key through the same unchanged helper, and the production app's fingerprint remained unchanged. The test uses the public official appcast: the separate production backend appcast offered only 8576 for the test installation at the time of the check.

This was **not a passing end-to-end run**: the reopened renderer failed with `TypeError: r is not a function`. The initial observer had finished on the Storage Key read before the error appeared. It now waits for the new process's update hook, records renderer failures separately, and leaves overall success pending UI confirmation. A diagnostic startup traced the failure to `authed-route-86740a2af5a2.js:1:1573`; that file was identical to the official archive. Its circular import calls an initializer from `app-primary` before that initializer is assigned.

Revision 9 defers that initializer until a route component is invoked, matching only the exact reviewed 8690 and 8720 route chunks. A native Node ES-module reproduction fails with the original ordering and passes both import orders after the fix. The related 34 startup, picker, archive and core checks passed. Before the complete revision 9 cycle above, a repaired 8720 candidate passed signature verification and retained the same helper. That repaired app opened at **13:57:21 Asia/Shanghai**, read the dummy Storage Key successfully, loaded its update hook, and produced no route-prefetch or error-boundary failure in the observed startup. The user confirmed that the interface was normal. The production app and its installed worker were not updated by these tests.

Isolated **26.901.51231 (8109)** and **26.903.71938 (8576)** apps were patched, then replaced on disk with the verified official 8690 app. The actual automatic worker tick installed revision 8 in **18.936 seconds** and **19.949 seconds**, respectively, including its normal recognition, staging and signing work. The temporary Storage helper executable remained identical, and the installed production app's fingerprint was unchanged. The tests used dedicated signing identities, dummy keychains and provider configurations.

The offline replacements verify package recognition and installation, separately from the real update above. User-triggered updates use a test-only isolated reopen function; on patch failure this test refuses to open an unpatched copy, so its failure-opening behavior intentionally differs from production. No personal credentials, provider requests or real Keychain item contents were used.

The first user-triggered update installed the official 8690 app, but Sparkle renamed the test's `Test Codex.app` to `ChatGPT.app`. The handoff still addressed the removed old path and failed before reopening. The test now keeps the official filename, and the handoff waits for the updater and bundle metadata before inspecting whether the app is running. Eight focused handoff tests pass, including a temporarily absent bundle.

The second user-triggered update, from 8576, also installed the official 8690 app. Repatching failed because the test worker inherited an isolated `HOME`, causing `codesign` to report `no identity found`. Signing the same probe with the same identity succeeded under the normal user home and failed under the isolated home. The fixture now restores the normal home for its patch worker while retaining the app's isolated profile, Codex home and dummy keychain. Signing through the real worker entry point from an isolated environment passed after this fix. These earlier manual attempts remain failed runs. The later 8576-to-8720 run disabled Chromium's mock-keychain flag and unlocked its dummy keychain before launch to check actual helper reads.

## 2026-09-11: official update observation and revision 6 installation

An independent observer recorded the official update from **26.901.51231 (8109)** to **26.903.71938 (8576)**. At **09:03:52 Asia/Shanghai**, the old app exited and the official app replaced the patched bundle. A new app process was present within **0.4 seconds** of the exit notification. The monitor remained at `waiting-for-exit`; no automatic patch preparation occurred during that update. Process sampling was every 500 ms, so this is not an exact launch or window-ready measurement.

The old app still contained revision 5: the earlier revision 6 installation had timed out waiting for normal quit. An older worker upgrade had also erased its successful-install baseline, disabling the fallback that adopts an already relaunched official update. The worker now preserves that baseline and can recover it from a checked installation record for a different build. Reviewed recipes cover build 8576's nested model settings and changed compact picker. Focused automatic, core, compact and relaunch tests passed; real-archive planning recognized all patch targets and passed the 12 gate cases.

The repair's first attempt finished preparation in about **19 seconds**, then timed out waiting for normal quit. After the app subsequently exited, the updated monitor installed revision **6** at **09:24:16**, retaining a backup of the official 8576 app. The reopened app reported the Sparkle 2.9.1 restart handoff **active** at **09:24:42**. Installed worker files matched the checkout, and the patched app passed deep signature verification with the same pinned signing certificate.

The user reported another `Codex Storage Key` authorization prompt on this patched launch. Keychain access rules were not changed. This verifies installation and loading of the handoff; the next official update using that handoff remains untested. No provider requests or relay changes were made.

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
## 2026-09-07: revision 6 preparation and update handoff

Preparing an isolated copy of **26.901.51231 (8109)** through an interactive one-shot LaunchAgent took **18.4 seconds**, including original verification, recognition, cloning, all patches, signing and final verification. The source fingerprint was unchanged and the candidate was removed without activation or launch. Before removing duplicate parsing and signature verification, the same preparation workload took **20.8 seconds**. These single measurements include cache and system-load variation; neither is a second full official-update run. The earlier 141.6-second update below used a throttled background monitor.

The actual bundled `objc-js` 1.5.0 bridge and Sparkle 2.9.1 classes loaded the native hook in an isolated process without initializing an updater or sending installation messages. A synthetic native connection verified that only a valid relaunch flag is changed after worker readiness, while other packets, disabled automation and a missing worker retain the original behavior. Targeted tests cover waiting for the old process and updater, reopening after rejection, cancelled quit, concurrent monitoring and refusing to launch pending recovery. Universal helpers were compiled; native execution was on arm64.

The next real official update remains untested. No provider, personal API credentials or Keychain item contents were used.

## 2026-09-07: official macOS update and automatic repatching, revision 5

The installed app updated from **26.901.41600 (7982)** to **26.901.51231 (8109)** through the official updater. The existing monitor reapplied revision **5** automatically, without a manual patch command. The user confirmed that the Fast controls returned; the final archive, transaction fingerprints and deep signature verification passed.

An independent observer recorded the update at **22:28:48 Asia/Shanghai**, automatic preparation starting at **22:28:54**, and patch installation completing at **22:31:29**. Preparation took **141.6 seconds** with the monitor's previous background CPU and I/O limits. The second exit-to-launch notification gap was **10.2 seconds**. The patcher's **2.1-second** closed interval ends when the open command returns and does not measure when the window is usable.

The second, patched launch requested `Codex Storage Key` access despite using the same signing certificate. Read-only inspection found a `cdhash:` partition list on the existing item, which is an additional authorization check beyond the designated requirement. No key contents were read and no access rules were changed. Persistent local signing therefore does not guarantee prompt-free updates.

Background throttling was subsequently removed and phase timestamps corrected. The complete update timings above describe the earlier monitor configuration, not the optimized configuration. Provider speed, billing and outgoing service tiers were not tested in this update run.

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
