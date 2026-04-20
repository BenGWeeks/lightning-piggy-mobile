/**
 * Centralized Nostr recipient identifiers.
 *
 * These are public identifiers, not secrets — they belong in source, not .env.
 * Putting them in one place keeps the DM-recipient flows (team feedback,
 * Boltz support) consistent and easy to audit.
 *
 * During development, outbound support/feedback DMs are rerouted to the
 * developer's own npub so test sends don't spam real support inboxes.
 * Flip `DEV_ROUTE_DMS_TO_SELF` off if you explicitly want to test against
 * the real recipients.
 */

/** Lightning Piggy team — receives in-app feedback DMs from Account screen. */
export const LIGHTNING_PIGGY_TEAM_NPUB =
  'npub1y2qcaseaspuwvjtyk4suswdhgselydc42ttlt0t2kzhnykne7s5swvaffq';

/** Boltz support — receives DMs from the transaction detail sheet for swap
 *  transactions. Verified against Boltz's public Nostr profile on damus.io
 *  and nostr.com (`Boltz - Non-Custodial Bitcoin Bridge`). */
export const BOLTZ_SUPPORT_NPUB =
  'npub1psm37hke2pmxzdzraqe3cjmqs28dv77da74pdx8mtn5a0vegtlas9q8970';

/** Developer npub for dev-build DM reroute (Ben). */
export const DEV_DM_NPUB =
  'npub1jutptdc2m8kgjmudtws095qk2tcale0eemvp4j2xnjnl4nh6669slrf04x';

/** When true in __DEV__, all outbound support DMs go to DEV_DM_NPUB instead
 *  of their real recipient so test runs don't reach real support inboxes. */
const DEV_ROUTE_DMS_TO_SELF = true;

/** Pick the effective DM recipient, applying the dev-reroute in __DEV__. */
export function dmRecipient(prodNpub: string): string {
  if (__DEV__ && DEV_ROUTE_DMS_TO_SELF) return DEV_DM_NPUB;
  return prodNpub;
}
