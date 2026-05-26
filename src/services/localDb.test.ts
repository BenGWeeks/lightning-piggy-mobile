// op-sqlite is a native module jest can't load; mock it to cover the open +
// schema orchestration and the verify smoke-check. The real encrypted open is
// validated by an on-device dev build (#695 spike), not here.
const mockExecute = jest.fn();
const mockDelete = jest.fn();
const mockDb = { execute: mockExecute, delete: mockDelete };
const mockOpen = jest.fn(() => mockDb);
const mockClearKey = jest.fn(() => Promise.resolve());
jest.mock('@op-engineering/op-sqlite', () => ({ open: mockOpen }));
jest.mock('./localDbKey', () => ({
  getOrCreateLocalDbKey: jest.fn(() => Promise.resolve('a'.repeat(64))),
  clearLocalDbKey: mockClearKey,
}));

import { getLocalDb, verifyEncryptedDb } from './localDb';

// Route execute() return values by SQL so verifyEncryptedDb's round-trip works.
const wireExecute = () =>
  mockExecute.mockImplementation((sql: string) => {
    if (sql.includes('cipher_version')) {
      return Promise.resolve({ rows: [{ cipher_version: '4.6.0' }] });
    }
    if (sql.startsWith('SELECT content')) {
      return Promise.resolve({ rows: [{ content: 'ok' }] });
    }
    return Promise.resolve({ rows: [] });
  });

beforeEach(() => {
  jest.clearAllMocks();
  wireExecute();
  jest.resetModules();
});

describe('localDb', () => {
  it('opens the DB with the keystore encryption key', async () => {
    const { getLocalDb: freshGetLocalDb } = require('./localDb');
    await freshGetLocalDb();
    expect(mockOpen).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'lightningpiggy.db', encryptionKey: 'a'.repeat(64) }),
    );
  });

  it('runs the schema (dm_messages table + conversation index) on open', async () => {
    const { getLocalDb: freshGetLocalDb } = require('./localDb');
    await freshGetLocalDb();
    const ddl = mockExecute.mock.calls.map((c) => c[0]).join('\n');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS dm_messages');
    expect(ddl).toContain('idx_dm_conversation_created');
  });

  it('is single-flight — a second getLocalDb does not reopen', async () => {
    const { getLocalDb: freshGetLocalDb } = require('./localDb');
    await freshGetLocalDb();
    await freshGetLocalDb();
    expect(mockOpen).toHaveBeenCalledTimes(1);
  });

  it('clears the cached open on failure so a later call can retry', async () => {
    mockOpen.mockImplementationOnce(() => {
      throw new Error('locked');
    });
    const { getLocalDb: freshGetLocalDb } = require('./localDb');
    await expect(freshGetLocalDb()).rejects.toThrow('locked');
    const db = await freshGetLocalDb();
    expect(db).toBe(mockDb);
  });

  it('verifyEncryptedDb returns the cipher version on a clean encrypted round-trip', async () => {
    const { verifyEncryptedDb: freshVerify } = require('./localDb');
    expect(await freshVerify()).toBe('4.6.0');
  });

  it('refuses to open when SQLCipher is not active (empty cipher_version → plaintext guard)', async () => {
    mockExecute.mockImplementation((sql: string) =>
      sql.includes('cipher_version')
        ? Promise.resolve({ rows: [{ cipher_version: '' }] })
        : Promise.resolve({ rows: [] }),
    );
    const { getLocalDb: freshGetLocalDb } = require('./localDb');
    await expect(freshGetLocalDb()).rejects.toThrow('SQLCipher not active');
  });

  it('checks cipher_version before running the schema (open-time guard)', async () => {
    const { getLocalDb: freshGetLocalDb } = require('./localDb');
    await freshGetLocalDb();
    const sqls = mockExecute.mock.calls.map((c) => c[0]);
    const cipherIdx = sqls.findIndex((s) => s.includes('cipher_version'));
    const schemaIdx = sqls.findIndex((s) => s.includes('CREATE TABLE'));
    expect(cipherIdx).toBeGreaterThanOrEqual(0);
    expect(cipherIdx).toBeLessThan(schemaIdx); // guard runs before schema
  });

  it('clearLocalDb deletes the encrypted DB file (open handle case)', async () => {
    const { getLocalDb: g, clearLocalDb } = require('./localDb');
    await g(); // open it this session
    await clearLocalDb();
    expect(mockDelete).toHaveBeenCalled();
  });

  it('clearLocalDb opens a bare handle to delete when not opened this session', async () => {
    const { clearLocalDb } = require('./localDb');
    await clearLocalDb(); // never opened
    expect(mockOpen).toHaveBeenCalledWith(expect.objectContaining({ name: 'lightningpiggy.db' }));
    expect(mockDelete).toHaveBeenCalled();
  });

  it('wipeLocalDmStore deletes the DB AND clears the keystore key (#710 H1)', async () => {
    const { wipeLocalDmStore } = require('./localDb');
    await wipeLocalDmStore();
    expect(mockDelete).toHaveBeenCalled();
    expect(mockClearKey).toHaveBeenCalled();
  });
});

// reference so the static imports aren't flagged unused (we re-require per
// test to reset the module-level single-flight cache).
void getLocalDb;
void verifyEncryptedDb;
