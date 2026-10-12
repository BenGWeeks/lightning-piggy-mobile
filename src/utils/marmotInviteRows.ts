// How Marmot invites (kind-444 Welcomes, gift-wrapped like NIP-17 DMs) show
// in the NIP-17 inbox (#1269). The Marmot session joins the invite, which
// gives it its own chat — so the gift wrap is hidden from the NIP-17 list and
// thread, whether it was joined, is still being processed, or was meant for
// another of our devices. Only an invite that couldn't be opened shows, as an
// explanation and a prompt to ask for a new one.

import { MARMOT_WELCOME_KIND } from './dmProtocol';
import type { DmInboxEntry } from './conversationSummaries';
import type { FailedMarmotInvite } from '../services/marmotWelcomeOutcomes';

/** Id prefix of the synthesized Messages-list entry for a failed invite. */
export const FAILED_INVITE_ENTRY_PREFIX = 'marmot-invite-failed:';

/**
 * The inbox with every stored invite gift wrap dropped and one entry per
 * failed invite added (from the session's record — stored invite rows are no
 * longer a thread's latest, see `getInboxLatest`), previewed as `text`.
 * Returns `entries` itself when there's nothing to change, so memoised
 * consumers bail out.
 */
export function withMarmotInviteRows(
  entries: DmInboxEntry[],
  failed: readonly FailedMarmotInvite[],
  text: string,
): DmInboxEntry[] {
  const hasInviteRows = entries.some((e) => e.wireKind === MARMOT_WELCOME_KIND);
  if (!hasInviteRows && failed.length === 0) return entries;
  const kept = hasInviteRows ? entries.filter((e) => e.wireKind !== MARMOT_WELCOME_KIND) : entries;
  if (failed.length === 0) return kept;
  return [
    ...kept,
    ...failed.map(
      (f): DmInboxEntry => ({
        id: `${FAILED_INVITE_ENTRY_PREFIX}${f.id}`,
        partnerPubkey: f.sender,
        fromMe: false,
        createdAt: f.createdAt,
        text,
        wireKind: MARMOT_WELCOME_KIND,
      }),
    ),
  ];
}

/** `partner`'s failed invites, for the 1:1 thread's notices. */
export function failedInvitesFrom(
  failed: readonly FailedMarmotInvite[],
  partner: string,
): FailedMarmotInvite[] {
  const p = partner.toLowerCase();
  return failed.filter((f) => f.sender === p);
}
