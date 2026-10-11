import {
  appDataDictionaryIsLast,
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
});
