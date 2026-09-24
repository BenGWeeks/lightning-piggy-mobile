# Private-backend repeat validation — 24 September 2026

Real mainnet tests on Warmachine's `lightningpiggy_api34` Android API34 emulator (`emulator-5554`), using the configured private Boltz v2 backend. No public fallback. No simulator mocks or constructed screenshots. The private endpoint and credentials are omitted.

| Run | Direction | Invoice | Outcome |
| --- | --- | ---: | --- |
| 20 September | Bitcoin → Lightning | 10,000 sats | `transaction.claimed`, wallet credited 10,000 |
| 24 September, first | Lightning → Bitcoin | 11,000 sats | `invoice.settled`, Bitcoin output 10,307 sats |
| 24 September, second | Bitcoin → Lightning | 10,000 sats | `transaction.claimed`, wallet credited 10,000 |
| 24 September, repeat | Lightning → Bitcoin | 11,000 sats | `invoice.settled`, Bitcoin output 10,066 sats |

The final repeat ran app code `207af865`. The earlier 24 September reverse and submarine were initiated with `850ea431`; recovery/receipt was checked after updating the app. Tests preserved app data. This is repeat coverage across review revisions, not four runs of the latest commit.

Final reverse: 11,000-sat invoice, 55-sat routing fee (Coinos balance 23,967 → 12,912), 10,606-sat server lockup, 540-sat claim fee, 10,066-sat Bitcoin output. Claim broadcast retried automatically while the parent propagated and then succeeded. Core independently accepted the claim; Boltz settled the hold invoice. Claim confirmation remained pending when the completion screenshot was captured.

The second submarine waited for Bitcoin confirmation because zero-confirmation acceptance was rejected; it subsequently completed. Both earlier 24 September transactions had 16 confirmations when rechecked. An earlier failed/unpaid route attempt and a rejected stale quote are not counted as successful swaps.

Total gross test movement including initial funding and fees: **58,382 sats**, below the authorized 60,000. Claim fees are inside reverse invoice debits, not counted twice. No new channel or extra funding was used. The bounded test approval window was closed and its worker stopped after the final repeat; this does not enable unrestricted family use.

Screenshots are original captures:
- `06-submarine-repeat-received.png`: 10,000-sat receipt and Coinos 23,967-sat balance.
- `07-reverse-repeat-complete.png`: current completion message, Coinos 12,912-sat balance.
- `08-repeat-history.png`: two Lightning debits and two incoming swap payments.

Remaining UI observation: opening the latest Coinos outgoing transaction's detail sheet showed a generic `Pending` badge despite the backend settlement and accepted Bitcoin claim. The Move completion panel was correct. This history/detail discrepancy remains to investigate; screenshots and backend results do not claim all transaction-detail states are fixed. Physical Graphene/iOS behavior and interruption/provider-switch scenarios are not established by these runs.
