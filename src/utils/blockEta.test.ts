import { blockEta, blockEtaText } from './blockEta';

describe('blockEta', () => {
  it('estimates ~10 minutes per block, in hours under two days', () => {
    expect(blockEta(144)).toEqual({ unit: 'hours', count: 24 });
    expect(blockEta(3)).toEqual({ unit: 'hours', count: 1 });
  });

  it('switches to days for longer waits (custom backends use ~1 week)', () => {
    expect(blockEta(956)).toEqual({ unit: 'days', count: 7 });
  });

  it('formats readable English with singular/plural', () => {
    expect(blockEtaText(6)).toBe('about 1 hour');
    expect(blockEtaText(144)).toBe('about 24 hours');
    expect(blockEtaText(1008)).toBe('about 7 days');
  });
});
