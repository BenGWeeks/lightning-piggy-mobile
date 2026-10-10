// Bounded inventory of an account's public invitation keys. No secrets leave storage.
import { getKeyPackageLifetime } from '@internet-privacy/marmot-ts';
import { type Event as NostrEvent, type Filter } from 'nostr-tools';
import { isRelayUrl, relayListFromTags } from '../utils/relayListEvents';
import { pool, trackRelays } from './nostrPool';
import { DEFAULT_RELAYS } from './nostrService';
import { newestEvent } from './marmotKeyPackages';
import { createSqliteMarmotBackend } from './marmotStore';
import { localKeyPackageFootprint, retireMarmotKeyPackages } from './marmotKeyPackageRetire';
import { getMarmotSession } from './marmotSession';
import type { EventTemplate } from 'nostr-tools';
import { KEY_PUBLICATION_PAUSED } from './marmotKeyMaintenance';

const MAX_RELAYS = 12;
const PER_RELAY_LIMIT = 100;
export interface InvitationKey {
  event: NostrEvent;
  slot: string;
  client: string;
  thisPhone: boolean;
  expires?: number;
  relays: string[];
}
export interface InvitationInventory {
  keys: InvitationKey[];
  partial: boolean;
  paused: boolean;
}
export type InventoryQuery = (relays: string[], filter: Filter) => Promise<NostrEvent[]>;
export const queryInvitationKeys: InventoryQuery = (relays, filter) => {
  trackRelays(relays);
  return new Promise((resolve, reject) => {
    const events: NostrEvent[] = [];
    // nostr-tools synthesizes EOSE at maxWait. Our earlier deadline must
    // reject first, otherwise a timed-out relay looks like a complete scan.
    let subscription: { close(): void } | undefined;
    const timer = setTimeout(() => {
      reject(new Error('Invitation-key relay timed out'));
      subscription?.close();
    }, 5000);
    subscription = pool.subscribeManyEose(relays, filter, {
      maxWait: 6000,
      onevent: (event) => events.push(event),
      onclose: (reasons) => {
        clearTimeout(timer);
        if (reasons.some((reason) => reason !== 'closed automatically on eose'))
          reject(new Error('Invitation-key relay unavailable'));
        else resolve(events);
      },
    });
  });
};

/** Keep all observed versions grouped by slot; an empty newest version retires that slot. */
export function shapeInvitationKeys(
  owner: string,
  responses: { relay: string; events: NostrEvent[] }[],
  localSlots: string[],
): InvitationKey[] {
  const byId = new Map<string, InvitationKey>();
  for (const { relay, events } of responses) {
    for (const event of events) {
      if (event.pubkey !== owner || event.kind !== 30443) continue;
      const slot = event.tags.find((t) => t[0] === 'd')?.[1];
      if (!slot) continue;
      const existing = byId.get(event.id);
      if (existing) {
        if (!existing.relays.includes(relay)) existing.relays.push(relay);
        continue;
      }
      let expires: number | undefined;
      try {
        const lifetime = getKeyPackageLifetime(event);
        if (lifetime) expires = Number(lifetime.notAfter);
      } catch {
        /* old / malformed keys remain removable */
      }
      byId.set(event.id, {
        event,
        slot,
        expires,
        relays: [relay],
        thisPhone: localSlots.includes(slot),
        client: event.tags.find((t) => t[0] === 'client')?.[1] ?? '',
      });
    }
  }
  const newest = new Map<string, NostrEvent>();
  for (const key of byId.values())
    newest.set(
      key.slot,
      newestEvent([key.event, ...(newest.has(key.slot) ? [newest.get(key.slot)!] : [])])!,
    );
  return [...byId.values()]
    .filter((key) => key.event.content && newest.get(key.slot)?.content)
    .sort(
      (a, b) =>
        a.slot.localeCompare(b.slot) ||
        b.event.created_at - a.event.created_at ||
        a.event.id.localeCompare(b.event.id),
    );
}

export async function loadInvitationKeys(
  owner: string,
  relays: string[],
  fetch: InventoryQuery = queryInvitationKeys,
): Promise<InvitationInventory> {
  const backend = createSqliteMarmotBackend(owner);
  const lookup = [...new Set([...relays, ...DEFAULT_RELAYS])]
    .filter(isRelayUrl)
    .slice(0, MAX_RELAYS);
  let discoveryFailed = false;
  const lists = await fetch(lookup, { kinds: [10002], authors: [owner], limit: 5 }).catch(() => {
    discoveryFailed = true;
    return [];
  });
  const latest = newestEvent(lists.filter((e) => e.pubkey === owner && e.kind === 10002));
  const allTargets = [
    ...new Set([...(latest ? relayListFromTags(latest.tags).map((r) => r.url) : []), ...lookup]),
  ].filter(isRelayUrl);
  const targets = allTargets.slice(0, MAX_RELAYS);
  // No since: old and expired packages are precisely what this screen manages.
  const results = await Promise.allSettled(
    targets.map(async (relay) => ({
      relay,
      events: await fetch([relay], { kinds: [30443], authors: [owner], limit: PER_RELAY_LIMIT }),
    })),
  );
  const responses = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
  if (!responses.length) throw new Error('Invitation-key relays unavailable');
  const local = await localKeyPackageFootprint(backend);
  return {
    keys: shapeInvitationKeys(owner, responses, local.slots),
    partial:
      discoveryFailed ||
      allTargets.length > MAX_RELAYS ||
      results.some((r) => r.status === 'rejected') ||
      responses.some((r) => r.events.length >= PER_RELAY_LIMIT),
    paused: (await backend.get('meta', KEY_PUBLICATION_PAUSED)) === 'true',
  };
}

/** Only whole old slots: never retire a newer key because an older version is old. */
export function oldInvitationKeys(
  keys: InvitationKey[],
  now = Math.floor(Date.now() / 1000),
): InvitationKey[] {
  const slots = new Map<string, InvitationKey[]>();
  for (const key of keys) slots.set(key.slot, [...(slots.get(key.slot) ?? []), key]);
  return [...slots.values()]
    .filter((versions) =>
      versions.every(
        (key) =>
          !key.thisPhone &&
          (key.event.created_at < now - 30 * 86400 ||
            (key.expires !== undefined && key.expires < now)),
      ),
    )
    .flat();
}

export async function removeInvitationKeys(args: {
  owner: string;
  selected: InvitationKey[];
  inventory: InvitationKey[];
  relays: string[];
  sign: (template: EventTemplate) => Promise<NostrEvent>;
  isCurrent: () => boolean;
}): Promise<void> {
  if (!args.isCurrent() || !args.selected.length) throw new Error('Account changed');
  if (args.selected.some((key) => key.event.pubkey !== args.owner || key.event.kind !== 30443))
    throw new Error('Invitation key belongs to another account');
  const selectedIds = new Set(args.selected.map((k) => k.event.id));
  const slots = [...new Set(args.selected.map((k) => k.slot))].filter((slot) =>
    args.inventory.filter((k) => k.slot === slot).every((k) => selectedIds.has(k.event.id)),
  );
  const local = args.selected.some((k) => k.thisPhone && slots.includes(k.slot));
  const session = getMarmotSession();
  const backend = createSqliteMarmotBackend(args.owner);
  if (local) {
    if (session?.pubkey !== args.owner) throw new Error('Marmot session unavailable');
    await session.pauseInvitationKey();
  }
  const outcome = await retireMarmotKeyPackages({
    owner: args.owner,
    relays: [...new Set([...args.relays, ...args.selected.flatMap((k) => k.relays)])],
    footprint: { slots, eventIds: [...selectedIds] },
    sign: async (template) => {
      if (!args.isCurrent()) throw new Error('Account changed');
      const signed = await args.sign(template);
      if (!args.isCurrent()) throw new Error('Account changed');
      return signed;
    },
  });
  if (local)
    await backend.set('meta', 'keyPackageResumeAfter', String(Math.floor(Date.now() / 1000) + 2));
  // Leave local publication paused even after partial failure: otherwise it
  // could immediately undo an accepted deletion. Refresh is the explicit retry.
  if (outcome !== 'deleted') throw new Error('Invitation-key removal incomplete');
}
