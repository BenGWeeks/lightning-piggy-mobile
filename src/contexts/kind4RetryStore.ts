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
  private candidateCursor = 0;
  private hasSnapshot = false;
  private pruneBefore = -Infinity;
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
    // Don't cache a rejected load: a transient AsyncStorage failure must not
    // poison every later load(), so the next call retries the read.
    this.loaded ??= this.readSnapshot().catch((error: unknown) => {
      this.loaded = undefined;
      throw error;
    });
    return this.loaded;
  }

  private readSnapshot(): Promise<void> {
    return (async () => {
      const [raw, legacyExhaustedRaw] = await Promise.all([
        AsyncStorage.getItem(this.key),
        AsyncStorage.getItem(this.exhaustedKey),
      ]);
      let retries = raw;
      let exhaustedRaw = legacyExhaustedRaw;
      if (raw) {
        try {
          const snapshot = JSON.parse(raw);
          if (snapshot.version === 1) {
            this.hasSnapshot = true;
            retries = JSON.stringify(snapshot.failures);
            exhaustedRaw = JSON.stringify(snapshot);
          }
        } catch {
          /* Legacy parsing below handles malformed metadata. */
        }
      }
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
      this.candidateCursor = this.replayCursor;
      if (!retries) {
        return;
      }
      try {
        const entries: Failure[] = JSON.parse(retries);
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
    })();
  }
  /** A refresh owns an isolated proposal; dropping it rolls back all metadata. */
  beginPass() {
    const pass = new Kind4RetryStore(this.owner, this.capacity, this.exhaustedCapacity);
    pass.failures = new Map([...this.failures].map(([id, f]) => [id, { ...f }]));
    pass.exhausted = new Map(this.exhausted);
    pass.replayCursor = this.replayCursor;
    pass.candidateCursor = this.replayCursor;
    pass.hasSnapshot = this.hasSnapshot;
    return pass;
  }
  /** Relay queries never observe a proposal from an unfinished pass. */
  committedCursor(legacyNewest = 0) {
    return this.hasSnapshot
      ? this.replayCursor
      : Math.max(
          this.replayCursor,
          Math.min(legacyNewest, ...[...this.failures.values()].map((f) => f.createdAt)),
        );
  }
  async commitPass(pass: Kind4RetryStore, newest: number) {
    pass.cursor(newest);
    await pass.save();
    this.failures = pass.failures;
    this.exhausted = pass.exhausted;
    this.replayCursor = this.candidateCursor = pass.replayCursor;
    this.hasSnapshot = true;
  }
  async save() {
    // One key is the atomic commit record. Legacy keys are read only and are
    // ignored once this envelope exists, even if they contain stale retries.
    this.trimFailures();
    const since = this.pruneBefore;
    // Compute the pruning set without applying it: inclusive relay `since`
    // means only timestamps strictly behind this boundary can be forgotten.
    const exhausted = new Map([...this.exhausted].filter(([, createdAt]) => createdAt >= since));
    const failures = new Map([...this.failures].filter(([, f]) => f.createdAt >= since));
    const snapshot = JSON.stringify({
      version: 1,
      cursor: this.candidateCursor,
      entries: [...exhausted],
      failures: [...failures.values()],
    });
    await AsyncStorage.setItem(this.key, snapshot);
    this.exhausted = exhausted;
    this.failures = failures;
    this.replayCursor = this.candidateCursor;
    this.hasSnapshot = true;
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
    if (this.failures.size <= this.capacity && this.exhausted.size <= this.exhaustedCapacity)
      return;
    this.pruneBefore = Math.max(
      this.pruneBefore,
      this.candidateCursor - KIND4_REPLAY_OVERLAP_SECONDS,
    );
    while (this.failures.size > this.capacity) {
      const entries = [...this.failures.values()];
      const victim =
        entries.find((f) => f.attempts >= MAX_ATTEMPTS) ??
        entries.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      // Capacity pressure retires work in the proposal, retaining its negative.
      this.rememberExhausted(victim.id, victim.createdAt);
      this.failures.delete(victim.id);
    }
    if (this.exhausted.size <= this.exhaustedCapacity) return;
    const replayable = [...this.exhausted.values()].filter(
      (createdAt) => createdAt >= this.candidateCursor - KIND4_REPLAY_OVERLAP_SECONDS,
    );
    if (replayable.length > this.exhaustedCapacity) {
      replayable.sort((a, b) => a - b);
      const oldest = replayable[replayable.length - this.exhaustedCapacity - 1];
      this.candidateCursor = Math.max(
        this.candidateCursor,
        oldest + KIND4_REPLAY_OVERLAP_SECONDS + 1,
      );
    }
    this.pruneBefore = Math.max(
      this.pruneBefore,
      this.candidateCursor - KIND4_REPLAY_OVERLAP_SECONDS,
    );
    // Keep even proposed pruning victims visible to shouldSkip for the whole
    // pass. Otherwise later targets in the same relay slice regain attempts.
  }
  succeeded(id: string) {
    this.exhausted.delete(id);
    this.failures.delete(id);
  }
  cursor(newest: number) {
    for (const f of this.failures.values()) this.expire(f);
    this.candidateCursor = Math.max(
      this.candidateCursor,
      Math.min(
        newest,
        ...[...this.failures.values()]
          .filter((f) => f.attempts < MAX_ATTEMPTS)
          .map((f) => f.createdAt),
      ),
    );
    this.trimFailures();
    return this.candidateCursor;
  }
  retryDelay() {
    const next = this.nextRetryAt();
    // A bounded relay slice can omit a pending event. Never spin at delay 0.
    if (next === undefined) return undefined;
    this.lastChecked = Date.now();
    return Math.max(KIND4_RETRY_BASE_MS, next - this.lastChecked);
  }
  nextRetryAt() {
    return this.beginPass().pendingRetryAt(this.lastChecked);
  }
  private pendingRetryAt(lastChecked: number) {
    for (const f of this.failures.values()) this.expire(f);
    this.trimFailures();
    const pending = [...this.failures.values()].filter((f) => f.attempts < MAX_ATTEMPTS);
    return pending.length
      ? Math.max(
          lastChecked + KIND4_RETRY_BASE_MS,
          Math.min(
            ...pending.map((f) => Math.min(this.due(f), f.firstFailure + KIND4_MAX_FAILURE_AGE_MS)),
          ),
        )
      : undefined;
  }
}

/** Other inbox consumers use the same commit record, with legacy fallback. */
export async function loadKind4ReplayCursor(owner: string, legacyCursor?: number) {
  const store = new Kind4RetryStore(owner);
  await store.load();
  return store.committedCursor(legacyCursor ?? 0) || undefined;
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
