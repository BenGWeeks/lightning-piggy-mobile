import { isBitcoinAddress } from '../services/boltzService';
import { showLinkActionSheet } from './linkActionSheet';
import { t } from '../i18n';
import { normalizeLnurlToUrl } from '../services/lnurlService';
import { decodeInvoice, stripLightningPrefix } from './sendSheetInput';
import { paymentRecipientLabel, sanitizeInvoiceMemo } from './paymentIdentity';
import { decode, npubEncode } from 'nostr-tools/nip19';

/** npub / nprofile (optionally `nostr:`-prefixed) or a bare 64-hex pubkey —
 *  the payload shapes the Friends scanner can turn into a profile. */
export function looksLikeProfileReference(raw: string): boolean {
  const s = raw.trim();
  return /^(nostr:)?(npub1|nprofile1)/i.test(s) || /^[0-9a-f]{64}$/i.test(s);
}

/** Local parsing only: describing a link must never contact its endpoint. */
export function linkActionDescription(raw: string): string {
  const input = stripLightningPrefix(raw);
  if (looksLikeProfileReference(input)) {
    try {
      const bare = input.replace(/^nostr:/i, '');
      const entity = /^[0-9a-f]{64}$/i.test(bare)
        ? ({ type: 'npub', data: bare.toLowerCase() } as const)
        : decode(bare);
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
  if (isBitcoinAddress(input)) return t('linkAction.pay', { target: input });
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
