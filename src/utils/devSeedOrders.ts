// __DEV__-only fixture seeding for the marketplace order cards (#925 follow-up).
//
// The order/receipt cards are driven by PLAINTEXT kind-16/17 events a Nostr
// market sends to the buyer — there is no test relay that publishes those, so
// a Maestro flow (and manual QA) can't otherwise get a deterministic
// payment-request card on screen to exercise the Pay / QR affordance. This
// writes two canonical order rows straight into the local DM store for a fixed
// Piggy partner, so opening that conversation renders one of each card.
//
// GUARDED: `seedDevOrderConversation` is a no-op (returns null) unless
// `__DEV__`, and its only caller is a `__DEV__`-gated button in MessagesScreen
// that never renders in a release build. So even though the module is statically
// imported (and may remain in the bundle), it can never seed a production
// install at runtime.

import { upsertDmMessages, type DmMessageRow } from '../services/dmDb';
import { serializeOrder, type ParsedOrderEvent } from './orderEvents';

// LITTLE Piggy — one of the project's own test accounts (see testAccounts.ts).
// Scoping the fixture to a Piggy keeps it inside the controlled test-account
// set per `.maestro/README.adoc`.
export const DEV_ORDER_PARTNER_PUBKEY =
  'd9b33280ba733261d8b559fde0d662b6cb0786e30785313a086cdca95639457e';
export const DEV_ORDER_PARTNER_NAME = 'Little Piggy (dev order)';

// A syntactically-plausible bolt11 used only for the fixture. It isn't a real,
// payable invoice — the dev flow never confirms a payment — but it renders a
// QR, copies, and (because it doesn't decode) carries no expiry, so the Pay
// button stays visible deterministically.
const SAMPLE_BOLT11 =
  'lnbc210n1pjqe9xkpp5devseedorderfixtureinvoicenotrealdonotpay00000000000000sdqqcqzzsxqyz5vq';

const ORDER_ID = 'dev0seed-1234-4abc-9def-0123456789ab';

function paymentRequestOrder(): ParsedOrderEvent {
  return {
    kind: 16,
    type: 'payment',
    orderId: ORDER_ID,
    amountSats: 21,
    items: [{ ref: '30402:dev:widget', quantity: 1 }],
    payment: { method: 'lightning', value: SAMPLE_BOLT11 },
    message: 'Please pay this invoice to complete your order.',
  };
}

function receiptOrder(): ParsedOrderEvent {
  return {
    kind: 17,
    type: 'receipt',
    orderId: ORDER_ID,
    amountSats: 21,
    items: [{ ref: '30402:dev:widget', quantity: 1 }],
    payment: { method: 'lightning', value: SAMPLE_BOLT11, preimage: 'de'.repeat(32) },
    message: 'Payment received — thank you!',
  };
}

/**
 * Seed a payment-request + receipt order conversation for the fixed Piggy
 * partner. Returns the partner pubkey/name so the caller can navigate straight
 * into the conversation. No-op (returns null) outside `__DEV__`.
 */
export async function seedDevOrderConversation(
  ownerPubkey: string,
): Promise<{ pubkey: string; name: string } | null> {
  if (!__DEV__) return null;
  const now = Math.floor(Date.now() / 1000);
  const partner = DEV_ORDER_PARTNER_PUBKEY;
  const rows: DmMessageRow[] = [
    {
      owner: ownerPubkey,
      eventId: `dev-order-payment-${ORDER_ID}`,
      conversation: partner,
      createdAt: now - 60,
      sender: partner,
      content: serializeOrder(paymentRequestOrder()),
      fromMe: false,
      wireKind: 16,
    },
    {
      owner: ownerPubkey,
      eventId: `dev-order-receipt-${ORDER_ID}`,
      conversation: partner,
      createdAt: now,
      sender: partner,
      content: serializeOrder(receiptOrder()),
      fromMe: false,
      wireKind: 17,
    },
  ];
  await upsertDmMessages(rows);
  return { pubkey: partner, name: DEV_ORDER_PARTNER_NAME };
}
