import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  TouchableOpacity,
  Image,
  type ScrollViewProps,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import BrandGradientBackground from '../../components/BrandGradientBackground';
import { useThemeColors } from '../../contexts/ThemeContext';
import type { Palette } from '../../styles/palettes';
import type { AccountDrawerNavigation } from '../../navigation/types';

interface Props {
  title: string;
  children: React.ReactNode;
  scrollRef?: React.RefObject<ScrollView | null>;
  scrollViewProps?: Omit<ScrollViewProps, 'contentContainerStyle' | 'style'>;
  // Set false when the screen's primary content is already a scrollable
  // surface (e.g. FlatList) — avoids nesting VirtualizedLists inside a
  // ScrollView, which breaks list windowing and triggers an RN warning.
  scrollable?: boolean;
}

/**
 * Shared chrome for every AccountStack sub-screen: pink background,
 * background art, safe-area top padding, and a back-to-tabs chevron.
 * Each section screen renders its content inside the ScrollView, unless
 * `scrollable={false}` is passed (in which case the screen owns its own
 * scroll surface and the layout only renders the chrome).
 */
const AccountScreenLayout: React.FC<Props> = ({
  title,
  children,
  scrollRef,
  scrollViewProps,
  scrollable = true,
}) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation<AccountDrawerNavigation>();
  const insets = useSafeAreaInsets();

  const titleRow = (
    <View style={styles.titleRow}>
      <TouchableOpacity
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        accessibilityLabel="Back"
        testID="account-back-button"
      >
        <ChevronLeft size={24} color={colors.brandPink} />
      </TouchableOpacity>
      <Text style={styles.title}>{title}</Text>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <BrandGradientBackground />
      <Image
        source={require('../../../assets/images/nostrich.png')}
        style={styles.bgImage}
        resizeMode="contain"
      />
      {scrollable ? (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}
          keyboardShouldPersistTaps="handled"
          {...scrollViewProps}
        >
          {titleRow}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.flex, { paddingTop: insets.top + 16 }]}>
          {titleRow}
          {children}
        </View>
      )}
    </KeyboardAvoidingView>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.brandPink,
    },
    flex: {
      flex: 1,
    },
    bgImage: {
      position: 'absolute',
      width: 420,
      height: 420,
      right: -60,
      top: -20,
      opacity: 0.15,
    },
    content: {
      paddingHorizontal: 20,
      paddingBottom: 40,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 24,
    },
    backButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: 'rgba(255,255,255,0.9)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    title: {
      color: colors.white,
      fontSize: 28,
      fontWeight: '700',
    },
  });

export default AccountScreenLayout;
