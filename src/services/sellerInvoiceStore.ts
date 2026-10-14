import { isSellerAccountForgotten } from './sellerEventStore';
// Per-account record of the invoices a seller sent for Gamma orders: which
// wallet made each one (so payment is checked on THAT wallet, not whichever
// is active), its payment hash, and when the wallet reported it paid.
// Device-local (AsyncStorage) — the payment request itself is in the
// encrypted DM store; this only adds what the wallet side needs.
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SellerInvoiceRecord {
  orderId: string;
  buyerPubkey: string;
  /** Wallet the invoice was created on. */
  walletId: string;
  paymentHash: string;
  bolt11: string;
  amountSats: number;
  sentAt: number;
  /** Persisted before publishing; retries reuse this invoice until delivery completes. */
  deliveryPending?: boolean;
  /** When the wallet reported the invoice settled (ms). */
  paidAt?: number;
  /** When the `confirmed` status update went to the buyer (ms). */
  confirmedAt?: number;
}

const MAX_RECORDS = 300;
export const sellerInvoiceKey = (buyer: string, orderId: string) =>
  `${buyer.toLowerCase()}:${orderId}`;
const key = (pubkey: string) => `market-seller-invoices:${pubkey}`;
const listeners = new Set<() => void>();
let writeChain: Promise<unknown> = Promise.resolve();

function isRecord(v: unknown): v is SellerInvoiceRecord {
  const r = v as SellerInvoiceRecord;
  return (
    !!r &&
    typeof r.orderId === 'string' &&
    typeof r.buyerPubkey === 'string' &&
    /^[0-9a-f]{64}$/i.test(r.buyerPubkey) &&
    typeof r.walletId === 'string' &&
    typeof r.paymentHash === 'string' &&
    typeof r.bolt11 === 'string' &&
    Number.isSafeInteger(r.amountSats)
  );
}

export async function loadSellerInvoices(
  pubkey: string,
): Promise<Record<string, SellerInvoiceRecord>> {
  const raw = await AsyncStorage.getItem(key(pubkey));
  const parsed: unknown = raw ? JSON.parse(raw) : {};
  const out: Record<string, SellerInvoiceRecord> = {};
  if (parsed && typeof parsed === 'object') {
    for (const value of Object.values(parsed as Record<string, unknown>)) {
      if (isRecord(value)) out[sellerInvoiceKey(value.buyerPubkey, value.orderId)] = value;
    }
  }
  return out;
}

/** Serialised read-modify-write so concurrent cards can't clobber each other. */
function update(
  pubkey: string,
  mutate: (records: Record<string, SellerInvoiceRecord>) => void,
): Promise<void> {
  const run = writeChain.then(async () => {
    if (isSellerAccountForgotten(pubkey)) return;
    const records = await loadSellerInvoices(pubkey);
    if (isSellerAccountForgotten(pubkey)) return;
    mutate(records);
    const kept = Object.values(records)
      .sort((a, b) => b.sentAt - a.sentAt)
      .slice(0, MAX_RECORDS);
    await AsyncStorage.setItem(
      key(pubkey),
      JSON.stringify(
        Object.fromEntries(kept.map((r) => [sellerInvoiceKey(r.buyerPubkey, r.orderId), r])),
      ),
    );
  });
  writeChain = run.catch(() => undefined);
  return run.then(() => listeners.forEach((listener) => listener()));
}

/** Persist a validated invoice before delivery (replaces an earlier one for the order). */
export function recordSellerInvoice(pubkey: string, record: SellerInvoiceRecord): Promise<void> {
  return update(pubkey, (records) => {
    records[sellerInvoiceKey(record.buyerPubkey, record.orderId)] = record;
  });
}

export function patchSellerInvoice(
  pubkey: string,
  orderId: string,
  buyerPubkey: string,
  patch: Partial<Pick<SellerInvoiceRecord, 'paidAt' | 'confirmedAt' | 'deliveryPending'>>,
): Promise<void> {
  return update(pubkey, (records) => {
    const id = sellerInvoiceKey(buyerPubkey, orderId);
    const existing = records[id];
    if (existing) records[id] = { ...existing, ...patch };
  });
}

export function subscribeSellerInvoices(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function drainSellerInvoiceWrites(): Promise<void> {
  await writeChain;
}
