import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';
import uk from '../i18n/locales/uk.json';
import { SWAP_SEND_STEPS, swapSendActiveStep, swapSendSteps } from './swapSendStage';
import type { ReverseSwapSendStage } from './reverseSwapSend';

const statuses = (stage: ReverseSwapSendStage | null, dispatched: boolean) =>
  swapSendSteps(stage, dispatched).map((s) => `${s.id}:${s.status}`);

describe('swapSendSteps', () => {
  it('walks create → pay → lockup → claim as the swap reports its stages', () => {
    expect(statuses('createSwap', false)).toEqual([
      'create:active',
      'pay:pending',
      'lockup:pending',
      'claim:pending',
    ]);
    // The hold invoice is being paid but not yet dispatched to the wallet.
    expect(statuses('payAndLockup', false)).toEqual([
      'create:complete',
      'pay:active',
      'lockup:pending',
      'claim:pending',
    ]);
    // Dispatched: the HTLC is out; Boltz now has to lock up on-chain.
    expect(statuses('payAndLockup', true)).toEqual([
      'create:complete',
      'pay:complete',
      'lockup:active',
      'claim:pending',
    ]);
    expect(statuses('claimSwap', true)).toEqual([
      'create:complete',
      'pay:complete',
      'lockup:complete',
      'claim:active',
    ]);
  });

  it('starts on the first row before the swap reports a stage', () => {
    expect(swapSendActiveStep(null, false)).toBe(0);
  });

  it('keeps the claim row active through cleanup (it follows the broadcast within moments)', () => {
    expect(swapSendActiveStep('cleanup', true)).toBe(3);
  });

  it('labels each row with its i18n key', () => {
    expect(swapSendSteps('createSwap', false).map((s) => s.label)).toEqual(
      SWAP_SEND_STEPS.map((s) => s.labelKey),
    );
  });

  it.each([
    ['en', en],
    ['es', es],
    ['uk', uk],
  ])('every step label (and the not-paid copy) is translated in %s', (_locale, strings) => {
    const section = (strings as unknown as Record<string, Record<string, string>>)
      .paymentProgressOverlay;
    const keys = [...SWAP_SEND_STEPS.map((s) => s.labelKey), 'paymentProgressOverlay.swapNotPaid'];
    for (const key of keys) {
      expect(section[key.split('.')[1]]).toEqual(expect.any(String));
    }
  });
});
