/**
 * Unit tests for `parseFoundLog` — flattens a kind-7516 found-log event
 * into the row shape, and (the behaviour added in #764) strips orphaned
 * placeholder characters from the finder's note so they don't render as a
 * tofu box.
 */
import type { VerifiedEvent } from 'nostr-tools';
import { parseFoundLog } from './foundLog';

// Minimal kind-7516 event; only the fields parseFoundLog reads matter.
const makeEvent = (over: Partial<VerifiedEvent> = {}): VerifiedEvent =>
  ({
    id: 'evt-id',
    pubkey: 'author-pubkey',
    created_at: 1717000000,
    kind: 7516,
    content: 'Found it!',
    tags: [],
    sig: 'sig',
    ...over,
  }) as VerifiedEvent;

describe('parseFoundLog', () => {
  it('strips a trailing U+FFFC tofu placeholder from the note (#764)', () => {
    const log = parseFoundLog(makeEvent({ content: 'Stay out!\uFFFC' }));
    expect(log.content).toBe('Stay out!');
  });

  it('maps id / pubkey / createdAt straight through', () => {
    const log = parseFoundLog(makeEvent({ id: 'x', pubkey: 'p', created_at: 42 }));
    expect(log).toMatchObject({ id: 'x', pubkey: 'p', createdAt: 42 });
  });

  it('reads the image tag, or null when absent', () => {
    expect(parseFoundLog(makeEvent({ tags: [['image', 'https://i/x.png']] })).imageUrl).toBe(
      'https://i/x.png',
    );
    expect(parseFoundLog(makeEvent()).imageUrl).toBeNull();
  });

  it('parses a positive amount tag, and nulls a missing / zero / invalid one', () => {
    expect(parseFoundLog(makeEvent({ tags: [['amount', '21']] })).amountSats).toBe(21);
    expect(parseFoundLog(makeEvent({ tags: [['amount', '0']] })).amountSats).toBeNull();
    expect(parseFoundLog(makeEvent({ tags: [['amount', 'nope']] })).amountSats).toBeNull();
    expect(parseFoundLog(makeEvent()).amountSats).toBeNull();
  });
});
