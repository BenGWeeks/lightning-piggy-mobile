import {
  cacheConversationReactions as writeCache,
  readConversationReactions,
  reactionCacheGeneration,
  clearConversationReactions,
} from './conversationReactionCache';
import { makeOptimisticReactionId, type ReactionRecord } from './reactions';

const cacheConversationReactions = (key: string, snapshot: Parameters<typeof writeCache>[1]) =>
  writeCache(key, snapshot, reactionCacheGeneration());
beforeEach(clearConversationReactions);

const record: ReactionRecord = {
  id: 'reaction',
  reactorPubkey: 'reactor',
  targetEventId: 'message',
  emoji: '👍',
  createdAt: 1,
};

it('returns cached records synchronously and isolates account/protocol/group keys', () => {
  const key = 'viewer:nip17:peer';
  cacheConversationReactions(key, { records: [record], retractions: new Map() });
  expect(readConversationReactions(key).records).toEqual([record]);
  for (const other of ['other:nip17:peer', 'viewer:marmot:peer', 'viewer:group:id']) {
    expect(readConversationReactions(other).records).toEqual([]);
  }
});

it('retains author-checked tombstones, copies their sets, and excludes pending publishes', () => {
  const retractions = new Map([
    ['reaction', new Set(['reactor'])],
    ['other', new Set(['attacker'])],
  ]);
  cacheConversationReactions('tombstones', {
    records: [record, { ...record, id: 'other' }, { ...record, id: makeOptimisticReactionId(0) }],
    retractions,
  });
  retractions.get('reaction')!.clear();
  const cached = readConversationReactions('tombstones');
  expect(cached.records.map((r) => r.id)).toEqual(['other']);
  expect(cached.retractions.get('reaction')).toEqual(new Set(['reactor']));
});

it('bounds retained conversations and events', () => {
  for (let i = 0; i < 31; i++) {
    cacheConversationReactions(`bounded:${i}`, {
      records: Array.from({ length: 2001 }, (_, n) => ({ ...record, id: `r${n}` })),
      retractions: new Map(Array.from({ length: 2001 }, (_, n) => [`d${n}`, new Set(['reactor'])])),
    });
  }
  expect(readConversationReactions('bounded:0').records).toEqual([]);
  const cached = readConversationReactions('bounded:30');
  expect(cached.records).toHaveLength(2000);
  expect(cached.records[0].id).toBe('r1');
  expect(cached.retractions.size).toBe(2000);
});

it('bounds total deletion-author pairs and retains known legitimate deletions amid forged authors', () => {
  const attackers = new Set(Array.from({ length: 5000 }, (_, i) => `attacker-${i}`));
  attackers.add(record.reactorPubkey);
  cacheConversationReactions('oversized', {
    records: [record],
    retractions: new Map([
      ['reaction', attackers],
      ['other', attackers],
    ]),
  });
  const cached = readConversationReactions('oversized');
  expect([...cached.retractions.values()].reduce((n, authors) => n + authors.size, 0)).toBe(2000);
  expect(cached.retractions.get('reaction')?.has(record.reactorPubkey)).toBe(true);
  expect(cached.records).toEqual([]);
  cacheConversationReactions('oversized', {
    ...cached,
    retractions: new Map([
      ['reaction', attackers],
      ['other', attackers],
    ]),
  });
  expect(
    readConversationReactions('oversized').retractions.get('reaction')?.has(record.reactorPubkey),
  ).toBe(true);
  cacheConversationReactions('oversized', {
    records: [record],
    retractions: readConversationReactions('oversized').retractions,
  });
  expect(readConversationReactions('oversized').records).toEqual([]);
});

it('rejects late writers after clearing, including a return to the same account', () => {
  const token = reactionCacheGeneration();
  cacheConversationReactions('viewer:thread', { records: [record], retractions: new Map() });
  clearConversationReactions();
  writeCache('viewer:thread', { records: [record], retractions: new Map() }, token);
  expect(readConversationReactions('viewer:thread').records).toEqual([]);
});
