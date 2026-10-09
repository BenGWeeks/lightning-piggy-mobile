// Hands decrypted kind-444 Welcomes (Marmot group invites) from the NIP-17
// inbox paths to the active Marmot session. Welcomes are delivered as NIP-59
// gift wraps exactly like NIP-17 DMs, so the existing unwrap + follow-gate
// pipeline already decrypts them; this only routes the rumor onward. A
// Welcome that arrives before the session starts (cold start) is queued.

import { getEventHash } from 'nostr-tools';

import { MARMOT_WELCOME_KIND } from '../utils/dmProtocol';
import type { DecodedRumor } from '../utils/nip17Unwrap';
import { getMarmotSession, subscribeMarmotSession, type MarmotRumor } from './marmotSession';

const MAX_PENDING = 50;
const pending: { owner: string; rumor: MarmotRumor }[] = [];

function deliver(owner: string, rumor: MarmotRumor): boolean {
  const session = getMarmotSession();
  if (!session || session.pubkey !== owner) return false;
  void session.acceptWelcome(rumor);
  return true;
}

/** Route `rumor` if it's an inbound Marmot Welcome for `owner`. */
export function routeMarmotWelcome(rumor: DecodedRumor, owner: string): void {
  if (rumor.kind !== MARMOT_WELCOME_KIND) return;
  if (rumor.pubkey.toLowerCase() === owner.toLowerCase()) return; // our own invite
  let full: MarmotRumor;
  try {
    full = { ...rumor, id: getEventHash(rumor) };
  } catch {
    return; // malformed rumor (bad pubkey) — nothing to join
  }
  if (deliver(owner, full)) return;
  if (pending.length >= MAX_PENDING) pending.shift();
  pending.push({ owner, rumor: full });
}

subscribeMarmotSession((session) => {
  if (!session) return;
  for (let i = pending.length - 1; i >= 0; i--) {
    const item = pending[i];
    if (item.owner === session.pubkey && deliver(item.owner, item.rumor)) pending.splice(i, 1);
  }
});
