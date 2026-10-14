import React, { useCallback, useMemo } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useTranslation } from '../contexts/LocaleContext';
import type { CollectionDraft } from '../utils/marketCollections';
import type { SellerSnapshot } from '../utils/marketSellerSnapshot';
import type { MarketSellerStyles } from '../styles/MarketSeller.styles';
import { ReferencePicker } from './CollectionPicker';

const FIELDS = ['dTag', 'title', 'summary', 'image', 'location'] as const;

/** The inline create / edit form for one kind-30405 collection. */
function CollectionEditorCard({
  draft,
  editing,
  busy,
  snapshot,
  styles,
  onChange,
  onSave,
  onCancel,
}: {
  draft: CollectionDraft;
  /** Editing a published collection: its `d` tag is fixed. */
  editing: boolean;
  busy: boolean;
  snapshot: SellerSnapshot;
  styles: MarketSellerStyles;
  onChange: (draft: CollectionDraft) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const t = useTranslation();
  const listingChoices = useMemo(
    () =>
      snapshot.listings.map((e) => ({
        coordinate: `30402:${e.pubkey}:${e.tags.find((tag) => tag[0] === 'd')?.[1]}`,
        title: e.tags.find((tag) => tag[0] === 'title')?.[1] ?? '',
      })),
    [snapshot.listings],
  );
  const shippingChoices = useMemo(
    () => snapshot.zones.map((z) => ({ coordinate: z.coordinate, title: z.title })),
    [snapshot.zones],
  );
  const setProducts = useCallback(
    (products: string[]) => onChange({ ...draft, products }),
    [draft, onChange],
  );
  const setShipping = useCallback(
    (shipping: string[]) => onChange({ ...draft, shipping }),
    [draft, onChange],
  );
  return (
    <View style={styles.card} testID="collection-editor">
      {FIELDS.map((field) => (
        <View key={field} style={styles.field}>
          <Text style={styles.label}>{t(`market.sell.collectionFields.${field}`)}</Text>
          <TextInput
            style={styles.input}
            value={draft[field]}
            editable={field !== 'dTag' || !editing}
            testID={`collection-${field}-input`}
            accessibilityLabel={t(`market.sell.collectionFields.${field}`)}
            maxLength={field === 'summary' ? 2000 : 200}
            onChangeText={(value) => onChange({ ...draft, [field]: value })}
          />
        </View>
      ))}
      <ReferencePicker
        choices={listingChoices}
        value={draft.products}
        onChange={setProducts}
        title={t('market.sell.yourListings')}
        testID="collection-products"
      />
      <ReferencePicker
        choices={shippingChoices}
        value={draft.shipping}
        onChange={setShipping}
        title={t('market.sell.shop.shipping')}
        testID="collection-shipping"
      />
      <TouchableOpacity
        style={styles.primaryButton}
        disabled={busy}
        testID="collection-save"
        accessibilityLabel={t('contactProfileScreen.save')}
        onPress={onSave}
      >
        <Text style={styles.primaryButtonText}>{t('contactProfileScreen.save')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.textButton}
        disabled={busy}
        testID="collection-cancel"
        accessibilityLabel={t('market.sell.cancel')}
        onPress={onCancel}
      >
        <Text style={styles.secondaryButtonText}>{t('market.sell.cancel')}</Text>
      </TouchableOpacity>
    </View>
  );
}

export default React.memo(CollectionEditorCard);
