// The account's invitation keys (kind-30443 key packages) seen on relays,
// shaped into one entry per device for "Devices that can get new chats"
// (#1236). Each install publishes into its own `d` slot, so a slot is a
// device. Pure: no relays, no storage, no React.
import { getKeyPackageLifetime } from '@internet-privacy/marmot-ts';
import type { Event as NostrEvent } from 'nostr-tools';

import { newestEvent } from './marmotKeyPackages';

const KEY_PACKAGE_KIND = 30443;
const HOUR_SECS = 60 * 60;
const DAY_SECS = 24 * HOUR_SECS;
/** A device that hasn't refreshed its key for this long counts as old. */
export const OLD_DEVICE_AFTER_SECS = 30 * DAY_SECS;

/** One version of a device's invitation key, as found on relays. */
export interface InvitationKey {
  event: NostrEvent;
  slot: string;
  client: string;
  thisPhone: boolean;
  expires?: number;
  relays: string[];
}

export type DeviceKind = 'thisPhone' | 'lightningPiggy' | 'whiteNoise' | 'otherApp';

export interface InvitationDevice {
  /** The device's `d` slot ('' for this phone before it ever published). */
  slot: string;
  kind: DeviceKind;
  /** The raw `client` tag of its newest key, for the Details view. */
  client: string;
  /** When its newest key was published; undefined = none found on relays. */
  updatedAt?: number;
  expires?: number;
  relays: string[];
  /** Newest first. Empty only for this phone's placeholder. */
  versions: InvitationKey[];
  /** Not this phone, and every version is past 30 days or expired. */
  old: boolean;
}

const slotOf = (event: NostrEvent) => event.tags.find((t) => t[0] === 'd')?.[1];

function expiryOf(event: NostrEvent): number | undefined {
  try {
    const lifetime = getKeyPackageLifetime(event);
    return lifetime ? Number(lifetime.notAfter) : undefined;
  } catch {
    return undefined; // old / malformed keys stay removable
  }
}

const isOldVersion = (createdAt: number, expires: number | undefined, now: number) =>
  createdAt < now - OLD_DEVICE_AFTER_SECS || (expires !== undefined && expires < now);

/** Which app published a key, from its `client` tag (White Noise on any platform). */
export function deviceKind(client: string, thisPhone: boolean): DeviceKind {
  if (thisPhone) return 'thisPhone';
  if (/white\s*noise/i.test(client)) return 'whiteNoise';
  if (/lightning\s*piggy/i.test(client)) return 'lightningPiggy';
  return 'otherApp';
}

/**
 * Every version relays returned, deduplicated across relays and grouped by
 * slot (newest first). A slot whose newest version is empty was retired, so
 * none of its versions are listed.
 */
export function shapeInvitationKeys(
  owner: string,
  responses: { relay: string; events: NostrEvent[] }[],
  localSlots: string[],
): InvitationKey[] {
  const byId = new Map<string, InvitationKey>();
  for (const { relay, events } of responses) {
    for (const event of events) {
      if (event.pubkey !== owner || event.kind !== KEY_PACKAGE_KIND) continue;
      const slot = slotOf(event);
      if (!slot) continue;
      const existing = byId.get(event.id);
      if (existing) {
        if (!existing.relays.includes(relay)) existing.relays.push(relay);
        continue;
      }
      byId.set(event.id, {
        event,
        slot,
        expires: expiryOf(event),
        relays: [relay],
        thisPhone: localSlots.includes(slot),
        client: event.tags.find((t) => t[0] === 'client')?.[1] ?? '',
      });
    }
  }
  const newest = new Map<string, NostrEvent>();
  for (const { slot, event } of byId.values()) {
    const prev = newest.get(slot);
    newest.set(slot, prev ? newestEvent([prev, event])! : event);
  }
  return [...byId.values()]
    .filter((key) => key.event.content && newest.get(key.slot)?.content)
    .sort(
      (a, b) =>
        a.slot.localeCompare(b.slot) ||
        b.event.created_at - a.event.created_at ||
        a.event.id.localeCompare(b.event.id),
    );
}

/**
 * One entry per device, this phone first (always present, so it can be
 * refreshed even when relays hold nothing for it), then newest first.
 */
export function groupInvitationDevices(
  keys: InvitationKey[],
  localSlot: string | undefined,
  now = Math.floor(Date.now() / 1000),
): InvitationDevice[] {
  const bySlot = new Map<string, InvitationKey[]>();
  for (const key of keys) bySlot.set(key.slot, [...(bySlot.get(key.slot) ?? []), key]);
  const devices: InvitationDevice[] = [...bySlot.values()].map((versions) => {
    const sorted = [...versions].sort((a, b) => b.event.created_at - a.event.created_at);
    const [newest] = sorted;
    const thisPhone = sorted.some((k) => k.thisPhone);
    return {
      slot: newest.slot,
      kind: deviceKind(newest.client, thisPhone),
      client: newest.client,
      updatedAt: newest.event.created_at,
      expires: newest.expires,
      relays: [...new Set(sorted.flatMap((k) => k.relays))],
      versions: sorted,
      old: !thisPhone && sorted.every((k) => isOldVersion(k.event.created_at, k.expires, now)),
    };
  });
  if (!devices.some((d) => d.kind === 'thisPhone')) {
    devices.push({
      slot: localSlot ?? '',
      kind: 'thisPhone',
      client: '',
      relays: [],
      versions: [],
      old: false,
    });
  }
  const rank = (d: InvitationDevice) => (d.kind === 'thisPhone' ? 0 : 1);
  return devices.sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/**
 * Bulk "Remove old devices", decided again from what relays hold right now
 * (just before anything is signed): keep only devices relays still show as
 * old. A device refreshed since the list loaded, already removed, or not
 * seen at all this time is skipped rather than guessed at.
 */
export function stillOldDevices(
  devices: InvitationDevice[],
  owner: string,
  onRelays: NostrEvent[],
  now = Math.floor(Date.now() / 1000),
): { slots: string[]; eventIds: string[] } {
  const kept = devices.filter((device) => {
    if (!device.old || device.kind === 'thisPhone') return false;
    const live = onRelays.filter(
      (e) => e.pubkey === owner && e.kind === KEY_PACKAGE_KIND && slotOf(e) === device.slot,
    );
    if (!newestEvent(live)?.content) return false;
    return live.every((e) => !e.content || isOldVersion(e.created_at, expiryOf(e), now));
  });
  return {
    slots: kept.map((d) => d.slot),
    eventIds: kept.flatMap((d) => d.versions.map((k) => k.event.id)),
  };
}

export type DeviceAge =
  | { unit: 'never' }
  | { unit: 'justNow' }
  | { unit: 'hours' | 'days'; count: number };

/** "Last updated …" for a device: just now, N hours ago, or N days ago. */
export function deviceAge(
  updatedAt: number | undefined,
  now = Math.floor(Date.now() / 1000),
): DeviceAge {
  if (updatedAt === undefined) return { unit: 'never' };
  const diff = now - updatedAt;
  if (diff < HOUR_SECS) return { unit: 'justNow' };
  if (diff < DAY_SECS) return { unit: 'hours', count: Math.floor(diff / HOUR_SECS) };
  return { unit: 'days', count: Math.floor(diff / DAY_SECS) };
}
