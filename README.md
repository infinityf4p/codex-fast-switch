# Codex Fast Switch

[简体中文](README.zh-CN.md)

Enable the existing **Standard / Fast** control in the Codex desktop app when using API-key authentication. Keep opening the usual app icon. An optional macOS LaunchAgent reapplies compatible patches after app updates, while the app is closed.

This is an independent, unofficial patch. It does not provide OAuth access, priority capacity, or a subscription. Your API provider must support the requested model and `service_tier: "priority"`; speed and pricing depend on that provider.

## Compatibility

- **macOS only**, macOS 13 or newer and an APFS volume with clone support. The official app may require a newer OS.
- Apple Silicon has been tested. The helper also builds for Intel; Intel end-to-end behavior is unverified. Patching is unsupported on Windows and Linux; CI also exercises the portable core on Linux.
- The current patch is verified on **26.901.41600 (7982)**, bundle ID `com.openai.codex`. Earlier releases also tested **26.901.41123 (7942)**. It can be named `Codex.app` or `ChatGPT.app`; a consumer ChatGPT bundle with a different ID is rejected.
- The selected model must have priority metadata in the app's built-in catalog. Arbitrary provider aliases are not automatically supported.
- New builds are accepted when all three complete function structures and the Fast icon components remain recognizable. Changed filenames, identifier names, whitespace and quote styles can be tolerated. Arbitrary future updates are not guaranteed.

## Install

Run this command to download and install or update the latest release:

```sh
curl -fsSL https://github.com/infinityf4p/codex-fast-switch/releases/latest/download/install.sh | /bin/sh
```

The script checks the release ZIP's SHA-256 digest, installs automatic patching, requests a normal quit, applies the patch, and reopens the app. An already current patch is left running. You can inspect [install.sh](install.sh) before running it.

Alternatively, download the macOS ZIP from [Releases](https://github.com/infinityf4p/codex-fast-switch/releases), unzip it, and double-click **Install or Update.command**. The package contains dependencies and a universal native helper. A suitable Node runtime is reused from your app, an earlier installation, or the system; Node and the official app are not redistributed.

There is no fixed stability delay or temporary-app UI test during installation. Use **Settings > General > Speed** after it reopens. Fast uses the app's bundled filled lightning glyph in both collapsed model controls. Older patch revisions are upgraded through their matching original backup. Check Status.command shows the result.

The automatic monitor listens for app exit events and applies compatible patches after future updates. A 10-second fallback poll covers missed events; it does not impose a delay on the restart command. If you manually reopen while a patch is being made, the monitor waits for another exit. Apply and Restart.command coordinates the entire sequence.

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
node cli.cjs setup
```

Use `node cli.cjs restart` for one-time patching with automatic quit and reopen, or `install` when the app is already closed. To select another app location:

```sh
node cli.cjs setup --app "/path/to/Codex.app"
node cli.cjs status
node cli.cjs restore
```

`--state PATH` selects a different backup directory; use that same flag for status, disable and restore. One automatic service is supported per macOS account. The legacy `--model` option is accepted for compatibility but installation no longer runs a model probe.

The current user must be able to write to the app's parent directory. The app and backup directory must be on the same filesystem for atomic exchange. The installer does not elevate itself or change ownership.

## Patching and recovery

1. Verify the original app's full code signature against the expected bundle ID and OpenAI signing team.
2. Find three unique whole-function AST fingerprints and the Fast icon fingerprints, then verify the transformed structures. Reuse the app's bundled filled glyph for the legacy collapsed control. Existing `fast_mode = false` policy restrictions remain effective.
3. Exercise API-key, ChatGPT and absent authentication across blocked/loading states: 12 cases, each checked against both UI and request gates.
4. Clone the complete app, patch the archive with integrity hashes, and sign the copy locally.
5. Confirm the original is still closed and unchanged, then atomically exchange complete bundles and retain the original backup.

Installation does not contact your relay or send model requests. The optional developer UI test checks Fast and Standard requests against a loopback mock. It is separate from installation and does not prove a TPS improvement. See [validation details](docs/validation.md).

If recognition or patching fails, the current original stays in place. If activation fails, recovery attempts to restore the original from **that same app version**. The restart command reopens the preserved or restored app after a failure. An interrupted transaction is recovered on a later run. If recovery is pending or a backup is missing, it reports the problem. Quit requests are normal macOS requests and never force termination. Failed builds are not retried automatically until their files change or you re-enable monitoring; an explicit restart command can retry immediately.

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
npm run test:restart       # normal quit, patch, reopen and exit observer on a copy
npm run test:e2e           # macOS GUI session, visible test window, copies only
npm run test:launchagent   # temporary uniquely named service, removed afterward
npm run package            # macOS release ZIP + SHA-256
```

Set `CODEX_FAST_TEST_APP` to test a specific original bundle. Core tests use independent synthetic code, not proprietary app fixtures. CI checks the core on Linux and macOS and builds/tests the native swap helper on macOS. It does not download or launch the official app. See [tested builds](docs/tested-builds.md) for the local integration results.

There is no rule download or patch self-update. Support for substantive new app code requires a reviewed project update. See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). A `busy` result means another operation holds the lock; let it finish and retry.

MIT license for this project's code. Third-party dependencies retain their licenses; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). OpenAI and Codex are trademarks of their respective owners; this project is not affiliated with OpenAI.
