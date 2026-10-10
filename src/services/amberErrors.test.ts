import i18n from '../i18n';
import { AmberSignerError, amberFailureKind, toAmberSignerError } from './amberErrors';

/** What the native module's CodedException looks like on the JS side. */
const coded = (code: string, message = `native ${code}`) =>
  Object.assign(new Error(message), { code });

describe('toAmberSignerError', () => {
  it.each([
    ['CANCELLED', 'declined'],
    ['NO_RESULT', 'no-response'],
    ['BUSY', 'busy'],
    ['NO_ACTIVITY', 'unavailable'],
    ['LAUNCH_FAILED', 'unavailable'],
  ] as const)('maps %s to %s', (code, kind) => {
    const err = toAmberSignerError(coded(code));
    expect(err).toBeInstanceOf(AmberSignerError);
    expect(err.kind).toBe(kind);
    expect(err.code).toBe(code);
    expect(err.detail).toBe(`native ${code}`);
  });

  it('treats unknown codes, uncoded errors and non-errors as a generic failure', () => {
    expect(toAmberSignerError(coded('UNKNOWN')).kind).toBe('failed');
    expect(toAmberSignerError(new Error('boom'))).toMatchObject({
      kind: 'failed',
      code: 'UNKNOWN',
      detail: 'boom',
    });
    expect(toAmberSignerError('weird')).toMatchObject({ kind: 'failed', detail: 'weird' });
    expect(toAmberSignerError(null).kind).toBe('failed');
  });

  it('is idempotent', () => {
    const first = toAmberSignerError(coded('BUSY'));
    expect(toAmberSignerError(first)).toBe(first);
  });

  it('uses the localised copy as the message', () => {
    expect(toAmberSignerError(coded('NO_RESULT')).message).toBe(i18n.t('amberSigner.noResponse'));
    i18n.locale = 'es';
    try {
      expect(toAmberSignerError(coded('BUSY')).message).toBe(
        'Amber todavía está atendiendo otra solicitud. Termínala o ciérrala en Amber y vuelve a intentarlo.',
      );
    } finally {
      i18n.locale = 'en';
    }
  });

  // #1186: a stuck request surfaced as BUSY and the UI said "declined".
  it('never tells the user they declined when Amber was busy or silent', () => {
    for (const code of ['BUSY', 'NO_RESULT', 'NO_ACTIVITY', 'LAUNCH_FAILED', 'UNKNOWN']) {
      expect(toAmberSignerError(coded(code)).message).not.toMatch(/declin/i);
    }
    expect(toAmberSignerError(coded('CANCELLED')).message).toMatch(/declined/);
  });

  it('every kind offers a way forward', () => {
    for (const code of ['CANCELLED', 'BUSY', 'NO_RESULT', 'NO_ACTIVITY', 'UNKNOWN']) {
      expect(toAmberSignerError(coded(code)).message).toMatch(/try again/i);
    }
  });
});

describe('amberFailureKind', () => {
  it('reads typed and raw coded errors', () => {
    expect(amberFailureKind(toAmberSignerError(coded('CANCELLED')))).toBe('declined');
    expect(amberFailureKind(coded('BUSY'))).toBe('busy');
    expect(amberFailureKind(coded('NO_RESULT'))).toBe('no-response');
  });

  it('returns null for anything that is not an Amber failure', () => {
    expect(amberFailureKind(new Error('relay timeout'))).toBeNull();
    expect(amberFailureKind(coded('PERMISSION_NOT_GRANTED'))).toBeNull();
    expect(amberFailureKind(undefined)).toBeNull();
  });
});
