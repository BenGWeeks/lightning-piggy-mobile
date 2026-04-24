"""Fix nwcprovider `_process_invoice` tight-loop flood.

Root cause in upstream `lnbits/nwcprovider` (file: `tasks.py`,
function: `_process_invoice`): the post-pay wait-for-preimage loop
only exits on `.success`, so any NWC `pay_invoice` that resolves to
`.failed` (e.g. LND's FAILURE_REASON_INCORRECT_PAYMENT_DETAILS on an
expired invoice) re-queries `check_transaction_status` every 50 ms
indefinitely, until the client disconnects or the container restarts.

Observed symptom: continuous ~20/s `LNDRest Payment failed: …` log
lines with no `checking_id` for hours after the underlying payment
was already persisted as `status=failed` in the DB.

Upstream is unpatched as of 2026-04-24 (no issue, no PR). Vanilla
nwcprovider `tasks.py` on lnbits/nwcprovider main has identical
code. Local patch just adds a `.failed` break and a bounded
300 s deadline — minimal, reversible, preserves the existing
return shape.

Run inside the lnbits-family container (same shape as
`apply_nip20_fix.py` / `fix_lnbits_inflight.py`):

    docker cp scripts/fix_nwcprovider_pay_loop.py lnbits-family:/tmp/
    docker exec lnbits-family python3 /tmp/fix_nwcprovider_pay_loop.py
    docker restart lnbits-family

Idempotent — running it twice is a no-op.
"""

import sys

PATH = "/app/lnbits/extensions/nwcprovider/tasks.py"

with open(PATH, "r") as f:
    content = f.read()

# The exact vanilla-upstream block we expect to replace.
OLD = '''    wait_for_preimage = (
        True  # currently required by nip 47 specs, might change in future
    )
    payment_status: PaymentStatus | None = None
    while wait_for_preimage:
        payment_status = await check_transaction_status(wallet_id, payment_hash)
        if payment_status.success:
            break
        await asyncio.sleep(0.05)'''

# Replacement: exit on `.failed`, bound the wait to 300 s. Existing
# return-shape below the loop already handles payment_status.paid=False
# correctly, so a graceful `.failed` exit just drops through.
NEW = '''    wait_for_preimage = (
        True  # currently required by nip 47 specs, might change in future
    )
    payment_status: PaymentStatus | None = None
    # Local patch: break on .failed (previously only broke on .success,
    # causing a 20 RPS flood of get_payment_status queries against the
    # funding source when a payment resolves to failed). Also apply a
    # hard deadline as a defence-in-depth against any other stuck state.
    # See scripts/fix_nwcprovider_pay_loop.py docstring.
    import time as _time
    _deadline = _time.monotonic() + 300
    while wait_for_preimage:
        payment_status = await check_transaction_status(wallet_id, payment_hash)
        if payment_status.success:
            break
        if payment_status.failed:
            break
        if _time.monotonic() > _deadline:
            break
        await asyncio.sleep(0.05)'''

MARKER = "Local patch: break on .failed"

if MARKER in content:
    print("Already patched — no-op.")
    sys.exit(0)

if OLD not in content:
    print("ERROR: could not find the expected vanilla block in", PATH)
    print(
        "       upstream nwcprovider/tasks.py may have changed shape. "
        "Re-derive the patch against the current source."
    )
    sys.exit(1)

content = content.replace(OLD, NEW)
with open(PATH, "w") as f:
    f.write(content)
print("Patch applied:", PATH)
