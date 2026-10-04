import { parseNwcLud16 } from './nwcLud16';
it.each([' @ ', 'alice@', '@example.com', 'a@b@c', 'a b@host'])(
  'rejects invalid advertised address %s',
  (value) => {
    expect(
      parseNwcLud16(`nostr+walletconnect://host?lud16=${encodeURIComponent(value)}`),
    ).toBeNull();
  },
);
it('trims valid advertised addresses', () => {
  expect(parseNwcLud16('nostr+walletconnect://host?lud16=%20alice%40example.com%20')).toBe(
    'alice@example.com',
  );
});
