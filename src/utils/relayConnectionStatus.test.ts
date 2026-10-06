import { connectionStatusByAppUrl } from './relayConnectionStatus';

describe('connectionStatusByAppUrl (#1147)', () => {
  it("finds a relay by the app's URL form despite nostr-tools' trailing slash", () => {
    const status = connectionStatusByAppUrl(
      new Map([
        ['wss://relay.damus.io/', true],
        ['wss://nos.lol/', false],
      ]),
    );
    expect(status.get('wss://relay.damus.io')).toBe(true);
    expect(status.get('wss://nos.lol')).toBe(false);
  });

  it('keeps a relay path, and treats either duplicate being connected as connected', () => {
    const status = connectionStatusByAppUrl(
      new Map([
        ['wss://relay.example.com/inbox', true],
        ['wss://nostr.mom/', false],
        ['wss://nostr.mom', true],
      ]),
    );
    expect(status.get('wss://relay.example.com/inbox')).toBe(true);
    expect(status.get('wss://nostr.mom')).toBe(true);
  });
});
