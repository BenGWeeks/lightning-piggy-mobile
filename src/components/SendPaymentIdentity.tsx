import React from 'react';
import { Text } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import { sanitizeInvoiceMemo } from '../utils/paymentIdentity';
import type { SendSheetStyles } from '../styles/SendSheet.styles';

/** Keep the payment destination visible independently of untrusted invoice copy. */
export default function SendPaymentIdentity({
  recipient,
  memo,
  styles,
}: {
  recipient: string;
  memo?: string | null;
  styles: SendSheetStyles;
}) {
  const t = useTranslation();
  return (
    <>
      <Text style={styles.detailAddress} testID="send-recipient">
        {recipient}
      </Text>
      {memo ? (
        <Text style={styles.detailDescription} numberOfLines={3}>
          {t('linkAction.memo')}: {sanitizeInvoiceMemo(memo)}
        </Text>
      ) : null}
    </>
  );
}
