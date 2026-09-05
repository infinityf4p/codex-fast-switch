# Security

For vulnerabilities involving credential exposure, unintended code execution, signature validation, backup integrity or arbitrary file replacement, use the repository's private vulnerability reporting when available. Do not post secrets, complete application bundles or user state in public issues.

Compatibility failures without sensitive data can be reported as public issues with the app version, operating system, architecture and a sanitized error. Do not attach raw app logs by default.

The patch changes a signed application and runs with the current user's permissions. It does not provide isolation from malicious software running as the same user. Backups and transaction records must remain trusted. The local UI verifier strips inherited credentials and provider/proxy overrides, but it is not an OS network sandbox.
