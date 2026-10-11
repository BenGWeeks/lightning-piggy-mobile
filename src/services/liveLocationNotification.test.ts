import { liveShareNotificationText } from './liveLocationNotification';
import { loadPersistedSessions, savePersistedSessions } from './liveLocationStorage';
import type { OutgoingSession } from './liveLocationStateMachine';

const clock = (ms: number) => `@${ms}`;

describe('liveShareNotificationText', () => {
  it('names the one chat and the end time', () => {
    expect(liveShareNotificationText([{ label: 'Middle Piggy', expiresAt: 5 }], clock)).toEqual({
      title: 'Sharing your location with Middle Piggy',
      body: 'Until @5',
    });
  });
  it('falls back to a neutral name, and counts several chats (latest end time)', () => {
    expect(liveShareNotificationText([{ groupId: 'marmot:g', expiresAt: 1 }], clock).title).toBe(
      'Sharing your location with a group',
    );
    expect(
      liveShareNotificationText(
        [
          { label: 'A', expiresAt: 1 },
          { label: 'B', expiresAt: 9 },
        ],
        clock,
      ),
    ).toEqual({ title: 'Sharing your location with 2 chats', body: 'Until @9' });
  });
});

describe('persisted shares (#1300 fields)', () => {
  const ME = 'a'.repeat(64);
  const base: OutgoingSession = {
    sessionId: 's1',
    senderPubkey: ME,
    recipientPubkey: 'marmot:g1',
    startedAt: 1,
    durationMs: 2,
    lastPingAt: null,
    status: 'active',
    startMarkerSent: true,
    endMarkerSent: false,
    protocol: 'marmot',
    groupId: 'marmot:g1',
    label: 'Piggy Pals',
    stopRequested: true,
  };
  it('round-trip group id, label and stopRequested', async () => {
    await savePersistedSessions(ME, [base]);
    const [loaded] = await loadPersistedSessions(ME);
    expect(loaded).toMatchObject({
      groupId: 'marmot:g1',
      label: 'Piggy Pals',
      stopRequested: true,
      protocol: 'marmot',
      status: 'paused',
    });
  });
  it('ignore a group id that is not a Marmot group', async () => {
    await savePersistedSessions(ME, [{ ...base, groupId: 'g_nip17' }]);
    const [loaded] = await loadPersistedSessions(ME);
    expect(loaded.groupId).toBeUndefined();
  });
});
