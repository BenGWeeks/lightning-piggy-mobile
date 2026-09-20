import { pinNip04IfNoInfoEvent, clearEncryptionDecision } from './nwcEncryption';
import type { NostrWebLNProvider } from '@getalby/sdk';
it('an old failed probe cannot repopulate a removed credential decision', async () => {
  let fail!: (error: Error) => void;
  const old = {
    client: {
      getWalletServiceInfo: () =>
        new Promise((_, reject) => {
          fail = reject;
        }),
    },
  };
  const pending = pinNip04IfNoInfoEvent(old as unknown as NostrWebLNProvider, 'wallet');
  clearEncryptionDecision('wallet');
  fail(new Error('no info event'));
  await pending;
  const probe = jest.fn(async () => ({}));
  const fresh = { client: { getWalletServiceInfo: probe } };
  await pinNip04IfNoInfoEvent(fresh as unknown as NostrWebLNProvider, 'wallet');
  expect(probe).toHaveBeenCalledTimes(1);
  clearEncryptionDecision('wallet');
});
