import { renderHook } from '@testing-library/react-native';
import { stopNativeDmEngineGlobal } from './nativeDmEngine';
import { clearMemoisedSecretKey, nip04PlaintextCache } from './nostrSecretKeyCache';
import { useIdentityMemoryReset, type IdentityMemoryState } from './resetIdentityMemoryState';

jest.mock('./nativeDmEngine', () => ({ stopNativeDmEngineGlobal: jest.fn(async () => {}) }));
jest.mock('./nostrSecretKeyCache', () => ({
  clearMemoisedSecretKey: jest.fn(),
  nip04PlaintextCache: { clear: jest.fn() },
}));

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function setup(active: string | null) {
  const state: jest.Mocked<IdentityMemoryState> = {
    setProfile: jest.fn(),
    setContacts: jest.fn(),
    setDmInbox: jest.fn(),
    setAmberNip44Permission: jest.fn(),
    resetRelayLists: jest.fn(),
  };
  const setPubkey = jest.fn();
  const { result } = renderHook(() => useIdentityMemoryReset(active, setPubkey, state));
  return { state, setPubkey, result };
}

const expectReset = (state: jest.Mocked<IdentityMemoryState>, times: number) => {
  expect(state.setProfile).toHaveBeenCalledTimes(times);
  expect(state.setContacts).toHaveBeenCalledTimes(times);
  expect(state.setDmInbox).toHaveBeenCalledTimes(times);
  expect(state.resetRelayLists).toHaveBeenCalledTimes(times);
  expect(state.setAmberNip44Permission).toHaveBeenCalledTimes(times);
};

beforeEach(() => jest.clearAllMocks());

describe('useIdentityMemoryReset', () => {
  it("adding a second account drops the active account's in-memory state before activating", () => {
    const { state, setPubkey, result } = setup(A);
    result.current.activateLoginPubkey(B);
    expectReset(state, 1);
    expect(state.setProfile).toHaveBeenCalledWith(null);
    expect(state.setContacts).toHaveBeenCalledWith([]);
    expect(state.setDmInbox).toHaveBeenCalledWith([]);
    expect(clearMemoisedSecretKey).toHaveBeenCalled();
    expect(stopNativeDmEngineGlobal).toHaveBeenCalled();
    expect(nip04PlaintextCache.clear).toHaveBeenCalled();
    expect(setPubkey).toHaveBeenCalledWith(B);
    // Teardown happens before the new pubkey is set.
    expect(state.setProfile.mock.invocationCallOrder[0]).toBeLessThan(
      setPubkey.mock.invocationCallOrder[0],
    );
  });

  it('does not tear anything down for a first login or a re-login of the active account', () => {
    const loggedOut = setup(null);
    loggedOut.result.current.activateLoginPubkey(A);
    expectReset(loggedOut.state, 0);
    expect(loggedOut.setPubkey).toHaveBeenCalledWith(A);

    const same = setup(A);
    same.result.current.activateLoginPubkey(A);
    expectReset(same.state, 0);
  });

  it('resetIdentityMemory clears every per-account slice', () => {
    const { state, result } = setup(A);
    result.current.resetIdentityMemory();
    expectReset(state, 1);
    expect(state.setAmberNip44Permission).toHaveBeenCalledWith('unknown');
  });
});
