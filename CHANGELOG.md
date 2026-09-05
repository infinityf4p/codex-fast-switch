# Changelog

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
