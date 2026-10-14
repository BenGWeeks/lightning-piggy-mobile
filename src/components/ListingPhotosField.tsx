import BrandedSpinner from './BrandedSpinner';
import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { ChevronLeft, ChevronRight, ImagePlus, Star, X } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { MAX_LISTING_IMAGES } from '../utils/marketSellerEvents';
import type { MarketSellerStyles } from '../styles/MarketSeller.styles';

interface Props {
  images: string[];
  uploading: boolean;
  onAdd: () => void;
  onRemove: (index: number) => void;
  /** Move the photo at `from` to `to` (one step left or right). */
  onMove: (from: number, to: number) => void;
  /** Make the photo at `index` the cover (position 0). */
  onSetCover: (index: number) => void;
  styles: MarketSellerStyles;
}

const HIT_SLOP = { top: 8, bottom: 8, left: 6, right: 6 };

/** The listing's photos plus an "Add photo" tile (#1534). The displayed
 * order is the published order: the first photo is the cover that Market
 * cards show. Each photo can move left / right or become the cover. */
const ListingPhotosField: React.FC<Props> = ({
  images,
  uploading,
  onAdd,
  onRemove,
  onMove,
  onSetCover,
  styles,
}) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const last = images.length - 1;
  return (
    <View style={styles.field} testID="listing-photos">
      <Text style={styles.label}>
        {t('market.sell.editor.photosLabel', { max: MAX_LISTING_IMAGES })}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.photoRow}
        keyboardShouldPersistTaps="handled"
      >
        {images.map((url, index) => (
          <View key={url} style={styles.photoTile} testID={`listing-photo-${index}`}>
            <View>
              <Image
                source={{ uri: url }}
                style={[styles.photo, index === 0 && styles.photoCover]}
                contentFit="cover"
                cachePolicy="memory-disk"
                recyclingKey={url}
              />
              {index === 0 ? (
                <View style={styles.coverBadge} testID="listing-photo-cover-badge">
                  <Text style={styles.coverBadgeText}>{t('market.sell.editor.cover')}</Text>
                </View>
              ) : null}
              <TouchableOpacity
                style={styles.photoRemove}
                onPress={() => onRemove(index)}
                accessibilityLabel={t('market.sell.editor.removePhoto', { index: index + 1 })}
                testID={`listing-photo-remove-${index}`}
              >
                <X size={14} color={colors.white} strokeWidth={3} />
              </TouchableOpacity>
            </View>
            {images.length > 1 ? (
              <View style={styles.photoControls}>
                <TouchableOpacity
                  style={styles.photoControl}
                  onPress={() => onMove(index, index - 1)}
                  disabled={index === 0}
                  hitSlop={HIT_SLOP}
                  accessibilityState={{ disabled: index === 0 }}
                  accessibilityLabel={t('market.sell.editor.movePhotoLeft', { index: index + 1 })}
                  testID={`listing-photo-move-left-${index}`}
                >
                  <ChevronLeft
                    size={18}
                    color={index === 0 ? colors.divider : colors.brandPink}
                    strokeWidth={2.5}
                  />
                </TouchableOpacity>
                {index > 0 ? (
                  <TouchableOpacity
                    style={styles.photoControl}
                    onPress={() => onSetCover(index)}
                    hitSlop={HIT_SLOP}
                    accessibilityLabel={t('market.sell.editor.setCover', { index: index + 1 })}
                    testID={`listing-photo-cover-${index}`}
                  >
                    <Star size={16} color={colors.brandPink} strokeWidth={2.5} />
                  </TouchableOpacity>
                ) : (
                  <View style={styles.photoControl} />
                )}
                <TouchableOpacity
                  style={styles.photoControl}
                  onPress={() => onMove(index, index + 1)}
                  disabled={index === last}
                  hitSlop={HIT_SLOP}
                  accessibilityState={{ disabled: index === last }}
                  accessibilityLabel={t('market.sell.editor.movePhotoRight', { index: index + 1 })}
                  testID={`listing-photo-move-right-${index}`}
                >
                  <ChevronRight
                    size={18}
                    color={index === last ? colors.divider : colors.brandPink}
                    strokeWidth={2.5}
                  />
                </TouchableOpacity>
              </View>
            ) : null}
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
              <BrandedSpinner />
            ) : (
              <ImagePlus size={24} color={colors.brandPink} strokeWidth={2} />
            )}
            <Text style={styles.photoAddText}>
              {uploading ? t('market.sell.editor.uploading') : t('market.sell.editor.addPhoto')}
            </Text>
            <Text style={styles.photoCount} testID="listing-photo-count">
              {t('market.sell.editor.photoCount', {
                n: images.length,
                max: MAX_LISTING_IMAGES,
              })}
            </Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
    </View>
  );
};

export default React.memo(ListingPhotosField);
