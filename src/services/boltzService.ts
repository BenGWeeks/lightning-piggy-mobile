/**
 * Boltz Exchange submarine swap service.
 *
 * Enables paying to on-chain Bitcoin addresses from a Lightning wallet by
 * creating a submarine swap: the user pays a Lightning invoice and Boltz
 * sends an on-chain transaction to the destination address.
 *
 * API docs: https://docs.boltz.exchange/v/api
 */

const BOLTZ_API = 'https://api.boltz.exchange/v2';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SwapFees {
  /** Boltz service fee as a percentage (e.g. 0.5 = 0.5%) */
  percentage: number;
  /** Fixed miner fee in sats that Boltz charges */
  minerFee: number;
  /** Minimum swap amount in sats */
  minAmount: number;
  /** Maximum swap amount in sats */
  maxAmount: number;
}

export interface SubmarineSwap {
  id: string;
  /** Lightning invoice the user must pay */
  invoice: string;
  /** Expected on-chain amount the recipient will receive (sats) */
  expectedAmount: number;
  /** Block height at which the swap times out */
  timeoutBlockHeight: number;
}

export type SwapStatus =
  | 'swap.created'
  | 'transaction.mempool'
  | 'transaction.confirmed'
  | 'invoice.set'
  | 'invoice.pending'
  | 'invoice.paid'
  | 'transaction.claimed'
  | 'swap.expired'
  | 'swap.refunded';

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fetch current submarine swap fee schedule (BTC Lightning → BTC on-chain).
 */
export async function getSwapFees(): Promise<SwapFees> {
  const res = await fetch(`${BOLTZ_API}/swap/submarine`);
  if (!res.ok) throw new Error(`Boltz API error: ${res.status}`);
  const data = await res.json();

  // The response is keyed by pair, e.g. data["BTC"]["BTC"]
  const pair = data?.BTC?.BTC;
  if (!pair) throw new Error('BTC/BTC pair not found in Boltz response');

  return {
    percentage: pair.fees?.percentage ?? 0.5,
    minerFee: pair.fees?.minerFees ?? 0,
    minAmount: pair.limits?.minimal ?? 10000,
    maxAmount: pair.limits?.maximal ?? 25000000,
  };
}

/**
 * Calculate the total fee for a submarine swap of a given amount.
 */
export function calculateSwapFee(amountSats: number, fees: SwapFees): number {
  return Math.ceil(amountSats * (fees.percentage / 100)) + fees.minerFee;
}

/**
 * Create a submarine swap: Lightning → on-chain.
 *
 * Returns a Lightning invoice the user must pay. Once paid, Boltz sends
 * on-chain BTC to the provided address.
 */
export async function createSubmarineSwap(
  onchainAddress: string,
  amountSats: number,
): Promise<SubmarineSwap> {
  const res = await fetch(`${BOLTZ_API}/swap/submarine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'BTC',
      to: 'BTC',
      invoice: '', // Boltz will generate an invoice
      refundAddress: onchainAddress,
      claimAddress: onchainAddress,
      invoiceAmount: amountSats,
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Boltz swap creation failed: ${errBody}`);
  }

  const data = await res.json();
  return {
    id: data.id,
    invoice: data.invoice,
    expectedAmount: data.expectedAmount ?? amountSats,
    timeoutBlockHeight: data.timeoutBlockHeight ?? 0,
  };
}

/**
 * Poll the status of an existing swap.
 */
export async function getSwapStatus(swapId: string): Promise<SwapStatus> {
  const res = await fetch(`${BOLTZ_API}/swap/submarine/${swapId}`);
  if (!res.ok) throw new Error(`Boltz status check failed: ${res.status}`);
  const data = await res.json();
  return data.status as SwapStatus;
}

/**
 * Validate that a string looks like a Bitcoin on-chain address.
 * Supports P2PKH (1...), P2SH (3...), and Bech32/Bech32m (bc1...).
 */
export function isBitcoinAddress(input: string): boolean {
  const trimmed = input.trim();
  // P2PKH
  if (/^1[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return true;
  // P2SH
  if (/^3[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(trimmed)) return true;
  // Bech32 / Bech32m (mainnet)
  if (/^bc1[a-zA-HJ-NP-Z0-9]{25,62}$/i.test(trimmed)) return true;
  return false;
}
