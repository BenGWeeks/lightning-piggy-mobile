// Typed failures for Amber (NIP-55) Intent requests (#1186).
//
// The native module (modules/amber-signer → AmberSignerModule.kt) rejects
// with a coded error. Before #1186 every one of those collapsed into a generic
// failure the UI reported as "declined", including `BUSY` (a lost result had
// left the module stuck) and a request Amber never answered. This maps each
// code to what actually happened, with copy that says so and how to retry.
// The message is the localised user-facing copy, so every existing surface
// that shows `error.message` / `result.error` reads correctly unchanged.

import { t } from '../i18n';

export type AmberFailureKind =
  /** Amber returned "cancelled": the user rejected the request or closed the sheet. */
  | 'declined'
  /** Nothing came back: Amber handed focus elsewhere, never opened, or went stale. */
  | 'no-response'
  /** Another Amber request is genuinely still in flight (single-flight guard). */
  | 'busy'
  /** Amber couldn't be launched at all (no activity, not installed, launch threw). */
  | 'unavailable'
  /** Anything else. */
  | 'failed';

const KIND_BY_CODE: Readonly<Record<string, AmberFailureKind>> = {
  CANCELLED: 'declined',
  NO_RESULT: 'no-response',
  BUSY: 'busy',
  NO_ACTIVITY: 'unavailable',
  LAUNCH_FAILED: 'unavailable',
};

const MESSAGE_KEY: Readonly<Record<AmberFailureKind, string>> = {
  declined: 'amberSigner.declined',
  'no-response': 'amberSigner.noResponse',
  busy: 'amberSigner.busy',
  unavailable: 'amberSigner.unavailable',
  failed: 'amberSigner.failed',
};

const codeOf = (e: unknown): string => {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : '';
};

export class AmberSignerError extends Error {
  /** The native module's error code (`CANCELLED`, `NO_RESULT`, `BUSY`, …). */
  readonly code: string;
  readonly kind: AmberFailureKind;
  /** The native (developer-facing) message, for logs. */
  readonly detail: string;

  constructor(code: string, kind: AmberFailureKind, detail: string) {
    super(t(MESSAGE_KEY[kind]));
    this.name = 'AmberSignerError';
    this.code = code;
    this.kind = kind;
    this.detail = detail;
  }
}

/** Normalises anything an Amber Intent call threw into an `AmberSignerError`. */
export function toAmberSignerError(e: unknown): AmberSignerError {
  if (e instanceof AmberSignerError) return e;
  const code = codeOf(e);
  const detail = e instanceof Error ? e.message : String(e);
  return new AmberSignerError(code || 'UNKNOWN', KIND_BY_CODE[code] ?? 'failed', detail);
}

/**
 * What kind of Amber failure `e` is, or null when it isn't one. Use this
 * rather than treating every signer error as the user's refusal: only
 * `'declined'` means the user said no.
 */
export function amberFailureKind(e: unknown): AmberFailureKind | null {
  if (e instanceof AmberSignerError) return e.kind;
  return KIND_BY_CODE[codeOf(e)] ?? null;
}
