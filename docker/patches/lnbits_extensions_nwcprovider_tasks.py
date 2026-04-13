import asyncio
import time
from math import ceil
from typing import Any

from bolt11 import decode as bolt11_decode
from lnbits.core.crud import get_payments, get_wallet, get_wallet_payment
from lnbits.core.models import Payment
from lnbits.core.services import (
    check_transaction_status,
    create_invoice,
    pay_invoice,
)
from lnbits.db import Filters
from lnbits.exceptions import PaymentError
from lnbits.settings import settings
from lnbits.wallets.base import PaymentStatus
from loguru import logger

from .crud import get_config_nwc, get_nwc, tracked_spend_nwc
from .execution_queue import execution_queue
from .models import GetNWC, NWCKey, TrackedSpendNWC
from .nwcp import NWCServiceProvider
from .paranoia import (
    assert_boolean,
    assert_sane_string,
    assert_valid_bolt11,
    assert_valid_expiration_seconds,
    assert_valid_msats,
    assert_valid_positive_int,
    assert_valid_pubkey,
    assert_valid_sha256,
    assert_valid_wallet_id,
)
from .permission import nwc_permissions


async def _check(nwc: NWCKey | None, method: str) -> dict | None:
    # check
    if not nwc:
        return {
            "code": "UNAUTHORIZED",
            "message": "This public key has no wallet connected.",
        }
    # check permissions
    allowed = False
    permissions = nwc.get_permissions()
    for p in permissions:
        permissions_data: dict[str, Any] = nwc_permissions.get(p, {})
        allowed_methods: list[str] = permissions_data.get("methods", [])
        if method in allowed_methods:
            allowed = True
            break
    if not allowed:
        return {
            "code": "RESTRICTED",
            "message": "This public key is not allowed to do this operation.",
        }
    return None


async def _process_invoice(
    wallet_id: str,
    pubkey: str,
    invoice: str,
    amount_msats: int,
    description: str | None = None,
):

    # hardening #
    assert_valid_wallet_id(wallet_id)
    assert_valid_pubkey(pubkey)
    assert_valid_bolt11(invoice)
    assert_valid_msats(amount_msats)
    if description:
        assert_sane_string(description)
    # ## #

    async def execute_payment() -> str:
        payment = await pay_invoice(
            wallet_id=wallet_id,
            payment_request=invoice,
            max_sat=ceil(amount_msats / 1000),
            description=description or "",
        )
        return payment.payment_hash

    payment_hash = None
    try:
        in_budget, payment_hash = await tracked_spend_nwc(
            TrackedSpendNWC(pubkey=pubkey, amount_msats=amount_msats), execute_payment
        )
        if not in_budget:
            error = {
                "code": "QUOTA_EXCEEDED",
                "message": "The wallet has exceeded its spending quota.",
            }
            return {"error": error, "in_budget": False}
    except PaymentError as e:
        status = e.status
        message = e.message
        if status == "failed":
            error = {"code": "PAYMENT_FAILED", "message": message}
            return {"error": error, "in_budget": False}
        else:
            raise e
    if not payment_hash:
        raise Exception("Payment hash not found")
    wait_for_preimage = (
        True  # currently required by nip 47 specs, might change in future
    )
    payment_status: PaymentStatus | None = None
    while wait_for_preimage:
        payment_status = await check_transaction_status(wallet_id, payment_hash)
        if payment_status.success:
            break
        await asyncio.sleep(0.05)
    if not payment_status:
        raise Exception("Payment status not found")
    return {
        "preimage": payment_status.preimage
        or "0000000000000000000000000000000000000000000000000000000000000000",
        "fee_msats": payment_status.fee_msat,
        "paid": payment_status.paid,
        "payment_hash": payment_hash,
        "in_budget": in_budget,
    }


async def _on_pay_invoice(
    sp: NWCServiceProvider, pubkey: str, payload: dict
) -> list[tuple[dict | None, dict | None, list]]:

    # hardening #
    assert_valid_pubkey(pubkey)
    # ## #

    nwc = await get_nwc(GetNWC(pubkey=pubkey, refresh_last_used=True))
    error = await _check(nwc, "pay_invoice")
    if error:
        return [(None, error, [])]
    if not nwc:
        raise Exception("Pubkey has no associated wallet")
    params = payload.get("params", {})
    invoice = params.get("invoice", None)
    # Ensures invoice is provided
    if not invoice:
        raise Exception("Missing invoice")
    invoice_data = bolt11_decode(invoice)
    amount_msats = int(invoice_data.amount_msat or 0)

    # hardening #
    assert_valid_bolt11(invoice)
    assert_valid_msats(amount_msats)
    # ## #

    res = await _process_invoice(
        nwc.wallet, pubkey, invoice, amount_msats, invoice_data.description
    )
    error = res.get("error")
    if error:
        return [(None, error, [])]
    preimage = res.get("preimage")
    out = {
        "preimage": preimage,
    }
    # await log_nwc(pubkey, payload)
    return [(out, None, [])]


async def _on_multi_pay_invoice(
    sp: NWCServiceProvider, pubkey: str, payload: dict
) -> list[tuple[dict | None, dict | None, list]]:

    # hardening #
    assert_valid_pubkey(pubkey)
    # ## #

    nwc = await get_nwc(GetNWC(pubkey=pubkey, refresh_last_used=True))
    error = await _check(nwc, "multi_pay_invoice")
    if error:
        return [(None, error, [])]
    if not nwc:
        raise Exception("Pubkey has no associated wallet")
    params = payload.get("params", {})
    invoices = params.get("invoices", [])
    results: list[tuple[dict | None, dict | None, list]] = []

    # Ensures all invoices are provided
    for i in invoices:
        invoice = i.get("invoice", None)
        if not invoice:
            raise Exception("Missing invoice")

    for i in invoices:
        try:
            invoice_id = i.get("id", None)
            invoice = i.get("invoice", None)
            invoice_data = bolt11_decode(invoice)
            amount_msats = int(invoice_data.amount_msat or 0)

            # hardening #
            assert_valid_bolt11(invoice)
            assert_valid_msats(amount_msats)
            if invoice_id:
                assert_sane_string(invoice_id)
            # ## #

            res = await _process_invoice(
                nwc.wallet, pubkey, invoice, amount_msats, invoice_data.description
            )
            error = res.get("error")
            if error:
                results.append((None, error, []))
            else:
                r = (
                    {
                        "preimage": res.get("preimage"),
                    },
                    None,
                    [["d", invoice_id if invoice_id else res.get("payment_hash")]],
                )
                results.append(r)
        except Exception as e:
            results.append((None, {"code": "INTERNAL", "message": str(e)}, []))
    # await log_nwc(pubkey, payload)
    return results


async def _on_make_invoice(
    sp: NWCServiceProvider, pubkey: str, payload: dict
) -> list[tuple[dict | None, dict | None, list]]:

    # hardening #
    assert_valid_pubkey(pubkey)
    # ## #

    nwc = await get_nwc(GetNWC(pubkey=pubkey, refresh_last_used=True))
    error = await _check(nwc, "make_invoice")
    if error:
        return [(None, error, [])]
    if not nwc:
        raise Exception("Pubkey has no associated wallet")
    params = payload.get("params", {})
    amount_msats = params.get("amount", None)
    # Ensures amount is provided
    if not amount_msats:
        raise Exception("Missing amount")
    description = params.get("description", "")
    description_hash = params.get("description_hash", None)
    expiry = params.get("expiry", None)

    # hardening #
    assert_valid_msats(amount_msats)
    if description:
        assert_sane_string(description)
    if description_hash:
        assert_valid_sha256(description_hash)
    if expiry:
        assert_valid_expiration_seconds(expiry)
    # ## #

    payment = await create_invoice(
        wallet_id=nwc.wallet,
        amount=int(amount_msats / 1000),
        currency="sat",
        memo=description,
        description_hash=bytes.fromhex(description_hash) if description_hash else None,
        unhashed_description=description.encode("utf-8"),
        expiry=expiry,
    )
    payment_hash = payment.payment_hash
    payment_request = payment.bolt11
    payment_status = await check_transaction_status(
        wallet_id=nwc.wallet, payment_hash=payment_hash
    )
    preimage = payment_status.preimage
    if (
        not preimage
    ):  # Some backend do not return a preimage (eg. FakeWallet), so we fake it
        preimage = "0000000000000000000000000000000000000000000000000000000000000000"
    res = {
        "type": "incoming",
        "invoice": payment_request,
        "description": description,
        "description_hash": description_hash,
        "preimage": preimage,
        "payment_hash": payment_hash,
        "amount": amount_msats,
        # "fees_paid":None,
        "created_at": int(time.time()),
        "metadata": {},
    }
    if expiry:
        res["expires_at"] = int(time.time()) + int(expiry)
    # await log_nwc(pubkey, payload)
    return [(res, None, [])]


async def _on_lookup_invoice(
    sp: NWCServiceProvider, pubkey: str, payload: dict
) -> list[tuple[dict | None, dict | None, list]]:

    # hardening #
    assert_valid_pubkey(pubkey)
    # ## #

    nwc = await get_nwc(GetNWC(pubkey=pubkey, refresh_last_used=True))
    error = await _check(nwc, "lookup_invoice")
    if error:
        return [(None, error, [])]
    if not nwc:
        raise Exception("Pubkey has no associated wallet")
    params = payload.get("params", {})
    payment_hash = params.get("payment_hash", None)
    invoice = params.get("invoice", None)
    # Ensure payment_hash or invoice are provided
    if not payment_hash and not invoice:
        raise Exception("Missing payment_hash or invoice")
    # Extract hash from invoice if not provided
    if not payment_hash:
        invoice_data = bolt11_decode(invoice)
        payment_hash = invoice_data.payment_hash

    # hardening #
    if payment_hash:
        assert_valid_sha256(payment_hash)
    if invoice:
        assert_valid_bolt11(invoice)
    # ## #

    # Get payment data
    payment = await get_wallet_payment(nwc.wallet, payment_hash)
    if not payment:
        raise Exception("Payment not found")
    invoice_data = bolt11_decode(payment.bolt11)
    is_settled = not payment.pending
    timestamp = int(payment.time.timestamp()) or int(invoice_data.date)
    expiry = int(payment.expiry.timestamp()) if payment.expiry else timestamp + 3600
    preimage = (
        payment.preimage
        or "0000000000000000000000000000000000000000000000000000000000000000"
    )
    res: dict = {
        "type": "outgoing" if payment.is_out else "incoming",
        "invoice": payment.bolt11,
        "description": (
            invoice_data.description if invoice_data.description else payment.memo
        ),
        "preimage": preimage if is_settled or payment.is_in else None,
        "payment_hash": payment.payment_hash,
        "amount": abs(payment.msat),
        "fees_paid": abs(payment.fee),
        "created_at": timestamp,
        "expires_at": expiry,
        "settled_at": timestamp if is_settled else None,
        "metadata": {},
    }
    if invoice_data.description_hash:
        res["description_hash"] = invoice_data.description_hash
    # await log_nwc(pubkey, payload)
    return [(res, None, [])]


async def _on_list_transactions(
    sp: NWCServiceProvider, pubkey: str, payload: dict
) -> list[tuple[dict | None, dict | None, list]]:
    # hardening #
    assert_valid_pubkey(pubkey)
    # ## #

    nwc = await get_nwc(GetNWC(pubkey=pubkey, refresh_last_used=True))
    error = await _check(nwc, "list_transactions")
    if error:
        return [(None, error, [])]
    if not nwc:
        raise Exception("Pubkey has no associated wallet")
    params = payload.get("params", 0)
    tfrom = params.get("from", 0)
    tuntil = params.get("until", int(time.time()))
    limit = params.get("limit", 10)
    offset = params.get("offset", 0)
    unpaid = params.get("unpaid", False)
    tx_type = params.get("type", "")

    # hardening #
    assert_valid_positive_int(tfrom)
    assert_valid_positive_int(tuntil)
    assert_valid_positive_int(limit)
    assert_valid_positive_int(offset)
    assert_boolean(unpaid)
    assert_sane_string(tx_type)
    # ## #

    filters: Filters = Filters()
    filters.where(["time <= :tuntil"])
    filters.values({"tuntil": tuntil})
    history = await get_payments(
        wallet_id=nwc.wallet,
        complete=True,
        pending=unpaid,
        outgoing=not tx_type or tx_type == "outgoing",
        incoming=not tx_type or tx_type == "incoming",
        since=tfrom,
        exclude_uncheckable=False,
        filters=filters,
        limit=limit,
        offset=offset,
    )
    transactions: list[dict] = []
    p: Payment
    for p in history:
        # bolt11_decode is synchronous and CPU-bound. Running it directly inside
        # this async handler blocks the asyncio event loop for the duration of
        # the whole batch, long enough that NWC clients hit their reply timeout
        # and other extensions (nostrclient relay keep-alives, publishes,
        # concurrent requests) are starved. Offload to a worker thread so the
        # event loop stays responsive.
        invoice_data = await asyncio.to_thread(bolt11_decode, p.bolt11)
        is_settled = not p.pending
        timestamp = int(p.time.timestamp()) or invoice_data.date
        transactions.append(
            {
                "type": "outgoing" if p.is_out else "incoming",
                "invoice": p.bolt11,
                "description": invoice_data.description,
                "description_hash": invoice_data.description_hash,
                "preimage": p.preimage if is_settled or p.is_in else None,
                "payment_hash": p.payment_hash,
                "amount": abs(p.msat),
                "fees_paid": p.fee,
                "created_at": timestamp,
                "settled_at": timestamp if is_settled else None,
                "metadata": {},
            }
        )
    # await log_nwc(pubkey, payload)
    return [({"transactions": transactions}, None, [])]


async def _on_get_balance(
    sp: NWCServiceProvider, pubkey: str, payload: dict
) -> list[tuple[dict | None, dict | None, list]]:

    # hardening #
    assert_valid_pubkey(pubkey)
    # ## #

    nwc = await get_nwc(GetNWC(pubkey=pubkey, refresh_last_used=True))
    error = await _check(nwc, "get_balance")
    if error:
        return [(None, error, [])]
    if not nwc:
        raise Exception("Pubkey has no associated wallet")
    balance = 0
    wallet = await get_wallet(nwc.wallet)
    if not wallet:
        raise Exception("Wallet not found")
    balance = wallet.balance_msat
    # await log_nwc(pubkey, payload)
    return [({"balance": balance}, None, [])]


async def _on_get_info(
    sp: NWCServiceProvider, pubkey: str, payload: dict
) -> list[tuple[dict | None, dict | None, list]]:

    # hardening #
    assert_valid_pubkey(pubkey)
    # ## #

    nwc = await get_nwc(GetNWC(pubkey=pubkey, refresh_last_used=True))
    error = await _check(nwc, "get_info")
    if error:
        return [(None, error, [])]
    if not nwc:
        raise Exception("Pubkey has no associated wallet")
    sp_methods = sp.get_supported_methods()
    permissions = nwc.get_permissions()
    # Filter only methods supported by the extension and allowed by the permissions
    account_methods = []
    for spm in sp_methods:
        for p in permissions:
            permissions_data: dict[str, Any] = nwc_permissions.get(p, {})
            allowed_methods: list[str] = permissions_data.get("methods", [])
            if spm in allowed_methods:
                account_methods.append(spm)
                break
    # await log_nwc(pubkey, payload)
    return [
        (
            {
                "alias": settings.lnbits_site_title,
                "color": "",
                "network": "mainnet",
                "block_height": 0,
                "block_hash": "",
                "methods": account_methods,
            },
            None,
            [],
        )
    ]


async def handle_nwc():
    priv_key = await get_config_nwc("provider_key")
    relay = await get_config_nwc("relay")
    handle_missed_events = int(await get_config_nwc("handle_missed_events") or 0)
    nwcsp = NWCServiceProvider(priv_key, relay, handle_missed_events)
    nwcsp.add_request_listener("pay_invoice", _on_pay_invoice)
    nwcsp.add_request_listener("multi_pay_invoice", _on_multi_pay_invoice)
    nwcsp.add_request_listener("make_invoice", _on_make_invoice)
    nwcsp.add_request_listener("lookup_invoice", _on_lookup_invoice)
    nwcsp.add_request_listener("list_transactions", _on_list_transactions)
    nwcsp.add_request_listener("get_balance", _on_get_balance)
    nwcsp.add_request_listener("get_info", _on_get_info)
    # currently not supported by lnbits
    # nwcsp.addRequestListener("pay_keysend", _on_pay_keysend)
    # nwcsp.addRequestListener("multi_pay_keysend", _on_multi_pay_keysend)
    ###
    await nwcsp.start()
    try:
        while True:
            await asyncio.sleep(3600)
    except asyncio.CancelledError:
        await nwcsp.cleanup()
        raise


async def handle_execution_queue():
    while True:
        try:
            task = await execution_queue.get()
            action = task.get("action")
            future = task.get("future")
            try:
                if not action:
                    raise Exception("Invalid action")
                res = await action()
                if future:
                    future.set_result(res)
            except Exception as e:
                if future:
                    future.set_exception(e)
        except Exception as e:
            logger.error(str(e))
