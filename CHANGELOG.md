# Changelog

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
