export const LIGHTNING_PIGGY_TEAM_NPUB =
  'npub1y2qcaseaspuwvjtyk4suswdhgselydc42ttlt0t2kzhnykne7s5swvaffq';

export const BOLTZ_SUPPORT_NPUB = 'npub1psm37hke2pmxzdzraqe3cjmqs28dv77da74pdx8mtn5a0vegtlas9q8970';

export const DEV_DM_NPUB = 'npub1jutptdc2m8kgjmudtws095qk2tcale0eemvp4j2xnjnl4nh6669slrf04x';

// Dev builds reroute support DMs to DEV_DM_NPUB so test sends don't reach
// real recipients. Flip off if you need to smoke-test the real inbox.
const DEV_ROUTE_DMS_TO_SELF = true;

export function dmRecipient(prodNpub: string): string {
  if (__DEV__ && DEV_ROUTE_DMS_TO_SELF) return DEV_DM_NPUB;
  return prodNpub;
}
