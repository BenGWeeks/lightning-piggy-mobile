import * as nip19 from 'nostr-tools/nip19';
import { activityFromMessages, computeRecentSenders } from './groupActivity';
import type { Group } from '../types/groups';

const ME = 'a'.repeat(64);
const BOB = 'b'.repeat(64);
const CAROL = 'c'.repeat(64);
const group: Group = {
  id: 'g1',
  name: 'Pigs',
  memberPubkeys: [BOB, CAROL],
  createdAt: 10_000,
  updatedAt: 10_000,
};
const mention = `hey nostr:${nip19.npubEncode(ME)}`;

describe('activityFromMessages', () => {
  it('falls back to the group creation time with no messages', () => {
    expect(activityFromMessages(group, [], ME)).toEqual({
      lastActivityAt: 10,
      lastText: '',
      lastSenderPubkey: null,
      recentSenderPubkeys: [],
    });
  });

  it('records the newest mention of the viewer by someone else', () => {
    const activity = activityFromMessages(
      group,
      [
        { id: '1', senderPubkey: BOB, text: mention, createdAt: 20 },
        { id: '2', senderPubkey: CAROL, text: 'hi', createdAt: 30, mentions: [ME] },
        { id: '3', senderPubkey: ME, text: mention, createdAt: 40 },
        { id: '4', senderPubkey: BOB, text: 'later', createdAt: 50 },
      ],
      ME,
    );
    expect(activity.lastMentionAt).toBe(30);
    expect(activity.lastText).toBe('later');
    expect(activity.recentSenderPubkeys).toEqual([BOB, ME, CAROL]);
  });

  it('omits lastMentionAt when nobody mentioned the viewer', () => {
    const activity = activityFromMessages(
      group,
      [{ id: '1', senderPubkey: BOB, text: 'hi', createdAt: 20 }],
      ME,
    );
    expect(activity).not.toHaveProperty('lastMentionAt');
  });
});

describe('computeRecentSenders', () => {
  it('lists up to three distinct posters, newest first', () => {
    const msgs = ['A', 'B', 'A', 'C', 'D'].map((p, i) => ({ senderPubkey: p, createdAt: i }));
    expect(computeRecentSenders(msgs)).toEqual(['d', 'c', 'a']);
  });
});
