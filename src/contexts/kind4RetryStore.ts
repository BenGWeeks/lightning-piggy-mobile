import { AmberSignerError, amberFailureKind } from '../services/amberErrors';
import {
  NostrConnectError,
  SignerUnavailableError,
  isCiphertextDecryptError,
} from '../services/signerErrors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { kind4FetchCapacity, KIND4_REPLAY_OVERLAP_SECONDS } from '../services/dmInboxFetchPolicy';

export const KIND4_RETRY_BASE_MS = 60_000;
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
  private replayCursor = 0;
  constructor(
    private owner: string,
    private capacity = kind4FetchCapacity(),
    private exhaustedCapacity = capacity,
  ) {
    this.assertCapacity(capacity);
    this.assertCapacity(exhaustedCapacity);
  }
  private assertCapacity(capacity: number) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0)
      throw new Error('Invalid kind-4 retry capacity');
  }
  configureFetch(relays: string[], fetchedCount: number) {
    this.capacity = this.exhaustedCapacity = kind4FetchCapacity(relays);
    if (fetchedCount > this.capacity)
      throw new Error('Kind-4 fetch exceeded its per-filter relay limit');
    this.trimFailures();
  }
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
          const saved = JSON.parse(exhaustedRaw);
          // Read legacy arrays without discarding replayable negatives.
          const entries: [string, number][] = Array.isArray(saved) ? saved : saved.entries;
          if (Number.isFinite(saved.cursor)) this.replayCursor = Math.max(0, saved.cursor);
          for (const [id, createdAt] of entries) {
            if (typeof id === 'string' && Number.isFinite(createdAt))
              this.rememberExhausted(id, createdAt);
          }
        }
      } catch {
        /* Ignore malformed negatives independently of retry metadata. */
      }
      if (!raw) {
        this.trimFailures();
        return;
      }
      try {
        const entries: Failure[] = JSON.parse(raw);
        for (const f of entries) {
          if (
            typeof f.id === 'string' &&
            Number.isFinite(f.createdAt) &&
            f.createdAt >= this.replayCursor - KIND4_REPLAY_OVERLAP_SECONDS &&
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
        }
      } catch {
        /* Ignore malformed metadata. */
      }
      this.trimFailures();
    })());
  }
  async save() {
    // Snapshot both before yielding so concurrent failures cannot split the pair.
    const exhausted = JSON.stringify({ cursor: this.replayCursor, entries: [...this.exhausted] });
    const failures = JSON.stringify([...this.failures.values()]);
    // Write negatives first: a failed retry write must not resurrect an evicted id.
    await AsyncStorage.setItem(this.exhaustedKey, exhausted);
    await AsyncStorage.setItem(this.key, failures);
  }
  private due(f: Failure) {
    return f.lastAttempt + KIND4_RETRY_BASE_MS * 2 ** Math.max(0, f.attempts - 1);
  }
  private expire(f: Failure, now = Date.now()) {
    if (
      f.attempts < MAX_ATTEMPTS &&
      (f.uncountedAttempts >= KIND4_MAX_UNCOUNTED_ATTEMPTS ||
        now - f.firstFailure >= KIND4_MAX_FAILURE_AGE_MS)
    ) {
      f.attempts = MAX_ATTEMPTS;
      console.warn(
        `[Perf] kind4 retry ceiling id=${f.id} uncounted=${f.uncountedAttempts} ageMs=${now - f.firstFailure}`,
      );
    }
    if (f.attempts >= MAX_ATTEMPTS) {
      this.rememberExhausted(f.id, f.createdAt);
      this.failures.delete(f.id);
    }
  }
  shouldSkip(id: string, bypass = false, now = Date.now()) {
    const f = this.failures.get(id);
    if (f) {
      this.expire(f, now);
      this.trimFailures();
    }
    return (
      !bypass &&
      (this.exhausted.has(id) || (!!f && (f.attempts >= MAX_ATTEMPTS || now < this.due(f))))
    );
  }
  failed(id: string, createdAt: number, counted: boolean, now = Date.now()) {
    // A failed explicit bypass retains exhaustion; only success clears it.
    if (this.exhausted.has(id)) return;
    if (createdAt < this.replayCursor - KIND4_REPLAY_OVERLAP_SECONDS) return;
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
    if (!this.exhausted.has(id)) this.failures.set(id, failure);
    this.trimFailures();
  }
  private rememberExhausted(id: string, createdAt: number) {
    this.exhausted.set(id, createdAt);
  }
  private trimFailures() {
    // Every forgetting path uses this strict boundary (relay `since` is inclusive).
    const prune = () => {
      const since = this.replayCursor - KIND4_REPLAY_OVERLAP_SECONDS;
      for (const [id, createdAt] of this.exhausted)
        if (createdAt < since) this.exhausted.delete(id);
      for (const [id, f] of this.failures) if (f.createdAt < since) this.failures.delete(id);
    };
    if (this.failures.size <= this.capacity && this.exhausted.size <= this.exhaustedCapacity)
      return;
    prune();
    while (this.failures.size > this.capacity) {
      const entries = [...this.failures.values()];
      const victim =
        entries.find((f) => f.attempts >= MAX_ATTEMPTS) ??
        entries.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      // Capacity pressure retires work, but retains its negative result.
      this.rememberExhausted(victim.id, victim.createdAt);
      this.failures.delete(victim.id);
    }
    while (this.exhausted.size > this.exhaustedCapacity) {
      const oldest = Math.min(...this.exhausted.values());
      // Only exhausted work can force the replay floor forward. Retire any
      // pending work the new boundary would exclude before advancing it.
      for (const [id, f] of this.failures) {
        if (f.createdAt <= oldest) {
          this.rememberExhausted(id, f.createdAt);
          this.failures.delete(id);
        }
      }
      this.replayCursor = Math.max(this.replayCursor, oldest + KIND4_REPLAY_OVERLAP_SECONDS + 1);
      prune();
    }
  }
  succeeded(id: string) {
    this.exhausted.delete(id);
    this.failures.delete(id);
  }
  cursor(newest: number) {
    for (const f of this.failures.values()) this.expire(f);
    this.replayCursor = Math.max(
      this.replayCursor,
      Math.min(
        newest,
        ...[...this.failures.values()]
          .filter((f) => f.attempts < MAX_ATTEMPTS)
          .map((f) => f.createdAt),
      ),
    );
    this.trimFailures();
    return this.replayCursor;
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
    this.trimFailures();
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
