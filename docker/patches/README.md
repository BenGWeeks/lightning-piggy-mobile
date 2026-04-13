# LNbits container hot-fix patches

These are **temporary** patched copies of files inside a running LNbits docker container. Each file corresponds to a pending upstream PR — once the PR merges and we update to an LNbits release that includes it, the matching patch here can be removed.

## Why these exist

Three independent event-loop-starvation bugs in upstream LNbits caused NWC (`pay_invoice`, `list_transactions`, `get_balance`) to time out on our wallet. Each is fixed upstream in a draft PR but not yet released.

| Patched file | Fixes | Upstream PR |
|---|---|---|
| `lnbits_wallets_lndrest.py` | IN_FLIGHT payment polling hot-loop — 100 checks/sec starved the event loop | [lnbits/lnbits#3918](https://github.com/lnbits/lnbits/pull/3918) |
| `lnbits_core_services_nostr.py` | `send_nostr_dm` blocked on synchronous websocket calls to unreachable relays | [lnbits/lnbits#3925](https://github.com/lnbits/lnbits/pull/3925) |
| `lnbits_extensions_nwcprovider_tasks.py` | `list_transactions` blocked on synchronous `bolt11_decode` in a loop | [lnbits/nwcprovider#37](https://github.com/lnbits/nwcprovider/pull/37) |

## Applying

Set `LNBITS_HOST` (and optionally `LNBITS_CONTAINER`, default `lnbits`) and run `./apply.sh` from this directory:

```sh
LNBITS_HOST=my-host LNBITS_CONTAINER=lnbits ./apply.sh
```
 It `docker cp`s each patched file over the corresponding path inside `lnbits-family` and restarts the container.

The container's writable layer persists `docker cp` changes across restarts, but **not** across `docker pull` + `docker run` (image replacement). Re-run `apply.sh` after any LNbits version upgrade until all three PRs are merged.

## Updating this folder

If you edit any of these patches:

1. Edit the file here
2. Run `./apply.sh`
3. Also push the same change to the corresponding upstream PR branch so the two don't drift

## Removing a patch

When a PR merges and you've updated LNbits to a version that includes it:

1. Delete the corresponding `.py` file from this folder
2. Remove its line from `apply.sh`
3. Update the table above
