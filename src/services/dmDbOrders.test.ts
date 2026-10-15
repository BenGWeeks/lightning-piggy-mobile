// Execute the real DAL SQL against SQLite, including JSON extraction and limits.
import { DatabaseSync } from 'node:sqlite';
import { getOrderRows, getShopOrderRows, hasIncomingOrder } from './dmDb';
import { admitOrderLifecycle } from '../contexts/orderRumorIngest';
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

it('bounds seller lifecycle bursts while retaining each kind and placed orders', async () => {
  insert('incoming', 'purchase', '1', 1, 'buyer', 'seller', false);
  insert('second-incoming', 'second-purchase', '1', 2, 'buyer', 'seller', false);
  insert('invoice', 'purchase', '2', 3, 'buyer', 'seller', true);
  for (let i = 0; i < 600; i++)
    insert(`status-${i}`, 'purchase', '3', 10 + i, 'buyer', 'seller', true);
  insert('shipping', 'purchase', '4', 700, 'buyer', 'seller', true);
  const receipt = serializeOrder({
    kind: 17,
    type: 'receipt',
    orderId: 'purchase',
    message: '',
    items: [],
  });
  mockDb
    .prepare('INSERT INTO dm_messages VALUES (?, ?, ?, ?, ?, ?, ?, 17)')
    .run('seller', 'receipt', 'buyer', 701, 'buyer', receipt, 0);
  insert('unsolicited', 'unknown', '2', 1000, 'buyer', 'seller', true);
  insert('other-buyer', 'purchase', '2', 1001, 'stranger', 'seller', false);
  insert('other-account', 'purchase', '1', 1002, 'buyer', 'other-seller', false);
  insert('outgoing-purchase', 'my-purchase', '1', 1003, 'merchant', 'seller', true);
  mockDb
    .prepare('INSERT INTO dm_messages VALUES (?, ?, ?, ?, ?, ?, ?, 16)')
    .run('seller', 'bad-json', 'buyer', 1004, 'buyer', '{broken', 0);
  const rows = await getShopOrderRows('seller');
  expect(rows).toHaveLength(6);
  expect(rows.map((row) => row.eventId)).toEqual(
    expect.arrayContaining(['incoming', 'second-incoming', 'invoice', 'shipping', 'receipt']),
  );
  expect(rows[0].eventId).toBe('receipt');
});

it('limits seller history by incoming orders and isolates identical ids across buyers', async () => {
  insert('old', 'same-id', '1', 1, 'older-buyer', 'seller', false);
  insert('new', 'same-id', '1', 2, 'newer-buyer', 'seller', false);
  insert('new-invoice', 'same-id', '2', 3, 'newer-buyer', 'seller', true);
  insert('old-invoice', 'same-id', '2', 4, 'older-buyer', 'seller', true);
  expect((await getShopOrderRows('seller', 1)).map((row) => row.eventId)).toEqual([
    'new-invoice',
    'new',
  ]);
});

it.each(['receipt', 'cancelled'])(
  'admits seller %s from incoming account history without any invoice record',
  async (type) => {
    // The same id under another account/buyer or in an outgoing row is insufficient.
    insert('other-account', 'sale', '1', 1, 'buyer', 'other-seller', false);
    insert('other-buyer', 'sale', '1', 2, 'stranger', 'seller', false);
    insert('outgoing', 'sale', '1', 3, 'merchant', 'seller', true);
    insert('not-placed', 'sale', '3', 4, 'buyer', 'seller', false);
    mockDb
      .prepare('INSERT INTO dm_messages VALUES (?, ?, ?, ?, ?, ?, ?, 16)')
      .run('seller', 'invalid', 'buyer', 5, 'buyer', '{broken', 0);
    const rumor = {
      kind: type === 'receipt' ? 17 : 16,
      content: '',
      tags: [
        ['order', 'sale'],
        ...(type === 'receipt'
          ? [['subject', 'order-receipt']]
          : [
              ['type', '3'],
              ['status', 'cancelled'],
            ]),
      ],
    };
    expect(await hasIncomingOrder('seller', 'buyer', 'sale')).toBe(false);
    expect(await admitOrderLifecycle('seller', 'buyer', false, rumor)).toBe(false);
    insert('incoming', 'sale', '1', 6, 'buyer', 'seller', false);
    expect(await admitOrderLifecycle('seller', 'buyer', false, rumor)).toBe(true);
    expect(await hasIncomingOrder('seller', 'buyer', 'different')).toBe(false);
  },
);

it('retains cancellation even when later status updates arrive', async () => {
  insert('incoming', 'purchase', '1', 1, 'buyer', 'seller', false);
  const cancelled = serializeOrder({
    kind: 16,
    type: 'status',
    orderId: 'purchase',
    message: '',
    items: [],
    status: 'cancelled',
  });
  mockDb
    .prepare('INSERT INTO dm_messages VALUES (?, ?, ?, ?, ?, ?, ?, 16)')
    .run('seller', 'cancelled', 'buyer', 2, 'buyer', cancelled, 0);
  insert('later-status', 'purchase', '3', 3, 'buyer', 'seller', false);
  expect((await getShopOrderRows('seller')).map((row) => row.eventId)).toEqual([
    'later-status',
    'cancelled',
    'incoming',
  ]);
});
