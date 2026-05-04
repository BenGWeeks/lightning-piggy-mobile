import React, { useMemo } from 'react';
import { Modal, Pressable, View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { MapPin, Radio } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { DURATION_OPTIONS } from '../services/liveLocationService';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** User picked "Send current location" — kicks the existing snapshot
   *  share flow. */
  onChooseSnapshot: () => void;
  /** User picked one of the duration options for a live share. */
  onChooseLive: (durationMs: number) => void;
}

/**
 * Sheet shown after the Attach → Location tile is tapped. Lets the
 * user pick between the existing single-snapshot share and a live
 * share with a duration cap. Renders inside a centred modal so the
 * picker is reachable on every screen size without us having to
 * guess a sheet height — keeps issue #206 acceptance criterion
 * "New duration picker UI accessible from the existing Location tile
 * (not a separate tile — keeps the panel grid compact)" honest.
 */
const LiveLocationDurationPicker: React.FC<Props> = ({
  visible,
  onClose,
  onChooseSnapshot,
  onChooseLive,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID="live-location-picker-modal"
    >
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Dismiss">
        <Pressable style={styles.card} onPress={() => undefined}>
          <Text style={styles.title}>Share location</Text>
          <Text style={styles.body}>
            Send your current spot once, or share live updates for a set time.
          </Text>

          <TouchableOpacity
            style={styles.row}
            onPress={onChooseSnapshot}
            accessibilityLabel="Send current location"
            testID="live-location-choose-snapshot"
          >
            <View style={styles.iconCircle}>
              <MapPin size={20} color={colors.white} />
            </View>
            <View style={styles.rowBody}>
              <Text style={styles.rowTitle}>Send current location</Text>
              <Text style={styles.rowSub}>One-shot snapshot — same as before.</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.divider} />

          <Text style={styles.sectionLabel}>Share live location for…</Text>
          {DURATION_OPTIONS.map((opt) => (
            <TouchableOpacity
              key={opt.id}
              style={styles.row}
              onPress={() => onChooseLive(opt.ms)}
              accessibilityLabel={`Share live location for ${opt.label}`}
              testID={`live-location-choose-${opt.id}`}
            >
              <View style={[styles.iconCircle, styles.iconCircleAlt]}>
                <Radio size={20} color={colors.white} />
              </View>
              <View style={styles.rowBody}>
                <Text style={styles.rowTitle}>{opt.label}</Text>
                <Text style={styles.rowSub}>
                  Auto-stops at the end. You can stop earlier from the bubble.
                </Text>
              </View>
            </TouchableOpacity>
          ))}

          <Text style={styles.footnote}>
            ~3% battery per hour. End-to-end encrypted. Recipient sees a map that updates every ~30
            seconds.
          </Text>

          <TouchableOpacity
            style={styles.cancel}
            onPress={onClose}
            accessibilityLabel="Cancel"
            testID="live-location-picker-cancel"
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 18,
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 12,
      width: '100%',
      maxWidth: 380,
      gap: 12,
    },
    title: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.textBody,
    },
    body: {
      fontSize: 13,
      color: colors.textSupplementary,
      lineHeight: 18,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: '700',
      color: colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginTop: 4,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
    },
    iconCircle: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconCircleAlt: {
      // Slight tonal shift from the snapshot row to differentiate the
      // live option without inventing a new brand colour. Stays on
      // theme via the existing courseTeal accent.
      backgroundColor: colors.courseTeal,
    },
    rowBody: {
      flex: 1,
    },
    rowTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.textBody,
    },
    rowSub: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginVertical: 4,
    },
    footnote: {
      fontSize: 11,
      color: colors.textSupplementary,
      lineHeight: 16,
      marginTop: 8,
    },
    cancel: {
      alignItems: 'center',
      paddingVertical: 12,
      marginTop: 8,
    },
    cancelText: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.brandPink,
    },
  });

export default LiveLocationDurationPicker;
