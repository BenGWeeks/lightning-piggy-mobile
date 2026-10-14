import { createI18nInstance } from '../i18n';
import type { InvitationDevice } from '../services/marmotInvitationDevices';
import {
  SUMMARY_FRESH_MS,
  cachedInvitationDeviceSummary,
  clearInvitationDeviceSummaries,
  invitationDeviceSummaryLabel,
  rememberInvitationDeviceSummary,
  summariseInvitationDevices,
  type InvitationDeviceSummary,
} from './invitationDeviceSummary';

const device = (kind: InvitationDevice['kind'], published = true): InvitationDevice => ({
  slot: `${kind}-slot`,
  kind,
  client: '',
  relays: [],
  versions: published ? [{} as InvitationDevice['versions'][number]] : [],
  old: false,
});

const en = createI18nInstance('en');
const label = (summary: InvitationDeviceSummary) => {
  const { key, options } = invitationDeviceSummaryLabel(summary);
  return en.t(key, options);
};

describe('"Devices for new chats" value (#1552)', () => {
  beforeEach(() => clearInvitationDeviceSummaries());

  it('counts only devices relays hold a key for (this phone is always listed)', () => {
    expect(summariseInvitationDevices([device('thisPhone', false)])).toEqual({
      state: 'notShared',
    });
    expect(summariseInvitationDevices([device('thisPhone')])).toEqual({ state: 'thisPhoneOnly' });
    expect(
      summariseInvitationDevices([device('thisPhone'), device('whiteNoise'), device('otherApp')]),
    ).toEqual({ state: 'devices', count: 3 });
    expect(summariseInvitationDevices([device('thisPhone', false), device('whiteNoise')])).toEqual({
      state: 'devices',
      count: 1,
    });
  });

  it('never shows "Unknown"', () => {
    const states: InvitationDeviceSummary[] = [
      { state: 'checking' },
      { state: 'unavailable' },
      { state: 'notShared' },
      { state: 'thisPhoneOnly' },
      { state: 'devices', count: 1 },
      { state: 'devices', count: 2 },
    ];
    const labels = states.map(label);
    expect(labels).toEqual([
      'Checking…',
      "Couldn't check",
      'Not shared yet',
      'This phone only',
      '1 device',
      '2 devices',
    ]);
    for (const text of labels) expect(text).not.toMatch(/unknown|missing/i);
  });

  it('remembers the last scan per account and marks it stale after 10 minutes', () => {
    rememberInvitationDeviceSummary('alice', { state: 'devices', count: 2 }, 1_000);
    expect(cachedInvitationDeviceSummary('alice', 1_000)).toEqual({
      summary: { state: 'devices', count: 2 },
      fresh: true,
    });
    expect(cachedInvitationDeviceSummary('alice', 1_000 + SUMMARY_FRESH_MS)?.fresh).toBe(false);
    expect(cachedInvitationDeviceSummary('bob', 1_000)).toBeUndefined();
  });

  it("doesn't cache transient states", () => {
    rememberInvitationDeviceSummary('alice', { state: 'checking' });
    rememberInvitationDeviceSummary('alice', { state: 'unavailable' });
    expect(cachedInvitationDeviceSummary('alice')).toBeUndefined();
  });
});
