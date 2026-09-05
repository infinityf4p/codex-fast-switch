# Contributing

Run the syntax checks and core tests before proposing a change. Changes to signing, transactions or compatibility rules also need the macOS transaction and UI tests on a locally installed original app.

For a new app build, verify its official signature, inspect the relevant functions locally, and review what changed before updating structural fingerprints. Preserve administrative Fast restrictions. Do not loosen matching until an unsupported build happens to pass. Test identifier renaming, changed semantics, duplicate matches, activation interruption and restoration.

Do not commit official app binaries, extracted frontend code, user profiles, credentials, relay endpoints, transaction directories or raw app logs. Unit fixtures must be independently written. A compatibility report should contain only the app version/build, CPU architecture, test results and relevant sanitized error messages.

The project does not provide an extension point for third-party downloaded patch rules. Review changes through GitHub pull requests. Use a Node version allowed by `package.json`; build the native helper with Xcode Command Line Tools on macOS.
