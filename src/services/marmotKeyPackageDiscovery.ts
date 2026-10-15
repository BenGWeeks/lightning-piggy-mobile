// Persist discovery receipts per account, so startup/resume never republishes
// unchanged keys/lists. Upgrades copy the existing signed key to the new relays.
import type { MarmotClient } from '@internet-privacy/marmot-ts';
import type { Event as NostrEvent } from 'nostr-tools';

import { isTestRelayLockdown, TEST_RELAY_URL } from '../config/testRelayLockdown';
import { RELAY_LIST_INDEXERS } from '../utils/relayListEvents';
import { selectHealthyRelays } from './relayHealth';
import {
  currentKeyPackage,
  maintainKeyPackage,
  type MaintainKeyPackageOptions,
} from './marmotKeyPackageLifecycle';
import { newestEvent } from './marmotKeyPackages';
import {
  buildKeyPackageRelayList,
  cleanKeyPackageRelays,
  keyPackagePublishRelays,
} from './marmotKeyPackageRelays';
import type { MarmotKvBackend } from './marmotStore';

export async function maintainDiscoverableKeyPackage(
  client: Pick<MarmotClient, 'keyPackages' | 'network' | 'signer'>,
  backend: MarmotKvBackend,
  owner: string,
  opts: MaintainKeyPackageOptions,
): Promise<'published' | 'unchanged' | 'failed'> {
  try {
    const outcome = await maintainDiscovery(client, backend, owner, opts);
    if (!opts.cancelled?.())
      await backend.set('keyPackageDiscovery', 'failed', String(outcome === 'failed'));
    return outcome;
  } catch (error) {
    if (!opts.cancelled?.()) await backend.set('keyPackageDiscovery', 'failed', 'true');
    throw error;
  }
}

async function maintainDiscovery(
  client: Pick<MarmotClient, 'keyPackages' | 'network' | 'signer'>,
  backend: MarmotKvBackend,
  owner: string,
  opts: MaintainKeyPackageOptions,
): Promise<'published' | 'unchanged' | 'failed'> {
  const relays = keyPackagePublishRelays(owner, opts.relays);
  // Include copies of older signed keys in sign-out retirement, whose
  // embedded relay tags still name only the original publication targets.
  if (opts.cancelled?.()) return 'failed';
  const oldRelays = JSON.parse(
    (await backend.get('keyPackageDiscovery', 'relays')) ?? '[]',
  ) as string[];
  if (opts.cancelled?.()) return 'failed';
  await backend.set(
    'keyPackageDiscovery',
    'relays',
    JSON.stringify([...new Set([...oldRelays, ...relays])]),
  );
  const outcome = await maintainKeyPackage(client.keyPackages, { ...opts, relays });
  if (outcome === 'failed' || opts.cancelled?.()) return 'failed';
  const current = currentKeyPackage(await client.keyPackages.list(), opts.slot);
  const event = newestEvent((current?.published ?? []) as NostrEvent[]);
  if (!event || opts.cancelled?.()) return 'failed';
  const namespace = 'keyPackageDiscovery';
  const fingerprint = JSON.stringify([...relays].sort());
  const receipt = `${event.id}:${fingerprint}`;
  const publish = async (targets: string[], signed: NostrEvent) => {
    if (opts.cancelled?.()) throw new Error('marmot: discovery cancelled');
    const result = await client.network.publish(selectHealthyRelays(targets), signed);
    if (opts.cancelled?.()) throw new Error('marmot: discovery cancelled');
    if (!Object.values(result).some((r) => r.ok)) throw new Error('marmot: discovery not accepted');
  };
  if ((await backend.get(namespace, 'key')) !== receipt) {
    // create() already published a fresh key to these relays. An unchanged
    // key on upgrade/relay edits only needs copying, never another signature.
    if (outcome !== 'published') await publish(relays, event);
    await backend.set(namespace, 'key', receipt);
  }
  const previousList = await backend.get(namespace, 'list');
  if (previousList !== fingerprint) {
    const pending = await backend.get(namespace, 'pendingList');
    const cached = pending ? (JSON.parse(pending) as NostrEvent) : undefined;
    let signed =
      cached && JSON.stringify(cached.tags.map((t) => t[1]).sort()) === fingerprint
        ? cached
        : undefined;
    if (!signed) {
      const previous = Number(await backend.get(namespace, 'timestamp')) || 0;
      const draft = buildKeyPackageRelayList(
        owner,
        relays,
        Math.max(Math.floor(Date.now() / 1000), previous + 1),
      );
      if (opts.cancelled?.()) throw new Error('marmot: discovery cancelled');
      signed = (await client.signer.signEvent(draft)) as NostrEvent;
      if (opts.cancelled?.()) throw new Error('marmot: discovery cancelled');
      await backend.set(namespace, 'timestamp', String(signed.created_at));
      await backend.set(namespace, 'pendingList', JSON.stringify(signed));
    }
    await publish(
      isTestRelayLockdown(owner)
        ? [TEST_RELAY_URL]
        : [
            ...new Set([
              ...relays,
              ...cleanKeyPackageRelays(previousList ? (JSON.parse(previousList) as string[]) : []),
              ...RELAY_LIST_INDEXERS,
            ]),
          ],
      signed,
    );
    await backend.set(namespace, 'list', fingerprint);
  }
  return outcome;
}
