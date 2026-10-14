// The rules every settings row follows (#1552), kept pure so they're
// testable without rendering: what kind of row it is, what sits at its far
// right, and whether it needs a second line. SettingsRow is the only caller.

/**
 * - `navigate` — opens a screen, sheet or picker inside the app (chevron).
 * - `external` — opens a URL or another app (↗ instead of a chevron).
 * - `action` — does something on the spot: save, share, remove (no affordance).
 * - `toggle` — a switch.
 * - `value` — read-only (no affordance).
 */
export type SettingsRowKind = 'navigate' | 'external' | 'action' | 'toggle' | 'value';

/** What sits at the row's far right, after the optional ⓘ button. */
export type SettingsRowTrailing = 'chevron' | 'external' | 'switch' | 'none';

interface KindInput {
  kind?: SettingsRowKind;
  onPress?: () => void;
  toggle?: object;
}

/**
 * The row's effective kind. An omitted kind is derived (toggle → `toggle`,
 * onPress → `navigate`, else `value`); a pressable kind without a handler
 * (e.g. a picker with nothing to pick) degrades to `value`.
 */
export function resolveSettingsRowKind({ kind, onPress, toggle }: KindInput): SettingsRowKind {
  if (kind === 'toggle' || (kind === undefined && toggle)) return toggle ? 'toggle' : 'value';
  if (kind === 'value') return 'value';
  if (!onPress) return 'value';
  return kind ?? 'navigate';
}

const TRAILING: Record<SettingsRowKind, SettingsRowTrailing> = {
  navigate: 'chevron',
  external: 'external',
  action: 'none',
  toggle: 'switch',
  value: 'none',
};

export const settingsRowTrailing = (kind: SettingsRowKind): SettingsRowTrailing => TRAILING[kind];

/** Screen-reader role for the row's main tap target (toggles announce on the switch). */
export function settingsRowAccessibilityRole(kind: SettingsRowKind): 'button' | 'link' | undefined {
  if (kind === 'external') return 'link';
  if (kind === 'navigate' || kind === 'action') return 'button';
  return undefined;
}

/** Only rows with something to say on the second line reserve its height. */
export const isTwoLineSettingsRow = (secondLine: string | undefined | null): boolean =>
  !!secondLine && secondLine.trim().length > 0;
