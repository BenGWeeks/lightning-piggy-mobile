// Reconciles and cancellations run one at a time, so a cancel (backup
// confirmed, sign-out) can never be overtaken by a reconcile that read the
// account list before it.
let chain: Promise<unknown> = Promise.resolve();
export function serialKeyBackupReminder<T>(op: () => Promise<T>): Promise<T> {
  const run = chain.then(op, op);
  chain = run.catch(() => undefined);
  return run;
}

// Signed-out accounts whose registry entry may not be gone yet (the cache
// wipe runs before removeIdentity): skipped until registry removal completes.
export const retiredBackupAccounts = new Set<string>();

/** Registry write completed: release retirement after all older reconciles.
 * Called on successful removal, clear, or re-add, even with no logged-in UI. */
export function completeKeyBackupReminderRetirement(pubkey?: string): Promise<void> {
  return serialKeyBackupReminder(async () => {
    if (pubkey) retiredBackupAccounts.delete(pubkey.toLowerCase());
    else retiredBackupAccounts.clear();
  });
}

export function resetKeyBackupReminderQueueForTests(): void {
  chain = Promise.resolve();
  retiredBackupAccounts.clear();
}
