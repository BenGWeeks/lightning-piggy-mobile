import { crossDevicePrizeLine, validatedSatsLine } from './huntPrizeLines';

const t = (scope: string, options?: Record<string, unknown>) =>
  `${scope} ${JSON.stringify(options)}`;

describe('validatedSatsLine', () => {
  it('shows a single amount when min equals max, in the given locale', () => {
    expect(validatedSatsLine(21_000_000, 21_000_000, t, 'de')).toBe(
      'huntCreateScreen.satsPerClaim {"amount":"21.000"}',
    );
  });

  it('shows a range when min and max differ', () => {
    expect(validatedSatsLine(1_000, 5_000_000, t, 'en')).toBe(
      'huntCreateScreen.satsPerClaimRange {"min":"1","max":"5,000"}',
    );
  });

  it('never advertises an unknown (0) prize', () => {
    expect(validatedSatsLine(0, 0, t, 'en')).toBeNull();
  });
});

describe('crossDevicePrizeLine', () => {
  it('formats a positive whole amount', () => {
    expect(crossDevicePrizeLine(' 1500 ', t, 'hu')).toBe(
      `huntCreateScreen.prizeLine {"amount":"${(1500).toLocaleString('hu')}"}`,
    );
  });

  it('returns null for empty, zero or non-numeric input', () => {
    for (const text of ['', '0', 'abc']) expect(crossDevicePrizeLine(text, t, 'en')).toBeNull();
  });
});
