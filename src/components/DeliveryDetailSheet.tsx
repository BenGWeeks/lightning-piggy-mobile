import React, { useMemo } from 'react';
import { Modal, View, Text, Pressable, TouchableOpacity } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, X, Send, Copy, RotateCw } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { Toast } from './BrandedToast';
import { summariseDelivery, shortRelayLabel, type DeliveryStatus } from '../utils/dmDeliveryStatus';
import { createDeliveryDetailSheetStyles } from '../styles/DeliveryDetailSheet.styles';

// Human label for a NIP-17 rumor kind shown in the metadata block.
function kindLabel(kind: number | undefined): string {
  if (kind === 14) return 'Direct message (kind 14)';
  if (kind === 15) return 'File message (kind 15)';
  return kind === undefined ? 'Unknown' : `Kind ${kind}`;
}

function shortEventId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 8)}…${id.slice(-8)}` : id;
}

/**
 * Per-relay delivery breakdown shown on long-pressing a sent DM bubble (#856).
 * Replaces the plain text alert so we can colour the ✓/✗ glyphs (green/red),
 * surface event metadata (rumor id + kind + status), and offer a Re-send.
 * Modal-based, same visual family as BrandedAlert.
 */
export default function DeliveryDetailSheet({
  status,
  onClose,
  onResend,
}: {
  status: DeliveryStatus | null;
  onClose: () => void;
  // Re-publish the message behind this sheet (#856). Optional — when omitted
  // the Re-send button is hidden.
  onResend?: () => void;
}): React.ReactElement | null {
  const colors = useThemeColors();
  const styles = useMemo(() => createDeliveryDetailSheetStyles(colors), [colors]);

  if (!status) return null;

  const { ok, total } = summariseDelivery(status);
  const title = total === 0 ? 'No relay results' : `Sent to ${ok} of ${total} relays`;
  // Sort relays for a stable order — relayResults insertion order depends on
  // async settle timing, which would otherwise reshuffle the list run-to-run
  // (Copilot #858). `ok` rows first, then alphabetical by URL.
  const relays = Object.entries(status.relayResults).sort(([ua, ra], [ub, rb]) =>
    ra === rb ? ua.localeCompare(ub) : ra === 'ok' ? -1 : 1,
  );
  // Distinguish all three terminal states. `delivered` is false BOTH for
  // "no results yet" and "every relay rejected", so key off the counts so the
  // label matches the bubble's tick (Copilot #858): no results → Pending,
  // 0 of N → Failed, some → Partially delivered, all → Delivered.
  const statusLabel =
    total === 0
      ? 'Pending'
      : ok === 0
        ? 'Failed'
        : ok < total
          ? 'Partially delivered'
          : 'Delivered';

  const copyEventId = () => {
    if (!status.eventId) return;
    void Clipboard.setStringAsync(status.eventId);
    Toast.show({ type: 'success', text1: 'Event ID copied' });
  };

  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.root} onPress={onClose} accessibilityLabel="Dismiss delivery detail">
        <View
          onStartShouldSetResponder={() => true}
          accessibilityRole="alert"
          style={styles.card}
          testID="dm-delivery-detail-sheet"
        >
          <View style={styles.header}>
            <View style={[styles.iconSlot, { backgroundColor: colors.brandPink }]}>
              <Send size={26} color={colors.white} strokeWidth={2.5} />
            </View>
            <Text style={styles.title} testID="dm-delivery-detail-title">
              {title}
            </Text>
          </View>

          <View style={styles.relayList}>
            {relays.map(([url, res], i) => {
              const isOk = res === 'ok';
              return (
                // Index-based testID — the relay URL (with `:` / `/`) makes a
                // brittle Maestro selector; the URL stays the visible label.
                <View key={url} style={styles.relayRow} testID={`dm-delivery-relay-${i}`}>
                  {isOk ? (
                    <Check size={16} color={colors.green} strokeWidth={3} />
                  ) : (
                    <X size={16} color={colors.red} strokeWidth={3} />
                  )}
                  <Text
                    style={[styles.relayLabel, !isOk && styles.relayLabelFailed]}
                    numberOfLines={1}
                  >
                    {shortRelayLabel(url)}
                  </Text>
                </View>
              );
            })}
          </View>

          <View style={styles.divider} />

          <View style={styles.metaBlock}>
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Kind</Text>
              <Text style={styles.metaValue}>{kindLabel(status.kind)}</Text>
            </View>
            {status.eventId ? (
              <View style={styles.metaRow}>
                <Text style={styles.metaLabel}>Event ID</Text>
                <TouchableOpacity
                  style={styles.copyRow}
                  onPress={copyEventId}
                  accessibilityRole="button"
                  accessibilityLabel="Copy event ID"
                  testID="dm-delivery-copy-event-id"
                >
                  <Text style={[styles.metaValue, styles.metaValueMono]} numberOfLines={1}>
                    {shortEventId(status.eventId)}
                  </Text>
                  <Copy size={13} color={colors.textSupplementary} />
                </TouchableOpacity>
              </View>
            ) : null}
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>Status</Text>
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
                accessibilityLabel="Re-publish message"
                testID="dm-delivery-detail-resend"
              >
                <RotateCw size={16} color={colors.brandPink} strokeWidth={2.5} />
                <Text style={[styles.buttonText, styles.buttonTextSecondary]}>Re-publish</Text>
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
              accessibilityLabel="Close"
              testID="dm-delivery-detail-close"
            >
              <Text style={styles.buttonText}>Done</Text>
            </Pressable>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}
