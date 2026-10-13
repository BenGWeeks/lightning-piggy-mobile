import { getWelcome, type MarmotClient } from '@internet-privacy/marmot-ts';
import { bytesToHex } from '@noble/hashes/utils.js';
import { hasWelcomeKeyPackage } from './marmotWelcomeFailure';
import type { MarmotRumor } from './marmotSession';

/** Validate this install's private key material before exposing invitation metadata. */
export async function previewInvitationWelcome(client: MarmotClient, rumor: MarmotRumor) {
  if (!(await hasWelcomeKeyPackage(client.keyPackages, getWelcome(rumor))))
    return { forThisDevice: false, groupId: undefined, group: null };
  const info = await client.readInviteGroupInfo(rumor);
  const preview = await client.previewWelcome(rumor);
  return {
    ...preview,
    forThisDevice: true,
    groupId: info ? bytesToHex(info.groupContext.groupId) : undefined,
  };
}
