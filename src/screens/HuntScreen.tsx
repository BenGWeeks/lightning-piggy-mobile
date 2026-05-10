import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronLeft, PiggyBank } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation } from '../navigation/types';

interface Props {
  navigation: ExploreNavigation;
}

// Placeholder for the Hunt sub-screen — geocaching mini-game with
// LNURL-withdraw Piggies. Full hider/finder/discover flows land in
// follow-up commits on this branch (milestones 4-6 of the plan).
// Closes #468 when those land.
const HuntScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);

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
      <View style={styles.body}>
        <PiggyBank size={64} color={colors.textSupplementary} strokeWidth={1.5} />
        <Text style={styles.title}>Hidden Piggies</Text>
        <Text style={styles.subtitle}>
          Coming soon. Stash an LNURL-withdraw Piggy on an NFC tag or QR for a friend (or stranger)
          to find — and pocket the sats inside.
        </Text>
      </View>
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
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
      gap: 12,
    },
    title: { fontSize: 18, fontWeight: '700', color: colors.textHeader, textAlign: 'center' },
    subtitle: {
      fontSize: 14,
      color: colors.textSupplementary,
      textAlign: 'center',
      lineHeight: 20,
    },
  });

export default HuntScreen;
