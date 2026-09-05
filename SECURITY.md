# Security

For vulnerabilities involving credential exposure, unintended code execution, signature validation, backup integrity or arbitrary file replacement, use the repository's private vulnerability reporting when available. Do not post secrets, complete application bundles or user state in public issues.

Compatibility failures without sensitive data can be reported as public issues with the app version, operating system, architecture and a sanitized error. Do not attach raw app logs by default.

The patch changes a signed application and runs with the current user's permissions. It does not provide isolation from malicious software running as the same user. Backups and transaction records must remain trusted. The local UI verifier strips inherited credentials and provider/proxy overrides, but it is not an OS network sandbox.

The persistent signing identity and its password file are private local state, not release artifacts. Do not upload the `signing` directory or include it in bug reports. Its non-extractable private key is restricted to signing through `/usr/bin/codesign`; it is not a system trust root. Missing or mismatched identity material must not be replaced silently. See [local signing](docs/local-signing.md) for the authorization and storage boundaries.
