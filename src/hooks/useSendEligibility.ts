import { useLocale } from '../contexts/LocaleContext';
import { onchainSendEligibility } from '../utils/onchainSendEligibility';

type Quote = Omit<
  Parameters<typeof onchainSendEligibility>[0],
  'amountSats' | 'balanceSats' | 'viaSwap'
>;

/** Apply the selected locale to the send button's fee and balance blockers. */
export function useSendEligibility(
  amountSats: number,
  balanceSats: number | null,
  viaSwap: boolean,
  quote: Quote,
) {
  const { formatLocale } = useLocale();
  return onchainSendEligibility({ amountSats, balanceSats, viaSwap, ...quote }, formatLocale);
}
