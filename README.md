# Codex Fast Switch

[简体中文](README.zh-CN.md)

Enable the existing **Standard / Fast** control in the Codex desktop app when using API-key authentication. Keep opening the usual app icon. An optional macOS LaunchAgent reapplies compatible patches after app updates, while the app is closed.

This is an independent, unofficial patch. It does not provide OAuth access, priority capacity, or a subscription. Your API provider must support the requested model and `service_tier: "priority"`; speed and pricing depend on that provider.

## Compatibility

- **macOS only**, macOS 13 or newer and an APFS volume with clone support. The official app may require a newer OS.
- Apple Silicon has been tested. The helper also builds for Intel; Intel end-to-end behavior is unverified. Patching is unsupported on Windows and Linux; CI also exercises the portable core on Linux.
- Verified app: **26.901.41123, build 7942**, bundle ID `com.openai.codex`. It can be named `Codex.app` or `ChatGPT.app`; a consumer ChatGPT bundle with a different ID is rejected.
- The selected model must have priority metadata in the app's built-in catalog. Arbitrary provider aliases are not automatically supported.
- New builds are accepted only when all three complete function structures remain recognizable and the patched copy passes UI verification. Changed filenames, identifier names, whitespace and quote styles can be tolerated. Arbitrary future updates are not guaranteed.

## Install

Download the macOS ZIP from [Releases](https://github.com/infinityf4p/codex-fast-switch/releases), unzip it, and run **Enable Automatic Fast.command**. The package contains dependencies and a universal native helper. It uses a suitable Node runtime from your installed app or system; Node itself and the official app are not redistributed.

Quit the official app with Command-Q. The monitor checks once a minute, waits for the update to settle, then verifies a temporary app copy. **That copy may briefly display an onboarding window and change focus.** Let verification finish before opening the official app again. Check Status.command shows the result. After activation, open the usual app and use **Settings > General > Speed**.

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
node cli.cjs enable
```

Use `node cli.cjs install` for one-time patching. To select another app location:

```sh
node cli.cjs enable --app "/path/to/Codex.app"
node cli.cjs status
node cli.cjs restore
```

`--model ID` selects the **local verification model only**. By default it is chosen from priority-capable models reported by the bundled backend. No user's model, API URL or credentials are copied into the probe. `--state PATH` selects a different backup directory; use that same flag for status, disable and restore. One automatic service is supported per macOS account.

The current user must be able to write to the app's parent directory. The app and backup directory must be on the same filesystem for atomic exchange. The installer does not elevate itself or change ownership.

## Verification and recovery

1. Verify the original app's full code signature against the expected bundle ID and OpenAI signing team.
2. Find three unique whole-function AST fingerprints and verify the transformed fingerprints. Existing `fast_mode = false` policy restrictions remain effective.
3. Exercise API-key, ChatGPT and absent authentication across blocked/loading states: 12 cases, each checked against both UI and request gates.
4. Clone the complete app, patch the archive with integrity hashes, and sign the copy locally.
5. Launch the copy with a temporary home, file-based dummy credentials and a local mock Responses endpoint. Use the real UI to select Fast and Standard, confirm saved settings, inspect both outgoing requests and complete mock responses.
6. Recheck that the original has not changed and is closed. Atomically exchange complete bundles and retain a verified original backup.

Fast must send `service_tier: "priority"`; Standard must omit the tier for new tasks. The probe does not test your relay, bill your API account, or prove a TPS improvement. It is **not a network sandbox**: the desktop app may still make non-model requests such as update checks or telemetry. See [validation details](docs/validation.md).

If recognition or UI testing fails, the current original stays in place. If activation fails, recovery attempts to restore the original from **that same app version**. An interrupted transaction is recovered on a later run. If the app is running or a backup is missing, recovery waits or reports the problem; it does not force-quit your app or overwrite an unrelated update. Failed builds are not retried until their files change or you explicitly re-enable monitoring. Re-enabling runs the same checks.

## Signing and storage

The patched app has an **ad-hoc signature**, replacing the original root signature. Restricted Apple entitlements are omitted and library validation is disabled for the local patch. This can affect Keychain access, push notifications, app groups, permissions, and future updater behavior. Only startup and the Speed workflow have been tested. Restore before reporting issues to OpenAI or installing an update that rejects the modified app.

State, logs, worker code, a copied runtime, and full app backups live in:

```text
~/Library/Application Support/Codex Fast Switch/
~/Library/LaunchAgents/io.github.infinityf4p.codex-fast-switch.plist
```

Backups are retained and can consume several GB over time. Restore and disable first before removing the state directory. Do not delete the active original backup while the app is patched. Earlier private **Codex Fast Patch** packages use a different state directory and must be restored with their original package first.

## Development

```sh
npm run check
npm run build              # macOS, universal native helper
npm test
npm run test:transactions  # macOS, installed supported app, copies only
npm run test:e2e           # macOS GUI session, visible test window, copies only
npm run test:launchagent   # temporary uniquely named service, removed afterward
npm run package            # macOS release ZIP + SHA-256
```

Set `CODEX_FAST_TEST_APP` to test a specific original bundle. Core tests use independent synthetic code, not proprietary app fixtures. CI checks the core on Linux and macOS and builds/tests the native swap helper on macOS. It does not download or launch the official app. See [tested builds](docs/tested-builds.md) for the local integration results.

There is no rule download or patch self-update. Support for substantive new app code requires a reviewed project update. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). A `busy` result means another operation holds the lock; let it finish and retry.

MIT license for this project's code. Third-party dependencies retain their licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). OpenAI and Codex are trademarks of their respective owners; this project is not affiliated with OpenAI.
