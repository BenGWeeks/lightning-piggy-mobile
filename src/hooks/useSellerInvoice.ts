import { useCallback, useEffect, useRef, useState } from 'react';
import { useNostr } from '../contexts/NostrContext';
import { useWallet } from '../contexts/WalletContext';
import { lookupInvoice } from '../services/nwcService';
import { sendNip17Rumor, Nip17SendError } from '../services/nip17RumorSend';
import {
  loadSellerInvoices,
  patchSellerInvoice,
  recordSellerInvoice,
  subscribeSellerInvoices,
  type SellerInvoiceRecord,
} from '../services/sellerInvoiceStore';
import { saveSellerReceiveWallet } from '../services/sellerReceiveWallet';
import { amountSatsFromBolt11, paymentHashFromBolt11 } from '../utils/bolt11';
import { extractInvoice } from '../utils/messageContent';
import { shortOrderId } from '../utils/marketOrder';
import {
  buildInvoiceChatNote,
  buildPaymentRequestRumor,
  buildStatusUpdateRumor,
} from '../utils/sellerOrderMessages';

/** Translatable reason an invoice action failed (`sellerOrders.errors.<code>`). */
export type SellerInvoiceErrorCode =
  | 'noWallet'
  | 'invoiceFailed'
  | 'amountMismatch'
  | 'sendFailed'
  | 'notSignedIn';

export class SellerInvoiceError extends Error {
  constructor(
    readonly code: SellerInvoiceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SellerInvoiceError';
  }
}

/** Paid-detection cadence for an unpaid invoice while its card is mounted. */
const CHECK_EVERY_MS = 15_000;
const MAX_AUTO_CHECKS = 20;

export interface SendInvoiceInput {
  walletId: string;
  amountSats: number;
  /** Save `walletId` as the shop's "Receive payments to" wallet. */
  remember: boolean;
}

export interface UseSellerInvoice {
  /** The invoice I sent for this order from this device, if any. */
  record: SellerInvoiceRecord | null;
  sending: boolean;
  checking: boolean;
  sendInvoice: (input: SendInvoiceInput) => Promise<void>;
  /** Ask the wallet the invoice was made on whether it's paid. */
  checkPaid: () => Promise<boolean>;
  /** Tell the buyer the order is paid (kind-16 type-3 `confirmed`). */
  markPaid: () => Promise<void>;
}

/**
 * Seller actions for one incoming order: create the invoice on the wallet
 * the seller CHOSE (never implicitly the active one), send it as a Gamma
 * kind-16 type-2 payment request over NIP-17, then watch THAT wallet for
 * payment and confirm with a type-3 status update.
 */
export function useSellerInvoice(
  buyerPubkey: string | null,
  orderId: string | null,
): UseSellerInvoice {
  const { pubkey, signerType, relays } = useNostr();
  const { makeInvoiceForWallet } = useWallet();
  const [record, setRecord] = useState<SellerInvoiceRecord | null>(null);
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const active = Boolean(pubkey && buyerPubkey && orderId);

  useEffect(() => {
    if (!active || !pubkey || !orderId) return;
    let cancelled = false;
    const load = () =>
      void loadSellerInvoices(pubkey).then((records) => {
        if (!cancelled) setRecord(records[orderId] ?? null);
      });
    load();
    const unsubscribe = subscribeSellerInvoices(load);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [active, pubkey, orderId]);

  const send = useCallback(
    (rumor: Parameters<typeof sendNip17Rumor>[0]['rumor']) =>
      sendNip17Rumor({
        senderPubkey: pubkey,
        signerType,
        relays,
        rumor,
        recipientPubkey: buyerPubkey ?? '',
      }),
    [pubkey, signerType, relays, buyerPubkey],
  );

  const sendInvoice = useCallback(
    async ({ walletId, amountSats, remember }: SendInvoiceInput) => {
      if (!pubkey || !buyerPubkey || !orderId) {
        throw new SellerInvoiceError('notSignedIn', 'Sign in to invoice orders');
      }
      if (!walletId) throw new SellerInvoiceError('noWallet', 'Choose a wallet');
      setSending(true);
      try {
        let bolt11: string;
        try {
          bolt11 = await makeInvoiceForWallet(
            walletId,
            amountSats,
            `Order #${shortOrderId(orderId)}`,
          );
        } catch (e) {
          throw new SellerInvoiceError('invoiceFailed', (e as Error)?.message ?? 'make_invoice');
        }
        // Never send an invoice that charges anything but the total shown.
        if (amountSatsFromBolt11(bolt11) !== amountSats) {
          throw new SellerInvoiceError('amountMismatch', 'Wallet returned a different amount');
        }
        const paymentHash = paymentHashFromBolt11(bolt11);
        if (!paymentHash) throw new SellerInvoiceError('invoiceFailed', 'Invoice has no hash');
        const rumor = buildPaymentRequestRumor({
          sellerPubkey: pubkey,
          buyerPubkey,
          orderId,
          amountSats,
          bolt11,
          expiresAt: extractInvoice(bolt11)?.expiresAt ?? null,
          note: `⚡ Invoice for order #${shortOrderId(orderId)} — ${amountSats.toLocaleString('en-US')} sats`,
        });
        try {
          await send(rumor);
        } catch (e) {
          throw new SellerInvoiceError(
            e instanceof Nip17SendError && e.code === 'notSignedIn' ? 'notSignedIn' : 'sendFailed',
            (e as Error)?.message ?? 'send failed',
          );
        }
        await recordSellerInvoice(pubkey, {
          orderId,
          walletId,
          paymentHash,
          bolt11,
          amountSats,
          sentAt: Date.now(),
        });
        if (remember) await saveSellerReceiveWallet(pubkey, walletId).catch(() => undefined);
        // Best effort: the same invoice as readable chat text for buyers on
        // generic NIP-17 clients (LP hides it beside the order card).
        void send(
          buildInvoiceChatNote({ sellerPubkey: pubkey, buyerPubkey, orderId, amountSats, bolt11 }),
        ).catch(() => undefined);
      } finally {
        setSending(false);
      }
    },
    [pubkey, buyerPubkey, orderId, makeInvoiceForWallet, send],
  );

  const recordRef = useRef(record);
  recordRef.current = record;
  const checkPaid = useCallback(async (): Promise<boolean> => {
    const current = recordRef.current;
    if (!pubkey || !current) return false;
    if (current.paidAt) return true;
    setChecking(true);
    try {
      // THE wallet that made the invoice — not whichever wallet is active.
      const result = await lookupInvoice(current.walletId, current.paymentHash, {
        replyTimeoutMs: 5000,
      });
      if (result?.paid) {
        await patchSellerInvoice(pubkey, current.orderId, { paidAt: Date.now() });
        return true;
      }
      return false;
    } finally {
      setChecking(false);
    }
  }, [pubkey]);

  // Bounded auto-check while the card is mounted and the invoice is unpaid.
  const unpaidHash = record && !record.paidAt ? record.paymentHash : null;
  useEffect(() => {
    if (!unpaidHash) return;
    let checks = 0;
    void checkPaid();
    const timer = setInterval(() => {
      checks += 1;
      if (checks >= MAX_AUTO_CHECKS) clearInterval(timer);
      void checkPaid();
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [unpaidHash, checkPaid]);

  const markPaid = useCallback(async () => {
    if (!pubkey || !buyerPubkey || !orderId) {
      throw new SellerInvoiceError('notSignedIn', 'Sign in to update orders');
    }
    setSending(true);
    try {
      await send(
        buildStatusUpdateRumor({
          sellerPubkey: pubkey,
          buyerPubkey,
          orderId,
          status: 'confirmed',
          note: `✅ Payment received for order #${shortOrderId(orderId)}. Thank you!`,
        }),
      ).catch((e) => {
        throw new SellerInvoiceError('sendFailed', (e as Error)?.message ?? 'send failed');
      });
      if (recordRef.current) {
        await patchSellerInvoice(pubkey, orderId, { confirmedAt: Date.now() });
      }
    } finally {
      setSending(false);
    }
  }, [pubkey, buyerPubkey, orderId, send]);

  return { record, sending, checking, sendInvoice, checkPaid, markPaid };
}
