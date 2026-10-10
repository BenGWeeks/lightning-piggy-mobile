import Toast from '../components/BrandedToast';
import { retireMarmotKeyPackages } from './marmotKeyPackageRetire';
import { retireInvitationKeys } from './marmotInvitationKeySignOut';
import { createMarmotSigner } from './marmotSigner';
import { getActiveConnection } from './nostrConnectService';

jest.mock('../components/BrandedToast', () => ({
  __esModule: true,
  default: { show: jest.fn(), hide: jest.fn() },
}));
jest.mock('./marmotSession', () => ({ quiesceMarmotSession: jest.fn(async () => undefined) }));
jest.mock('./marmotSigner', () => ({
  createMarmotSigner: jest.fn(() => ({ signEvent: jest.fn() })),
}));
jest.mock('./nostrConnectService', () => ({ getActiveConnection: jest.fn() }));
jest.mock('./marmotKeyPackageRetire', () => ({ retireMarmotKeyPackages: jest.fn() }));

const OWNER = 'a'.repeat(64);
const retire = retireMarmotKeyPackages as jest.Mock;

describe('retireInvitationKeys', () => {
  beforeEach(() => jest.clearAllMocks());

  it("never asks another account's NIP-46 bunker — no signer, no wait", async () => {
    (getActiveConnection as jest.Mock).mockReturnValue({ userPubkey: 'b'.repeat(64) });
    retire.mockResolvedValue('failed');
    expect(await retireInvitationKeys({ owner: OWNER, signerType: 'nip46' })).toBe('failed');
    expect(retire.mock.calls[0][0].sign).toBeNull();
    expect(createMarmotSigner).not.toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledWith(
      expect.objectContaining({ text1: expect.stringMatching(/not removed/i) }),
    );
  });

  it('shows progress while a remote signer is asked, then hides it', async () => {
    retire.mockImplementation(async (opts: { onBeforeSign: () => void }) => {
      opts.onBeforeSign();
      expect(Toast.show).toHaveBeenCalledWith(expect.objectContaining({ autoHide: false }));
      return 'deleted';
    });
    expect(await retireInvitationKeys({ owner: OWNER, signerType: 'amber' })).toBe('deleted');
    expect(retire.mock.calls[0][0].sign).toEqual(expect.any(Function));
    expect(Toast.hide).toHaveBeenCalled();
    expect(Toast.show).toHaveBeenCalledTimes(1); // no failure toast
  });

  it('signs silently for a local key (no progress toast)', async () => {
    retire.mockImplementation(async (opts: { onBeforeSign: () => void }) => {
      opts.onBeforeSign();
      return 'deleted';
    });
    await retireInvitationKeys({ owner: OWNER, signerType: 'nsec' });
    expect(Toast.show).not.toHaveBeenCalled();
  });
});
