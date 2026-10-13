import { relayKey } from './relayHealth';

export interface RelayInformation {
  name?: string;
  description?: string;
  contact?: string;
  pubkey?: string;
  software?: string;
  version?: string;
  icon?: string;
  supported_nips?: number[];
  limitation: {
    payment_required?: boolean;
    auth_required?: boolean;
    restricted_writes?: boolean;
    max_subscriptions?: number;
    max_message_length?: number;
    min_pow_difficulty?: number;
  };
}

/** Ignore unknown or malformed fields in this optional NIP-11 document. */
export function parseRelayInformation(value: unknown): RelayInformation {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid relay information');
  const raw = value as Record<string, unknown>;
  const info: RelayInformation = { limitation: {} };
  for (const key of ['name', 'description', 'contact', 'pubkey', 'software', 'version'] as const) {
    if (typeof raw[key] === 'string') info[key] = raw[key].slice(0, 8000);
  }
  if (typeof raw.icon === 'string' && /^https?:\/\//i.test(raw.icon)) info.icon = raw.icon;
  if (Array.isArray(raw.supported_nips))
    info.supported_nips = [
      ...new Set(
        raw.supported_nips.filter(
          (n): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0,
        ),
      ),
    ].slice(0, 200);
  const limits = raw.limitation;
  if (limits && typeof limits === 'object' && !Array.isArray(limits)) {
    const fields = limits as Record<string, unknown>;
    for (const key of ['payment_required', 'auth_required', 'restricted_writes'] as const) {
      if (typeof fields[key] === 'boolean') info.limitation[key] = fields[key];
    }
    for (const key of ['max_subscriptions', 'max_message_length', 'min_pow_difficulty'] as const) {
      const n = fields[key];
      if (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0) info.limitation[key] = n;
    }
  }
  return info;
}

export const RELAY_INFORMATION_TTL_MS = 60 * 60_000;
const FAILURE_TTL_MS = 60_000;
const cache = new Map<string, { until: number; request: Promise<RelayInformation | null> }>();

/** One bounded HTTP GET, shared across screens; never opens a Nostr subscription. */
export function fetchRelayInformation(url: string): Promise<RelayInformation | null> {
  const key = relayKey(url);
  const previous = cache.get(key);
  if (previous && previous.until > Date.now()) return previous.request;
  let http: URL;
  try {
    http = new URL(key);
  } catch {
    return Promise.resolve(null);
  }
  if (http.protocol !== 'wss:' && http.protocol !== 'ws:') return Promise.resolve(null);
  http.protocol = http.protocol === 'wss:' ? 'https:' : 'http:';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  const entry = { until: Infinity, request: Promise.resolve<RelayInformation | null>(null) };
  entry.request = (async () => {
    try {
      const response = await fetch(http.toString(), {
        headers: { Accept: 'application/nostr+json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Relay information unavailable');
      const info = parseRelayInformation(await response.json());
      entry.until = Date.now() + RELAY_INFORMATION_TTL_MS;
      return info;
    } catch {
      entry.until = Date.now() + FAILURE_TTL_MS;
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  cache.delete(key);
  cache.set(key, entry);
  if (cache.size > 100) cache.delete(cache.keys().next().value!);
  return entry.request;
}

export function __resetRelayInformationForTests(): void {
  cache.clear();
}
