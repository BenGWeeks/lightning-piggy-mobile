import { connectedRelays, pool, pruneIdleRelays, trackRelays } from './nostrPool';

jest.mock('nostr-tools/pool', () => ({
  SimplePool: class {
    pruneIdleRelays = jest.fn();
  },
}));
jest.mock('./relayHealth', () => ({ hydrateRelayHealth: jest.fn() }));

it('prunes immediately and removes normalized idle URLs while retaining active relay bookkeeping', () => {
  connectedRelays.clear();
  trackRelays(['wss://hint', 'wss://HINT:443/', 'wss://active']);
  jest.mocked(pool.pruneIdleRelays).mockReturnValue(['wss://hint/']);
  pruneIdleRelays();
  expect(pool.pruneIdleRelays).toHaveBeenCalledWith(0);
  expect([...connectedRelays]).toEqual(['wss://active']);
});
