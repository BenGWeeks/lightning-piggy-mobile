import React, { useMemo, useRef } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { btcMapIconComponent } from '../utils/btcMapIcon';

interface Props {
  visible: boolean;
  onClose: () => void;
  /**
   * When true, the sheet also lists the BTC Map category icons present
   * in the current view (the user's filter chips can turn merchants off
   * entirely, in which case showing the category iconography is just
   * noise). Caller decides based on its current `filters.lightning ||
   * filters.onchain`.
   */
  placesVisible: boolean;
  /**
   * BTC Map category keys present in the current viewport — same
   * `availableCategories` array the MapScreen filter sheet uses. We
   * render the icon for each so the user can correlate the glyph on
   * the map pin with the category name.
   */
  availableCategories: string[];
}

/**
 * Bottom-sheet legend opened from a button next to Recenter on the
 * inline + full maps. Lists the pin colour idioms and, when places
 * are visible, the BTC Map category iconography. Replaces the inline
 * `MapLegend` strip we previously rendered under the maps — the legend
 * is rarely-needed but high-value when you do need it, so tucking it
 * behind a glyph button reclaims vertical space on the host screens.
 *
 * Swipe-down to dismiss; tap-backdrop also dismisses. Same gesture
 * rules as `useDismissibleSheet` in MapScreen for behavioural parity
 * — the hook was inlined there before this component existed; this
 * sheet copies the rules rather than depending on a co-located hook
 * to keep the component self-contained.
 */
export const LegendSheet: React.FC<Props> = ({
  visible,
  onClose,
  placesVisible,
  availableCategories,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const translateY = useRef(new Animated.Value(0)).current;
  const responder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderMove: (_e, g) => translateY.setValue(Math.max(0, g.dy)),
      onPanResponderRelease: (_e, g) => {
        const dismiss = g.dy > 100 || g.vy > 0.5;
        if (dismiss) {
          Animated.timing(translateY, {
            toValue: 600,
            duration: 180,
            useNativeDriver: true,
          }).start(() => {
            translateY.setValue(0);
            onClose();
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            friction: 8,
            tension: 80,
          }).start();
        }
      },
    }),
  ).current;

  // Sort + dedupe so unstable BTC Map ordering doesn't make the legend
  // shuffle on every viewport change. The same key (e.g. 'cafe' and
  // 'coffee') maps to the same Lucide glyph; we dedupe by glyph name
  // so the user doesn't see duplicate entries.
  const categoryRows = useMemo(() => {
    if (!placesVisible) return [];
    const seenComponents = new Set<unknown>();
    const rows: { key: string; label: string }[] = [];
    for (const key of [...availableCategories].sort()) {
      const Comp = btcMapIconComponent(key);
      if (seenComponents.has(Comp)) continue;
      seenComponents.add(Comp);
      // Title-case the category key for display ("fast_food" → "Fast food").
      const label = key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
      rows.push({ key, label });
    }
    return rows;
  }, [availableCategories, placesVisible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop} testID="legend-sheet">
        <TouchableOpacity style={styles.tapAway} onPress={onClose} activeOpacity={1} />
        <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
          <View {...responder.panHandlers} style={styles.grabber} testID="legend-sheet-grabber">
            <View style={styles.handle} />
          </View>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollPad}>
            <Text style={styles.sectionTitle}>Pin types</Text>
            <Item dot color="#EC008C" label="⚡ Lightning merchant" />
            <Item dot color="#F7931A" label="On-chain merchant" />
            <Item diamond color="#EC008C" label="Piglet (Lightning Piggy)" />
            <Item diamond color="#7A5CFF" label="NIP-GC cache" />
            <Item dot color="#2D88FF" label="You" />

            {categoryRows.length > 0 ? (
              <>
                <Text style={[styles.sectionTitle, { marginTop: 20 }]}>Categories</Text>
                <Text style={styles.sectionSub}>
                  Icons used on Places pins in the current viewport.
                </Text>
                {categoryRows.map((row) => {
                  const Icon = btcMapIconComponent(row.key);
                  return (
                    <View key={row.key} style={styles.row}>
                      <View style={styles.iconWrap}>
                        <Icon size={16} color={colors.brandPink} strokeWidth={2.5} />
                      </View>
                      <Text style={styles.rowLabel}>{row.label}</Text>
                    </View>
                  );
                })}
              </>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
};

const Item: React.FC<{
  label: string;
  color: string;
  dot?: boolean;
  diamond?: boolean;
}> = ({ label, color, dot, diamond }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.row}>
      <View style={[dot ? styles.swatchDot : styles.swatchDiamond, { backgroundColor: color }]} />
      <Text style={styles.rowLabel}>{label}</Text>
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.4)',
      justifyContent: 'flex-end',
    },
    tapAway: { ...StyleSheet.absoluteFillObject },
    sheet: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      maxHeight: '75%',
      paddingHorizontal: 20,
      paddingBottom: 32,
    },
    grabber: { width: '100%', paddingVertical: 12, alignItems: 'center' },
    handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: colors.divider },
    scrollPad: { paddingBottom: 8 },
    sectionTitle: { fontSize: 18, fontWeight: '700', color: colors.textHeader },
    sectionSub: { fontSize: 13, color: colors.textSupplementary, marginTop: 2, marginBottom: 8 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 8,
    },
    swatchDot: {
      width: 14,
      height: 14,
      borderRadius: 7,
      borderWidth: 1.5,
      borderColor: '#fff',
    },
    swatchDiamond: {
      width: 12,
      height: 12,
      transform: [{ rotate: '45deg' }],
      borderWidth: 1.5,
      borderColor: '#fff',
    },
    iconWrap: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowLabel: { fontSize: 14, color: colors.textBody, flex: 1 },
  });

export default LegendSheet;
