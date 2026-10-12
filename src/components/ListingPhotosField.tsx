import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Image } from 'expo-image';
import { ImagePlus, X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { MAX_LISTING_IMAGES } from '../utils/marketSellerEvents';
import type { MarketSellerStyles } from '../styles/MarketSeller.styles';

interface Props {
  images: string[];
  uploading: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  styles: MarketSellerStyles;
}

/** The listing's photos (first = cover) plus an "Add photo" tile. */
const ListingPhotosField: React.FC<Props> = ({ images, uploading, onAdd, onRemove, styles }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{t('market.sell.editor.photos')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.photoRow}
        keyboardShouldPersistTaps="handled"
      >
        {images.map((url, index) => (
          <View key={url} testID={`listing-photo-${index}`}>
            <Image
              source={{ uri: url }}
              style={styles.photo}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={url}
            />
            <TouchableOpacity
              style={styles.photoRemove}
              onPress={() => onRemove(index)}
              accessibilityLabel={t('market.sell.editor.removePhoto', { index: index + 1 })}
              testID={`listing-photo-remove-${index}`}
            >
              <X size={14} color={colors.white} strokeWidth={3} />
            </TouchableOpacity>
          </View>
        ))}
        {images.length < MAX_LISTING_IMAGES ? (
          <TouchableOpacity
            style={styles.photoAdd}
            onPress={onAdd}
            disabled={uploading}
            accessibilityState={{ disabled: uploading, busy: uploading }}
            accessibilityLabel={t('market.sell.editor.addPhoto')}
            testID="listing-photo-add"
          >
            {uploading ? (
              <ActivityIndicator color={colors.brandPink} />
            ) : (
              <ImagePlus size={24} color={colors.brandPink} strokeWidth={2} />
            )}
            <Text style={styles.photoAddText}>
              {uploading ? t('market.sell.editor.uploading') : t('market.sell.editor.addPhoto')}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
};

export default React.memo(ListingPhotosField);
