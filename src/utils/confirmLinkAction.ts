import { showLinkActionSheet } from './linkActionSheet';
import { t } from '../i18n';
import { normalizeLnurlToUrl } from '../services/lnurlService';
import { decodeInvoice, stripLightningPrefix } from './sendSheetInput';
import { paymentRecipientLabel, sanitizeInvoiceMemo } from './paymentIdentity';
import { decode, npubEncode } from 'nostr-tools/nip19';

/** Local parsing only: describing a link must never contact its endpoint. */
export function linkActionDescription(raw: string): string {
  const input = stripLightningPrefix(raw);
  if (/^(nostr:)?(npub1|nprofile1)/i.test(input)) {
    try {
      const entity = decode(input.replace(/^nostr:/i, ''));
      const pubkey =
        entity.type === 'npub'
          ? entity.data
          : entity.type === 'nprofile'
            ? entity.data.pubkey
            : null;
      if (pubkey) return t('linkAction.profile', { target: npubEncode(pubkey).slice(0, 20) + '…' });
    } catch {
      /* Unsupported references still require consent before navigation. */
    }
  }
  if (/^nostr:/i.test(input)) return t('linkAction.open', { target: sanitizeInvoiceMemo(input) });
  if (/^bitcoin:/i.test(input))
    return t('linkAction.pay', { target: sanitizeInvoiceMemo(input.slice(8).split('?')[0]) });
  if (/^[^@\s]+@[^@\s]+$/.test(input))
    return t('linkAction.pay', { target: sanitizeInvoiceMemo(input) });
  try {
    const host = new URL(normalizeLnurlToUrl(input)).host;
    return t(/^lnurlw:\/\//i.test(input) ? 'linkAction.withdraw' : 'linkAction.open', {
      target: host,
    });
  } catch {
    const invoice = decodeInvoice(input);
    return t('linkAction.pay', {
      target: paymentRecipientLabel({
        contacts: [],
        nodePubkey: invoice?.nodePubkey,
        unknownLabel: t('sendSheet.thisRecipient'),
      }),
    });
  }
}

/** The callback is the only route to network work; dismiss/cancel do nothing. */
export function confirmLinkAction(raw: string, onConfirm: () => void, onCancel?: () => void): void {
  let settled = false;
  showLinkActionSheet(
    t('linkAction.title'),
    linkActionDescription(raw),
    [
      {
        text: t('linkAction.cancel'),
        style: 'cancel',
        onPress: () => {
          settled = true;
          onCancel?.();
        },
      },
      {
        text: t('linkAction.continue'),
        testID: 'link-action-confirm',
        onPress: () => {
          if (settled) return;
          settled = true;
          onConfirm();
        },
      },
    ],
    {
      onDismiss: () => {
        if (!settled) onCancel?.();
        settled = true;
      },
    },
  );
}
