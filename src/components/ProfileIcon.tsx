import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { profileIconStyles as styles } from '../styles/ProfileIcon.styles';
import { UserRound } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { isSupportedImageUrl } from '../utils/imageUrl';

interface Props {
  uri?: string | null;
  size?: number;
  onPress?: () => void;
}

const ProfileIcon: React.FC<Props> = ({ uri, size = 36, onPress }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  return (
    <TouchableOpacity
      accessibilityRole={onPress ? 'button' : 'image'}
      disabled={!onPress}
      accessibilityState={{ disabled: !onPress }}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityLabel={t('profileIcon.profile')}
      testID="profile-icon"
    >
      <View style={[styles.container, { width: size, height: size, borderRadius: size / 2 }]}>
        {uri && isSupportedImageUrl(uri) ? (
          <Image
            source={{ uri }}
            style={{ width: size, height: size, borderRadius: size / 2 }}
            cachePolicy="memory-disk"
            recyclingKey={uri}
            autoplay={false}
          />
        ) : (
          <UserRound size={size * 0.6} color={colors.white} strokeWidth={1.75} />
        )}
      </View>
    </TouchableOpacity>
  );
};

export default ProfileIcon;
