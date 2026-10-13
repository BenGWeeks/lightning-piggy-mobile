# Legacy on-chain import-method screenshot evidence

PR #1442 has a conditional visible effect: a seed wallet whose metadata lacks
`onchainImportMethod` becomes eligible for Send and Move after hydration classifies
it as `mnemonic`. A wallet without stored signing material becomes `xpub` and stays
watch-only. Explicit import methods are unchanged.

On 13 October 2026, hulk1 (`127.0.0.1:5565`) was checked on `origin/main`
(`dd2650fc`). Its active Big Piggy account displayed Add Wallet and the empty-wallet
welcome screen, with Receive, Move and Send disabled. There was no legacy on-chain
wallet available for a meaningful before/after comparison.

No fixture was created, no wallet metadata was edited, and no account was switched.
Screenshots of an unrelated empty screen would not demonstrate the migration, so
none are included. The PR's automated migration and hydration tests remain the
available evidence; device verification of the legacy-wallet transition is still
outstanding.
