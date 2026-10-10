import { sendClearingDraft, type DraftAccess } from './composerDraft';

function fakeDraft(initial: string): DraftAccess & { value: string } {
  const d = {
    value: initial,
    get: () => d.value,
    set: (v: string) => {
      d.value = v;
    },
  };
  return d;
}

describe('sendClearingDraft', () => {
  it('clears the input before the send resolves, and leaves it clear on success', async () => {
    const draft = fakeDraft('hello ');
    let seenDuringSend: string | undefined;
    const ok = await sendClearingDraft('hello ', draft, async () => {
      seenDuringSend = draft.value;
      return true;
    });
    expect(seenDuringSend).toBe('');
    expect(ok).toBe(true);
    expect(draft.value).toBe('');
  });

  it('restores the original text when the send fails or is cancelled', async () => {
    const draft = fakeDraft('hello ');
    const ok = await sendClearingDraft('hello ', draft, async () => false);
    expect(ok).toBe(false);
    expect(draft.value).toBe('hello ');
  });

  it('never clobbers what the user typed while the send was in flight', async () => {
    const draft = fakeDraft('hello');
    await sendClearingDraft('hello', draft, async () => {
      draft.set('something new');
      return false;
    });
    expect(draft.value).toBe('something new');
  });

  it('restores on a thrown send, then rethrows', async () => {
    const draft = fakeDraft('hello');
    await expect(
      sendClearingDraft('hello', draft, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(draft.value).toBe('hello');
  });
});
