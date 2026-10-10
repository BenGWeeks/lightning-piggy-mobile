// The composer clears its input the moment Send is tapped — the optimistic
// bubble is already above it, so leaving the text in the box for the whole
// encrypt / sign / publish (longer with Amber) reads as a duplicate. If the
// send doesn't go (it failed, or the user cancelled the NIP-17 fallback
// dialog) the text comes back — unless they've started typing something new.

export interface DraftAccess {
  /** The input's current text (a ref read, so it sees typing mid-send). */
  get: () => string;
  set: (value: string) => void;
}

/** Clear `draft`, run `send`, and restore `original` if it reports false (or
 * throws) while the input is still empty. Returns `send`'s result. */
export async function sendClearingDraft(
  original: string,
  draft: DraftAccess,
  send: () => Promise<boolean>,
): Promise<boolean> {
  draft.set('');
  let ok = false;
  try {
    ok = await send();
    return ok;
  } finally {
    if (!ok && draft.get() === '') draft.set(original);
  }
}
