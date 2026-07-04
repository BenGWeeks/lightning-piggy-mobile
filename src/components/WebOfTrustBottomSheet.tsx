// Bottom-sheet explainer + tier picker for the Web of Trust filter (#535).
//
// Tapping any of the three WoT chips (Messages, Hunt, Events) opens this
// sheet. Friends + All are both selectable post-#627; FoF stays gated
// until #565 lands the foreground compute dialog. First-time selection
// of FoF will then kick off the FoF compute (kind-3 batch fetch +
// heuristics in `friendsOfFriendsService`) with a progress modal.

import React, { useMemo, useRef } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ShieldCheck, ShieldOff, ShieldQuestion, X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import { useTranslation } from '../contexts/LocaleContext';
import type { Palette } from '../styles/palettes';
import type { WotTier } from '../services/wotSettingsService';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Optional explicit "current" tier. When provided, the sheet renders
   * that as the active row instead of reading the global value from
   * `useTrustGraph()`. Lets a caller surface a *derived* tier in its
   * chip — most cleanly used by the per-rail override design in #636.
   * When omitted, falls back to the global persisted tier — every
   * existing caller's behaviour. */
  currentTier?: WotTier;
}

interface TierRowProps {
  tier: WotTier;
  title: string;
  subtitle: string;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}

const TierRow: React.FC<TierRowProps> = ({ tier, title, subtitle, active, disabled, onSelect }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const Icon = tier === 'friends' ? ShieldCheck : tier === 'fof' ? ShieldQuestion : ShieldOff;
  return (
    <TouchableOpacity
      style={[
        styles.tierRow,
        active ? styles.tierRowActive : null,
        disabled ? styles.tierRowDisabled : null,
      ]}
      onPress={onSelect}
      disabled={disabled}
      testID={`wot-tier-${tier}-chip`}
      accessibilityRole="radio"
      accessibilityState={{ selected: active, disabled }}
      accessibilityLabel={`${title}. ${disabled ? t('webOfTrustBottomSheet.locked') : ''}`}
    >
      <View style={styles.tierIcon}>
        <Icon
          size={20}
          color={disabled ? colors.textSupplementary : colors.textHeader}
          strokeWidth={2.5}
        />
      </View>
      <View style={styles.tierBody}>
        <Text style={[styles.tierTitle, disabled ? styles.tierTitleDisabled : null]}>{title}</Text>
        <Text style={styles.tierSubtitle}>{subtitle}</Text>
      </View>
      <View style={[styles.radioOuter, active ? styles.radioOuterActive : null]}>
        {active ? <View style={styles.radioInner} /> : null}
      </View>
    </TouchableOpacity>
  );
};

const WebOfTrustBottomSheet: React.FC<Props> = ({ visible, onClose, currentTier }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { wotTier, setWotTier } = useTrustGraph();
  // `activeTier` is what the picker renders as "checked". Defaults to
  // the global persisted tier; a caller can pass `currentTier` to
  // override this when its chip surfaces a derived value (per-rail —
  // #636) so the sheet's active state matches what the user just tapped.
  const activeTier = currentTier ?? wotTier;

  // `lastTierRef` is retained for the future FoF re-enable so the
  // "compute now" affordance can compare incoming vs persisted tier
  // without re-reading state.
  const lastTierRef = useRef<WotTier>(wotTier);

  const handleSelect = (next: WotTier): void => {
    // `fof` remains disabled until #565 lands the foreground compute
    // dialog — `friends` and `all` are both selectable now that `all`
    // is the new default for content surfaces (#627). Defensive guard
    // so a future regression on the TierRow disabled prop can't
    // silently switch into the unsupported tier.
    if (next !== 'friends' && next !== 'all') return;
    lastTierRef.current = next;
    setWotTier(next);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID="wot-sheet-backdrop" />
      <View style={styles.sheet} testID="wot-bottom-sheet">
        <View style={styles.handleBar} />
        <View style={styles.titleRow}>
          <Text style={styles.title}>{t('webOfTrustBottomSheet.title')}</Text>
          <TouchableOpacity
            onPress={onClose}
            testID="wot-sheet-close"
            accessibilityLabel={t('webOfTrustBottomSheet.close')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={20} color={colors.textHeader} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.explainer}>{t('webOfTrustBottomSheet.explainer')}</Text>

          <TierRow
            tier="friends"
            title={t('webOfTrustBottomSheet.friendsTitle')}
            subtitle={t('webOfTrustBottomSheet.friendsSubtitle')}
            active={activeTier === 'friends'}
            disabled={false}
            onSelect={() => handleSelect('friends')}
          />
          <TierRow
            tier="fof"
            title={t('webOfTrustBottomSheet.fofTitle')}
            subtitle={t('webOfTrustBottomSheet.fofSubtitle')}
            active={false}
            disabled
            onSelect={() => {}}
          />
          <TierRow
            tier="all"
            title={t('webOfTrustBottomSheet.allTitle')}
            subtitle={t('webOfTrustBottomSheet.allSubtitle')}
            active={activeTier === 'all'}
            disabled={false}
            onSelect={() => handleSelect('all')}
          />

          <Text style={styles.gateHint} testID="wot-sheet-gate-hint">
            {t('webOfTrustBottomSheet.gateHint')}
          </Text>

          {/* The computing banner + fof meta row + error row hang off L2 state
              that's currently stubbed to empty / non-loading. They render as
              no-ops while L2 is disabled and will come back when GH #565 lands
              the foreground compute dialog. */}
        </ScrollView>

        <TouchableOpacity
          style={styles.doneButton}
          onPress={onClose}
          testID="wot-sheet-done"
          accessibilityLabel={t('webOfTrustBottomSheet.done')}
        >
          <Text style={styles.doneText}>{t('webOfTrustBottomSheet.done')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.4)',
    },
    sheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      maxHeight: '85%',
      backgroundColor: colors.background,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 20,
      paddingBottom: 28,
      paddingTop: 8,
    },
    handleBar: {
      alignSelf: 'center',
      width: 40,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.divider,
      marginBottom: 10,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 4,
    },
    title: {
      flex: 1,
      fontSize: 20,
      fontWeight: '800',
      color: colors.textHeader,
    },
    scroll: {
      flexGrow: 0,
    },
    explainer: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.textBody,
      marginTop: 10,
      marginBottom: 18,
    },
    tierRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.divider,
      marginBottom: 8,
      backgroundColor: colors.surface,
    },
    tierRowActive: {
      borderColor: colors.zapYellow,
      backgroundColor: 'rgba(255, 193, 7, 0.10)',
    },
    tierRowDisabled: {
      opacity: 0.5,
    },
    tierIcon: {
      width: 28,
      alignItems: 'center',
    },
    tierBody: {
      flex: 1,
    },
    tierTitle: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textHeader,
    },
    tierTitleDisabled: {
      color: colors.textSupplementary,
    },
    tierSubtitle: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 2,
      lineHeight: 16,
    },
    radioOuter: {
      width: 20,
      height: 20,
      borderRadius: 10,
      borderWidth: 2,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioOuterActive: {
      borderColor: colors.zapYellow,
    },
    radioInner: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.zapYellow,
    },
    gateHint: {
      marginTop: 8,
      fontSize: 12,
      color: colors.textSupplementary,
      fontStyle: 'italic',
      lineHeight: 17,
    },
    computeBanner: {
      marginTop: 14,
      padding: 12,
      borderRadius: 10,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.zapYellow,
    },
    computeBannerText: {
      fontSize: 12,
      color: colors.textBody,
      lineHeight: 17,
    },
    metaText: {
      marginTop: 12,
      fontSize: 12,
      color: colors.textSupplementary,
    },
    errorText: {
      marginTop: 12,
      fontSize: 12,
      color: colors.brandPink,
    },
    doneButton: {
      marginTop: 16,
      paddingVertical: 14,
      borderRadius: 999,
      backgroundColor: colors.brandPink,
      alignItems: 'center',
    },
    doneText: {
      color: colors.white,
      fontSize: 15,
      fontWeight: '700',
    },
  });

export default WebOfTrustBottomSheet;
