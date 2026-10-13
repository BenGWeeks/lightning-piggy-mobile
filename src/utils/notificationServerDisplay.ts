import { nip19 } from 'nostr-tools';

import type { PushServer } from '../services/marmotPushRegistration';

/** The stored override owns the card; removing it restores the app's built-in server. */
export function notificationServerDisplay(
  custom: PushServer | null,
  builtIn: PushServer,
  profileName: string | null,
  defaultName: string,
) {
  const server = custom ?? builtIn;
  const npub = nip19.npubEncode(server.pubkey);
  const shortNpub = `${npub.slice(0, 12)}…${npub.slice(-6)}`;
  return {
    server,
    npub,
    shortNpub,
    isDefault: custom === null,
    canReset: custom !== null,
    name: profileName?.trim() || (custom ? shortNpub : defaultName),
  };
}
