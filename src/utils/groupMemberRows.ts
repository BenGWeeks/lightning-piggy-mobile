import type { NostrContact, NostrProfile } from '../types/nostr';
import { shortNpub } from './shortNpub';

/** Display fields for a member the viewer doesn't follow (kind-0, display-only). */
export interface MemberProfile {
  name: string | null;
  displayName: string | null;
  picture: string | null;
}

/** One resolved row of a group's member list (header count, members sheet, sender labels). */
export interface GroupMemberRow {
  pubkey: string;
  name: string;
  picture: string | null;
  isSelf: boolean;
  /** In the viewer's kind-3 follow list. Always false for the self row. */
  following: boolean;
}

const firstNonEmpty = (...values: (string | null | undefined)[]): string | null => {
  for (const v of values) {
    const trimmed = v?.trim();
    if (trimmed) return trimmed;
  }
  return null;
};

/**
 * Non-self members with no entry in the viewer's follow list — the only ones
 * whose kind-0 isn't already loaded by `contacts` (#1268). Lower-cased and
 * deduped so it can key a cache / one bounded batch fetch.
 */
export function membersNeedingProfiles(
  memberPubkeys: readonly string[],
  selfPubkey: string | null | undefined,
  contacts: readonly NostrContact[],
): string[] {
  const followed = new Set(contacts.map((c) => c.pubkey.toLowerCase()));
  const self = selfPubkey?.toLowerCase();
  const out = new Set<string>();
  for (const pk of memberPubkeys) {
    const lower = pk.toLowerCase();
    if (lower === self || followed.has(lower)) continue;
    out.add(lower);
  }
  return [...out];
}

interface BuildArgs {
  memberPubkeys: readonly string[];
  selfPubkey: string | null | undefined;
  selfProfile: Pick<NostrProfile, 'displayName' | 'name' | 'picture'> | null | undefined;
  contacts: readonly NostrContact[];
  /** Kind-0s for non-followed members, keyed by lower-case pubkey. */
  profiles: ReadonlyMap<string, MemberProfile>;
}

/**
 * Resolve a group's member pubkeys into display rows: `displayName` → `name`
 * (from the follow list, then the fetched kind-0) → petname → short npub.
 *
 * Stored `memberPubkeys` excludes the viewer by LP convention (GroupsContext),
 * so the self row is prepended here; a legacy list that already includes the
 * viewer is deduped case-insensitively so it can't produce a double "you" row
 * or an off-by-one count (#473).
 */
export function buildGroupMemberRows({
  memberPubkeys,
  selfPubkey,
  selfProfile,
  contacts,
  profiles,
}: BuildArgs): GroupMemberRow[] {
  const byPubkey = new Map(contacts.map((c) => [c.pubkey.toLowerCase(), c]));
  const self = selfPubkey?.toLowerCase();
  const rows: GroupMemberRow[] = [];
  if (selfPubkey) {
    rows.push({
      pubkey: selfPubkey,
      name: firstNonEmpty(selfProfile?.displayName, selfProfile?.name) ?? shortNpub(selfPubkey),
      picture: selfProfile?.picture ?? null,
      isSelf: true,
      following: false,
    });
  }
  const seen = new Set<string>();
  for (const pk of memberPubkeys) {
    const lower = pk.toLowerCase();
    if (lower === self || seen.has(lower)) continue;
    seen.add(lower);
    const contact = byPubkey.get(lower);
    const fetched = profiles.get(lower);
    rows.push({
      pubkey: pk,
      name:
        firstNonEmpty(
          contact?.profile?.displayName,
          contact?.profile?.name,
          fetched?.displayName,
          fetched?.name,
          contact?.petname,
        ) ?? shortNpub(pk),
      picture: contact?.profile?.picture || fetched?.picture || null,
      isSelf: false,
      following: !!contact,
    });
  }
  return rows;
}
