/**
 * CoinOS managed-wallet bootstrap.
 *
 * CoinOS (https://coinos.io, AGPL-3.0) runs a single LND node behind a
 * REST API that lets a fresh client register a username, then mint a
 * NIP-47 (Nostr Wallet Connect) connection that LP can plug straight
 * into the existing NWC wallet plumbing.
 *
 * **Custody disclosure:** funds created through this flow are CUSTODIAL
 * — they live in CoinOS's hot wallet. Suitable as an onboarding /
 * "training wheels" wallet so a new user has working Lightning from
 * minute one; NOT suitable for life savings. The UI MUST surface this
 * before the user commits, and MUST hand back the username + password
 * + NWC string on a recovery screen the user has to acknowledge.
 *
 * The service is `baseUrl`-agnostic so a sovereignty-minded user can
 * point LP at their own self-hosted CoinOS instance instead of the
 * public coinos.io node — the long-term graduation story (#287).
 */
import { getPublicKey } from 'nostr-tools/pure';
import { hexToBytes } from '@noble/hashes/utils.js';

/** Public, fully-managed CoinOS instance. Override per-call to point at
 *  a self-hosted instance (see Advanced section in the create flow). */
export const DEFAULT_COINOS_BASE_URL = 'https://coinos.io';

/** Coarse, structured failure modes the UI can render with specific
 *  copy. Anything we can't classify lands in `unknown`. */
export type CoinosErrorCode =
  | 'username_taken'
  | 'invalid_input'
  | 'rate_limited'
  | 'service_down'
  | 'network'
  | 'timeout'
  | 'auth'
  | 'unknown';

export class CoinosError extends Error {
  readonly code: CoinosErrorCode;
  readonly status?: number;
  constructor(code: CoinosErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'CoinosError';
    this.code = code;
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** `fetch` with an AbortController-backed deadline. Lifted from the
 *  pattern used elsewhere in the app rather than imported, so this
 *  service stays standalone (no cross-service `fetchWithTimeout`
 *  helper exported from nostrService today). */
async function fetchWithTimeout(
  input: RequestInfo,
  init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...rest, signal: controller.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') {
      throw new CoinosError('timeout', `Request timed out after ${timeoutMs} ms`);
    }
    // DOMException network failures land here too — surface as a network
    // error so the UI can suggest "check your connection".
    throw new CoinosError('network', (e as Error)?.message || 'Network request failed');
  } finally {
    clearTimeout(timer);
  }
}

/** Strip a trailing slash so `${baseUrl}${path}` doesn't end up with
 *  `https://coinos.io//register`. */
function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

/** Map an HTTP status + best-effort body text to a structured CoinosError.
 *  Server returns plain-text bodies on 5xx and `{ message }` JSON on 4xx
 *  in some routes, so we try JSON first and fall back to raw text. */
async function classifyError(res: Response): Promise<CoinosError> {
  let bodyText = '';
  try {
    bodyText = (await res.text()).trim();
  } catch {}
  let bodyMessage = bodyText;
  try {
    const parsed = JSON.parse(bodyText);
    if (parsed && typeof parsed.message === 'string') bodyMessage = parsed.message;
  } catch {}

  const lower = bodyMessage.toLowerCase();
  if (res.status === 429 || lower.includes('rate limit') || lower.includes('too many')) {
    return new CoinosError(
      'rate_limited',
      bodyMessage || 'Rate limited — please wait and try again.',
      res.status,
    );
  }
  if (
    res.status === 400 ||
    lower.includes('username') ||
    lower.includes('exists') ||
    lower.includes('taken') ||
    lower.includes('invalid')
  ) {
    if (lower.includes('username') || lower.includes('exists') || lower.includes('taken')) {
      return new CoinosError(
        'username_taken',
        bodyMessage || 'That username is already taken.',
        res.status,
      );
    }
    return new CoinosError(
      'invalid_input',
      bodyMessage || 'The CoinOS server rejected the request.',
      res.status,
    );
  }
  if (res.status === 401 || res.status === 403) {
    return new CoinosError('auth', bodyMessage || 'Authentication failed.', res.status);
  }
  if (res.status >= 500) {
    return new CoinosError(
      'service_down',
      bodyMessage || 'CoinOS appears to be down — please try again later.',
      res.status,
    );
  }
  return new CoinosError('unknown', bodyMessage || `HTTP ${res.status}`, res.status);
}

// ─── /register ─────────────────────────────────────────────────────────────

export interface CoinosRegisterArgs {
  baseUrl?: string;
  username: string;
  password: string;
}

/** What `/register` hands back, plus the optional Nostr identity material
 *  CoinOS auto-derives for the user. We don't currently consume `sk` /
 *  `pubkey` — they're surfaced for completeness and so a later
 *  "use this account's Nostr identity" feature wouldn't need a re-register
 *  round-trip. */
export interface CoinosRegisterResult {
  token: string;
  /** Nostr secret key (hex) auto-generated by CoinOS for this user. */
  sk?: string;
  /** Nostr pubkey (hex) derived from `sk`. */
  pubkey?: string;
  username: string;
}

/**
 * Register a fresh CoinOS user. Returns the JWT used to authenticate
 * follow-up requests. Throws `CoinosError` with a coarse `code` for the
 * UI to translate into specific copy ("username taken", "rate limited",
 * "service down").
 *
 * NOTE: the `/register` endpoint on coinos.io is currently NOT gated by
 * captcha (per coinos-server `routes/users.ts`). The acceptance criteria
 * in #287 includes a courtesy DM to CoinOS maintainers before un-drafting
 * the PR — this auto-provision path is well-behaved (one account per
 * deliberate user tap, never silent) but we should confirm it's
 * acceptable under their ToS.
 */
export async function registerCoinosUser({
  baseUrl = DEFAULT_COINOS_BASE_URL,
  username,
  password,
}: CoinosRegisterArgs): Promise<CoinosRegisterResult> {
  const trimmedUser = username.trim();
  if (!/^[a-z0-9_]{3,32}$/.test(trimmedUser)) {
    throw new CoinosError(
      'invalid_input',
      'Username must be 3–32 lowercase letters, digits, or underscores.',
    );
  }
  if (password.length < 12) {
    throw new CoinosError('invalid_input', 'Password must be at least 12 characters.');
  }

  const url = `${normalizeBaseUrl(baseUrl)}/register`;
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user: { username: trimmedUser, password } }),
  });
  if (!res.ok) throw await classifyError(res);

  let body: { token?: string; sk?: string; pubkey?: string; username?: string };
  try {
    body = await res.json();
  } catch {
    throw new CoinosError('unknown', 'CoinOS returned a non-JSON response to /register.');
  }
  if (!body.token || typeof body.token !== 'string') {
    throw new CoinosError('unknown', 'CoinOS /register response missing JWT token.');
  }
  return {
    token: body.token,
    sk: typeof body.sk === 'string' ? body.sk : undefined,
    pubkey: typeof body.pubkey === 'string' ? body.pubkey : undefined,
    username: typeof body.username === 'string' ? body.username : trimmedUser,
  };
}

// ─── /app  + /apps ─────────────────────────────────────────────────────────

export interface CreateCoinosNwcArgs {
  baseUrl?: string;
  token: string;
  /** Human-readable label that appears in the user's CoinOS account view
   *  ("Lightning Piggy Mobile"). Doesn't surface in LP. */
  name?: string;
  /** Optional spend cap in sats. Omit for unbounded — the user controls
   *  what they top up. */
  maxAmount?: number;
  /** Optional fee cap in sats. */
  maxFee?: number;
  /** Budget renewal cadence (`'never' | 'daily' | 'weekly' | 'monthly' |
   *  'yearly'`). CoinOS defaults to `'never'` — we follow suit. */
  budgetRenewal?: 'never' | 'daily' | 'weekly' | 'monthly' | 'yearly';
}

export interface CoinosAppRecord {
  pubkey: string;
  secret: string;
  /** NIP-47 connection string the LP NWC plumbing consumes directly. */
  nwc: string;
  name?: string;
}

/**
 * Mint a fresh NIP-47 connection on the authenticated CoinOS account.
 * The secret is generated client-side (so it never leaves the device
 * unless the user later inspects the NWC string) and POSTed to `/app`,
 * then we re-fetch `/apps` to pick up the server-built `nwc` field.
 *
 * Fetching `/apps` immediately after `/app` is necessary because the
 * upstream `POST /app` handler returns `{}` — the assembled NIP-47
 * connection string is only constructed when the apps list is read
 * (see coinos-server `routes/users.ts::apps`).
 */
export async function createCoinosNwcConnection({
  baseUrl = DEFAULT_COINOS_BASE_URL,
  token,
  name = 'Lightning Piggy',
  maxAmount,
  maxFee,
  budgetRenewal = 'never',
}: CreateCoinosNwcArgs): Promise<CoinosAppRecord> {
  // 32-byte NIP-47 secret. We mint client-side instead of letting the
  // server pick: keeps the secret material visible to the device that
  // creates it (recovery info screen) and matches the upstream handler,
  // which derives the app pubkey from `getPublicKey(hexToBytes(secret))`.
  const secret = randomHexBytes(32);
  const pubkey = getPublicKey(hexToBytes(secret));

  const createUrl = `${normalizeBaseUrl(baseUrl)}/app`;
  const createRes = await fetchWithTimeout(createUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      pubkey,
      secret,
      name,
      max_amount: maxAmount,
      max_fee: maxFee,
      budget_renewal: budgetRenewal,
      notify: false,
    }),
  });
  if (!createRes.ok) throw await classifyError(createRes);

  // The `nwc` field is computed in /apps, not /app. Pull the list and
  // pick the row that matches the secret/pubkey we just registered.
  const apps = await listCoinosApps({ baseUrl, token });
  const minted = apps.find((a) => a.pubkey === pubkey || a.secret === secret);
  if (!minted) {
    throw new CoinosError(
      'unknown',
      'CoinOS accepted /app but the new connection did not appear in /apps.',
    );
  }
  return minted;
}

export interface ListCoinosAppsArgs {
  baseUrl?: string;
  token: string;
}

/** All NIP-47 connections this account has minted. Each entry includes
 *  the assembled NIP-47 connection string in `nwc`. */
export async function listCoinosApps({
  baseUrl = DEFAULT_COINOS_BASE_URL,
  token,
}: ListCoinosAppsArgs): Promise<CoinosAppRecord[]> {
  const url = `${normalizeBaseUrl(baseUrl)}/apps`;
  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw await classifyError(res);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new CoinosError('unknown', 'CoinOS returned a non-JSON response to /apps.');
  }
  if (!Array.isArray(body)) {
    throw new CoinosError('unknown', 'CoinOS /apps response was not an array.');
  }
  return body
    .filter(
      (entry): entry is { pubkey: string; secret: string; nwc: string; name?: string } =>
        !!entry &&
        typeof (entry as Record<string, unknown>).pubkey === 'string' &&
        typeof (entry as Record<string, unknown>).secret === 'string' &&
        typeof (entry as Record<string, unknown>).nwc === 'string',
    )
    .map((entry) => ({
      pubkey: entry.pubkey,
      secret: entry.secret,
      nwc: entry.nwc,
      name: entry.name,
    }));
}

// ─── /health ───────────────────────────────────────────────────────────────

/** Reachability probe for the self-hosted-instance picker. Hits CoinOS's
 *  unauthenticated `GET /health` and returns true on a 2xx. We use a
 *  short timeout (8 s) here because the user is waiting at a live form
 *  field — failing fast keeps the UX responsive. */
export async function probeCoinosInstance(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${normalizeBaseUrl(baseUrl)}/health`, {
      method: 'GET',
      timeoutMs: 8_000,
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Local helpers ────────────────────────────────────────────────────────

/** Cryptographically random hex string of `len` bytes. Uses the WebCrypto
 *  polyfill set up in `src/polyfills.ts` (react-native-get-random-values). */
function randomHexBytes(len: number): string {
  const buf = new Uint8Array(len);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Suggest a default username so the user isn't naming their own account
 * — `lp_<random>` is unguessable enough that two devices booting at the
 * same moment won't collide, and short enough to fit CoinOS's username
 * field. Lower-case + digits only matches the regex enforced in
 * `registerCoinosUser`.
 */
export function suggestUsername(): string {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  const suffix = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  return `lp_${suffix}`;
}

/**
 * Generate a strong random password suitable for CoinOS's
 * /register + /login flow. 40 chars of base64url drawn from 30 bytes
 * of CSPRNG output (~240 bits) — long enough that an attacker can't
 * brute-force, short enough to copy-paste / write down, and
 * URL-safe so the user doesn't lose chars to ambiguous symbols.
 */
export function generateStrongPassword(): string {
  const buf = new Uint8Array(30);
  crypto.getRandomValues(buf);
  // Standard base64url, no padding.
  let b64: string;
  if (typeof btoa === 'function') {
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    b64 = btoa(bin);
  } else {
    // Buffer is set up by polyfills.ts; fall back if btoa is missing.
    b64 = Buffer.from(buf).toString('base64');
  }
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
