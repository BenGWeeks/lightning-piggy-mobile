import { migrateDmStore, type MigrationDeps } from './dmStoreMigration';

// A deps harness with sane defaults + call tracking, overridable per test.
const makeDeps = (over: Partial<MigrationDeps> = {}) => {
  const calls: string[] = [];
  let migrated = false;
  const deps: MigrationDeps = {
    isMigrated: jest.fn(async () => migrated),
    setMigrated: jest.fn(async () => {
      migrated = true;
      calls.push('setMigrated');
    }),
    populateFromRelays: jest.fn(async () => {
      calls.push('populate');
      return { completed: true };
    }),
    deletePlaintextCaches: jest.fn(async () => {
      calls.push('delete');
    }),
    verifyPlaintextGone: jest.fn(async () => true),
    warn: jest.fn(),
    ...over,
  };
  return {
    deps,
    calls,
    get migrated() {
      return migrated;
    },
  };
};

describe('dmStoreMigration', () => {
  it('short-circuits when already migrated (no populate, no delete)', async () => {
    const { deps } = makeDeps({ isMigrated: jest.fn(async () => true) });
    const res = await migrateDmStore(deps);
    expect(res).toEqual({ ok: true, status: 'already-migrated' });
    expect(deps.populateFromRelays).not.toHaveBeenCalled();
    expect(deps.deletePlaintextCaches).not.toHaveBeenCalled();
  });

  it('happy path: populate → delete → setMigrated, strictly ordered', async () => {
    const { deps, calls } = makeDeps();
    const res = await migrateDmStore(deps);
    expect(res).toEqual({ ok: true, status: 'migrated' });
    expect(calls).toEqual(['populate', 'delete', 'setMigrated']); // ordering is the safety invariant
  });

  it('does NOT delete plaintext or set the flag when populate is incomplete', async () => {
    const { deps } = makeDeps({
      populateFromRelays: jest.fn(async () => ({ completed: false })),
    });
    const res = await migrateDmStore(deps);
    expect(res).toEqual({ ok: false, reason: 'populate-incomplete' });
    expect(deps.deletePlaintextCaches).not.toHaveBeenCalled(); // never delete on a partial DB
    expect(deps.setMigrated).not.toHaveBeenCalled();
  });

  it('M2: does NOT set the migrated flag if plaintext survives the delete', async () => {
    const { deps } = makeDeps({
      verifyPlaintextGone: jest.fn(async () => false),
    });
    const res = await migrateDmStore(deps);
    expect(res).toEqual({ ok: false, reason: 'delete-unverified' });
    expect(deps.deletePlaintextCaches).toHaveBeenCalled(); // it tried
    expect(deps.setMigrated).not.toHaveBeenCalled(); // but didn't mark done → retries
  });

  it('is idempotent: a second run after success short-circuits', async () => {
    const h = makeDeps();
    await migrateDmStore(h.deps);
    expect(h.migrated).toBe(true);
    const second = await migrateDmStore(h.deps);
    expect(second).toEqual({ ok: true, status: 'already-migrated' });
    expect(h.deps.populateFromRelays).toHaveBeenCalledTimes(1); // not re-run
  });

  it('retries cleanly: a failed run leaves the flag unset so the next run proceeds', async () => {
    let plaintextGone = false; // first delete "fails" verification, then succeeds
    const deps = makeDeps({
      verifyPlaintextGone: jest.fn(async () => plaintextGone),
    }).deps;
    const first = await migrateDmStore(deps);
    expect(first.ok).toBe(false);
    plaintextGone = true; // environment recovered
    const second = await migrateDmStore(deps);
    expect(second).toEqual({ ok: true, status: 'migrated' });
  });
});
