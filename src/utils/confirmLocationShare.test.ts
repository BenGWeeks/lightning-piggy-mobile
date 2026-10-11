import { Alert } from '../components/BrandedAlert';
import i18n, { type SupportedLocale } from '../i18n';
import { confirmLocationShare } from './confirmLocationShare';

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
    '51.5074° N, 0.1278° W\n\nOnly share your location with people you know and trust. Your message is end-to-end encrypted.',
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
  [[], 0, 'people'],
  [['me'], 0, 'people'],
  [['me', 'big'], 1, 'person'],
  [['me', 'big', 'little', 'big'], 2, 'people'],
  [['big', 'little'], 2, 'people'],
] as const)('counts unique other members in %j', async (members, count, noun) => {
  const consent = confirmLocationShare(location, {
    group: 'Family',
    memberPubkeys: members,
    myPubkey: 'me',
  });
  expect(alert.mock.calls[0][0]).toBe(`Share your location with the ${count} ${noun} in Family?`);
  alert.mock.calls[0][2]![0].onPress!();
  await expect(consent).resolves.toBe(false);
});

describe.each<SupportedLocale>(['en', 'es', 'uk'])('%s translations', (locale) => {
  it.each([0, 1, 2, 5, 21])('interpolates group count %i without missing translations', (count) => {
    i18n.locale = locale;
    void confirmLocationShare(location, {
      group: 'Piggies',
      myPubkey: 'me',
      memberPubkeys: ['me', ...Array.from({ length: count }, (_, i) => String(i))],
    });
    const [title, body, buttons] = alert.mock.calls[0];
    expect(title).toContain(String(count));
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
