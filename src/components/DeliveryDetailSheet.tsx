import React, { useMemo } from 'react';
import { Modal, View, Text, Pressable, TouchableOpacity } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, X, Send, Inbox, Copy, RotateCw, Clock } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { Toast } from './BrandedToast';
import {
  deliverySheetTitle,
  shortRelayLabel,
  protocolLabel,
  summariseDelivery,
  type MessageInfo,
} from '../utils/dmDeliveryStatus';
import { createDeliveryDetailSheetStyles } from '../styles/DeliveryDetailSheet.styles';

// Human label for a NIP-04/17 message kind shown in the metadata block.
// Takes the hook translator (`useTranslation()`'s return) so the label tracks
// the live UI locale — the module-level `t` can lag during a locale switch.
function kindLabel(kind: number | undefined, tr: ReturnType<typeof useTranslation>): string {
  if (kind === 4) return tr('deliveryDetailSheet.kind4');
  if (kind === 14) return tr('deliveryDetailSheet.kind14');
  if (kind === 15) return tr('deliveryDetailSheet.kind15');
  return kind === undefined
    ? tr('deliveryDetailSheet.unknown')
    : tr('deliveryDetailSheet.kindN', { kind });
}

function shortEventId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-8)}` : id;
}

/**
 * Message-info sheet shown on tapping a DM bubble (#856). For a SENT message it
 * shows the per-relay delivery breakdown (coloured ✓/✗) + a Re-publish action;
 * for a RECEIVED message it shows just the metadata (no relay breakdown, no
 * Re-publish). Both show the protocol (NIP-17 gift-wrapped vs NIP-04), Kind,
 * and a copyable Event ID. Modal-based, same visual family as BrandedAlert.
 */
export default function DeliveryDetailSheet({
  info,
  onClose,
  onResend,
}: {
  info: MessageInfo | null;
  onClose: () => void;
  // Re-publish the message (sent kind-14 text only). Optional — when omitted
  // (received messages, non-text, kind-15) the button is hidden.
  onResend?: () => void;
}): React.ReactElement | null {
  const colors = useThemeColors();
  const tr = useTranslation();
  const styles = useMemo(() => createDeliveryDetailSheetStyles(colors), [colors]);

  if (!info) return null;

  const sent = info.direction === 'sent';
  const status = info.deliveryStatus;
  const { ok, total } = status ? summariseDelivery(status) : { ok: 0, total: 0 };
  const sending = !!status?.pending;

  // Title decision lives in `deliverySheetTitle` (pure, unit-tested). Key
  // property: an UNTRACKED sent message (`!status` — group sends, legacy 1:1
  // rows) titles "Message sent", NOT "Send failed"; "Send failed" is reserved
  // for a tracked, settled send with an empty relay breakdown (e.g. a
  // pre-publish `failedDelivery`).
  const titleDescriptor = deliverySheetTitle(info.direction, status);
  const title = tr(`deliveryDetailSheet.${titleDescriptor.key}`, {
    ok: 'ok' in titleDescriptor ? titleDescriptor.ok : undefined,
    total: 'total' in titleDescriptor ? titleDescriptor.total : undefined,
  });

  // Sorted relays (ok first, then by URL) so the order is stable run-to-run.
  const relays = status
    ? Object.entries(status.relayResults).sort(([ua, ra], [ub, rb]) =>
        ra === rb ? ua.localeCompare(ub) : ra === 'ok' ? -1 : 1,
      )
    : [];

  // A received message has no relay outcomes (we didn't publish it). A SENT
  // message with no delivery data was sent before tracking existed (or its
  // status wasn't persisted) — show "Not tracked", not "Received".
  // Once a status exists and isn't pending, the send has settled. `ok === 0`
  // means no relay accepted — a Failure — whether the breakdown is empty
  // (total === 0, e.g. a pre-publish `failedDelivery`) or every listed relay
  // rejected. "Not tracked" is reserved for `!status` (Copilot). A previous
  // `total === 0 ? 'Pending'` branch mislabelled tracked failures as pending.
  const statusLabel = !status
    ? sent
      ? tr('deliveryDetailSheet.statusNotTracked')
      : tr('deliveryDetailSheet.statusReceived')
    : status.pending
      ? tr('deliveryDetailSheet.statusSending')
      : ok === 0
        ? tr('deliveryDetailSheet.statusFailed')
        : ok < total
          ? tr('deliveryDetailSheet.statusPartiallyDelivered')
          : tr('deliveryDetailSheet.statusDelivered');

  const copyEventId = () => {
    if (!info.eventId) return;
    void Clipboard.setStringAsync(info.eventId);
    Toast.show({ type: 'success', text1: tr('deliveryDetailSheet.eventIdCopied') });
  };

  const HeaderIcon = sent ? Send : Inbox;
  const showRelays = sent && relays.length > 0;
  // `sending` (above) is reused for the relay rows below: while the send is
  // still in flight the seeded relays are all `failed` placeholders, so we
  // render a neutral pending Clock (not a red ✗) — reads as "publishing to
  // these relays", not "all failed".

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable
        style={styles.root}
        onPress={onClose}
        accessibilityLabel={tr('deliveryDetailSheet.dismissAccessibility')}
      >
        <View
          onStartShouldSetResponder={() => true}
          accessibilityRole="alert"
          style={styles.card}
          testID="dm-delivery-detail-sheet"
        >
          <View style={styles.header}>
            <View style={[styles.iconSlot, { backgroundColor: colors.brandPink }]}>
              <HeaderIcon size={26} color={colors.white} strokeWidth={2.5} />
            </View>
            <Text style={styles.title} testID="dm-delivery-detail-title">
              {title}
            </Text>
          </View>

          {/* Per-relay breakdown — sent messages only (a received message
              wasn't published by us, so there are no relay outcomes). */}
          {showRelays ? (
            <View style={styles.relayList}>
              {relays.map(([url, res], i) => {
                const isOk = res === 'ok';
                return (
                  <View key={url} style={styles.relayRow} testID={`dm-delivery-relay-${i}`}>
                    {isOk ? (
                      <Check size={16} color={colors.green} strokeWidth={3} />
                    ) : sending ? (
                      <Clock size={16} color={colors.textSupplementary} strokeWidth={2.5} />
                    ) : (
                      <X size={16} color={colors.red} strokeWidth={3} />
                    )}
                    <Text
                      style={[styles.relayLabel, !isOk && !sending && styles.relayLabelFailed]}
                      numberOfLines={1}
                    >
                      {shortRelayLabel(url)}
                    </Text>
                  </View>
                );
              })}
            </View>
          ) : null}

          {showRelays ? <View style={styles.divider} /> : null}

          <View style={styles.metaBlock}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{tr('deliveryDetailSheet.protocol')}</Text>
              <Text style={styles.metaValue}>{protocolLabel(info.wireKind)}</Text>
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{tr('deliveryDetailSheet.kind')}</Text>
              <Text style={styles.metaValue}>{kindLabel(info.wireKind, tr)}</Text>
            </View>
            {info.eventId ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>{tr('deliveryDetailSheet.eventId')}</Text>
                <TouchableOpacity
                  style={styles.copyRow}
                  onPress={copyEventId}
                  accessibilityRole="button"
                  accessibilityLabel={tr('deliveryDetailSheet.copyEventIdAccessibility')}
                  testID="dm-delivery-copy-event-id"
                >
                  <Text style={[styles.metaValue, styles.metaValueMono]} numberOfLines={1}>
                    {shortEventId(info.eventId)}
                  </Text>
                  <Copy size={13} color={colors.textSupplementary} />
                </TouchableOpacity>
              </View>
            ) : null}
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{tr('deliveryDetailSheet.status')}</Text>
              <Text style={styles.metaValue}>{statusLabel}</Text>
            </View>
          </View>

          <View style={styles.buttonRow}>
            {onResend ? (
              <Pressable
                onPress={onResend}
                style={({ pressed }) => [
                  styles.button,
                  styles.buttonSecondary,
                  styles.buttonInRow,
                  pressed && styles.buttonPressed,
                ]}
                accessibilityRole="button"
                accessibilityLabel={tr('deliveryDetailSheet.republishAccessibility')}
                testID="dm-delivery-detail-resend"
              >
                <RotateCw size={16} color={colors.brandPink} strokeWidth={2.5} />
                <Text style={[styles.buttonText, styles.buttonTextSecondary]}>
                  {tr('deliveryDetailSheet.republish')}
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={onClose}
              style={({ pressed }) => [
                styles.button,
                styles.buttonInRow,
                pressed && styles.buttonPressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel={tr('deliveryDetailSheet.closeAccessibility')}
              testID="dm-delivery-detail-close"
            >
              <Text style={styles.buttonText}>{tr('deliveryDetailSheet.done')}</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
