/**
 * LNURL service for resolving lightning addresses and LNURL strings to invoices.
 *
 * Flow: lightning address -> LNURL-pay endpoint -> fetch invoice for amount
 * Flow: lnurl1... -> bech32 decode -> LNURL endpoint -> pay or withdraw
 * See: https://github.com/lnurl/luds/blob/luds/16.md
 */

// Bech32 charset for LNURL decoding
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

// Cap LNURL endpoint resolution so a network stall can't hang a cold-start
// deep link indefinitely (#756 Copilot review).
const LNURL_FETCH_TIMEOUT_MS = 15_000;

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
 * Normalise any user-pasteable / tapped LNURL form into the underlying
 * HTTPS endpoint URL, WITHOUT fetching it:
 *   - `lightning:` URI prefix (stripped)
 *   - bech32 `lnurl1…` / `LNURL1…` (decoded via {@link decodeLnurl})
 *   - cleartext `lnurlp://` / `lnurlw://` / `lnurl://host/path` (→ `https://`)
 *   - raw `https://…` endpoint URLs (passed through)
 *
 * Mirrors `lnurlWithdrawService.decodeLnurlWithdraw` but is direction-
 * agnostic: it does not assume pay vs withdraw — the resolved `tag`
 * decides that (see {@link resolveLnurlDirection}). Throws on anything
 * that isn't a recognisable LNURL form, or that decodes to a non-HTTPS
 * URL (the LUD-01 .onion-over-HTTP exception is allowed via decodeLnurl).
 */
export function normalizeLnurlToUrl(input: string): string {
  let s = input.trim();
  if (!s) throw new Error('Empty LNURL');

  // Strip the Lightning URI prefix when present.
  if (/^lightning:/i.test(s)) {
    s = s.slice('lightning:'.length).trim();
  }

  // Cleartext LUD-17 forms: `lnurlp://`, `lnurlw://`, `lnurl://`. Per LUD-17
  // these map to http:// for `.onion` Tor hosts and https:// elsewhere.
  const cleartext = s.match(/^(?:lnurlp|lnurlw|lnurl):\/\/(.+)$/i);
  if (cleartext) {
    const rest = cleartext[1];
    // Reject a nested scheme (e.g. `lnurl://https://evil/…`) — concatenating
    // would yield `https://https://…`, a malformed/confusable URL.
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rest)) {
      throw new Error('Malformed LNURL endpoint (nested scheme)');
    }
    const host = rest.split(/[/:?#]/, 1)[0].toLowerCase();
    const built = (host.endsWith('.onion') ? 'http://' : 'https://') + rest;
    let parsed: URL;
    try {
      parsed = new URL(built);
    } catch {
      throw new Error('Malformed LNURL endpoint');
    }
    if (!/^https?:$/.test(parsed.protocol) || !parsed.hostname) {
      throw new Error('Malformed LNURL endpoint');
    }
    return built;
  }

  // bech32 form. decodeLnurl validates HRP + checksum + HTTPS scheme.
  if (/^lnurl1/i.test(s)) {
    return decodeLnurl(s);
  }

  // Raw https endpoint (e.g. a LUD-06 LNURL-pay URL).
  if (/^https:\/\//i.test(s)) return s;

  throw new Error(
    'Not a recognised LNURL — expected lnurl1…, lnurlp://, lnurlw://, lightning:LNURL1…, or https://',
  );
}

/**
 * Single shared resolver that fetches an LNURL endpoint ONCE and reports
 * which *direction* the link is — pay (money out → SendSheet) vs withdraw
 * (money in → claim sheet) — keyed off the server's resolved `tag`, NOT
 * the bech32 prefix.
 *
 * This is the disambiguation point the scan-to-pay (#756) and
 * scan-to-claim (#341) flows both agree on: a `lnurl1…` that *looks*
 * payable might actually be a withdrawRequest and vice-versa, so the only
 * correct signal is the `tag` the endpoint returns.
 *
 * @returns `{ kind: 'pay', tag: 'payRequest', params }` or
 *          `{ kind: 'withdraw', tag: 'withdrawRequest', params }`.
 * @throws on transport failure, non-OK status, or an unsupported tag.
 */
export async function resolveLnurlDirection(
  input: string,
): Promise<
  | { kind: 'pay'; tag: 'payRequest'; params: LnurlPayParams; url: string }
  | { kind: 'withdraw'; tag: 'withdrawRequest'; params: LnurlWithdrawParams; url: string }
> {
  const url = normalizeLnurlToUrl(input);
  const resolved = await resolveLnurlFromUrl(url);
  if (resolved.tag === 'payRequest') {
    return { kind: 'pay', tag: 'payRequest', params: resolved.params, url };
  }
  return { kind: 'withdraw', tag: 'withdrawRequest', params: resolved.params, url };
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
  return resolveLnurlFromUrl(url);
}

/**
 * Fetch an already-resolved LNURL endpoint URL and shape its JSON into the
 * pay / withdraw param objects. Shared by {@link resolveLnurl} (bech32-only
 * entry) and {@link resolveLnurlDirection} (all URI forms).
 */
async function resolveLnurlFromUrl(
  url: string,
): Promise<
  | { tag: 'payRequest'; params: LnurlPayParams }
  | { tag: 'withdrawRequest'; params: LnurlWithdrawParams }
> {
  // Bound the fetch — RN's fetch can hang indefinitely on a network stall, and
  // for a cold-start deep link that would leave the user with no resolution and
  // no error toast for an unbounded time.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LNURL_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } catch (e) {
    throw new Error(`Could not reach LNURL endpoint: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

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
