#!/usr/bin/env node
// Derive the pubkey for each MAESTRO_NSEC_{BIG,MIDDLE,LITTLE} fixture
// and print a mapping. Used by #78 cleanup to know which fixture nsec
// signs which leftover test event. Reads from env so nsecs never leave
// the user's shell:
//
//   source .env && node scripts/derive-piggy-pubkeys.mjs

import { getPublicKey } from 'nostr-tools/pure';
import * as nip19 from 'nostr-tools/nip19';

// Scan every env var whose name contains NSEC. Covers MAESTRO_NSEC_*
// fixtures plus any ad-hoc test accounts (TEST_ACCOUNT_*_NSEC etc.)
// — useful when an old test event was signed by a key whose role we
// forgot.
const matches = Object.entries(process.env).filter(([k]) => k.includes('NSEC'));
for (const [name, value] of matches) {
  if (!value) {
    console.log(`${name.padEnd(28)} (empty)`);
    continue;
  }
  try {
    const decoded = nip19.decode(value);
    if (decoded.type !== 'nsec') {
      console.log(`${name.padEnd(28)} (not a valid nsec)`);
      continue;
    }
    const pk = getPublicKey(decoded.data);
    console.log(`${name.padEnd(28)} ${pk}`);
  } catch (e) {
    console.log(`${name.padEnd(28)} error: ${e.message}`);
  }
}
