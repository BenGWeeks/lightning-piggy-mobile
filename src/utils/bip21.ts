// BIP-21 URI parser + builder shared by ReceiveSheet (sender), SendSheet
// (parser fed by paste/scan/tap), and MessageBubble (recipient render).
//
// Sat-precise: amount strings parsed via BigInt to avoid float rounding
// drift on values like 0.00012345. Bounded by Bitcoin's 21M supply.

const BITCOIN_URI_REGEX = /^bitcoin:([a-z0-9]{8,})(\?[^\s]*)?$/i;
const MAX_SATS = 2_100_000_000_000_000n;

export interface ParsedBip21 {
  raw: string;
  address: string;
  amountSats: number | null;
}

export function parseBip21(text: string): ParsedBip21 | null {
  if (!text) return null;
  const trimmed = text.trim();
  const match = trimmed.match(BITCOIN_URI_REGEX);
  if (!match) return null;
  const address = match[1];
  let amountSats: number | null = null;
  if (match[2]) {
    const params = new URLSearchParams(match[2].slice(1));
    const raw = (params.get('amount') ?? '').trim();
    if (/^\d+(\.\d{0,8})?$/.test(raw)) {
      const [whole, frac = ''] = raw.split('.');
      const fracPadded = (frac + '00000000').slice(0, 8);
      try {
        const sats = BigInt(whole) * 100_000_000n + BigInt(fracPadded);
        if (sats > 0n && sats <= MAX_SATS) {
          amountSats = Number(sats);
        }
      } catch {
        // malformed — fall through with amountSats null
      }
    }
  }
  return { raw: trimmed, address, amountSats };
}

export function buildBip21(address: string, amountSats?: number | null): string {
  if (!address) return '';
  if (!amountSats || amountSats <= 0) return `bitcoin:${address}`;
  return `bitcoin:${address}?amount=${(amountSats / 100_000_000).toFixed(8)}`;
}
