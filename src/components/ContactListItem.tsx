import React, { useState, useEffect, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { UserRound, Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { isSupportedImageUrl } from '../utils/imageUrl';

interface Props {
  name: string;
  picture?: string | null;
  lightningAddress?: string | null;
  onPress?: () => void;
  onZap?: () => void;
}

const ContactListItem: React.FC<Props> = ({ name, picture, lightningAddress, onPress, onZap }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [avatarError, setAvatarError] = useState(false);

  // Reset error state when picture URL changes (rows are recycled by
  // FlashList; without this a row that errored before would show its
  // fallback even when reused for a contact whose picture loads fine).
  useEffect(() => {
    setAvatarError(false);
  }, [picture]);

  // Pre-filter unsupported URLs (`.svg`, `.heic`, etc.) so we never
  // hand them to expo-image — Android's BitmapFactory floods logcat
  // with `unimplemented` decode errors + GC pressure when ~50 contacts
  // each fail to decode (#189).
  const showImage = !!picture && !avatarError && isSupportedImageUrl(picture);

  return (
    <TouchableOpacity style={styles.container} onPress={onPress} activeOpacity={onPress ? 0.6 : 1}>
      <View style={styles.avatar}>
        {showImage ? (
          <Image
            source={{ uri: picture }}
            style={styles.avatarImage}
            cachePolicy="memory-disk"
            transition={200}
            recyclingKey={picture || undefined}
            autoplay={false}
            onError={() => setAvatarError(true)}
          />
        ) : (
          <UserRound size={22} color={colors.textBody} strokeWidth={1.75} />
        )}
      </View>
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {lightningAddress && (
          <Text style={styles.address} numberOfLines={1}>
            {lightningAddress}
          </Text>
        )}
      </View>
      {lightningAddress && onZap && (
        <TouchableOpacity style={styles.zapButton} onPress={onZap} activeOpacity={0.6}>
          <Zap size={22} color={colors.brandPink} fill={colors.brandPink} />
        </TouchableOpacity>
      )}
    </TouchableOpacity>
  );
};

// Row height is fixed by the styles below — avatar 44 + paddingVertical
// 14 × 2 = 72. Exported so FriendsScreen's alphabet-tap offset math
// doesn't duplicate the magic number; if you change avatar size or
// paddingVertical, update this constant too (the FriendsScreen comment
// references it).
export const CONTACT_LIST_ITEM_HEIGHT = 72;

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 12,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.background,
      justifyContent: 'center',
      alignItems: 'center',
      overflow: 'hidden',
    },
    avatarImage: {
      width: 44,
      height: 44,
      borderRadius: 22,
    },
    info: {
      flex: 1,
    },
    name: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.textHeader,
    },
    address: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    zapButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.brandPinkLight,
      justifyContent: 'center',
      alignItems: 'center',
    },
  });

export default React.memo(ContactListItem);
