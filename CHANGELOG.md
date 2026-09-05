# Changelog

## Unreleased

- Rename the standalone Windows installer to install.cmd and add uninstall.cmd, with matching download links and one-command PowerShell entries in both READMEs.
- Combine Windows installation, monitor setup and app launch; avoid restarting a current local copy unnecessarily.
- Add complete Windows uninstall: normal Quit, Startup removal, worker shutdown, owned-file cleanup and return to the original app. Preserve Codex's personal profile. These changes have not been tested locally.
- Sync the Windows Fast UI with macOS v0.2.4: filled Fast glyph, full model names, purple Ultra effort and native compact picker spacing and chevron.
- Track Windows patch revisions so the updated installer upgrades existing copies and enabled monitors without requiring an official app update. This UI revision has not been tested locally.
- Add Windows Owl runtime support with automatic Store discovery, local app copies, normal close/reopen, and double-click commands.
- Add a standalone one-click Windows script with an embedded, hash-checked package and automatic temporary extraction.
- Fix Windows restart timeouts caused by close-to-tray behavior: restore the same application profile and invoke Ctrl+Q after process and focus checks. Record failed operation details for diagnosis.
- Update the Windows PE integrity resource through resedit, preserve other resources and executable sections, and remove the copy's invalid Authenticode signature.
- Keep the original Store installation unchanged; publish complete local generations through an atomic launch-target record.
- Add optional per-user Startup monitoring, Windows packaging and CI, interruption tests, and an isolated Windows UI probe.
- Fix Windows ASAR entry separators and directory-fsync incompatibility in shared core code.

## 0.2.4

- Keep a persistent local signing identity so subsequent patches retain the same Keychain identity instead of changing with each ad-hoc signature.
- Prepare signing before quitting the app, preserve the identity across worker updates, and refuse silent certificate replacement if its files are lost or damaged.
- Add an isolated Keychain test proving authorization reuse across different builds and rejection of another certificate. The first migration still requires the user's macOS authorization.

## 0.2.3

- Match the native compact model control with full model names, a filled Fast icon, purple Ultra effort and a dropdown chevron.
- Preserve the selected model, effort and service tier across both compact control variants.

## 0.2.2

- Add an online one-command installer that downloads the latest release and checks its SHA-256 digest.
- Add Install or Update.command and `setup` to enable automatic patching, apply the patch, and reopen the app in one operation.
- Preserve the existing no-restart behavior when the current patch is already installed.

## 0.2.1

- Use the app's filled lightning glyph for Fast in both collapsed model-picker layouts.
- Upgrade existing patches through their original backup when the patch revision changes.
- Include the fix that prevents repeated restart commands from bouncing an already patched app.

## 0.2.0

- Add Apply and Restart.command: normal quit, patch, and reopen the existing app.
- Remove the fixed update-stability wait and automatic temporary-app UI verification.
- Listen for macOS app-exit events, with a 10-second fallback poll.
- Preserve original backups and interruption recovery; reopen the original after a failed restart operation when recovery is complete.
- Keep UI verification as an explicit developer test. Recognize app 26.901.41600 (7982).

## 0.1.0

- Enable native Fast controls and priority request forwarding for API-key authentication.
- Match reviewed whole-function structures across compatible bundler changes.
- Verify real Speed UI behavior against a local mock with isolated credentials.
- Discover the app executable and a compatible verification model from the installed app.
- Support one-time patching, automatic monitoring, atomic replacement, interruption recovery and restoration.
- Include universal macOS helper source, independent core tests and opt-in app-copy integration tests.
