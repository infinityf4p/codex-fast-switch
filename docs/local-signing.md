# Persistent local signing

Starting with 0.2.4, patches use one locally generated signing certificate per installation instead of an ad-hoc signature. The designated requirement binds the app identifier to that certificate. Updated app contents change the code hash while preserving the identity tracked by Keychain access controls.

The first launch after migrating from an ad-hoc patch can still request access to `Codex Storage Key`. Choose **Always Allow** in the macOS prompt to authorize the new identity. Choosing Allow authorizes one access; choosing Deny does not establish persistent access. This change does not remove the initial authorization requirement, unlock the user's login keychain, or suppress unrelated macOS permission prompts.

## Storage

The state directory contains `signing/identity.keychain-db`, a private password file, the public certificate and its record. A separate `signing-identity.json` pins the certificate across updates. These files remain outside the replaceable automatic worker and app backups.

The dedicated keychain is registered in the user's search list because `codesign` requires registration even with an explicit `--keychain`. Existing keychains, their access controls, the default keychain and system trust settings are not changed. The private key is non-extractable, restricted to signing, and accessible to `/usr/bin/codesign`. Passwords reach the native helper through stdin, never command arguments. Temporary generation files are removed after import.

Keep the identity directory and pin together when backing up the patcher's state. Missing, damaged or substituted identity material fails instead of generating a replacement or falling back to ad-hoc signing. Restoring the original app does not require the local signing identity. Certificates and private signing material are generated locally and excluded from release packages.

The state files are private to the current user. This is not isolation from malicious software running as that same user. The local certificate is not added as a system trust root and does not recreate the official OpenAI signing identity or its restricted Apple entitlements.

## Verification

`npm run test:signing` creates two different test programs with the same identifier and certificate-bound requirement. Both must decrypt the same dummy keychain item with all Keychain UI disabled. A third program with another certificate must be rejected. The test also verifies that missing identities are not regenerated and removes only its temporary keychains, restoring the original search list and default keychain.

The separate App UI test uses a mock Keychain and loopback API. Neither test reads the user's `Codex Storage Key` or real API credentials.

Apple describes Keychain identity tracking and explicit requirements in [TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html).
