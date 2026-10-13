// The automatic notification-default setup is ONE cancellable task bound to
// ONE account. It spans a permission prompt, a token fetch (up to 20 s) and
// several storage writes, and during that time the user can switch accounts,
// sign out, or make a choice of their own in Settings. Every write and the
// final runtime commit go through `isDefaultSetupCurrent`, which reads the
// live account at call time (never a render-time snapshot) — so a stale task
// stops before it writes, and never over a choice the user has just made.

import { getActivePubkey, subscribeActivePubkey } from './walletStorageService';

export interface DefaultSetupTask {
  /** The account this run decides for (lowercase hex). */
  readonly pubkey: string;
  /** The account generation it started under. */
  readonly generation: number;
  /** The manual-change counter it started under. */
  readonly manualSeq: number;
  /** Set by account cleanup (`cancelNotificationDefaults`). */
  aborted: boolean;
}

// Bumped on every live-account change (switch, sign-out): tasks that started
// under an earlier generation are stale even if the same account comes back.
let generation = 0;
// Bumped by every user-made notification choice: a task that read the stored
// choices before it must not write over it.
let manualChangeSeq = 0;
let watchingAccount = false;

/** The user changed a notification setting (push on/off, a category). */
export function noteManualNotificationChange(): void {
  manualChangeSeq += 1;
}

/** Start a task for `pubkey`, bound to the current account generation and
 * manual-change counter. */
export function beginDefaultSetup(pubkey: string): DefaultSetupTask {
  if (!watchingAccount) {
    watchingAccount = true;
    subscribeActivePubkey(() => {
      generation += 1;
    });
  }
  return { pubkey: pubkey.toLowerCase(), generation, manualSeq: manualChangeSeq, aborted: false };
}

/** THE guard: may `task` still act? Only while it was not aborted, no
 * account change or manual notification choice happened since it started,
 * and its account is the live one right now. */
export function isDefaultSetupCurrent(task: DefaultSetupTask): boolean {
  return (
    !task.aborted &&
    task.generation === generation &&
    task.manualSeq === manualChangeSeq &&
    getActivePubkey()?.toLowerCase() === task.pubkey
  );
}
