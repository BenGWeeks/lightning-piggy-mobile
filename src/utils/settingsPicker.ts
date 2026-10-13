/** Labels must already be translated by the caller; values remain stored values. */
export interface SettingsPickerOption {
  value: string;
  label: string;
  subtitle?: string;
  searchTerms?: string;
  disabled?: boolean;
  testID?: string;
}

export function filterPickerOptions(
  options: readonly SettingsPickerOption[],
  query: string,
): readonly SettingsPickerOption[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return options;
  return options.filter((option) =>
    `${option.label} ${option.value} ${option.searchTerms ?? ''}`
      .toLocaleLowerCase()
      .includes(needle),
  );
}

export function shouldUseSegmentedPicker(
  optionCount: number,
  fontScale: number,
  labelsOverflow: boolean,
): boolean {
  return optionCount > 3 || fontScale >= 2 || labelsOverflow;
}

/** Data only: no callbacks, hooks, or domain saving logic in the registry. */
const EMPTY_OPTIONS: readonly SettingsPickerOption[] = [];
const registry = new Map<string, readonly SettingsPickerOption[]>();
export function registerPickerOptions(
  key: string,
  options: readonly SettingsPickerOption[],
): () => void {
  registry.set(key, options);
  return () => {
    if (registry.get(key) === options) registry.delete(key);
  };
}
export function getPickerOptions(key: string): readonly SettingsPickerOption[] {
  return registry.get(key) ?? EMPTY_OPTIONS;
}

export type SettingsPickerParams = {
  title: string;
  selectedValue?: string;
  searchable?: boolean;
  /** Use a caller-defined sentinel value; the caller opens its domain-specific custom editor. */
  customOption?: Omit<SettingsPickerOption, 'label'> & { label?: string };
  testID: string;
  /** Selection is delivered to the originating route, which owns save semantics. */
  returnTo: { routeKey: string; navigatorKey: string; param: string };
} & (
  | { options: readonly SettingsPickerOption[]; registryKey?: never }
  | { registryKey: string; options?: never }
);
