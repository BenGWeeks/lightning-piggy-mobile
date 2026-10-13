import { npubEncode } from 'nostr-tools/nip19';
import { relayExternalLink } from './relayExternalLink';
it.each([
  'javascript:alert(1)',
  'file:///etc/passwd',
  'http://unsafe.example',
  'https://user:pass@example.com',
  'nostr:bad',
])('blocks unsafe or malformed links: %s', (value) => {
  expect(relayExternalLink(value)).toBeNull();
});
it('supports HTTPS, mail contacts and Nostr profile links', () => {
  expect(relayExternalLink('https://example.com/policy')).toBe('https://example.com/policy');
  expect(relayExternalLink('primal.net')).toBe('https://primal.net');
  expect(relayExternalLink('mailto:operator@example.com')).toBe('mailto:operator@example.com');
  expect(relayExternalLink('operator@example.com')).toBe('mailto:operator@example.com');
  const uri = `nostr:${npubEncode('a'.repeat(64))}`;
  expect(relayExternalLink(uri)).toBe(uri);
  expect(relayExternalLink('nostr:npub1qqqqqqqq')).toBeNull();
});
