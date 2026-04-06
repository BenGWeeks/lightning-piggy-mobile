"""Fix LNbits IN_FLIGHT payment polling starvation (lnbits/lnbits#3917).

Adds exponential backoff in check_pending_payments() when a payment
remains pending, ramping from 0.5s to 30s max. Normal payments that
resolve quickly only see a 0.5s delay.
"""

with open("/app/lnbits/core/services/payments.py", "r") as f:
    content = f.read()

old = """        for i, payment in enumerate(pending_payments):
            payment = await update_pending_payment(payment)
            prefix = f"payment ({i+1} / {count})"
            logger.debug(f"{prefix} {payment.status} {payment.checking_id}")
            await asyncio.sleep(0.01)  # to avoid complete blocking"""

new = """        for i, payment in enumerate(pending_payments):
            payment = await update_pending_payment(payment)
            prefix = f"payment ({i+1} / {count})"
            logger.debug(f"{prefix} {payment.status} {payment.checking_id}")
            if payment.pending:
                # Exponential backoff for stuck IN_FLIGHT payments (#3917)
                _checks = getattr(payment, '_pending_checks', 0) + 1
                object.__setattr__(payment, '_pending_checks', _checks)
                backoff = min(30, 0.5 * (2 ** min(_checks, 6)))
                logger.debug(f"{prefix} pending, backoff {backoff:.1f}s")
                await asyncio.sleep(backoff)
            else:
                await asyncio.sleep(0.01)"""

if old in content:
    content = content.replace(old, new)
    with open("/app/lnbits/core/services/payments.py", "w") as f:
        f.write(content)
    print("Fix applied: exponential backoff on pending payments (0.5s → 30s)")
else:
    if "pending_checks" in content:
        print("Fix already applied")
    else:
        print("ERROR: Could not find target code to patch")
        # Show what's actually there for debugging
        import re
        match = re.search(r'for i, payment in enumerate\(pending_payments\).*?asyncio\.sleep', content, re.DOTALL)
        if match:
            print(f"Found similar code at position {match.start()}")
            print(match.group()[:200])
