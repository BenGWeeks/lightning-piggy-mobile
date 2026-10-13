import { preferredDmProtocol } from '../services/preferredDmProtocol';
import type { DmProtocol } from './dmProtocol';

/** A Receive sheet opened in a thread preserves its protocol only for that
 * peer; choosing someone else starts a conversation using their preference. */
export function receiveFriendProtocol(
  viewer: string | null,
  peer: string,
  presetPeer?: string,
  presetProtocol?: DmProtocol,
): Promise<DmProtocol> {
  return preferredDmProtocol(
    viewer,
    peer,
    peer.toLowerCase() === presetPeer?.toLowerCase() ? presetProtocol : undefined,
  );
}
