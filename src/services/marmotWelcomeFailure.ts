// Whether a Welcome (kind 444) that failed to join can NEVER be joined here,
// so it may be marked handled and dropped instead of retried next start.
//
// Decided from the Welcome itself, not the error text: marmot-ts tries every
// key package we hold and reports only the LAST error, so a failure on the
// genuinely matching key (e.g. a transient store error) can surface as "No
// matching secret" from an unrelated retained key. Dropping that invite
// would lose a valid chat for good.

import { getWelcome, type KeyPackageManager } from '@internet-privacy/marmot-ts';

type WelcomeRumor = Parameters<typeof getWelcome>[0];

/** Structurally invalid Welcome rumors — no key package can ever open them. */
const MALFORMED_WELCOME = /Invalid welcome event|Expected welcome event kind/i;

/**
 * Permanent when the rumor is malformed, or when no key package we still
 * hold private material for is one the Welcome was encrypted to (RFC 9420
 * KeyPackageRef match): it was meant for another device, or for a key we
 * have deleted. Anything else — including a failed join with a matching
 * key — stays retryable. A store error while checking is treated as
 * transient.
 */
export async function isPermanentWelcomeFailure(
  keyPackages: Pick<KeyPackageManager, 'selectForWelcome'>,
  rumor: WelcomeRumor,
  error: unknown,
): Promise<boolean> {
  if (MALFORMED_WELCOME.test(String((error as Error)?.message ?? error))) return true;
  let welcome: ReturnType<typeof getWelcome>;
  try {
    welcome = getWelcome(rumor);
  } catch {
    return true; // undecodable — can never be joined
  }
  try {
    const candidates = await keyPackages.selectForWelcome(welcome);
    return !candidates.some((c) => c.hasMatchingSecret);
  } catch {
    return false;
  }
}
