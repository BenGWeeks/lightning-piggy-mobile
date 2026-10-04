# On-chain connection checks (#1112)

Public screenshots are captured with Android's native `screencap` through Maestro on Warmachine's **Lightning Piggy API 34 emulator**, `lightningpiggy_api34` / `emulator-5554`. They are not from Satmo or the physical Pixel. All addresses shown are public defaults or intentionally invalid public examples. No credentials, private family server addresses or funded wallets are shown.

`01-before-keyboard-cycles.png` is the unmodified merged-main Preview (7fd55430), after three opens and dismissals of the Electrum field keyboard. The white bottom strip is visible.

Connection tests read only the Electrum chain tip or the two Boltz BTC pair endpoints. They do not sync wallets, create swaps or transfer money. A green result means that explicit check succeeded; it is not a permanent availability indicator.

`02-after-keyboard-cycles.png`, `03-electrum-verified.png`, `04-public-boltz-failed.png` and `05-electrum-checking.png` come from this PR's actual full-app Preview at commit `54700b9752226c3eca2cf44f8711035a81530bdb`. The installed APK SHA-256 is `989f26bac9a5289da008ed7ae9c82dfaad3c22468e0096514ec4e89b691bda93`. No mocked UI or network responses were used.

The three keyboard open/close cycles completed again on this build. The gradient reaches the gesture navigation area; the old white strip is gone. The configured public Electrum SSL endpoint returned a valid chain tip and the green verified result. The public default Boltz endpoint produced the shown retryable connection failure; that image is not a successful Boltz connection. `maestro-validation.txt` records the assertions and captures.

`06-electrum-invalid-draft.png` shows a deliberate invalid character inserted into the public Electrum address. The old green check disappears immediately and the new check shows a failure. The second strict Maestro flow also checked a deliberately invalid Boltz draft, cleared its error by resetting the draft, and restarted the app to reload the unchanged stored public settings. All assertions passed; see `maestro-error-validation.txt`.
