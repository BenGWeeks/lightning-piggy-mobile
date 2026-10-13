import { relayAcceptedKinds, relayAllowsKind } from './relayKindPolicy';
import { fetchRelayInformation, parseRelayInformation } from './relayInformation';
jest.mock('./relayInformation', () => ({
  ...jest.requireActual('./relayInformation'),
  fetchRelayInformation: jest.fn(),
}));
const fetchInfo = fetchRelayInformation as jest.Mock;
beforeEach(() => fetchInfo.mockResolvedValue(null));
it.each([10050, 10063])(
  'does not send kind %s to user.kindpag.es, including URL variants',
  async (kind) => {
    expect(await relayAllowsKind('wss://USER.kindpag.es/', kind)).toBe(false);
    expect(await relayAllowsKind('wss://purplepag.es', kind)).toBe(true);
  },
);
it('allows 10002 at both indexers and leaves unknown relays unrestricted', async () => {
  expect(await relayAllowsKind('wss://user.kindpag.es', 10002)).toBe(true);
  expect(await relayAllowsKind('wss://unknown.example', 10063)).toBe(true);
});
it('NIP-11 overrides notes, including an explicit empty allowed list', async () => {
  fetchInfo.mockResolvedValue(parseRelayInformation({ limitation: { allowed_kinds: [10050] } }));
  expect(await relayAllowsKind('wss://user.kindpag.es', 10050)).toBe(true);
  expect(await relayAllowsKind('wss://user.kindpag.es', 10002)).toBe(false);
  fetchInfo.mockResolvedValue(parseRelayInformation({ limitation: { allowed_kinds: [] } }));
  expect(await relayAllowsKind('wss://unknown.example', 10002)).toBe(false);
});
it('marks built-in information as notes without applying it to unrelated endpoints', () => {
  expect(relayAcceptedKinds('wss://user.kindpag.es', null)).toEqual({
    source: 'notes',
    kinds: [0, 3, 10002],
  });
  expect(relayAcceptedKinds('wss://user.kindpag.es/other', null)).toBeNull();
});
it('does not mistake inherited object keys for built-in relay policies', async () => {
  expect(await relayAllowsKind('wss://constructor', 10063)).toBe(true);
  expect(await relayAllowsKind('wss://__proto__', 10063)).toBe(true);
});
