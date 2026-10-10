import { buildSignOutPrompt, signOutPromptVariant } from './signOutPrompt';

const base = { displayName: 'Big Piggy', backedUp: false, otherAccountCount: 0 };

describe('signOutPromptVariant', () => {
  it.each([
    ['nsec', false, 'nsec-unbacked'],
    ['nsec', true, 'nsec-backed'],
    ['amber', false, 'amber'],
    ['amber', true, 'amber'],
    ['nip46', false, 'nip46'],
    ['nip46', true, 'nip46'],
    [null, false, 'nsec-unbacked'],
    [undefined, true, 'nsec-backed'],
  ] as const)('%s / backedUp=%s -> %s', (signer, backedUp, expected) => {
    expect(signOutPromptVariant(signer, backedUp)).toBe(expected);
  });
});

describe('buildSignOutPrompt', () => {
  it('names the account in the title', () => {
    const p = buildSignOutPrompt({ ...base, signerType: 'nsec' });
    expect(p.title).toEqual({ key: 'signOutPrompt.title', params: { name: 'Big Piggy' } });
  });

  it('warns and offers a backup for an nsec account that is not backed up', () => {
    const p = buildSignOutPrompt({ ...base, signerType: 'nsec' });
    expect(p.variant).toBe('nsec-unbacked');
    expect(p.offerBackup).toBe(true);
    expect(p.confirm.key).toBe('signOutPrompt.signOutAnyway');
    expect(p.paragraphs.map((x) => x.key)).toEqual([
      'signOutPrompt.nsecUnbacked',
      'signOutPrompt.walletsRemoved',
    ]);
    expect(p.paragraphs[0].params).toEqual({ name: 'Big Piggy' });
  });

  it('uses the lighter warning without a backup action once backed up', () => {
    const p = buildSignOutPrompt({ ...base, signerType: 'nsec', backedUp: true });
    expect(p.variant).toBe('nsec-backed');
    expect(p.offerBackup).toBe(false);
    expect(p.confirm.key).toBe('signOutPrompt.signOut');
    expect(p.paragraphs[0].key).toBe('signOutPrompt.nsecBacked');
  });

  it.each([
    ['amber', 'signOutPrompt.amber'],
    ['nip46', 'signOutPrompt.nip46'],
  ] as const)('reassures %s accounts that the key stays in the signer', (signer, key) => {
    const p = buildSignOutPrompt({ ...base, signerType: signer });
    expect(p.offerBackup).toBe(false);
    expect(p.confirm.key).toBe('signOutPrompt.signOut');
    expect(p.paragraphs.map((x) => x.key)).toEqual([key, 'signOutPrompt.walletsRemoved']);
  });

  it('only mentions other accounts when there are some', () => {
    expect(buildSignOutPrompt({ ...base, signerType: 'amber' }).paragraphs).toHaveLength(2);
    const one = buildSignOutPrompt({ ...base, signerType: 'amber', otherAccountCount: 1 });
    expect(one.paragraphs[2]).toEqual({
      key: 'signOutPrompt.otherAccountOne',
      params: { count: 1 },
    });
    const many = buildSignOutPrompt({ ...base, signerType: 'nsec', otherAccountCount: 3 });
    expect(many.paragraphs.map((x) => x.key)).toEqual([
      'signOutPrompt.nsecUnbacked',
      'signOutPrompt.walletsRemoved',
      'signOutPrompt.otherAccountsMany',
    ]);
    expect(many.paragraphs[2].params).toEqual({ count: 3 });
  });
});
