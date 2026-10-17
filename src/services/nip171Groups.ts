import AsyncStorage from '@react-native-async-storage/async-storage';
import { hexToBytes } from '@noble/hashes/utils.js';
import { getPublicKey } from 'nostr-tools/pure';
import { nostrGetEventHash, nostrVerifyEvent } from './nostrCrypto';
import { deleteNip171Group, loadNip171Tickets, saveNip171Ticket } from './nip171Store';
import { perAccountKey } from './perAccountStorage';
import type { Group } from '../types/groups';
import {
  groupKeysFromTickets,
  groupRumorTags,
  nip171GroupId,
  NIP171_TICKET_KIND,
  parseTicket,
  type Nip171Event,
  type Nip171GroupKeys,
  type Nip171Ticket,
} from '../utils/nip171';

// NIP-171 groups this account belongs to, member side: built from the epoch
// tickets we hold (nip171Store). Groups appear in GroupsContext alongside
// NIP-17 and Marmot groups; nip171Session receives their messages.

export interface Nip171GroupMeta {
  name?: string;
  picture?: string;
  /** The group identity's kind-10050 DM relays: where its messages go. */
  relays?: string[];
}

export interface Nip171GroupState {
  keys: Nip171GroupKeys;
  /** Public key of the current epoch: messages are addressed to it. */
  epochPubkey: string;
  /** Public keys of every epoch we hold a key for (never valid authors). */
  epochPubkeys: Set<string>;
  /** Members we've seen post or be announced (the roster isn't published). */
  members: Set<string>;
  meta: Nip171GroupMeta;
  /** First ticket we received, ms. */
  joinedAt: number;
}

const META_KEY = 'nip171_group_meta_v1';
const states = new Map<string, Map<string, Nip171GroupState>>();
const loads = new Map<string, Promise<void>>();
const listeners = new Set<(owner: string) => void>();

const emit = (owner: string) => {
  for (const listener of listeners) {
    try {
      listener(owner);
    } catch {
      // A listener failure must not stop the others.
    }
  }
};

/** Notified when an account's NIP-171 groups (or their keys) change. */
export function subscribeNip171Groups(listener: (owner: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Verify a fresh copy (see parseTicket): never trust a memoised result.
const verify = (event: Required<Omit<Nip171Event, 'sealInvitationProof'>>) =>
  nostrVerifyEvent(event as Parameters<typeof nostrVerifyEvent>[0]);

const epochPubkeyOf = (secretHex: string) => getPublicKey(hexToBytes(secretHex));
const hash = (event: Omit<Nip171Event, 'id' | 'sig'>) =>
  nostrGetEventHash(event as Parameters<typeof nostrGetEventHash>[0]);

async function loadMeta(owner: string): Promise<Record<string, Nip171GroupMeta>> {
  try {
    const raw = await AsyncStorage.getItem(perAccountKey(META_KEY, owner));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Nip171GroupMeta>) : {};
  } catch {
    return {};
  }
}

function buildStates(
  tickets: readonly Nip171Ticket[],
  meta: Record<string, Nip171GroupMeta>,
  previous: Map<string, Nip171GroupState> | undefined,
): Map<string, Nip171GroupState> {
  const byGroup = new Map<string, Nip171Ticket[]>();
  for (const t of tickets) {
    const list = byGroup.get(t.groupPubkey) ?? [];
    list.push(t);
    byGroup.set(t.groupPubkey, list);
  }
  const next = new Map<string, Nip171GroupState>();
  for (const [groupPubkey, list] of byGroup) {
    const keys = groupKeysFromTickets(list);
    if (!keys) continue;
    const old = previous?.get(groupPubkey);
    next.set(groupPubkey, {
      keys,
      epochPubkey: epochPubkeyOf(keys.current.epochSecretHex),
      epochPubkeys: new Set([...keys.epochSecrets.values()].map(epochPubkeyOf)),
      members: old?.members ?? new Set(),
      meta: meta[groupPubkey] ?? old?.meta ?? {},
      joinedAt: Math.min(...list.map((t) => t.createdAt)) * 1000,
    });
  }
  return next;
}

async function reload(owner: string): Promise<void> {
  const [tickets, meta] = await Promise.all([loadNip171Tickets(owner), loadMeta(owner)]);
  states.set(owner, buildStates(tickets, meta, states.get(owner)));
  emit(owner);
}

/** Load the account's groups from storage (once; later calls share it). */
export function loadNip171Groups(owner: string): Promise<void> {
  const pending = loads.get(owner);
  if (pending) return pending;
  const load = reload(owner).catch((error) => {
    loads.delete(owner);
    throw error;
  });
  loads.set(owner, load);
  return load;
}

/** The account's NIP-171 groups, by group identity pubkey. */
export function nip171GroupStates(owner: string): ReadonlyMap<string, Nip171GroupState> {
  return states.get(owner) ?? new Map();
}

export function nip171GroupState(owner: string, groupPubkey: string): Nip171GroupState | null {
  return states.get(owner)?.get(groupPubkey) ?? null;
}

/** App `Group` rows for GroupsContext. */
export function nip171GroupsFor(owner: string): Group[] {
  return [...nip171GroupStates(owner)].map(([groupPubkey, s]) => ({
    id: nip171GroupId(groupPubkey),
    name: s.meta.name?.trim() || '',
    memberPubkeys: [...s.members].filter((m) => m !== owner),
    createdAt: s.joinedAt,
    updatedAt: s.joinedAt,
    protocol: 'nip171',
  }));
}

/**
 * A gift-wrapped `kind:1014` ticket that reached our own inbox. Returns true
 * when the rumor was a ticket, valid or not, so the DM inbox never shows it.
 */
export async function ingestNip171Ticket(
  owner: string,
  rumor: Omit<Nip171Event, 'id'>,
): Promise<boolean> {
  if (rumor.kind !== NIP171_TICKET_KIND) return false;
  const ticket = parseTicket({ ...rumor, id: '' }, owner, verify, hash, epochPubkeyOf);
  if (!ticket) {
    if (__DEV__) console.log('[NIP-171] ticket rejected');
    return true;
  }
  await loadNip171Groups(owner).catch(() => undefined);
  await saveNip171Ticket(owner, ticket);
  await reload(owner);
  return true;
}

/** Remember members we've seen post or be announced. */
export function noteNip171Members(owner: string, groupPubkey: string, members: string[]): void {
  const state = states.get(owner)?.get(groupPubkey);
  if (!state) return;
  let changed = false;
  for (const m of members) {
    if (!state.members.has(m)) {
      state.members.add(m);
      changed = true;
    }
  }
  if (changed) emit(owner);
}

/** Store the group identity's profile / relays (fetched by the session). */
export async function setNip171GroupMeta(
  owner: string,
  groupPubkey: string,
  meta: Nip171GroupMeta,
): Promise<void> {
  const all = await loadMeta(owner);
  all[groupPubkey] = { ...all[groupPubkey], ...meta };
  await AsyncStorage.setItem(perAccountKey(META_KEY, owner), JSON.stringify(all)).catch(
    () => undefined,
  );
  const state = states.get(owner)?.get(groupPubkey);
  if (state) {
    state.meta = all[groupPubkey];
    emit(owner);
  }
}

/** Drop a group we left: its tickets and metadata. */
export async function forgetNip171Group(owner: string, groupPubkey: string): Promise<void> {
  await deleteNip171Group(owner, groupPubkey);
  const all = await loadMeta(owner);
  delete all[groupPubkey];
  await AsyncStorage.setItem(perAccountKey(META_KEY, owner), JSON.stringify(all)).catch(
    () => undefined,
  );
  states.get(owner)?.delete(groupPubkey);
  emit(owner);
}

/** Account wipe / sign-out: drop the in-memory state. */
export function forgetNip171Account(owner: string): void {
  states.delete(owner);
  loads.delete(owner);
  void AsyncStorage.removeItem(perAccountKey(META_KEY, owner)).catch(() => undefined);
  emit(owner);
}

export function __resetNip171GroupsForTests(): void {
  states.clear();
  loads.clear();
  listeners.clear();
}

/**
 * What to send for a text message to a NIP-171 group: a kind-14 rumor tagged
 * per the draft, gift-wrapped once to the current epoch key (no self-copy:
 * we read it from there), published to the group's relays plus `relays`.
 */
export function nip171Outgoing(
  owner: string,
  groupId: string,
  text: string,
  relays: readonly string[],
):
  | {
      rumor: { kind: 14; pubkey: string; created_at: number; tags: string[][]; content: string };
      recipientPubkeys: string[];
      relays: string[];
    }
  | { error: string } {
  const groupPubkey = groupId.startsWith('nip171:') ? groupId.slice('nip171:'.length) : null;
  const state = groupPubkey ? states.get(owner)?.get(groupPubkey) : undefined;
  if (!state) return { error: 'Not a member of this group' };
  if (state.keys.conflicted) {
    return { error: "This group's keys conflict; its owner has to fix them before you can send" };
  }
  return {
    rumor: {
      kind: 14,
      pubkey: owner,
      created_at: Math.floor(Date.now() / 1000),
      tags: groupRumorTags(state.keys, state.epochPubkey),
      content: text,
    },
    recipientPubkeys: [state.epochPubkey],
    relays: [...new Set([...(state.meta.relays ?? []), ...relays])],
  };
}

/** Whether `pubkey` is the identity of one of the account's NIP-171 groups. */
export function isNip171GroupIdentity(owner: string, pubkey: string): boolean {
  return states.get(owner)?.has(pubkey.toLowerCase()) ?? false;
}
