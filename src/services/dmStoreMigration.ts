// One-time migration from the old plaintext DM caches to the encrypted DB
// (#695 / #710 M1+M2). The encrypted store is populated from the *canonical*
// source — relays — not by importing the old plaintext (which only ever
// memoised decryption); then the old plaintext caches are deleted, closing the
// at-rest gap (#690).
//
// Strict ordering is the whole safety story:
//   1. populate the encrypted DB from relays (decrypt-once → rows)
//   2. only if that completed, delete the old plaintext caches
//   3. only if the plaintext is VERIFIED gone, set the migrated flag
// Never delete plaintext before the DB is populated; never mark migrated until
// the plaintext is confirmed deleted. Because the DB is re-fetchable from
// relays, deletion is safe even in the worst case (a bad run just re-migrates
// next launch — the flag stays unset). Idempotent + interruption-safe.

export interface MigrationDeps {
  /** Has migration already completed for this account? */
  isMigrated: () => Promise<boolean>;
  /** Persist the migrated flag — called LAST, only after a verified wipe. */
  setMigrated: () => Promise<void>;
  /**
   * Re-fetch the wraps from relays and decrypt-once into the encrypted DB.
   * Returns whether it ran to completion (false = aborted/errored → do NOT
   * delete plaintext, since the DB may be incomplete). An empty inbox still
   * counts as completed.
   */
  populateFromRelays: () => Promise<{ completed: boolean }>;
  /** Delete the old plaintext caches (file wrap cache + AsyncStorage blobs). */
  deletePlaintextCaches: () => Promise<void>;
  /** M2: confirm the plaintext caches are actually gone after deletion. */
  verifyPlaintextGone: () => Promise<boolean>;
  /** Dev breadcrumb for a non-fatal migration hiccup (so a stuck retry is visible). */
  warn?: (msg: string) => void;
}

export type MigrationResult =
  | { ok: true; status: 'migrated' | 'already-migrated' }
  | { ok: false; reason: 'populate-incomplete' | 'delete-unverified' };

/**
 * Run the one-time DM-store migration. Safe to call on every login/app-start:
 * short-circuits once migrated, and a failed run leaves the flag unset so it
 * retries (the decrypt-once gate makes re-populating cheap).
 */
export async function migrateDmStore(deps: MigrationDeps): Promise<MigrationResult> {
  if (await deps.isMigrated()) return { ok: true, status: 'already-migrated' };

  // 1. Populate the encrypted DB from relays. If it didn't complete, bail
  //    WITHOUT touching the plaintext — the DB may be partial.
  const populate = await deps.populateFromRelays();
  if (!populate.completed) {
    deps.warn?.(
      'DM migration: populate did not complete; leaving plaintext + flag intact, will retry',
    );
    return { ok: false, reason: 'populate-incomplete' };
  }

  // 2. DB is now the source of truth → delete the old plaintext caches.
  await deps.deletePlaintextCaches();

  // 3. M2: verify the plaintext is actually gone. If not, DO NOT mark migrated
  //    — otherwise plaintext would persist while the user believes it's gone.
  if (!(await deps.verifyPlaintextGone())) {
    deps.warn?.(
      'DM migration: plaintext caches still present after delete; not marking migrated, will retry',
    );
    return { ok: false, reason: 'delete-unverified' };
  }

  // 4. Flag LAST — so a crash anywhere above just retries next launch.
  await deps.setMigrated();
  return { ok: true, status: 'migrated' };
}
