import AsyncStorage from '@react-native-async-storage/async-storage';

export const KIND4_RETRY_BASE_MS = 60_000;
const MAX_FAILURES = 500;
const MAX_ATTEMPTS = 3;
type Failure = { id: string; createdAt: number; attempts: number; lastAttempt: number };

/** Metadata only: ciphertext and plaintext stay out of AsyncStorage. */
export class Kind4RetryStore {
  private failures = new Map<string, Failure>();
  private loaded?: Promise<void>;
  private lastChecked = 0;
  constructor(private owner: string) {}
  private get key() {
    return `dm-kind4-retries:${this.owner}`;
  }
  load(): Promise<void> {
    return (this.loaded ??= (async () => {
      const raw = await AsyncStorage.getItem(this.key);
      if (!raw) return;
      try {
        const entries: Failure[] = JSON.parse(raw);
        for (const f of entries.slice(-MAX_FAILURES)) {
          if (
            typeof f.id === 'string' &&
            Number.isFinite(f.createdAt) &&
            Number.isInteger(f.attempts) &&
            f.attempts >= 0 &&
            f.attempts <= MAX_ATTEMPTS &&
            Number.isFinite(f.lastAttempt)
          )
            this.failures.set(f.id, f);
        }
      } catch {
        /* Ignore malformed metadata. */
      }
    })());
  }
  async save() {
    await AsyncStorage.setItem(this.key, JSON.stringify([...this.failures.values()]));
  }
  private due(f: Failure) {
    return f.lastAttempt + KIND4_RETRY_BASE_MS * 2 ** Math.max(0, f.attempts - 1);
  }
  shouldSkip(id: string, bypass = false, now = Date.now()) {
    const f = this.failures.get(id);
    return !bypass && !!f && (f.attempts >= MAX_ATTEMPTS || now < this.due(f));
  }
  failed(id: string, createdAt: number, counted: boolean, now = Date.now()) {
    const previous = this.failures.get(id);
    this.failures.set(id, {
      id,
      createdAt,
      attempts: Math.min(MAX_ATTEMPTS, (previous?.attempts ?? 0) + Number(counted)),
      lastAttempt: now,
    });
    if (this.failures.size > MAX_FAILURES) {
      // Prefer permanent negatives, then the newest failure; keep the oldest floor.
      const victim =
        [...this.failures.values()].find((f) => f.attempts >= MAX_ATTEMPTS) ??
        [...this.failures.values()].reduce((newest, f) =>
          f.createdAt > newest.createdAt ? f : newest,
        );
      if (victim) this.failures.delete(victim.id);
    }
  }
  succeeded(id: string) {
    this.failures.delete(id);
  }
  cursor(newest: number) {
    return Math.min(
      newest,
      ...[...this.failures.values()]
        .filter((f) => f.attempts < MAX_ATTEMPTS)
        .map((f) => f.createdAt),
    );
  }
  retryDelay() {
    const next = this.nextRetryAt();
    // A bounded relay slice can omit a pending event. Never spin at delay 0.
    if (next === undefined) return undefined;
    this.lastChecked = Date.now();
    return Math.max(KIND4_RETRY_BASE_MS, next - this.lastChecked);
  }
  nextRetryAt() {
    const pending = [...this.failures.values()].filter((f) => f.attempts < MAX_ATTEMPTS);
    return pending.length
      ? Math.max(
          this.lastChecked + KIND4_RETRY_BASE_MS,
          Math.min(...pending.map((f) => this.due(f))),
        )
      : undefined;
  }
}

/** Transport/availability failures do not exhaust a valid event's retry budget. */
export function isTransientKind4Error(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /disconnect|not connected|unavailable|not logged in|timeout|timed out|network|offline|ECONN|EAGAIN|transport|connection|temporar|cancel|reject|denied|permission|abort/i.test(
    message,
  );
}
