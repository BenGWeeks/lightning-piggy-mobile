// What the devices UI (#1267) says, decided in one pure place: the "Sent
// from" / "Can be read on" lines of the message-info sheet, and the app list
// in a device notice.
//
// Wire limits these rest on:
// - Marmot has no per-device delivery receipts: a message is encrypted once
//   for the whole group, so every device in the chat when it was sent CAN
//   read it. Hence "can be read on N devices", never "delivered to".
// - The app is told which account sent a message, not which of its leaves —
//   marmot-ts authenticates the sender leaf but doesn't hand it up. So "Sent
//   from" names the device only when that is certain: the sender has one
//   device here, or all of theirs are the same app. Otherwise it says "one
//   of their N devices".
// - We don't know a message's epoch either, only its time. Device changes
//   are timed by when this phone processed the commit, so comparisons allow
//   a little slack (a 1:1's first message is written before the invite that
//   adds the other person's devices lands, a few seconds later).

import type { DeviceInfo } from '../services/marmotDeviceTracker';

/** How far apart a message and a device change must be to be ordered (s). */
export const DEVICE_TIME_SLACK_SECS = 120;

export type SentFrom =
  | { kind: 'thisDevice' }
  | { kind: 'app'; name: string | null }
  | { kind: 'oneOf'; count: number };

/**
 * Which device a message came from, as far as the group state can tell.
 * `sentHere`: this device sent it (it has a tracked send / local row).
 * `sentAt` / `removedAt`: the message's time and when the sender last lost a
 * device here — if that may have been after the message, today's devices
 * aren't the ones it could have come from, so nothing is claimed.
 * Returns null when it can't say (or the sender has left the chat).
 */
export function sentFrom(
  senderDevices: readonly DeviceInfo[] | undefined,
  fromMe: boolean,
  sentHere: boolean,
  timing: { sentAt?: number; removedAt?: number } = {},
): SentFrom | null {
  if (fromMe && sentHere) return { kind: 'thisDevice' };
  if (!senderDevices || senderDevices.length === 0) return null;
  const { sentAt, removedAt } = timing;
  if (
    removedAt !== undefined &&
    (sentAt === undefined || removedAt + DEVICE_TIME_SLACK_SECS >= sentAt)
  ) {
    return null;
  }
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

/**
 * The devices that can read a message: everyone's devices in the chat now,
 * minus those added (clearly) after it was sent — MLS gives a new device no
 * access to earlier epochs.
 */
export function readableOn(
  people: ReadonlyMap<string, readonly DeviceInfo[]>,
  selfPubkey: string | null | undefined,
  sentAt?: number,
): ReadableOn {
  const self = selfPubkey?.toLowerCase();
  const couldRead = (d: DeviceInfo) =>
    sentAt === undefined || d.seenAt === null || d.seenAt <= sentAt + DEVICE_TIME_SLACK_SECS;
  const rows: ReadableOn['people'] = [];
  let mine: ReadableOn['people'][number] | null = null;
  let total = 0;
  for (const [pubkey, devices] of people) {
    const count = devices.filter(couldRead).length;
    if (count === 0) continue;
    total += count;
    const row = { pubkey, count, isSelf: pubkey === self };
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
