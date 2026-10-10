import {
  applyScopedDmInboxUpdate,
  EMPTY_DM_INBOX,
  INITIAL_SCOPED_DM_INBOX,
  selectScopedDmInbox,
  type ScopedDmInbox,
} from './dmInboxScope';
import type { DmInboxEntry } from '../utils/conversationSummaries';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const entry = (id: string): DmInboxEntry => ({
  id,
  partnerPubkey: 'c'.repeat(64),
  fromMe: false,
  createdAt: 1,
  text: id,
  wireKind: 14,
});

describe('selectScopedDmInbox', () => {
  it("exposes only the active account's entries", () => {
    const state: ScopedDmInbox = { owner: A, entries: [entry('a1')] };
    expect(selectScopedDmInbox(state, A)).toEqual([entry('a1')]);
    expect(selectScopedDmInbox(state, B)).toBe(EMPTY_DM_INBOX);
    expect(selectScopedDmInbox(state, null)).toBe(EMPTY_DM_INBOX);
  });
});

describe('applyScopedDmInboxUpdate', () => {
  it('drops a write from an account that is no longer active', () => {
    const prev: ScopedDmInbox = { owner: B, entries: [entry('b1')] };
    expect(applyScopedDmInboxUpdate(prev, A, B, [entry('a1')])).toBe(prev);
    expect(applyScopedDmInboxUpdate(prev, A, B, (p) => [...p, entry('a1')])).toBe(prev);
  });

  it("never builds the new owner's list on the previous owner's entries", () => {
    const prev: ScopedDmInbox = { owner: A, entries: [entry('a1')] };
    const next = applyScopedDmInboxUpdate(prev, B, B, (p) => [entry('b1'), ...p]);
    expect(next).toEqual({ owner: B, entries: [entry('b1')] });
  });

  it("appends to the active owner's own entries", () => {
    const prev: ScopedDmInbox = { owner: A, entries: [entry('a1')] };
    const next = applyScopedDmInboxUpdate(prev, A, A, (p) => [entry('a2'), ...p]);
    expect(next.entries.map((e) => e.id)).toEqual(['a2', 'a1']);
  });

  it('returns the same state object for a no-op functional update', () => {
    const prev: ScopedDmInbox = { owner: A, entries: [entry('a1')] };
    expect(applyScopedDmInboxUpdate(prev, A, A, (p) => p)).toBe(prev);
  });

  it('claims an unowned initial state for the active writer', () => {
    const next = applyScopedDmInboxUpdate(INITIAL_SCOPED_DM_INBOX, A, A, [entry('a1')]);
    expect(next).toEqual({ owner: A, entries: [entry('a1')] });
  });
});
