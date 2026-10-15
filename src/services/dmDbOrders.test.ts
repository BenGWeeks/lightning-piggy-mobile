// Execute the real DAL SQL against SQLite, including JSON extraction and limits.
import { DatabaseSync } from 'node:sqlite';
import { getOrderRows } from './dmDb';
import { parseOrderEvent, serializeOrder } from '../utils/orderEvents';

let mockDb: DatabaseSync;
jest.mock('./localDb', () => ({
  getLocalDb: async () => ({
    execute: async (sql: string, params: (string | number)[]) => ({
      rows: mockDb.prepare(sql).all(...params),
    }),
  }),
}));

beforeEach(() => {
  mockDb = new DatabaseSync(':memory:');
  mockDb.exec(`CREATE TABLE dm_messages (
    owner TEXT, event_id TEXT, conversation TEXT, created_at INTEGER,
    sender TEXT, content TEXT, from_me INTEGER, wire_kind INTEGER
  );`);
});
afterEach(() => mockDb.close());

function insert(
  id: string,
  orderId: string,
  type: string,
  at: number,
  seller = 'seller',
  owner = 'buyer',
  fromMe = type === '1',
) {
  const content = serializeOrder(
    parseOrderEvent({
      kind: 16,
      content: '',
      tags: [
        ['type', type],
        ['order', orderId],
      ],
    })!,
  );
  mockDb
    .prepare('INSERT INTO dm_messages VALUES (?, ?, ?, ?, ?, ?, ?, 16)')
    .run(owner, id, seller, at, fromMe ? owner : seller, content, fromMe ? 1 : 0);
}

it('keeps placed orders and every lifecycle row after 600 newer updates', async () => {
  insert('original', 'purchase', '1', 1);
  insert('second', 'other-purchase', '1', 2);
  insert('invoice', 'purchase', '2', 3);
  for (let i = 0; i < 600; i++) insert(`status-${i}`, 'purchase', '3', 10 + i);
  insert('unsolicited', 'unknown', '2', 1000);
  insert('impostor', 'purchase', '2', 1001, 'stranger');
  insert('other-account', 'purchase', '1', 1002, 'seller', 'other-buyer');
  mockDb
    .prepare('INSERT INTO dm_messages VALUES (?, ?, ?, ?, ?, ?, ?, 16)')
    .run('buyer', 'bad-json', 'seller', 1003, 'buyer', '{broken', 1);
  const rows = await getOrderRows('buyer');
  expect(rows).toHaveLength(603);
  expect(rows.map((row) => row.eventId)).toEqual(
    expect.arrayContaining(['original', 'second', 'invoice']),
  );
  expect(rows[0].eventId).toBe('status-599');
  expect(rows.map((row) => row.eventId)).not.toEqual(expect.arrayContaining(['unsolicited']));
});

it('limits by newest placed orders, including older invoices only for selected orders', async () => {
  insert('old', 'old-order', '1', 1);
  insert('new', 'new-order', '1', 2);
  insert('new-invoice', 'new-order', '2', 3);
  insert('old-invoice', 'old-order', '2', 4);
  expect((await getOrderRows('buyer', 1)).map((row) => row.eventId)).toEqual([
    'new-invoice',
    'new',
  ]);
});
