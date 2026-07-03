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

// LUD-06 servers may pin the amount by returning minSendable === maxSendable.
// In that case there is nothing for the user to choose, so the Send sheet
// pre-fills the value and skips the amount-entry step. Returns the fixed
// sats amount, or null when the range is open (or params are absent).
export function lnurlFixedAmountSats(
  params: { minSats: number; maxSats: number } | null,
): number | null {
  if (!params) return null;
  return params.minSats === params.maxSats && params.minSats > 0 ? params.minSats : null;
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

// Pick the value to pre-fill the paste/input box when the user taps "Edit
// address" (or when a resolution failure bounces them back to the input). The
// goal is fix-in-place: keep whatever the user actually typed so a one-char
// typo can be corrected without retyping the whole address (#871). Prefer the
// live paste-box text; fall back to the parsed payment target (e.g. when the
// value arrived via scan/NFC/initialAddress and never passed through the box).
// Returns '' when there is nothing to recover, so the box opens empty rather
// than showing "null".
export function editAddressPrefill(
  pasteText: string | null | undefined,
  invoiceData: string | null | undefined,
): string {
  const typed = (pasteText ?? '').trim();
  if (typed) return typed;
  return (invoiceData ?? '').trim();
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
