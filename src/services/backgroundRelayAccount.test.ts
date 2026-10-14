import { loadIdentities } from './identitiesStore';
import { initialiseBackgroundRelayAccount } from './backgroundRelayAccount';
import { getCurrentUserPubkey, setCurrentUserPubkey } from './nostrActiveAccount';
import { TEST_ACCOUNT_PUBKEYS } from '../config/testRelayLockdown';

jest.mock('./identitiesStore', () => ({ loadIdentities: jest.fn() }));
afterEach(() => {
  setCurrentUserPubkey(null);
  jest.resetAllMocks();
});

it('restores a saved test account into a fresh headless mirror', async () => {
  const owner = [...TEST_ACCOUNT_PUBKEYS][0];
  setCurrentUserPubkey(null);
  jest.mocked(loadIdentities).mockResolvedValue({ activePubkey: owner, identities: [] });
  expect(await initialiseBackgroundRelayAccount()).toBe(owner);
  expect(getCurrentUserPubkey()).toBe(owner);
});

it.each([null, 'invalid'])(
  'fails closed with an unavailable active identity (%s)',
  async (activePubkey) => {
    jest.mocked(loadIdentities).mockResolvedValue({ activePubkey, identities: [] });
    expect(await initialiseBackgroundRelayAccount()).toBeNull();
  },
);

it('fails closed on storage errors', async () => {
  jest.mocked(loadIdentities).mockRejectedValue(new Error('storage locked'));
  expect(await initialiseBackgroundRelayAccount()).toBeNull();
});

it('does not overwrite a foreground account switch while loading', async () => {
  const owner = [...TEST_ACCOUNT_PUBKEYS][0];
  setCurrentUserPubkey(null);
  jest.mocked(loadIdentities).mockImplementation(async () => {
    setCurrentUserPubkey('a'.repeat(64));
    return { activePubkey: owner, identities: [] };
  });
  expect(await initialiseBackgroundRelayAccount()).toBeNull();
  expect(getCurrentUserPubkey()).toBe('a'.repeat(64));
});
