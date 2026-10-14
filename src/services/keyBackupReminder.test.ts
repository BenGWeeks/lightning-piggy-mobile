// Weekly "Back up your key" reminder (#1546): eligibility, the 7-day anchor,
// idempotent rescheduling, every cancel path, and the no-permission banner.

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BANNER_SNOOZE_KEY_BASE,
  REMINDER_ANCHOR_KEY_BASE,
  __resetKeyBackupReminderForTests,
  cancelKeyBackupReminder,
  eligibleReminderAccounts,
  reconcileKeyBackupReminders,
  reminderId,
  retireKeyBackupReminder,
  setKeyBackupRemindersEnabled,
  shouldShowKeyBackupBanner,
  snoozeKeyBackupBanner,
} from './keyBackupReminder';
import { completeKeyBackupReminderRetirement } from './keyBackupReminderQueue';
import { markKeyBackedUp } from './keyBackupStatus';
import { perAccountKey } from './perAccountStorage';

interface MockRequest {
  identifier: string;
  content: { title: string; body: string; data: Record<string, unknown> };
  trigger: Record<string, unknown>;
}
const mockScheduled = new Map<string, MockRequest>();
let mockPresented: { request: { identifier: string } }[] = [];
const mockSchedule = jest.fn(async (req: MockRequest) => {
  mockScheduled.set(req.identifier, req);
  return req.identifier;
});
const mockCancel = jest.fn(async (id: string) => {
  mockScheduled.delete(id);
});
const mockDismiss = jest.fn(async (id: string) => {
  mockPresented = mockPresented.filter((n) => n.request.identifier !== id);
});

jest.mock('expo-notifications', () => ({
  setNotificationChannelAsync: jest.fn(async () => null),
  scheduleNotificationAsync: (req: MockRequest) => mockSchedule(req),
  getAllScheduledNotificationsAsync: async () => [...mockScheduled.values()],
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  dismissNotificationAsync: (id: string) => mockDismiss(id),
  getPresentedNotificationsAsync: async () => mockPresented,
  SchedulableTriggerInputTypes: { DATE: 'date', WEEKLY: 'weekly', TIME_INTERVAL: 'timeInterval' },
  AndroidImportance: { DEFAULT: 3 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
}));

const mockPermission = jest.fn(async () => true);
jest.mock('./notificationService', () => ({
  hasNotificationPermission: () => mockPermission(),
}));

type Identity = { pubkey: string; signerType: 'nsec' | 'amber'; lastUsedAt: number };
let mockIdentities: Identity[] = [];
jest.mock('./identitiesStore', () => ({
  loadIdentities: async () => ({ identities: mockIdentities, activePubkey: null }),
}));

const WEEK = 7 * 24 * 60 * 60 * 1000;
const DAY = 24 * 60 * 60 * 1000;
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const nsec = (pubkey: string): Identity => ({ pubkey, signerType: 'nsec', lastUsedAt: 1 });
const amber = (pubkey: string): Identity => ({ pubkey, signerType: 'amber', lastUsedAt: 1 });
// Wednesday 2026-10-14, local time.
const WED_14 = new Date(2026, 9, 14, 14, 0).getTime();

const anchorOf = async (pk: string) =>
  Number(await AsyncStorage.getItem(perAccountKey(REMINDER_ANCHOR_KEY_BASE, pk)));

beforeEach(async () => {
  await AsyncStorage.clear();
  mockScheduled.clear();
  mockPresented = [];
  mockSchedule.mockClear();
  mockCancel.mockClear();
  mockDismiss.mockClear();
  mockPermission.mockResolvedValue(true);
  mockIdentities = [];
  __resetKeyBackupReminderForTests();
});

describe('eligibility', () => {
  it('only local-key accounts that are not backed up', async () => {
    await markKeyBackedUp(B);
    const eligible = await eligibleReminderAccounts([nsec(A), nsec(B), amber(C)]);
    expect(eligible).toEqual([A]);
  });
});

describe('reconcile', () => {
  it('anchors a new account now and first fires no sooner than 7 days later', async () => {
    mockIdentities = [nsec(A), amber(B)];
    await reconcileKeyBackupReminders(WED_14);
    expect(await anchorOf(A)).toBe(WED_14);
    expect(await AsyncStorage.getItem(perAccountKey(REMINDER_ANCHOR_KEY_BASE, B))).toBeNull();
    expect([...mockScheduled.keys()]).toEqual([reminderId(A)]);
    const req = mockScheduled.get(reminderId(A))!;
    expect(req.trigger).toEqual({
      type: 'timeInterval',
      channelId: 'reminders',
      seconds: WEEK / 1000,
      repeats: true,
    });
    expect(req.content.data).toMatchObject({ kind: 'keyBackup', keyBackupPubkey: A });
    expect(req.content.title).toBe('Back up your key');
    expect(req.content.body).toContain("isn't backed up yet");
  });

  it('keeps an existing anchor (an account added earlier)', async () => {
    mockIdentities = [nsec(A)];
    await AsyncStorage.setItem(perAccountKey(REMINDER_ANCHOR_KEY_BASE, A), String(WED_14 - WEEK));
    await reconcileKeyBackupReminders(WED_14);
    expect(await anchorOf(A)).toBe(WED_14 - WEEK);
    expect(mockScheduled.get(reminderId(A))!.trigger).toMatchObject({
      type: 'timeInterval',
      repeats: true,
    });
  });

  it('keeps the repeating trigger unchanged across later reconciles', async () => {
    mockIdentities = [nsec(A)];
    await reconcileKeyBackupReminders(WED_14);
    await reconcileKeyBackupReminders(WED_14 + 60_000);
    expect(mockSchedule).toHaveBeenCalledTimes(1);

    await reconcileKeyBackupReminders(WED_14 + 2 * DAY);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    expect(mockScheduled.size).toBe(1);
    expect(mockScheduled.get(reminderId(A))!.trigger).toMatchObject({
      type: 'timeInterval',
      seconds: WEEK / 1000,
      repeats: true,
    });
    await reconcileKeyBackupReminders(WED_14 + 3 * DAY);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('replaces a legacy one-shot with an OS-owned repeating reminder', async () => {
    mockIdentities = [nsec(A)];
    mockScheduled.set(reminderId(A), {
      identifier: reminderId(A),
      content: { title: 'Back up your key', body: '', data: { reminderKey: 'legacy-plan' } },
      trigger: { type: 'date', date: WED_14 + WEEK },
    });
    await reconcileKeyBackupReminders(WED_14);
    expect(mockCancel).toHaveBeenCalledWith(reminderId(A));
    expect(mockScheduled.get(reminderId(A))!.trigger).toMatchObject({
      type: 'timeInterval',
      seconds: WEEK / 1000,
      repeats: true,
    });
  });

  it('reschedules when the account name changes', async () => {
    mockIdentities = [nsec(A)];
    await reconcileKeyBackupReminders(WED_14);
    await AsyncStorage.setItem(
      perAccountKey('nostr_own_profile_cache', A),
      JSON.stringify({ displayName: 'Penny' }),
    );
    await reconcileKeyBackupReminders(WED_14 + 60_000);
    expect(mockSchedule).toHaveBeenCalledTimes(2);
    expect(mockScheduled.get(reminderId(A))!.content.body).toContain('Penny');
  });

  it('cancels when the signer changes away from a local key', async () => {
    mockIdentities = [nsec(A)];
    await reconcileKeyBackupReminders(WED_14);
    mockIdentities = [amber(A)];
    await reconcileKeyBackupReminders(WED_14 + 60_000);
    expect(mockScheduled.size).toBe(0);
  });
});

describe('cancel paths', () => {
  it('cancels (and clears a delivered one) when the key is backed up', async () => {
    mockIdentities = [nsec(A), nsec(B)];
    await reconcileKeyBackupReminders(WED_14);
    mockPresented = [{ request: { identifier: reminderId(A) } }];
    await markKeyBackedUp(A);
    await cancelKeyBackupReminder(A);
    expect([...mockScheduled.keys()]).toEqual([reminderId(B)]);
    expect(mockPresented).toEqual([]);
    // A later reconcile doesn't bring it back.
    await reconcileKeyBackupReminders(WED_14 + DAY);
    expect([...mockScheduled.keys()]).toEqual([reminderId(B)]);
  });

  it('a signed-out account stays cancelled while its registry entry lingers', async () => {
    mockIdentities = [nsec(A)];
    await reconcileKeyBackupReminders(WED_14);
    // The cache wipe runs before removeIdentity, and wipes the backup flag.
    await retireKeyBackupReminder(A);
    await reconcileKeyBackupReminders(WED_14 + 60_000);
    expect(mockScheduled.size).toBe(0);
    // Registry entry gone → no longer retired; signing back in reminds again.
    mockIdentities = [];
    await AsyncStorage.removeItem(perAccountKey(REMINDER_ANCHOR_KEY_BASE, A));
    await completeKeyBackupReminderRetirement(A);
    mockIdentities = [nsec(A)];
    await reconcileKeyBackupReminders(WED_14 + 180_000);
    expect([...mockScheduled.keys()]).toEqual([reminderId(A)]);
    expect(await anchorOf(A)).toBe(WED_14 + 180_000);
    mockPermission.mockResolvedValue(false);
    expect(await shouldShowKeyBackupBanner(A, 'nsec', WED_14 + 180_000 + WEEK)).toBe(true);
  });

  it('keeps queued stale reconciles retired until removal completion reaches the queue', async () => {
    mockIdentities = [nsec(A)];
    await reconcileKeyBackupReminders(WED_14);
    const cancellation = retireKeyBackupReminder(A);
    const staleReconcile = reconcileKeyBackupReminders(WED_14 + 60_000);
    const completion = completeKeyBackupReminderRetirement(A);
    await Promise.all([cancellation, staleReconcile, completion]);
    expect(mockScheduled.size).toBe(0);
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    // Re-add can schedule again after the older reconcile is finished.
    await reconcileKeyBackupReminders(WED_14 + 120_000);
    expect(mockScheduled.has(reminderId(A))).toBe(true);
  });

  it('cancels a reminder for an account no longer on the phone', async () => {
    mockIdentities = [nsec(A), nsec(B)];
    await reconcileKeyBackupReminders(WED_14);
    mockIdentities = [nsec(B)];
    await reconcileKeyBackupReminders(WED_14 + 60_000);
    expect([...mockScheduled.keys()]).toEqual([reminderId(B)]);
  });

  it('toggle off cancels everything; on schedules again', async () => {
    mockIdentities = [nsec(A), nsec(B)];
    await reconcileKeyBackupReminders(WED_14);
    mockPresented = [{ request: { identifier: reminderId(B) } }, { request: { identifier: 'x' } }];
    await setKeyBackupRemindersEnabled(false);
    expect(mockScheduled.size).toBe(0);
    expect(mockPresented).toEqual([{ request: { identifier: 'x' } }]);
    await reconcileKeyBackupReminders(WED_14 + DAY);
    expect(mockScheduled.size).toBe(0);
    await setKeyBackupRemindersEnabled(true);
    expect(mockScheduled.size).toBe(2);
  });
});

describe('without notification permission', () => {
  it('schedules nothing (and never asks) but still anchors the account', async () => {
    mockPermission.mockResolvedValue(false);
    mockIdentities = [nsec(A)];
    await reconcileKeyBackupReminders(WED_14);
    expect(mockScheduled.size).toBe(0);
    expect(await anchorOf(A)).toBe(WED_14);
  });

  it('cancels reminders scheduled before permission was withdrawn', async () => {
    mockIdentities = [nsec(A)];
    await reconcileKeyBackupReminders(WED_14);
    mockPermission.mockResolvedValue(false);
    await reconcileKeyBackupReminders(WED_14 + 60_000);
    expect(mockScheduled.size).toBe(0);
  });

  it('shows the banner a week after the anchor, snoozes it for a week', async () => {
    mockPermission.mockResolvedValue(false);
    mockIdentities = [nsec(A)];
    await reconcileKeyBackupReminders(WED_14);
    expect(await shouldShowKeyBackupBanner(A, 'nsec', WED_14 + DAY)).toBe(false);
    const due = WED_14 + WEEK;
    expect(await shouldShowKeyBackupBanner(A, 'nsec', due)).toBe(true);
    await snoozeKeyBackupBanner(A, due);
    expect(Number(await AsyncStorage.getItem(perAccountKey(BANNER_SNOOZE_KEY_BASE, A))) - due).toBe(
      WEEK,
    );
    expect(await shouldShowKeyBackupBanner(A, 'nsec', due + 6 * DAY)).toBe(false);
    expect(await shouldShowKeyBackupBanner(A, 'nsec', due + WEEK)).toBe(true);
  });

  it('no banner when notifications are allowed, for other signers, when backed up or off', async () => {
    mockIdentities = [nsec(A)];
    await reconcileKeyBackupReminders(WED_14);
    const due = WED_14 + WEEK;
    expect(await shouldShowKeyBackupBanner(A, 'nsec', due)).toBe(false); // permission granted
    mockPermission.mockResolvedValue(false);
    expect(await shouldShowKeyBackupBanner(A, 'amber', due)).toBe(false);
    expect(await shouldShowKeyBackupBanner(A, 'nip46', due)).toBe(false);
    expect(await shouldShowKeyBackupBanner(null, 'nsec', due)).toBe(false);
    await setKeyBackupRemindersEnabled(false);
    expect(await shouldShowKeyBackupBanner(A, 'nsec', due)).toBe(false);
    await setKeyBackupRemindersEnabled(true);
    expect(await shouldShowKeyBackupBanner(A, 'nsec', due)).toBe(true);
    await markKeyBackedUp(A);
    expect(await shouldShowKeyBackupBanner(A, 'nsec', due)).toBe(false);
  });
});
