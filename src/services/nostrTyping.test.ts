/**
 * Unit tests for the ephemeral typing-indicator event shape. The event is the
 * compatibility-critical bit (kind + p-tag + NIP-40 expiration + empty content),
 * so pin it so a refactor can't silently change what peers subscribe for.
 */
import { buildTypingEvent, TYPING_INDICATOR_KIND, TYPING_EXPIRY_SECONDS } from './nostrTyping';

const PEER = 'a'.repeat(64);

it('uses the ephemeral typing kind (NIP-16 range 20000–29999)', () => {
  const e = buildTypingEvent(PEER, 1000);
  expect(e.kind).toBe(TYPING_INDICATOR_KIND);
  expect(TYPING_INDICATOR_KIND).toBeGreaterThanOrEqual(20000);
  expect(TYPING_INDICATOR_KIND).toBeLessThanOrEqual(29999);
});

it('p-tags the peer and carries no content (no message data leaks)', () => {
  const e = buildTypingEvent(PEER, 1000);
  expect(e.tags).toContainEqual(['p', PEER]);
  expect(e.content).toBe('');
});

it('sets an NIP-40 expiration TYPING_EXPIRY_SECONDS after created_at', () => {
  const e = buildTypingEvent(PEER, 1000);
  expect(e.created_at).toBe(1000);
  const exp = e.tags.find((t) => t[0] === 'expiration');
  expect(exp).toEqual(['expiration', String(1000 + TYPING_EXPIRY_SECONDS)]);
});
