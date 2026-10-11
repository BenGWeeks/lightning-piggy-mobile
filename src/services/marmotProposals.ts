// Workarounds for marmot-ts commit building, kept out of the session.

import type { MarmotClient } from '@internet-privacy/marmot-ts';
import {
  appDataDictionaryExtensionType,
  appDataUpdateProposalType,
  defaultProposalTypes,
} from '@internet-privacy/marmot-ts/mls';

type CommitOptions = NonNullable<Parameters<MarmotClient['groups']['commit']>[1]>;
type SingleProposalAction = Extract<
  NonNullable<CommitOptions['extraProposals']>[number],
  (...args: never[]) => unknown
>;

/**
 * marmot-ts 0.6.1-next pushes an array-returning ProposalAction's result into
 * the commit UN-flattened (engine/group-engine.js), so builders like
 * `proposeRemoveUser` / `proposeUpdateMetadata` produce a malformed commit.
 * Split one into `count` single-proposal actions.
 */
export function spreadProposals(
  action: (ctx: Parameters<SingleProposalAction>[0]) => Promise<unknown[]>,
  count: number,
): SingleProposalAction[] {
  return Array.from(
    { length: count },
    (_, i) =>
      (async (ctx: Parameters<SingleProposalAction>[0]) => {
        const proposals = await action(ctx);
        if (proposals.length !== count) throw new Error('marmot: unexpected proposal count');
        return proposals[i];
      }) as SingleProposalAction,
  );
}

type ExtensionLike = { extensionType: number };

/** Whether `app_data_dictionary` is the last GroupContext extension (or absent). */
export function appDataDictionaryIsLast(extensions: readonly ExtensionLike[]): boolean {
  const i = extensions.findIndex((e) => e.extensionType === appDataDictionaryExtensionType);
  return i === -1 || i === extensions.length - 1;
}

/**
 * Whether a commit built on `state` should carry {@link proposeAppDataDictionaryLast}:
 * the dictionary isn't last yet, and no staged `app_data_update` proposal
 * exists. ts-mls bundles staged proposals (by reference) ahead of the commit's
 * own, and an `app_data_update` may not precede a GroupContextExtensions
 * proposal, so in that rare case this commit can't realign (a later one will).
 */
export function needsAppDataDictionaryAlignment(state: {
  groupContext: { extensions: readonly ExtensionLike[] };
  unappliedProposals: Record<string, { proposal: { proposalType: number } }>;
}): boolean {
  if (appDataDictionaryIsLast(state.groupContext.extensions)) return false;
  return !Object.values(state.unappliedProposals).some(
    (p) => p.proposal.proposalType === appDataUpdateProposalType,
  );
}

/** The same extensions, in the same order, with `app_data_dictionary` moved to the end. */
export function withAppDataDictionaryLast<T extends ExtensionLike>(extensions: readonly T[]): T[] {
  const isDict = (e: T) => e.extensionType === appDataDictionaryExtensionType;
  return [...extensions.filter((e) => !isDict(e)), ...extensions.filter(isDict)];
}

/**
 * A GroupContextExtensions proposal that re-sends the group's own extensions
 * with `app_data_dictionary` last, its bytes unchanged (#1309).
 *
 * OpenMLS (MDK, so White Noise) applies an `app_data_update` by removing the
 * dictionary extension and re-appending it; ts-mls (marmot-ts) replaces it in
 * place, as draft-ietf-mls-extensions §4.7 describes. marmot-ts creates groups
 * with the dictionary FIRST (MDK puts it last), so after a rename or admin
 * change the two sides derive different GroupContexts, MDK rejects the commit
 * ("Confirmation tag mismatch") and White Noise never reads the group again.
 * Once the dictionary is last both behaviours give the same bytes. Commit this
 * ahead of any `app_data_update` (it must precede them) while the group isn't
 * aligned; both sides set GroupContextExtensions verbatim.
 */
export function proposeAppDataDictionaryLast(): SingleProposalAction {
  return (async (ctx: Parameters<SingleProposalAction>[0]) => ({
    proposalType: defaultProposalTypes.group_context_extensions,
    groupContextExtensions: {
      extensions: withAppDataDictionaryLast(ctx.state.groupContext.extensions),
    },
  })) as SingleProposalAction;
}

/** `proposals`, led by {@link proposeAppDataDictionaryLast} when the group
 * built on `state` still needs aligning (see {@link needsAppDataDictionaryAlignment}). */
export function alignedForMdk(
  state: Parameters<typeof needsAppDataDictionaryAlignment>[0],
  proposals: SingleProposalAction[],
): SingleProposalAction[] {
  return needsAppDataDictionaryAlignment(state)
    ? [proposeAppDataDictionaryLast(), ...proposals]
    : proposals;
}
