import { useLocale } from '../contexts/LocaleContext';

/** Locale-aware amount shared by the Bitcoin URI and invoice message cards. */
export default function MessageSatsAmount({ amountSats }: { amountSats: number | null }) {
  const { t, formatLocale } = useLocale();
  return amountSats !== null
    ? t('messageBubble.satsAmount', { amount: amountSats.toLocaleString(formatLocale) })
    : t('messageBubble.anyAmount');
}
