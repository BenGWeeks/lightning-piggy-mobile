import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ChevronLeft, ChevronRight, PiggyBank, Plus } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation } from '../navigation/types';
import { HiddenPiggy, loadPiggies } from '../services/piggyStorageService';

interface Props {
  navigation: ExploreNavigation;
}

/**
 * Hunt sub-screen — the hider's "My Piggies" hub. Lists every LNURL-w
 * Piggy the user has stashed locally, with a CTA to hide a new one.
 *
 * Lightning Piggy is wallet-agnostic for the Hunt feature: the LNURL-w
 * itself is created in the hider's wallet of choice (LNbits, Alby,
 * Mutiny, …) — see project memory `No LNbits-specific APIs`. This
 * screen is the front door to the paste-and-validate create flow that
 * lives in HuntCreateScreen.
 *
 * Closes part of #468.
 */
const HuntScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [piggies, setPiggies] = useState<HiddenPiggy[]>([]);

  useFocusEffect(
    useCallback(() => {
      loadPiggies().then(setPiggies);
    }, []),
  );

  return (
    <View style={styles.container} testID="hunt-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to Explore"
          testID="hunt-back-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Hunt</Text>
        <View style={styles.headerRightSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <TouchableOpacity
          style={styles.createCard}
          onPress={() => navigation.navigate('HuntCreate')}
          testID="hunt-create-piggy-button"
          accessibilityLabel="Hide a Piggy"
        >
          <View style={styles.createIconWrapper}>
            <Plus size={28} color={colors.white} strokeWidth={2.5} />
          </View>
          <View style={styles.createTextWrapper}>
            <Text style={styles.createTitle}>Hide a Piggy</Text>
            <Text style={styles.createSubtitle}>
              Stash an LNURL-withdraw link on an NFC tag or QR for someone to find.
            </Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>My Piggies</Text>
        {piggies.length === 0 ? (
          <View style={styles.emptyState} testID="hunt-empty-state">
            <PiggyBank size={48} color={colors.textSupplementary} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No Piggies hidden yet</Text>
            <Text style={styles.emptySubtitle}>
              Tap &ldquo;Hide a Piggy&rdquo; above to stash your first one.
            </Text>
          </View>
        ) : (
          piggies.map((p) => <PiggyRow key={p.id} piggy={p} colors={colors} styles={styles} />)
        )}
      </ScrollView>
    </View>
  );
};

const PiggyRow: React.FC<{
  piggy: HiddenPiggy;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
}> = ({ piggy, colors, styles }) => {
  const ageMinutes = Math.floor((Date.now() - piggy.createdAt) / 60_000);
  const ageLabel =
    ageMinutes < 60
      ? `${ageMinutes}m ago`
      : ageMinutes < 60 * 24
        ? `${Math.floor(ageMinutes / 60)}h ago`
        : `${Math.floor(ageMinutes / (60 * 24))}d ago`;

  return (
    <View style={styles.piggyRow} testID={`hunt-piggy-row-${piggy.id}`}>
      <View style={styles.piggyIconWrapper}>
        <PiggyBank size={22} color={colors.brandPink} strokeWidth={2} />
      </View>
      <View style={styles.piggyMain}>
        <Text style={styles.piggyMemo} numberOfLines={1}>
          {piggy.memo || 'Untitled Piggy'}
        </Text>
        <Text style={styles.piggyMeta}>
          {ageLabel}
          {piggy.isPublic ? ' • Public' : ' • Private'}
        </Text>
      </View>
      <ChevronRight size={20} color={colors.textSupplementary} />
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 16,
      backgroundColor: colors.brandPink,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    headerRightSpacer: { width: 24 },
    body: {
      padding: 16,
      gap: 16,
    },
    createCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: colors.brandPink,
      borderRadius: 12,
      padding: 16,
    },
    createIconWrapper: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: 'rgba(255,255,255,0.25)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    createTextWrapper: { flex: 1 },
    createTitle: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    createSubtitle: {
      color: 'rgba(255,255,255,0.85)',
      fontSize: 12,
      marginTop: 2,
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSupplementary,
      letterSpacing: 0.5,
      marginTop: 8,
    },
    emptyState: {
      alignItems: 'center',
      gap: 8,
      paddingVertical: 36,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 6,
    },
    emptySubtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      paddingHorizontal: 24,
    },
    piggyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    piggyIconWrapper: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    piggyMain: { flex: 1 },
    piggyMemo: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textHeader,
    },
    piggyMeta: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 2,
    },
  });

export default HuntScreen;
