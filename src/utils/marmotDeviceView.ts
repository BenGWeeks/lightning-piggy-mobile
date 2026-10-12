// What the devices UI (#1267) says, decided in one pure place: the 1:1
// by-line count, the "Sent from" / "Can be read on" lines of the message-info
// sheet, and the app list in a device notice.
//
// Wire limits these rest on:
// - Marmot has no per-device delivery receipts: a message is encrypted once
//   for the whole group, so every device in the chat CAN read it. Hence "can
//   be read on N devices", never "delivered to".
// - The app is told which account sent a message, not which of its leaves —
//   marmot-ts authenticates the sender leaf but doesn't hand it up. So "Sent
//   from" names the device only when that is certain: the sender has one
//   device here, or all of theirs are the same app. Otherwise it says "one
//   of their N devices".

import type { DeviceInfo } from '../services/marmotDeviceTracker';

export type SentFrom =
  | { kind: 'thisDevice' }
  | { kind: 'app'; name: string | null }
  | { kind: 'oneOf'; count: number };

/**
 * Which device a message came from, as far as the group state can tell.
 * `sentHere`: this device sent it (it has a tracked send / local row).
 * Returns null when the sender has no devices in the chat any more.
 */
export function sentFrom(
  senderDevices: readonly DeviceInfo[] | undefined,
  fromMe: boolean,
  sentHere: boolean,
): SentFrom | null {
  if (fromMe && sentHere) return { kind: 'thisDevice' };
  if (!senderDevices || senderDevices.length === 0) return null;
  if (senderDevices.length === 1) {
    const [only] = senderDevices;
    // Our only leaf is this one: MLS can't deliver our message from elsewhere.
    return only.isOwn ? { kind: 'thisDevice' } : { kind: 'app', name: only.client };
  }
  if (!fromMe) {
    const names = new Set(senderDevices.map((d) => d.client));
    const [name] = names;
    if (names.size === 1 && name !== null) return { kind: 'app', name };
  }
  return { kind: 'oneOf', count: senderDevices.length };
}

export interface ReadableOn {
  total: number;
  /** Per person, others first (in chat order), the viewer last. */
  people: { pubkey: string; count: number; isSelf: boolean }[];
}

/** Every device that can read a message in the chat right now. */
export function readableOn(
  people: ReadonlyMap<string, readonly DeviceInfo[]>,
  selfPubkey: string | null | undefined,
): ReadableOn {
  const self = selfPubkey?.toLowerCase();
  const rows: ReadableOn['people'] = [];
  let mine: ReadableOn['people'][number] | null = null;
  let total = 0;
  for (const [pubkey, devices] of people) {
    total += devices.length;
    const row = { pubkey, count: devices.length, isSelf: pubkey === self };
    if (row.isSelf) mine = row;
    else rows.push(row);
  }
  if (mine) rows.push(mine);
  return { total, people: rows };
}

/**
 * "White Noise, Lightning Piggy ×2": each app once, in first-seen order, with
 * a count when it's on more than one device. Unknown apps share one label.
 */
export function appsSummary(clients: readonly (string | null)[], unknownLabel: string): string {
  const counts = new Map<string, number>();
  for (const c of clients) {
    const name = c ?? unknownLabel;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)).join(', ');
}
