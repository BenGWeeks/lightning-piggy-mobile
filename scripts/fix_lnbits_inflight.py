"""Fix LNbits IN_FLIGHT payment hot-loop (lnbits/lnbits#3917, PR #3918).

When get_payment_status() receives IN_FLIGHT from LND's TrackPaymentV2
stream, stay in the stream loop instead of returning immediately.
LND pushes the final status through the same stream — no polling needed.

Also adds a 300s timeout to prevent hanging forever.
"""

with open("/app/lnbits/wallets/lndrest.py", "r") as f:
    content = f.read()

old = '''                elif status == "IN_FLIGHT":
                    logger.info(f"LNDRest Payment in flight: {checking_id}")
                    return PaymentPendingStatus()'''

new = '''                elif status == "IN_FLIGHT":
                    # Stay in the stream loop — LND will push the final
                    # status (SUCCEEDED/FAILED) when the payment resolves.
                    # No polling needed; the event loop is free while we
                    # await the next line from the stream. See #3917.
                    logger.info(f"LNDRest Payment in flight: {checking_id}")
                    continue'''

if old in content:
    content = content.replace(
        'async with self.client.stream("GET", url, timeout=None) as r:',
        'async with self.client.stream("GET", url, timeout=300) as r:'
    )
    content = content.replace(old, new)
    with open("/app/lnbits/wallets/lndrest.py", "w") as f:
        f.write(content)
    print("Fix applied: continue on IN_FLIGHT + 300s stream timeout")
elif "continue" in content and "IN_FLIGHT" in content and "await asyncio.sleep" not in content:
    print("Fix already applied")
else:
    # Check for v2 fix (asyncio.sleep version) and upgrade to continue
    old_v2 = '''                elif status == "IN_FLIGHT":
                    logger.info(f"LNDRest Payment in flight: {checking_id}")
                    await asyncio.sleep(30)  # backoff: avoid hot-loop (#3917)
                    return PaymentPendingStatus()'''
    if old_v2 in content:
        content = content.replace(old_v2, new)
        content = content.replace(
            'async with self.client.stream("GET", url, timeout=None) as r:',
            'async with self.client.stream("GET", url, timeout=300) as r:'
        )
        with open("/app/lnbits/wallets/lndrest.py", "w") as f:
            f.write(content)
        print("Upgraded from asyncio.sleep to continue + 300s timeout")
    else:
        print("ERROR: Could not find target code to patch")
