import React, { useMemo } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { ImageIcon, Link2 } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useLocale } from '../contexts/LocaleContext';
import { createTapToLoadMediaStyles } from '../styles/TapToLoadMedia.styles';

/** Host shown on the placeholder so the reader knows where a tap will connect. */
export function displayHost(url: string): string {
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

interface Props {
  /** `thumb` fills its parent (profile thumbnails / media tiles) and drops
   *  the host line to fit. */
  variant: 'image' | 'preview' | 'thumb';
  url: string;
  fromMe: boolean;
  testID: string;
  /** Omit when a parent touchable owns the tap (the image bubble does, so a
   *  long-press still reaches the message menu). */
  onPress?: () => void;
}

/**
 * Placeholder for chat media that didn't auto-load because the sender isn't
 * someone the reader follows (#1338). Nothing is fetched until it's tapped.
 */
const TapToLoadMedia: React.FC<Props> = ({ variant, url, fromMe, testID, onPress }) => {
  const colors = useThemeColors();
  const { t } = useLocale();
  const styles = useMemo(() => createTapToLoadMediaStyles(colors, fromMe), [colors, fromMe]);
  const host = displayHost(url);
  const iconColor = fromMe ? colors.white : colors.brandPink;

  if (variant === 'thumb') {
    return (
      <View style={styles.thumbBox} testID={testID}>
        <ImageIcon size={20} color={colors.brandPink} />
        <Text style={styles.thumbLabel} numberOfLines={2}>
          {t('messageBubble.tapToLoadImage')}
        </Text>
      </View>
    );
  }

  if (variant === 'image') {
    return (
      <View style={styles.imageBox} testID={testID}>
        <ImageIcon size={28} color={iconColor} />
        <Text style={[styles.label, styles.labelCentered]}>
          {t('messageBubble.tapToLoadImage')}
        </Text>
        <Text style={[styles.host, styles.labelCentered]} numberOfLines={1}>
          {t('messageBubble.loadsFrom', { host })}
        </Text>
      </View>
    );
  }

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={styles.previewCard}
      accessibilityRole="button"
      accessibilityLabel={t('messageBubble.loadPreviewA11y', { host })}
      testID={testID}
    >
      <Link2 size={20} color={iconColor} />
      <View style={styles.textCol}>
        <Text style={styles.label}>{t('messageBubble.tapToLoadPreview')}</Text>
        <Text style={styles.host} numberOfLines={1}>
          {t('messageBubble.loadsFrom', { host })}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

export default React.memo(TapToLoadMedia);
