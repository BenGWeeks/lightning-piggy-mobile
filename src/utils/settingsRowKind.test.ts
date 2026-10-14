import {
  isTwoLineSettingsRow,
  resolveSettingsRowKind,
  settingsRowAccessibilityRole,
  settingsRowTrailing,
  type SettingsRowKind,
} from './settingsRowKind';

const press = () => undefined;

describe('settings row kind → trailing affordance (#1552)', () => {
  it.each<[SettingsRowKind, string]>([
    ['navigate', 'chevron'],
    ['external', 'external'],
    ['action', 'none'],
    ['toggle', 'switch'],
    ['value', 'none'],
  ])('%s rows end in %s', (kind, trailing) => {
    expect(settingsRowTrailing(kind)).toBe(trailing);
  });

  it('only in-app navigation gets a chevron', () => {
    const kinds: SettingsRowKind[] = ['navigate', 'external', 'action', 'toggle', 'value'];
    expect(kinds.filter((k) => settingsRowTrailing(k) === 'chevron')).toEqual(['navigate']);
  });

  it('external rows are links; navigate and action rows are buttons', () => {
    expect(settingsRowAccessibilityRole('external')).toBe('link');
    expect(settingsRowAccessibilityRole('navigate')).toBe('button');
    expect(settingsRowAccessibilityRole('action')).toBe('button');
    expect(settingsRowAccessibilityRole('toggle')).toBeUndefined();
    expect(settingsRowAccessibilityRole('value')).toBeUndefined();
  });
});

describe('resolveSettingsRowKind', () => {
  it('keeps an explicit kind', () => {
    expect(resolveSettingsRowKind({ kind: 'external', onPress: press })).toBe('external');
    expect(resolveSettingsRowKind({ kind: 'action', onPress: press })).toBe('action');
    expect(resolveSettingsRowKind({ kind: 'toggle', toggle: {} })).toBe('toggle');
  });

  it('derives an omitted kind from the props', () => {
    expect(resolveSettingsRowKind({ onPress: press })).toBe('navigate');
    expect(resolveSettingsRowKind({ toggle: {} })).toBe('toggle');
    expect(resolveSettingsRowKind({})).toBe('value');
  });

  it('a pressable kind with no handler is read-only (no chevron to nowhere)', () => {
    expect(resolveSettingsRowKind({ kind: 'navigate', onPress: undefined })).toBe('value');
  });
});

describe('single-line rows', () => {
  it.each([
    [undefined, false],
    ['', false],
    ['   ', false],
    ['Lightning Piggy', true],
  ])('second line %p → two-line %p', (secondLine, twoLine) => {
    expect(isTwoLineSettingsRow(secondLine)).toBe(twoLine);
  });
});
