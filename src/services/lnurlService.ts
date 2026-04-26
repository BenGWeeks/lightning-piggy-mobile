/**
 * LNURL service for resolving lightning addresses and LNURL strings to invoices.
 *
 * Flow: lightning address -> LNURL-pay endpoint -> fetch invoice for amount
 * Flow: lnurl1... -> bech32 decode -> LNURL endpoint -> pay or withdraw
 * See: https://github.com/lnurl/luds/blob/luds/16.md
 */

// Bech32 charset for LNURL decoding
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

export interface LnurlWithdrawParams {
  callback: string;
  k1: string;
  minSats: number;
  maxSats: number;
  description: string;
}

interface LnurlPayResponse {
  callback: string;
  minSendable: number; // millisatoshis
  maxSendable: number; // millisatoshis
  metadata: string;
  tag: string;
  commentAllowed?: number;
  allowsNostr?: boolean;
  nostrPubkey?: string;
}

interface LnurlInvoiceResponse {
  pr: string; // bolt11 invoice
  routes: unknown[];
}

export interface LnurlPayParams {
  callback: string;
  minSats: number;
  maxSats: number;
  description: string;
  commentAllowed: number;
  allowsNostr: boolean;
  nostrPubkey: string | null;
}

/**
 * Compute bech32 polymod for checksum verification.
 */
function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

/**
 * Expand the human-readable part for bech32 checksum computation.
 */
function bech32HrpExpand(hrp: string): number[] {
  const ret: number[] = [];
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) >> 5);
  }
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) {
    ret.push(hrp.charCodeAt(i) & 31);
  }
  return ret;
}

/**
 * Verify bech32 checksum.
 */
function bech32VerifyChecksum(hrp: string, data: number[]): boolean {
  return bech32Polymod([...bech32HrpExpand(hrp), ...data]) === 1;
}

/**
 * Decode a bech32-encoded LNURL string to its URL.
 * LNURL strings start with "lnurl1" and contain a bech32-encoded HTTPS URL.
 * Includes full bech32 checksum verification.
 */
export function decodeLnurl(lnurl: string): string {
  const hrp = 'lnurl';
  const lower = lnurl.toLowerCase();

  if (!lower.startsWith(hrp + '1')) {
    throw new Error('Invalid LNURL: must start with lnurl1');
  }

  const dataStr = lower.slice(hrp.length + 1);
  if (dataStr.length < 6) {
    throw new Error('Invalid LNURL: too short');
  }

  const data: number[] = [];
  for (const ch of dataStr) {
    const idx = BECH32_CHARSET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid LNURL: bad character');
    data.push(idx);
  }

  // Verify bech32 checksum
  if (!bech32VerifyChecksum(hrp, data)) {
    throw new Error('Invalid LNURL: checksum verification failed');
  }

  // Remove the 6-character checksum
  const values = data.slice(0, data.length - 6);

  // Convert from 5-bit groups to 8-bit bytes
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const v of values) {
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }

  // Decode bytes as UTF-8
  const url = new TextDecoder().decode(new Uint8Array(bytes));

  // Validate URL scheme (LNURL spec requires HTTPS, allow .onion over HTTP)
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid LNURL: decoded value is not a valid URL');
  }

  // LNURL spec: HTTPS required, except `.onion` may use HTTP
  // (Tor provides equivalent transport security). Older check only
  // gated on HTTPS exclusion; the .onion exception was permissive of
  // any protocol (e.g. ftp://x.onion would pass) — tighten to require
  // either https: anywhere or http: on a .onion host specifically.
  const isHttps = parsed.protocol === 'https:';
  const isHttpOnion = parsed.protocol === 'http:' && parsed.hostname.endsWith('.onion');
  if (!isHttps && !isHttpOnion) {
    throw new Error('Invalid LNURL: must be HTTPS, or HTTP on a .onion host');
  }

  return url;
}

/**
 * Resolve an LNURL string to either pay or withdraw parameters.
 * Returns an object with a `tag` field indicating the type.
 */
export async function resolveLnurl(
  lnurl: string,
): Promise<
  | { tag: 'payRequest'; params: LnurlPayParams }
  | { tag: 'withdrawRequest'; params: LnurlWithdrawParams }
> {
  const url = decodeLnurl(lnurl); // decodeLnurl validates HTTPS
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to resolve LNURL (${response.status})`);
  }

  const data = await response.json();

  if (data.tag === 'payRequest') {
    let description = '';
    try {
      const metadata = JSON.parse(data.metadata);
      const textEntry = metadata.find((m: [string, string]) => m[0] === 'text/plain');
      if (textEntry) description = textEntry[1];
    } catch {}

    return {
      tag: 'payRequest',
      params: {
        callback: data.callback,
        minSats: Math.ceil(data.minSendable / 1000),
        maxSats: Math.floor(data.maxSendable / 1000),
        description,
        commentAllowed: data.commentAllowed ?? 0,
        allowsNostr: data.allowsNostr ?? false,
        nostrPubkey: data.nostrPubkey ?? null,
      },
    };
  }

  if (data.tag === 'withdrawRequest') {
    return {
      tag: 'withdrawRequest',
      params: {
        callback: data.callback,
        k1: data.k1,
        minSats: Math.ceil(data.minWithdrawable / 1000),
        maxSats: Math.floor(data.maxWithdrawable / 1000),
        description: data.defaultDescription || '',
      },
    };
  }

  throw new Error(`Unsupported LNURL tag: ${data.tag}`);
}

/**
 * Resolve a lightning address (user@domain) to LNURL-pay parameters.
 */
export async function resolveLightningAddress(address: string): Promise<LnurlPayParams> {
  const [user, domain] = address.split('@');
  if (!user || !domain) {
    throw new Error('Invalid lightning address format');
  }

  // Validate lightning address parts
  const addressRegex = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!addressRegex.test(address)) {
    throw new Error('Invalid lightning address format');
  }

  const url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to resolve lightning address (${response.status})`);
  }

  const data: LnurlPayResponse = await response.json();

  if (data.tag !== 'payRequest') {
    throw new Error('Invalid LNURL-pay response');
  }

  // Parse description from metadata
  let description = address;
  try {
    const metadata = JSON.parse(data.metadata);
    const textEntry = metadata.find((m: [string, string]) => m[0] === 'text/plain');
    if (textEntry) description = textEntry[1];
  } catch {}

  return {
    callback: data.callback,
    minSats: Math.ceil(data.minSendable / 1000),
    maxSats: Math.floor(data.maxSendable / 1000),
    description,
    commentAllowed: data.commentAllowed ?? 0,
    allowsNostr: data.allowsNostr ?? false,
    nostrPubkey: data.nostrPubkey ?? null,
  };
}

/**
 * Fetch a bolt11 invoice from an LNURL-pay callback for a given amount.
 * Optionally includes a NIP-57 zap request event and/or a comment.
 */
export async function fetchInvoice(
  callback: string,
  amountSats: number,
  options?: { nostr?: string; comment?: string },
): Promise<string> {
  let callbackUrl: URL;
  try {
    callbackUrl = new URL(callback);
  } catch {
    throw new Error('Invalid callback URL');
  }
  if (callbackUrl.protocol !== 'https:') {
    throw new Error('Callback URL must use HTTPS');
  }

  const amountMsat = amountSats * 1000;
  callbackUrl.searchParams.set('amount', amountMsat.toString());

  if (options?.nostr) {
    callbackUrl.searchParams.set('nostr', options.nostr);
  }
  if (options?.comment) {
    callbackUrl.searchParams.set('comment', options.comment);
  }

  const url = callbackUrl.toString();
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Failed to fetch invoice (${response.status})`);
  }

  const data: LnurlInvoiceResponse = await response.json();

  if (!data.pr) {
    throw new Error('No invoice returned from LNURL service');
  }

  return data.pr;
}
