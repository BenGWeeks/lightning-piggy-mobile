import { withPeerName, indexMessagesById, resolveQuote } from './messageQuote';
import { sanitizeDisplayText } from './sanitizeDisplayText';

const msgs = [
  { id: 'e1', fromMe: true, text: 'hello', wireKind: 14 },
  { id: 'local-1', rumorId: 'e2', fromMe: false, text: 'hi back', wireKind: 14 },
  { id: 'e3', fromMe: false, text: 'https://x/y#lpe=1&k=secret&n=nonce', wireKind: 15 },
];

describe('resolveQuote', () => {
  const byId = indexMessagesById(msgs);
  it('quotes the parent by message id or rumor id', () => {
    expect(resolveQuote('e1', byId)).toEqual({ text: 'hello', fromMe: true });
    expect(resolveQuote('e2', byId)).toEqual({ text: 'hi back', fromMe: false });
  });
  it('redacts a quoted attachment instead of leaking its key', () => {
    expect(resolveQuote('e3', byId)?.text).not.toContain('secret');
  });
  it('marks a parent outside the thread as unavailable', () => {
    expect(resolveQuote('gone', byId)).toEqual({ text: null, fromMe: false });
  });
  it('is undefined for a message that is not a reply', () => {
    expect(resolveQuote(undefined, byId)).toBeUndefined();
  });
});

describe('withPeerName', () => {
  it("names the contact for a 1:1 parent that isn't ours, and leaves the rest", () => {
    expect(withPeerName({ text: 'hi', fromMe: false }, 'Little Piggy')).toEqual({
      text: 'hi',
      fromMe: false,
      authorName: 'Little Piggy',
    });
    const mine = { text: 'hi', fromMe: true };
    expect(withPeerName(mine, 'Little Piggy')).toBe(mine);
    const named = { text: 'hi', fromMe: false, authorName: 'Bob' };
    expect(withPeerName(named, 'Little Piggy')).toBe(named);
    expect(withPeerName(undefined, 'Little Piggy')).toBeUndefined();
  });
});

it('sanitises the quoted preview like the bubble (no U+FFFC box)', () => {
  const byId = indexMessagesById([{ id: 'p', fromMe: false, text: 'hello\uFFFC' }]);
  expect(resolveQuote('p', byId)?.text).toBe(sanitizeDisplayText('hello\uFFFC'));
  expect(resolveQuote('p', byId)?.text).not.toContain('\uFFFC');
});
