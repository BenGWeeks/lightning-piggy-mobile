const DISPLAY_CONTROL_RE = /[\uFFFC\u200B\u200C\u200D\uFEFF]/g;

export function sanitizeDisplayText(text: string): string {
  return text.replace(DISPLAY_CONTROL_RE, '');
}
