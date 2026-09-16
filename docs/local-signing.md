# Persistent local signing

Starting with 0.2.4, patches use one locally generated signing certificate per installation instead of an ad-hoc signature. The designated requirement binds the app identifier to that certificate. This preserves the designated requirement across updates, but the app's code hash still changes.

macOS can request access to `Codex Storage Key` again after an update, even when the certificate is unchanged and **Always Allow** was selected previously. File-based Keychain items can also have a partition list: macOS assigns self-signed apps a `cdhash:` partition that changes with the app's code hash. A stable designated requirement does not satisfy this separate check for future builds. The 2026-09-07 update test confirmed this limitation.

**Always Allow** authorizes the current build; **Allow** authorizes one access; **Deny** does not establish persistent access. The patch does not relax the item's access controls or unlock the user's login keychain.

## Optional persistent Storage helper (macOS)

To keep the process accessing the Keychain unchanged across app updates, run:

```sh
node cli.cjs keychain-enable
```

This installs `Codex Storage Access.app` inside the patcher's `storage` state directory and reapplies the patch. Continue opening Codex from its usual app icon. On first access, macOS may ask to authorize **Codex Storage Access** for **Codex Storage Key**. Select **Always Allow** to retain that authorization.

The helper's executable, signature, configuration and path are retained across ordinary app updates and worker reinstalls. A native bridge forwards only the app's Storage Key lookup to it. The helper checks the caller's installation path and certificate-bound code signature, reads that one existing item, and returns it through an anonymous pipe. It does not log the key or create a replacement if access fails. Other Keychain lookups retain the app's normal behavior.

The feature is opt-in. `restore` removes its integration by restoring the original app; the helper and signing identity remain in the state directory for reuse. Changing the helper itself, losing the signing identity, resetting the Keychain, or keeping it locked may require authorization again. Changes to the app's native storage implementation can require a patch update; this is not a guarantee for every future app version.

## Storage

The state directory contains `signing/identity.keychain-db`, a private password file, the public certificate and its record. A separate `signing-identity.json` pins the certificate across updates. These files remain outside the replaceable automatic worker and app backups.

The dedicated keychain is registered in the user's search list because `codesign` requires registration even with an explicit `--keychain`. Existing keychains, their access controls, the default keychain and system trust settings are not changed. The private key is non-extractable, restricted to signing, and accessible to `/usr/bin/codesign`. Passwords reach the native helper through stdin, never command arguments. Temporary generation files are removed after import.

Keep the identity directory and pin together when backing up the patcher's state. Missing, damaged or substituted identity material fails instead of generating a replacement or falling back to ad-hoc signing. Restoring the original app does not require the local signing identity. Certificates and private signing material are generated locally and excluded from release packages.

The state files are private to the current user. This is not isolation from malicious software running as that same user. The local certificate is not added as a system trust root and does not recreate the official OpenAI signing identity or its restricted Apple entitlements.

## Verification

`npm run test:signing` creates two different test programs with the same identifier and certificate-bound requirement. Both must decrypt the same dummy keychain item with all Keychain UI disabled. A third program with another certificate must be rejected. This test covers the explicit ACL created by the fixture, not an existing item's `cdhash:` partition restriction, and does not establish that real app updates will avoid authorization prompts. The test also verifies that missing identities are not regenerated and removes only its temporary keychains, restoring the original search list and default keychain.

The separate App UI test uses a mock Keychain and loopback API. Neither test reads the user's `Codex Storage Key` or real API credentials.

`npm run test:storage` uses a separate dummy item with Keychain UI disabled. It checks that two different client builds reuse the exact same helper, and rejects wrong paths, identifiers, certificates, missing helpers and modified helpers. This covers the helper's authorization boundary without accessing the user's stored key.

Apple describes Keychain identity tracking and explicit requirements in [TN2206](https://developer.apple.com/library/archive/technotes/tn2206/_index.html).
The additional partition classification is implemented in Apple's [Security client identification code](https://github.com/apple-oss-distributions/Security/blob/main/securityd/src/clientid.cpp#L254-L274).
