import { decode as bolt11Decode } from 'light-bolt11-decoder';

/** Decoded bolt11 fields the Send sheet renders. */
export interface DecodedInvoice {
  amountSats: number | null;
  description: string | null;
  expiry: number | null;
}

export function decodeInvoice(bolt11: string): DecodedInvoice {
  try {
    const decoded = bolt11Decode(bolt11);
    let amountSats: number | null = null;
    let description: string | null = null;
    let expiry: number | null = null;

    for (const section of decoded.sections) {
      if (section.name === 'amount') {
        amountSats = Math.round(Number(section.value) / 1000);
      } else if (section.name === 'description') {
        description = section.value as string;
      } else if (section.name === 'expiry') {
        expiry = section.value as number;
      }
    }
    return { amountSats, description, expiry };
  } catch {
    return { amountSats: null, description: null, expiry: null };
  }
}

export function isLightningAddress(input: string): boolean {
  return input.includes('@') && !input.startsWith('lnbc') && !input.startsWith('lntb');
}

export function isValidInvoice(data: string): boolean {
  const lower = data.toLowerCase();
  return (
    lower.startsWith('lnbc') ||
    lower.startsWith('lntb') ||
    lower.startsWith('lnts') ||
    lower.startsWith('lnbs')
  );
}

// Strip a `lightning:` URI prefix (case-insensitive) that wallets and QR codes
// commonly prepend to a bolt11 invoice or LNURL — users often copy/paste it
// along with the payload. Returns the bare string so the detectors above and
// `decodeInvoice` see a clean `lnbc…` / `lnurl1…` and the invoice stays
// payable. Non-prefixed input is returned trimmed but otherwise untouched.
export function stripLightningPrefix(input: string): string {
  const s = input.trim();
  if (/^lightning:/i.test(s)) {
    return s.slice('lightning:'.length).trim();
  }
  return s;
}

// Raw LNURL strings the scanner/paste box can hand us: bech32 `lnurl1…`
// (LUD-01/06) and the cleartext LUD-17 `lnurlp://` / `lnurlw://` /
// `lnurl://` schemes, with or without a `lightning:` URI prefix. Direction
// (pay vs withdraw) is NOT inferred here — the resolved server `tag` decides
// that downstream via resolveLnurlDirection(). Lightning addresses (which
// contain `@`) and bolt11 invoices (`lnbc…`) are deliberately not matched.
export function isLnurlString(input: string): boolean {
  let s = input.trim();
  if (/^lightning:/i.test(s)) {
    s = s.slice('lightning:'.length).trim();
  }
  return /^lnurl1/i.test(s) || /^(?:lnurlp|lnurlw|lnurl):\/\//i.test(s);
}
