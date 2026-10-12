import { AmberSignerError, amberFailureKind } from '../services/amberErrors';
import {
  NostrConnectError,
  SignerUnavailableError,
  isCiphertextDecryptError,
} from '../services/signerErrors';
import AsyncStorage from '@react-native-async-storage/async-storage';

export const KIND4_RETRY_BASE_MS = 60_000;
const MAX_FAILURES = 500;
const MAX_EXHAUSTED = 5000;
const MAX_ATTEMPTS = 3;
export const KIND4_MAX_UNCOUNTED_ATTEMPTS = 20;
export const KIND4_MAX_FAILURE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
type Failure = {
  id: string;
  createdAt: number;
  attempts: number;
  uncountedAttempts: number;
  firstFailure: number;
  lastAttempt: number;
};

/** Metadata only: ciphertext and plaintext stay out of AsyncStorage. */
export class Kind4RetryStore {
  private failures = new Map<string, Failure>();
  private exhausted = new Map<string, number>();
  private loaded?: Promise<void>;
  private lastChecked = 0;
  constructor(private owner: string) {}
  private get key() {
    return `dm-kind4-retries:${this.owner}`;
  }
  private get exhaustedKey() {
    return `dm-kind4-exhausted:${this.owner}`;
  }
  load(): Promise<void> {
    return (this.loaded ??= (async () => {
      const [raw, exhaustedRaw] = await Promise.all([
        AsyncStorage.getItem(this.key),
        AsyncStorage.getItem(this.exhaustedKey),
      ]);
      try {
        if (exhaustedRaw) {
          const entries: [string, number][] = JSON.parse(exhaustedRaw);
          for (const [id, createdAt] of entries) {
            if (typeof id === 'string' && Number.isFinite(createdAt))
              this.rememberExhausted(id, createdAt);
          }
        }
      } catch {
        /* Ignore malformed negatives independently of retry metadata. */
      }
      if (!raw) return;
      try {
        const entries: Failure[] = JSON.parse(raw);
        for (const f of entries) {
          if (
            typeof f.id === 'string' &&
            Number.isFinite(f.createdAt) &&
            Number.isInteger(f.attempts) &&
            f.attempts >= 0 &&
            f.attempts <= MAX_ATTEMPTS &&
            Number.isFinite(f.lastAttempt) &&
            !this.exhausted.has(f.id)
          )
            this.failures.set(f.id, {
              ...f,
              // Older metadata has no ceiling fields; retain its last known age.
              firstFailure: Number.isFinite(f.firstFailure) ? f.firstFailure : f.lastAttempt,
              uncountedAttempts:
                Number.isInteger(f.uncountedAttempts) && f.uncountedAttempts >= 0
                  ? Math.min(KIND4_MAX_UNCOUNTED_ATTEMPTS, f.uncountedAttempts)
                  : 0,
            });
          this.trimFailures();
        }
      } catch {
        /* Ignore malformed metadata. */
      }
    })());
  }
  async save() {
    // Snapshot both before yielding so concurrent failures cannot split the pair.
    const exhausted = JSON.stringify([...this.exhausted]);
    const failures = JSON.stringify([...this.failures.values()]);
    // Write negatives first: a failed retry write must not resurrect an evicted id.
    await AsyncStorage.setItem(this.exhaustedKey, exhausted);
    await AsyncStorage.setItem(this.key, failures);
  }
  private due(f: Failure) {
    return f.lastAttempt + KIND4_RETRY_BASE_MS * 2 ** Math.max(0, f.attempts - 1);
  }
  private expire(f: Failure, now = Date.now()) {
    if (f.attempts >= MAX_ATTEMPTS) return;
    if (
      f.uncountedAttempts >= KIND4_MAX_UNCOUNTED_ATTEMPTS ||
      now - f.firstFailure >= KIND4_MAX_FAILURE_AGE_MS
    ) {
      f.attempts = MAX_ATTEMPTS;
      console.warn(
        `[Perf] kind4 retry ceiling id=${f.id} uncounted=${f.uncountedAttempts} ageMs=${now - f.firstFailure}`,
      );
    }
  }
  shouldSkip(id: string, bypass = false, now = Date.now()) {
    const f = this.failures.get(id);
    if (f) this.expire(f, now);
    return (
      !bypass &&
      (this.exhausted.has(id) || (!!f && (f.attempts >= MAX_ATTEMPTS || now < this.due(f))))
    );
  }
  failed(id: string, createdAt: number, counted: boolean, now = Date.now()) {
    // A failed explicit bypass retains exhaustion; only success clears it.
    if (this.exhausted.has(id)) return;
    const previous = this.failures.get(id);
    const failure: Failure = {
      id,
      createdAt,
      attempts: Math.min(MAX_ATTEMPTS, (previous?.attempts ?? 0) + Number(counted)),
      uncountedAttempts: Math.min(
        KIND4_MAX_UNCOUNTED_ATTEMPTS,
        (previous?.uncountedAttempts ?? 0) + Number(!counted),
      ),
      firstFailure: previous?.firstFailure ?? now,
      lastAttempt: now,
    };
    this.expire(failure, now);
    this.failures.set(id, failure);
    this.trimFailures();
  }
  private rememberExhausted(id: string, createdAt: number) {
    this.exhausted.set(id, createdAt);
    if (this.exhausted.size > MAX_EXHAUSTED) {
      // Discard the oldest history first, behind the advancing cursor/overlap.
      const oldest = [...this.exhausted].reduce((a, b) => (a[1] <= b[1] ? a : b));
      this.exhausted.delete(oldest[0]);
    }
  }
  private trimFailures() {
    if (this.failures.size <= MAX_FAILURES) return;
    // Retire permanent negatives first. If every entry still pins the cursor,
    // exhaust the oldest floor so capacity pressure advances it rather than
    // dropping counters on the newest event forever.
    const entries = [...this.failures.values()];
    const victim =
      entries.find((f) => f.attempts >= MAX_ATTEMPTS) ??
      entries.reduce((oldest, f) => (f.createdAt < oldest.createdAt ? f : oldest));
    this.rememberExhausted(victim.id, victim.createdAt);
    this.failures.delete(victim.id);
  }
  succeeded(id: string) {
    this.exhausted.delete(id);
    this.failures.delete(id);
  }
  cursor(newest: number) {
    for (const f of this.failures.values()) this.expire(f);
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
    for (const f of this.failures.values()) this.expire(f);
    const pending = [...this.failures.values()].filter((f) => f.attempts < MAX_ATTEMPTS);
    return pending.length
      ? Math.max(
          this.lastChecked + KIND4_RETRY_BASE_MS,
          Math.min(
            ...pending.map((f) => Math.min(this.due(f), f.firstFailure + KIND4_MAX_FAILURE_AGE_MS)),
          ),
        )
      : undefined;
  }
}

/** Availability failures use the safety ceiling instead of the ciphertext budget. */
export function isTransientKind4Error(error: unknown): boolean {
  if (error instanceof SignerUnavailableError) return true;
  if (error instanceof NostrConnectError) return error.kind !== 'decrypt-failed';
  const amberKind = amberFailureKind(error);
  if (amberKind && amberKind !== 'failed') return true;
  // Amber's message is translated UI copy; only its native detail can identify
  // a ciphertext failure. Unknown signer failures remain retryable within the safety ceiling.
  if (error instanceof AmberSignerError) return !isCiphertextDecryptError(error.detail);
  return !isCiphertextDecryptError(error);
}
