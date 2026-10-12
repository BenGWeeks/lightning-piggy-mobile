import React from 'react';
import { Text, View } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import { useMarmotDeviceDetails } from '../hooks/useMarmotDevices';
import type { DeliveryDetailSheetStyles } from '../styles/DeliveryDetailSheet.styles';
import { readableOn, sentFrom, type SentFrom } from '../utils/marmotDeviceView';

/** What the message-info sheet needs to show a Marmot message's devices. */
export interface MessageDevicesSource {
  /** The chat's MLS group id (hex). */
  chatId: string;
  /** Who sent the message (lower-case pubkey). */
  sender: string;
  selfPubkey: string;
  /** Display name for a member (others; "You" is added here). */
  nameOf: (pubkey: string) => string;
  /** When the message was sent (unix seconds), if known. */
  sentAt?: number;
}

interface Props {
  source: MessageDevicesSource;
  fromMe: boolean;
  /** This phone sent it (a tracked send). */
  sentHere: boolean;
  styles: DeliveryDetailSheetStyles;
}

/**
 * Marmot rows of the message-info sheet (#1267): "Sent from" (which device,
 * where the group state can tell) and, for our own messages, "Can be read on
 * 5 devices (Little Piggy: 3, You: 2)". Marmot has no per-device receipts —
 * a message is encrypted once for the group — so it's "can be read on",
 * never "delivered to". Mounted only while the sheet is open, so the group
 * is read lazily.
 */
const MessageDeviceRows: React.FC<Props> = ({ source, fromMe, sentHere, styles }) => {
  const t = useTranslation();
  const view = useMarmotDeviceDetails(source.chatId, true);
  if (!view) return null;
  const sender = source.sender.toLowerCase();
  const from = sentFrom(view.people.get(sender), fromMe, sentHere, {
    sentAt: source.sentAt,
    removedAt: view.removedAt.get(sender),
  });
  const label = (f: SentFrom) =>
    f.kind === 'thisDevice'
      ? t('chatDevices.thisPhone')
      : f.kind === 'app'
        ? (f.name ?? t('chatDevices.unknownApp'))
        : t('chatDevices.oneOfDevices', { count: f.count });
  const readable = fromMe ? readableOn(view.people, source.selfPubkey, source.sentAt) : null;
  const breakdown = readable?.people
    .map((p) =>
      t('chatDevices.readableOnPerson', {
        name: p.isSelf ? t('chatDevices.you') : source.nameOf(p.pubkey),
        count: p.count,
      }),
    )
    .join(', ');
  return (
    <>
      {from ? (
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{t('chatDevices.sentFrom')}</Text>
          <Text style={styles.metaValue} testID="dm-delivery-sent-from">
            {label(from)}
          </Text>
        </View>
      ) : null}
      {readable && readable.total > 0 ? (
        <View style={styles.metaRow}>
          <Text style={styles.metaLabel}>{t('chatDevices.readableOn')}</Text>
          <Text style={styles.metaValue} testID="dm-delivery-readable-on">
            {t('chatDevices.deviceCount', { count: readable.total })}
            {breakdown ? ` (${breakdown})` : ''}
          </Text>
        </View>
      ) : null}
    </>
  );
};

export default MessageDeviceRows;
