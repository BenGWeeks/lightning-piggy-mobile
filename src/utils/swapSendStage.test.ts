import en from '../i18n/locales/en.json';
import es from '../i18n/locales/es.json';
import uk from '../i18n/locales/uk.json';
import { swapSendStageKey } from './swapSendStage';
import type { ReverseSwapSendStage } from './reverseSwapSend';

const STAGES: ReverseSwapSendStage[] = ['createSwap', 'payAndLockup', 'claimSwap', 'cleanup'];

describe('swapSendStageKey', () => {
  it('maps each swap stage to its overlay copy', () => {
    expect(STAGES.map(swapSendStageKey)).toEqual([
      'paymentProgressOverlay.swapStageCreating',
      'paymentProgressOverlay.swapStagePaying',
      'paymentProgressOverlay.swapStageClaiming',
      // Cleanup follows the claim broadcast within moments — keep the claim copy.
      'paymentProgressOverlay.swapStageClaiming',
    ]);
  });

  it.each([
    ['en', en],
    ['es', es],
    ['uk', uk],
  ])('every stage key (and the not-paid copy) is translated in %s', (_locale, strings) => {
    const section = (strings as unknown as Record<string, Record<string, string>>)
      .paymentProgressOverlay;
    for (const key of [...STAGES.map(swapSendStageKey), 'paymentProgressOverlay.swapNotPaid']) {
      expect(section[key.split('.')[1]]).toEqual(expect.any(String));
    }
  });
});
