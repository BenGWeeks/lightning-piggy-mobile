import {
  filterPickerOptions,
  shouldUseSegmentedPicker,
  registerPickerOptions,
  getPickerOptions,
} from './settingsPicker';
const options = [
  { value: 'system', label: 'System', searchTerms: 'automatic' },
  { value: 'light', label: 'Hell', subtitle: 'Light theme' },
  { value: 'dark', label: 'Dunkel', disabled: true },
];
describe('picker filtering', () => {
  it('keeps original order, values and disabled state without a query', () => {
    expect(filterPickerOptions(options, '  ')).toBe(options);
    expect(filterPickerOptions(options, 'dunk')).toEqual([options[2]]);
  });
  it('matches translated labels, stored values and extra search terms', () => {
    expect(filterPickerOptions(options, ' HELL ')).toEqual([options[1]]);
    expect(filterPickerOptions(options, 'LIGHT')).toEqual([options[1]]);
    expect(filterPickerOptions(options, 'auto')).toEqual([options[0]]);
    expect(filterPickerOptions(options, 'missing')).toEqual([]);
    const translated = [{ value: 'custom', label: 'Власний' }];
    expect(filterPickerOptions(translated, 'ВЛАС')).toEqual(translated);
  });
});
describe('segmented fallback', () => {
  it('uses segments only for up to three fitting labels below the large text threshold', () => {
    expect(shouldUseSegmentedPicker(3, 1.9, false)).toBe(false);
    expect(shouldUseSegmentedPicker(4, 1, false)).toBe(true);
    expect(shouldUseSegmentedPicker(2, 2, false)).toBe(true);
    expect(shouldUseSegmentedPicker(2, 1, true)).toBe(true);
  });
});
describe('picker option registry', () => {
  it('releases owned data without removing a newer registration', () => {
    const releaseOld = registerPickerOptions('theme', options);
    const replacement = [options[0]];
    const releaseNew = registerPickerOptions('theme', replacement);
    releaseOld();
    expect(getPickerOptions('theme')).toBe(replacement);
    releaseNew();
    expect(getPickerOptions('theme')).toEqual([]);
  });
});
