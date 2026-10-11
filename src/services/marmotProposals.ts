// A workaround for a marmot-ts commit-building bug, kept out of the session.

import type { MarmotClient } from '@internet-privacy/marmot-ts';

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
