import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BrandedAlertButton, BrandedAlertOptions } from '../components/BrandedAlert';
import {
  askMarmotFallback,
  hasSentMarmotFallbackNote,
  markMarmotFallbackNoteSent,
  marmotFallbackNoteKey,
  marmotFallbackNoteText,
  marmotFallbackPromptCopy,
  nip17FallbackReason,
} from './marmotFallback';

const ME = 'a'.repeat(64);
const PEER = 'b'.repeat(64);
const OTHER = 'c'.repeat(64);

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('nip17FallbackReason', () => {
  it('offers NIP-17 only for a failed Marmot send the peer cannot receive', () => {
    const unreachable = { success: false, marmotUnreachable: 'noKeyPackage' as const };
    expect(nip17FallbackReason(unreachable, 'marmot')).toBe('noKeyPackage');
    expect(
      nip17FallbackReason({ success: false, marmotUnreachable: 'outdatedKeyPackage' }, 'marmot'),
    ).toBe('outdatedKeyPackage');
    expect(nip17FallbackReason(unreachable, 'nip17')).toBeNull();
    expect(nip17FallbackReason({ success: false }, 'marmot')).toBeNull();
    expect(nip17FallbackReason({ success: true }, 'marmot')).toBeNull();
  });
});

describe('marmotFallbackPromptCopy', () => {
  it('names the peer and says why Marmot cannot reach them', () => {
    expect(marmotFallbackPromptCopy('noKeyPackage', 'Little Piggy', false).title).toBe(
      "Little Piggy isn't on Marmot yet",
    );
    expect(marmotFallbackPromptCopy('outdatedKeyPackage', 'Little Piggy', false).title).toBe(
      "Little Piggy's Marmot app needs opening or updating",
    );
  });

  it('mentions the note only while it has not been sent in this thread', () => {
    const first = marmotFallbackPromptCopy('noKeyPackage', 'Little Piggy', false);
    expect(first.message).toMatch(/^Send this with NIP-17 instead\?/);
    expect(first.message).toMatch(/let them know you tried Marmot\.$/);
    const later = marmotFallbackPromptCopy('noKeyPackage', 'Little Piggy', true);
    expect(later.message).not.toMatch(/let them know/);
    expect(later).toMatchObject({ cancel: 'Cancel', confirm: 'Send with NIP-17' });
  });

  it('has a note that points the peer at a Marmot app', () => {
    expect(marmotFallbackNoteText()).toMatch(/White Noise or Lightning Piggy/);
  });
});

describe('marmot fallback note flag', () => {
  it('is per account and per peer', async () => {
    expect(await hasSentMarmotFallbackNote(ME, PEER)).toBe(false);
    await markMarmotFallbackNoteSent(ME, PEER);
    expect(await hasSentMarmotFallbackNote(ME, PEER)).toBe(true);
    // Another peer, or another account on this phone, still sends its own.
    expect(await hasSentMarmotFallbackNote(ME, OTHER)).toBe(false);
    expect(await hasSentMarmotFallbackNote(OTHER, PEER)).toBe(false);
  });

  it('ignores pubkey case', async () => {
    await markMarmotFallbackNoteSent(ME.toUpperCase(), PEER);
    expect(await hasSentMarmotFallbackNote(ME, PEER.toUpperCase())).toBe(true);
    expect(marmotFallbackNoteKey(ME, PEER)).toBe(marmotFallbackNoteKey(ME.toUpperCase(), PEER));
  });

  it('reads as not sent when storage fails', async () => {
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    expect(await hasSentMarmotFallbackNote(ME, PEER)).toBe(false);
  });
});

describe('askMarmotFallback', () => {
  type Shown = { buttons: BrandedAlertButton[]; options?: BrandedAlertOptions };
  function fakeAlert() {
    const shown: Shown[] = [];
    const alert = jest.fn(
      (_t: string, _m?: string, buttons?: BrandedAlertButton[], options?: BrandedAlertOptions) => {
        shown.push({ buttons: buttons ?? [], options });
      },
    );
    return { alert, shown };
  }
  const copy = marmotFallbackPromptCopy('noKeyPackage', 'Little Piggy', false);

  it('shows Cancel then Send with NIP-17, dismissable', () => {
    const { alert, shown } = fakeAlert();
    void askMarmotFallback(alert, copy);
    expect(alert).toHaveBeenCalledWith(copy.title, copy.message, expect.any(Array), {
      cancelable: true,
      onDismiss: expect.any(Function),
    });
    expect(shown[0].buttons.map((b) => [b.text, b.style])).toEqual([
      ['Cancel', 'cancel'],
      ['Send with NIP-17', 'default'],
    ]);
  });

  it('resolves true for Send with NIP-17, ignoring the dismiss that follows', async () => {
    const { alert, shown } = fakeAlert();
    const answer = askMarmotFallback(alert, copy);
    shown[0].buttons[1].onPress?.();
    shown[0].options?.onDismiss?.();
    await expect(answer).resolves.toBe(true);
  });

  it('resolves false for Cancel', async () => {
    const { alert, shown } = fakeAlert();
    const answer = askMarmotFallback(alert, copy);
    shown[0].buttons[0].onPress?.();
    await expect(answer).resolves.toBe(false);
  });

  it('treats a dismiss (backdrop / back) as Cancel', async () => {
    const { alert, shown } = fakeAlert();
    const answer = askMarmotFallback(alert, copy);
    shown[0].options?.onDismiss?.();
    shown[0].buttons[1].onPress?.();
    await expect(answer).resolves.toBe(false);
  });
});
