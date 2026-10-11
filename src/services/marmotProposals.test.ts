import {
  alignCommitForMdk,
  appDataDictionaryIsLast,
  needsAppDataDictionaryAlignment,
  proposeAppDataDictionaryLast,
  withAppDataDictionaryLast,
} from './marmotProposals';

// GroupContext extension types: 3 = required_capabilities, 6 = app_data_dictionary.
const ext = (extensionType: number, tag = '') => ({ extensionType, tag });

describe('app_data_dictionary extension order (#1309)', () => {
  it('reports whether the dictionary is the last GroupContext extension', () => {
    expect(appDataDictionaryIsLast([ext(6), ext(3)])).toBe(false); // marmot-ts creation order
    expect(appDataDictionaryIsLast([ext(3), ext(6)])).toBe(true); // MDK creation order
    expect(appDataDictionaryIsLast([ext(6)])).toBe(true);
    expect(appDataDictionaryIsLast([ext(3)])).toBe(true); // no dictionary: nothing to move
    expect(appDataDictionaryIsLast([])).toBe(true);
  });

  it('moves only the dictionary, keeping every other extension in order', () => {
    const input = [ext(6, 'dict'), ext(3, 'caps'), ext(0xf2ee, 'other')];
    expect(withAppDataDictionaryLast(input)).toEqual([
      ext(3, 'caps'),
      ext(0xf2ee, 'other'),
      ext(6, 'dict'),
    ]);
    expect(input[0]).toEqual(ext(6, 'dict')); // not mutated
    expect(withAppDataDictionaryLast([ext(3), ext(6)])).toEqual([ext(3), ext(6)]);
  });

  it('proposes a GroupContextExtensions re-send with the dictionary last, bytes untouched', async () => {
    const dict = { extensionType: 6, extensionData: new Uint8Array([1, 2, 3]) };
    const caps = { extensionType: 3, extensionData: { proposalTypes: [8, 10] } };
    const action = proposeAppDataDictionaryLast() as unknown as (ctx: unknown) => Promise<unknown>;
    const proposal = (await action({ state: { groupContext: { extensions: [dict, caps] } } })) as {
      proposalType: number;
      groupContextExtensions: { extensions: unknown[] };
    };
    expect(proposal.proposalType).toBe(7); // group_context_extensions (RFC 9420)
    expect(proposal.groupContextExtensions.extensions).toEqual([caps, dict]);
    expect(proposal.groupContextExtensions.extensions[1]).toBe(dict); // same object, same bytes
  });

  it('aligns only an unaligned group with no staged app_data_update', () => {
    const state = (extensions: number[], staged: number[] = []) => ({
      groupContext: { extensions: extensions.map((t) => ext(t)) },
      unappliedProposals: Object.fromEntries(
        staged.map((proposalType, i) => [`ref${i}`, { proposal: { proposalType } }]),
      ),
    });
    expect(needsAppDataDictionaryAlignment(state([6, 3]))).toBe(true);
    expect(needsAppDataDictionaryAlignment(state([6, 3], [10]))).toBe(true); // a staged SelfRemove is fine
    expect(needsAppDataDictionaryAlignment(state([3, 6]))).toBe(false); // already aligned (MDK groups)
    // A staged app_data_update is bundled ahead of our proposals and may not
    // precede a GroupContextExtensions proposal: leave that commit alone.
    expect(needsAppDataDictionaryAlignment(state([6, 3], [8]))).toBe(false);
    // A staged GroupContextExtensions proposal: a commit may hold only one.
    expect(needsAppDataDictionaryAlignment(state([6, 3], [7]))).toBe(false);
  });

  it('leads a commit (invites included) with the realign proposal only while needed', () => {
    const group = (extensions: number[], staged: number[] = []) => ({
      state: {
        groupContext: { extensions: extensions.map((t) => ext(t)) },
        unappliedProposals: Object.fromEntries(
          staged.map((proposalType, i) => [`ref${i}`, { proposal: { proposalType } }]),
        ),
      },
    });
    const add = { proposalType: 1 };
    const commit = { kind: 'commit', actorPubkey: 'a', extraProposals: [add] } as never;
    const aligned = alignCommitForMdk(commit)(group([6, 3])) as { extraProposals: unknown[] };
    expect(aligned.extraProposals).toHaveLength(2);
    expect(typeof aligned.extraProposals[0]).toBe('function'); // the realign action
    expect(aligned.extraProposals[1]).toBe(add);
    expect(alignCommitForMdk(commit)(group([3, 6]))).toBe(commit); // MDK-created: no-op
    expect(alignCommitForMdk(commit)(group([6, 3], [7]))).toBe(commit);
    const message = { kind: 'applicationMessage', payload: new Uint8Array() } as never;
    expect(alignCommitForMdk(message)(group([6, 3]))).toBe(message);
  });
});
