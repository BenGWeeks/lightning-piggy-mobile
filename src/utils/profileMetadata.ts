import { parsePublicUrl } from './publicUrl';
import { sanitizeDisplayText } from './sanitizeDisplayText';

/** Tolerant kind-0 validation: retain only bounded strings. */
export function validateProfileMetadata(value: unknown) {
  const data =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const text = (field: string, maxLen: number, allowNewlines = false) =>
    sanitizeDisplayText(data[field], { maxLen, allowNewlines }) || undefined;
  const url = (field: string) => {
    const value = data[field];
    return typeof value === 'string' && value.length <= 2048 && parsePublicUrl(value, ['https'])
      ? value
      : undefined;
  };
  return {
    name: text('name', 64),
    displayName: text('display_name', 64),
    about: text('about', 2000, true),
    nip05: text('nip05', 320),
    lud16: text('lud16', 320),
    picture: url('picture'),
    banner: url('banner'),
  };
}
