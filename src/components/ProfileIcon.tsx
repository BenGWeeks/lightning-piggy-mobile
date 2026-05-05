import React from 'react';
import { TouchableOpacity, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { UserRound } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { isSupportedImageUrl } from '../utils/imageUrl';

interface Props {
  uri?: string | null;
  size?: number;
  onPress?: () => void;
}

const ProfileIcon: React.FC<Props> = ({ uri, size = 36, onPress }) => {
  const colors = useThemeColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityLabel="Profile"
      testID="profile-icon"
    >
      <View style={[styles.container, { width: size, height: size, borderRadius: size / 2 }]}>
        {uri && isSupportedImageUrl(uri) ? (
          <Image
            source={{ uri }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            cachePolicy="disk"
          />
        ) : (
          <UserRound size={size * 0.6} color={colors.white} strokeWidth={1.75} />
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
});

export default ProfileIcon;
