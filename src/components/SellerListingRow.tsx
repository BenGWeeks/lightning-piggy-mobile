import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import type { Event } from 'nostr-tools';
import { useTranslation } from '../contexts/LocaleContext';
import type { ListingDraft } from '../utils/marketSellerEvents';
import type { MarketSellerStyles } from '../styles/MarketSeller.styles';

interface Props {
  event: Event;
  draft: ListingDraft;
  styles: MarketSellerStyles;
  onEdit: (dTag: string) => void;
  onPreview: (event: Event) => void;
  onDelete: (event: Event) => void;
}

/** One of the seller's own listings with Edit / Preview / Delete. */
const SellerListingRow: React.FC<Props> = ({
  event,
  draft,
  styles,
  onEdit,
  onPreview,
  onDelete,
}) => {
  const t = useTranslation();
  const [imageFailed, setImageFailed] = useState(false);
  const image = draft.images[0];
  const title = draft.title || draft.dTag;
  const id = draft.dTag;
  return (
    <View style={styles.listingRow} testID={`seller-listing-${id}`}>
      {image && !imageFailed ? (
        <Image
          source={{ uri: image }}
          style={styles.listingImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={image}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <View style={[styles.listingImage, styles.listingImageFallback]}>
          <Text style={styles.listingImageInitial}>{title.charAt(0).toUpperCase()}</Text>
        </View>
      )}
      <View style={styles.listingBody}>
        <Text style={styles.listingTitle} numberOfLines={2}>
          {title}
        </Text>
        <Text style={styles.listingPrice}>
          {draft.price} {draft.currency}
        </Text>
        <Text style={styles.muted}>
          {draft.quantity
            ? t('market.sell.stock', { count: Number(draft.quantity) })
            : t('market.sell.stockUntracked')}
        </Text>
        <View style={styles.listingActions}>
          <TouchableOpacity
            onPress={() => onEdit(draft.dTag)}
            accessibilityLabel={t('market.sell.editAccessibility', { title })}
            testID={`seller-listing-edit-${id}`}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={styles.listingAction}>{t('market.sell.edit')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onPreview(event)}
            accessibilityLabel={t('market.sell.previewAccessibility', { title })}
            testID={`seller-listing-preview-${id}`}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={styles.listingAction}>{t('market.sell.preview')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => onDelete(event)}
            accessibilityLabel={t('market.sell.deleteAccessibility', { title })}
            testID={`seller-listing-delete-${id}`}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Text style={[styles.listingAction, styles.listingActionDanger]}>
              {t('market.sell.delete')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

export default React.memo(SellerListingRow);
