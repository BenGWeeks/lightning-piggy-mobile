import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { ChevronLeft } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { MarketSellerStyles } from '../styles/MarketSeller.styles';

interface Props {
  title: string;
  backLabel: string;
  onBack: () => void;
  styles: MarketSellerStyles;
  testID: string;
}

/** Pink Market header shared by the seller screens. */
const MarketSellerHeader: React.FC<Props> = ({ title, backLabel, onBack, styles, testID }) => {
  const colors = useThemeColors();
  return (
    <View style={styles.header}>
      <Image
        source={require('../../assets/images/learn-header-bg.png')}
        style={styles.headerImage}
        contentFit="cover"
        cachePolicy="memory-disk"
      />
      <View style={styles.headerOverlay} />
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={onBack}
          accessibilityLabel={backLabel}
          testID={testID}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {title}
        </Text>
        <View style={styles.headerSpacer} />
      </View>
    </View>
  );
};

export default MarketSellerHeader;
