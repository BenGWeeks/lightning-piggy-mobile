import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import type { Event } from 'nostr-tools';
import { useTranslation } from '../contexts/LocaleContext';
import { parseCollection } from '../utils/marketCollections';
import type { MarketSellerStyles } from '../styles/MarketSeller.styles';

/** One of the seller's collections on the Collections screen. */
function SellerCollectionRow({
  event,
  busy,
  styles,
  onEdit,
  onDelete,
}: {
  event: Event;
  busy: boolean;
  styles: MarketSellerStyles;
  onEdit: (event: Event) => void;
  onDelete: (event: Event) => void;
}) {
  const t = useTranslation();
  const collection = parseCollection(event);
  return (
    <View style={styles.listingRow} testID={`collection-${event.id}`}>
      <View style={styles.listingBody}>
        <Text style={styles.listingTitle} numberOfLines={1}>
          {collection.title}
        </Text>
        {collection.summary ? (
          <Text style={styles.muted} numberOfLines={2}>
            {collection.summary}
          </Text>
        ) : null}
        <Text style={styles.muted}>
          {t('market.sell.collectionListings', { count: collection.products.length })}
        </Text>
        <View style={styles.listingActions}>
          <TouchableOpacity
            disabled={busy}
            testID={`collection-edit-${event.id}`}
            accessibilityLabel={t('market.sell.editAccessibility', { title: collection.title })}
            onPress={() => onEdit(event)}
          >
            <Text style={styles.listingAction}>{t('market.sell.edit')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            disabled={busy}
            testID={`collection-delete-${event.id}`}
            accessibilityLabel={t('market.sell.deleteAccessibility', { title: collection.title })}
            onPress={() => onDelete(event)}
          >
            <Text style={[styles.listingAction, styles.listingActionDanger]}>
              {t('market.sell.delete')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default React.memo(SellerCollectionRow);
