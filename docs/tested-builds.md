# Tested builds

## 2026-09-05: direct restart, 0.2.0

Local verification used **26.901.41600 (7982)** on **arm64**.

- Core and native tests: 22 passed.
- Transaction and interruption tests: 12 passed at **08:50:37 UTC**, including default installation without a UI probe.
- Optional UI test passed at **08:58:46 UTC**: `gpt-6-astra` sent `priority` for Fast and omitted the tier for Standard, with complete local mock responses.
- The normal quit, patch, and reopen test passed at **09:00:21 UTC**, using the same isolated profile before and after patching. The reopened window loaded and the macOS exit notification arrived. Installation did not invoke the UI checker.
- Time from exit to the reopened test window loading: **38.6 seconds**. This includes patching and window startup, with no fixed stability wait; it is not a guarantee of startup time on other machines.
- The test copy was restored and the installed official app remained unchanged throughout the tests.

The restart test uses a reachable loopback mock and the bundled backend's model metadata. No relay, user credentials, or server changes are involved. Intel remains unverified.

## 2026-09-05: initial release

Local verification used the official macOS app **26.901.41123 (7942)** on **arm64**.

| Check | Result |
| --- | --- |
| Source syntax and JSON | Passed |
| Core and native tests | 15 passed |
| Transaction and process-interruption checks | 12 passed |
| Automatic monitor, real UI, activation and restoration on a copy | Passed |
| Copied Node runtime started by a temporary LaunchAgent | Passed; test service removed |
| Installed official app identity after integration tests | Unchanged |

The UI test completed at **2026-09-05 06:54:51 UTC**. Model discovery selected `gpt-5.6-sol` from the bundled backend. A new Fast task sent `priority` to the loopback mock; a new Standard task omitted the field. Both received complete mock replies. Additional title requests used the same mock. The original signature was restored on the test copy.

Transaction checks completed at **2026-09-05 06:57:08 UTC**. They injected thrown failures and process exits at prepared, exchanged and activated phases, checked subsequent recovery, idempotency and refusal to overwrite a changed app. The UI checker was stubbed for fault injection; actual UI verification ran separately.

No relay credentials or private server were involved. These results do not measure real API throughput. The universal helper was compiled for arm64 and x86_64; only arm64 execution was tested. Later CI results are available in the repository's Actions tab.
