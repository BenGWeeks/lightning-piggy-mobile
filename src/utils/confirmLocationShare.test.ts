import { Alert } from '../components/BrandedAlert';
import i18n, { type SupportedLocale } from '../i18n';
import { confirmGroupLocationShare, confirmLocationShare } from './confirmLocationShare';

jest.mock('../components/BrandedAlert', () => ({ Alert: { alert: jest.fn() } }));
const alert = jest.mocked(Alert.alert);
const location = { lat: 51.5074, lon: -0.1278, accuracyMeters: 5 };

beforeEach(() => {
  jest.clearAllMocks();
  i18n.locale = 'en';
});
afterEach(() => {
  i18n.locale = 'en';
});

it.each([
  ['Cancel', 0, false],
  ['Share', 1, true],
] as const)('%s resolves consent to %s', async (_label, index, expected) => {
  const consent = confirmLocationShare(location, { name: 'Big Piggy' });
  expect(alert).toHaveBeenCalledWith(
    'Share your location with Big Piggy?',
    "51.5074° N, 0.1278° W\n\nOnly share your location with people you know and trust. Your message is end-to-end encrypted, and they'll see a map preview from OpenStreetMap.",
    expect.any(Array),
    expect.objectContaining({ cancelable: true }),
  );
  alert.mock.calls[0][2]![index].onPress!();
  // The host can dismiss after a button press; the first decision wins.
  alert.mock.calls[0][3]!.onDismiss!();
  await expect(consent).resolves.toBe(expected);
});

it('dismissal declines consent without a button press', async () => {
  const consent = confirmLocationShare(location, { name: 'Big Piggy' });
  alert.mock.calls[0][3]!.onDismiss!();
  await expect(consent).resolves.toBe(false);
});

it.each([
  [['me', 'big'], 'the other person'],
  [['me', 'big', 'little', 'big'], 'the 2 people'],
  [['big', 'little'], 'the 2 people'],
] as const)('counts unique other members in %j', async (members, audience) => {
  const consent = confirmLocationShare(location, {
    group: 'Family',
    memberPubkeys: members,
    myPubkey: 'me',
  });
  expect(alert.mock.calls[0][0]).toBe(`Share your location with ${audience} in Family?`);
  alert.mock.calls[0][2]![0].onPress!();
  await expect(consent).resolves.toBe(false);
});

it.each([[[]], [['me']], [['me', 'me']]] as const)(
  'blocks a group share when no one else is in the group (%j)',
  async (members) => {
    const consent = confirmLocationShare(location, {
      group: 'Family',
      memberPubkeys: members,
      myPubkey: 'me',
    });
    await expect(consent).resolves.toBe(false);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert.mock.calls[0][0]).toBe('No one to share with yet');
    expect(alert.mock.calls[0][1]).toContain('no one else in Family');
    expect(alert.mock.calls[0][2]).toEqual([{ text: 'OK' }]);
  },
);

describe('confirmGroupLocationShare', () => {
  const audience = (memberPubkeys: string[], myPubkey = 'me', groupId = 'family') => ({
    group: 'Family',
    groupId,
    memberPubkeys,
    myPubkey,
  });
  // Lets the pending dialog's promise chain settle before the next assertion.
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('consents when the roster is unchanged', async () => {
    const consent = confirmGroupLocationShare(location, () => audience(['me', 'big']));
    alert.mock.calls[0][2]![1].onPress!();
    await expect(consent).resolves.toBe(true);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('asks again with the new count when the roster changed while the dialog was open', async () => {
    let current = audience(['me', 'big']);
    const consent = confirmGroupLocationShare(location, () => current);
    expect(alert.mock.calls[0][0]).toBe('Share your location with the other person in Family?');
    current = audience(['me', 'big', 'little']);
    alert.mock.calls[0][2]![1].onPress!();
    await flush();
    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert.mock.calls[1][0]).toBe('Share your location with the 2 people in Family?');
    alert.mock.calls[1][2]![1].onPress!();
    await expect(consent).resolves.toBe(true);
  });

  it('declines when the re-ask is cancelled', async () => {
    let current = audience(['me', 'big', 'little']);
    const consent = confirmGroupLocationShare(location, () => current);
    current = audience(['me', 'big']);
    alert.mock.calls[0][2]![1].onPress!();
    await flush();
    alert.mock.calls[1][2]![0].onPress!();
    await expect(consent).resolves.toBe(false);
  });

  it('asks again when the account switched, and declines when the group is gone', async () => {
    let current: ReturnType<typeof audience> | null = audience(['me', 'big']);
    const consent = confirmGroupLocationShare(location, () => current);
    current = audience(['me', 'big'], 'other');
    alert.mock.calls[0][2]![1].onPress!();
    await flush();
    expect(alert).toHaveBeenCalledTimes(2);
    current = null;
    alert.mock.calls[1][2]![1].onPress!();
    await expect(consent).resolves.toBe(false);
  });

  it('asks again when the screen switched to another group with the same members', async () => {
    let current = audience(['me', 'big']);
    const consent = confirmGroupLocationShare(location, () => current);
    current = audience(['me', 'big'], 'me', 'other-group');
    alert.mock.calls[0][2]![1].onPress!();
    await flush();
    expect(alert).toHaveBeenCalledTimes(2);
    alert.mock.calls[1][2]![0].onPress!();
    await expect(consent).resolves.toBe(false);
  });

  it('ignores member order and duplicates when comparing rosters', async () => {
    let current = audience(['me', 'big', 'little']);
    const consent = confirmGroupLocationShare(location, () => current);
    current = audience(['little', 'big', 'big', 'me']);
    alert.mock.calls[0][2]![1].onPress!();
    await expect(consent).resolves.toBe(true);
    expect(alert).toHaveBeenCalledTimes(1);
  });
});

describe.each<SupportedLocale>(['en', 'es', 'uk'])('%s translations', (locale) => {
  it.each([1, 2, 5, 21])('interpolates group count %i without missing translations', (count) => {
    i18n.locale = locale;
    void confirmLocationShare(location, {
      group: 'Piggies',
      myPubkey: 'me',
      memberPubkeys: ['me', ...Array.from({ length: count }, (_, i) => String(i))],
    });
    const [title, body, buttons] = alert.mock.calls[0];
    // The singular reads "the other person", so only plurals show the number.
    if (count > 1) expect(title).toContain(String(count));
    expect(title).toContain('Piggies');
    expect(`${title} ${body}`).not.toMatch(/missing|\{\{/i);
    if (locale !== 'en') {
      expect(title).not.toContain('Share your');
      expect(body).not.toContain('Only share');
      expect(buttons![0].text).not.toBe('Cancel');
      expect(buttons![1].text).not.toBe('Share');
    }
    buttons![0].onPress!();
  });

  it('translates the empty-group message', () => {
    i18n.locale = locale;
    void confirmLocationShare(location, { group: 'Piggies', myPubkey: 'me', memberPubkeys: [] });
    const [title, body, buttons] = alert.mock.calls[0];
    expect(body).toContain('Piggies');
    expect(`${title} ${body} ${buttons![0].text}`).not.toMatch(/missing|\{\{/i);
    if (locale !== 'en') expect(title).not.toBe('No one to share with yet');
  });

  it.each([false, true])('translates direct sharing (live: %s)', (live) => {
    i18n.locale = locale;
    void confirmLocationShare(location, { name: 'Big Piggy', live });
    expect(alert.mock.calls[0][0]).toBe(
      i18n.t(live ? 'locationSharing.liveTitle' : 'locationSharing.directTitle', {
        name: 'Big Piggy',
      }),
    );
    alert.mock.calls[0][2]![0].onPress!();
  });
});
