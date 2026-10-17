// "You replied to them" (#1623) over the real store SQL: the app schema
// (localDb.ts) on Node's built-in SQLite.
jest.mock('@op-engineering/op-sqlite', () =>
  require('./testUtils/nodeSqliteOpSqlite').nodeSqliteOpSqlite(),
);
jest.mock('./localDbKey', () => ({
  getOrCreateLocalDbKey: jest.fn(() => Promise.resolve('k')),
  clearLocalDbKey: jest.fn(() => Promise.resolve()),
}));

import { upsertDmMessages, type DmMessageRow } from './dmDb';
import { getLocalDb } from './localDb';
import {
  __resetRepliedPartnersForTests,
  forgetRepliedPartners,
  hasRepliedTo,
  completeSkipSetRecheck,
  loadRepliedPartners,
  pendingSkipSetRecheck,
} from './dmRepliedPartners';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ME = 'a'.repeat(64);
const ALICE = 'b'.repeat(64);
const BOB = 'c'.repeat(64);
const SHOP = 'd'.repeat(64);

const row = (over: Partial<DmMessageRow>): DmMessageRow => ({
  owner: ME,
  eventId: Math.random().toString(36),
  conversation: ALICE,
  createdAt: 1,
  sender: ME,
  content: 'hi',
  fromMe: true,
  wireKind: 14,
  ...over,
});

beforeEach(async () => {
  __resetRepliedPartnersForTests();
  await AsyncStorage.clear();
  await (await getLocalDb()).execute('DELETE FROM dm_messages;');
});

it('counts only 1:1 messages we sent, from the store and as we send', async () => {
  await upsertDmMessages([
    row({ conversation: ALICE }),
    row({ conversation: BOB, fromMe: false, sender: BOB }), // they wrote to us
    row({ conversation: SHOP, wireKind: 16 }), // an order isn't a reply
  ]);
  expect(hasRepliedTo(ME, ALICE)).toBe(false); // not loaded yet

  await loadRepliedPartners(ME);
  expect(hasRepliedTo(ME, ALICE)).toBe(true);
  expect(hasRepliedTo(ME, ALICE.toUpperCase())).toBe(true);
  expect(hasRepliedTo(ME, BOB)).toBe(false);
  expect(hasRepliedTo(ME, SHOP)).toBe(false);
  expect(hasRepliedTo(BOB, ALICE)).toBe(false); // per account

  // Replying to Bob (an optimistic send row) accepts him straight away.
  await upsertDmMessages([row({ eventId: 'local-1', conversation: BOB, wireKind: 4 })]);
  expect(hasRepliedTo(ME, BOB)).toBe(true);
});

it('forgets an account whose DM store was wiped', async () => {
  await upsertDmMessages([row({ conversation: ALICE })]);
  await loadRepliedPartners(ME);
  forgetRepliedPartners(ME);
  expect(hasRepliedTo(ME, ALICE)).toBe(false);
});

it("doesn't let a read that started before a wipe restore the account", async () => {
  await upsertDmMessages([row({ conversation: ALICE })]);
  const pending = loadRepliedPartners(ME);
  forgetRepliedPartners(ME);
  await pending;
  expect(hasRepliedTo(ME, ALICE)).toBe(false);
  // A fresh load after the wipe reads the store again.
  await loadRepliedPartners(ME);
  expect(hasRepliedTo(ME, ALICE)).toBe(true);
});

it('keeps a skip-set recheck pending across a restart until a refresh completes it', async () => {
  await loadRepliedPartners(ME);
  expect(pendingSkipSetRecheck(ME)).toBeNull();
  await upsertDmMessages([row({ conversation: ALICE })]);
  const first = pendingSkipSetRecheck(ME);
  expect(first).not.toBeNull();
  // Same partner again, or a received message: nothing new to recheck.
  await upsertDmMessages([row({ conversation: ALICE })]);
  await upsertDmMessages([row({ conversation: BOB, fromMe: false, sender: BOB })]);
  expect(pendingSkipSetRecheck(ME)).toBe(first);

  // App restart before any refresh ran: the persisted flag brings it back.
  await new Promise((resolve) => setTimeout(resolve, 0));
  __resetRepliedPartnersForTests();
  await loadRepliedPartners(ME);
  const restored = pendingSkipSetRecheck(ME);
  expect(restored).not.toBeNull();

  // A reply to someone new while a refresh runs stays pending after it.
  await upsertDmMessages([row({ conversation: BOB })]);
  completeSkipSetRecheck(ME, restored!);
  expect(pendingSkipSetRecheck(ME)).not.toBeNull();
  completeSkipSetRecheck(ME, pendingSkipSetRecheck(ME)!);
  expect(pendingSkipSetRecheck(ME)).toBeNull();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(await AsyncStorage.getItem(`dm_replied_skip_recheck_v1_${ME}`)).toBeNull();
});
