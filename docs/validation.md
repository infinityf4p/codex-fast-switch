# Validation boundaries

The release targets the code shape reviewed in app 26.901.41123, build 7942. Structural tests simulate renamed variables, quote changes and split chunks; they are not evidence about unreleased app builds.

## What an installation verifies

The original app passes `codesign --verify --deep --strict` with an inline requirement for bundle ID `com.openai.codex` and signing team `2DC432GLL2`. The requirement begins with `=` so codesign parses it as an expression.

Acorn parses packed JavaScript under `webview/`. Each entire target function must match a bundled fingerprint. Normalization removes locations and normalizes identifier spelling and literal quote style. It keeps operators, control flow, property names and values. Duplicate or missing targets are rejected. The transformed functions must match separate reviewed hashes. Isolated VM tests verify API-key and ChatGPT eligibility, absent authentication, loading state and `fast_mode = false` restrictions.

The app copy uses a temporary HOME, CODEX_HOME, working directory and Electron profile. The child environment is built from an allowlist, excluding API credentials, Node injection options, proxy settings and inherited provider overrides. Auth is explicitly file-based with a dummy local key. Model discovery uses the bundled backend's `model/list` protocol and requires reported `priority` capability. It does not read the user's real model configuration.

The test uses CDP over inherited pipes, not a listening debugging port. CDP reads DOM state and dispatches normal mouse/keyboard input; it does not inject a patch into the renderer. English onboarding and Settings are currently expected. A changed layout, locale override or missing control causes a timeout and prevents activation.

The test selects Fast, creates a new task, receives a complete local mock response, then repeats for Standard. It checks saved config and outgoing request bodies. All test model requests use a loopback HTTP server. Additional title-generation requests can also reach that mock.

## What this does not verify

- It does not contact or validate a user's relay or prove real speed, routing, capacity or prices.
- It does not prove zero external network traffic. App update checks, telemetry and other non-model requests are outside the mock's coverage. Analytics and backend update checks are disabled where supported, but no OS network filter is installed.
- It does not test every app feature, OAuth, Apple services or persistence in already existing tasks.
- It does not guarantee compatibility with future versions or with Intel Macs.
- Atomic exchange and durable records address process interruption. They are not a guarantee against disk corruption, deleted backups, loss of power at every filesystem boundary, or another updater modifying files continuously.

## Recovery states

`prepared` records the verified original and staged copy before exchange. `activated` records the displaced original in its backup location. `installed` records a verified final app. Interrupted `prepared`, `activated` and `rollback-pending` states are considered for recovery before another attempt.

The recovery path verifies backup identity and signature and refuses to replace an unrelated app update. If the original is already in place, it records an aborted transaction. If the patched app is running, it waits for exit. Failed builds are suppressed until a file-stamp change or explicit re-enable. Error messages and status remain available in the state directory; the native error dialog dismisses after 30 seconds.
