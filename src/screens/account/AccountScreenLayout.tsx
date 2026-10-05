import React, { useMemo } from 'react';
import {
  View,
  Text,
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
import { useTranslation } from '../../contexts/LocaleContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import { createAccountScreenLayoutStyles } from '../../styles/AccountScreenLayout.styles';
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
  const t = useTranslation();
  const styles = useMemo(() => createAccountScreenLayoutStyles(colors), [colors]);
  const navigation = useNavigation<AccountDrawerNavigation>();
  const insets = useSafeAreaInsets();

  const titleRow = (
    <View style={styles.titleRow}>
      <TouchableOpacity
        accessibilityRole="button"
        style={styles.backButton}
        onPress={() => navigation.goBack()}
        accessibilityLabel={t('accountScreenLayout.back')}
        testID="account-back-button"
      >
        <ChevronLeft size={24} color={colors.brandPink} />
      </TouchableOpacity>
      <Text style={styles.title}>{title}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <BrandGradientBackground />
      {/* Android: edge-to-edge means the window doesn't resize for the
          keyboard, so shrink the scroll area or bottom inputs stay hidden. */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Image
          source={require('../../../assets/images/nostrich.png')}
          style={styles.bgImage}
          resizeMode="contain"
        />
        {scrollable ? (
          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[
              styles.content,
              { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 },
            ]}
            keyboardShouldPersistTaps="handled"
            {...scrollViewProps}
          >
            {titleRow}
            {children}
          </ScrollView>
        ) : (
          <View
            style={[
              styles.content,
              styles.flex,
              { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 40 },
            ]}
          >
            {titleRow}
            {children}
          </View>
        )}
      </KeyboardAvoidingView>
    </View>
  );
};

export default AccountScreenLayout;
