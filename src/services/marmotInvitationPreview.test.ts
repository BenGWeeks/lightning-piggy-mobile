import { getWelcome, type MarmotClient } from '@internet-privacy/marmot-ts';
import { previewInvitationWelcome } from './marmotInvitationPreview';
import type { MarmotRumor } from './marmotSession';

jest.mock('@internet-privacy/marmot-ts', () => ({ getWelcome: jest.fn() }));
const rumor = { id: 'welcome' } as MarmotRumor;

it('uses the same KeyPackageRef/private-secret selection as auto-join before reading group metadata', async () => {
  const welcome = { secrets: [] };
  (getWelcome as jest.Mock).mockReturnValue(welcome);
  const client = {
    keyPackages: { selectForWelcome: jest.fn().mockResolvedValue([{ hasMatchingSecret: false }]) },
    readInviteGroupInfo: jest.fn(),
    previewWelcome: jest.fn(),
  };
  expect(await previewInvitationWelcome(client as unknown as MarmotClient, rumor)).toEqual({
    forThisDevice: false,
    groupId: undefined,
    group: null,
  });
  expect(client.keyPackages.selectForWelcome).toHaveBeenCalledWith(welcome);
  expect(client.readInviteGroupInfo).not.toHaveBeenCalled();
  expect(client.previewWelcome).not.toHaveBeenCalled();
});

it('exposes the MLS group id when this install holds a matching secret', async () => {
  const client = {
    keyPackages: {
      selectForWelcome: jest
        .fn()
        .mockResolvedValue([{ hasMatchingSecret: false }, { hasMatchingSecret: true }]),
    },
    readInviteGroupInfo: jest
      .fn()
      .mockResolvedValue({ groupContext: { groupId: new Uint8Array([1, 2]) } }),
    previewWelcome: jest.fn().mockResolvedValue({ group: { name: 'Family' } }),
  };
  expect(await previewInvitationWelcome(client as unknown as MarmotClient, rumor)).toEqual({
    forThisDevice: true,
    groupId: '0102',
    group: { name: 'Family' },
  });
});
