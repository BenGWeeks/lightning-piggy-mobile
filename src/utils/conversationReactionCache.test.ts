import { cacheConversationReactions, readConversationReactions } from './conversationReactionCache';
import { makeOptimisticReactionId, type ReactionRecord } from './reactions';

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
