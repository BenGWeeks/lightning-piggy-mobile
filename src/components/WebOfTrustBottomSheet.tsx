// Bottom-sheet explainer + tier picker for the Web of Trust filter (#535).
//
// Tapping any of the three WoT chips (Messages, Hunt, Events) opens this
// sheet. Friends is always selectable; FoF + All are secret-mode gated.
// First-time selection of FoF kicks off the FoF compute (kind-3 batch
// fetch + heuristics in `friendsOfFriendsService`) with a progress modal.

import React, { useMemo, useRef, useState } from 'react';
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
import { useGroups } from '../contexts/GroupsContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import type { Palette } from '../styles/palettes';
import type { WotTier } from '../services/wotSettingsService';

interface Props {
  visible: boolean;
  onClose: () => void;
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
      accessibilityLabel={`${title}. ${disabled ? 'Disabled. Enable secret mode to unlock.' : ''}`}
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

const WebOfTrustBottomSheet: React.FC<Props> = ({ visible, onClose }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { secretMode } = useGroups();
  const { wotTier, setWotTier, l2Loading, l2Size } = useTrustGraph();

  // First-FoF compute progress state. The actual FoF compute is owned
  // by TrustGraphContext (L2 set), but the sheet surfaces the progress
  // so the user understands why the picker briefly shows "computing".
  // We track a local mirror so we can drive a small banner without
  // re-rendering siblings whenever l2Loading flips.
  const [computeState] = useState<'idle' | 'computing' | 'ready' | 'error'>('idle');
  // Reserved for the explicit "Compute now" affordance — wire-up lives
  // in the host context to keep this component dependency-light.
  const lastTierRef = useRef<WotTier>(wotTier);

  const handleSelect = (next: WotTier): void => {
    if (!secretMode && (next === 'fof' || next === 'all')) return;
    lastTierRef.current = next;
    setWotTier(next);
  };

  // Compose the "computing" banner state. When the user picks FoF and
  // the L2 cache is cold, TrustGraphContext kicks off a relay fetch;
  // l2Loading flips true until it resolves. We surface that here.
  const showComputingBanner = wotTier === 'fof' && l2Loading;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="wot-sheet-backdrop" />
      <View style={styles.sheet} testID="wot-bottom-sheet">
        <View style={styles.handleBar} />
        <View style={styles.titleRow}>
          <Text style={styles.title}>Web of Trust</Text>
          <TouchableOpacity
            onPress={onClose}
            testID="wot-sheet-close"
            accessibilityLabel="Close"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <X size={20} color={colors.textHeader} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
          <Text style={styles.explainer}>
            We filter out unverified senders, cache hiders, and event organisers — anyone could
            publish a phishing message or set up a physical lure, so by default you only see content
            from people in your trust graph.
          </Text>

          <TierRow
            tier="friends"
            title="Friends"
            subtitle="Only people you follow."
            active={wotTier === 'friends'}
            disabled={false}
            onSelect={() => handleSelect('friends')}
          />
          <TierRow
            tier="fof"
            title="Friends of friends"
            subtitle="People your follows follow (one hop). Some bot leakage possible."
            active={wotTier === 'fof'}
            disabled={!secretMode}
            onSelect={() => handleSelect('fof')}
          />
          <TierRow
            tier="all"
            title="All"
            subtitle="Filter disabled — every publisher is shown."
            active={wotTier === 'all'}
            disabled={!secretMode}
            onSelect={() => handleSelect('all')}
          />

          {!secretMode ? (
            <Text style={styles.gateHint} testID="wot-sheet-gate-hint">
              Enable Secret mode on About to unlock wider trust tiers.
            </Text>
          ) : null}

          {showComputingBanner ? (
            <View style={styles.computeBanner} testID="wot-sheet-computing">
              <Text style={styles.computeBannerText}>
                Computing your extended trust graph… fetching follow lists from relays. This is a
                one-off; we'll cache the result for 24 h.
              </Text>
            </View>
          ) : null}

          {wotTier === 'fof' && !l2Loading && l2Size > 0 ? (
            <Text style={styles.metaText} testID="wot-sheet-fof-meta">
              {l2Size.toLocaleString()} pubkeys in your friends-of-friends set.
            </Text>
          ) : null}

          {/* Reserved meta — high-fanout exclusion count surfaces here once
              the FoF service is wired through TrustGraphContext. */}
          {computeState === 'error' ? (
            <Text style={styles.errorText}>
              Couldn't reach enough relays to compute the FoF set. Try again later.
            </Text>
          ) : null}
        </ScrollView>

        <TouchableOpacity
          style={styles.doneButton}
          onPress={onClose}
          testID="wot-sheet-done"
          accessibilityLabel="Done"
        >
          <Text style={styles.doneText}>Done</Text>
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
