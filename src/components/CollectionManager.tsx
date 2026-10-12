import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Text, TextInput, TouchableOpacity, View } from 'react-native';
import type { Event } from 'nostr-tools';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { useSellerActions, StaleRevisionError } from '../hooks/useSellerActions';
import { newIdentifier } from '../utils/marketSellerEvents';
import {
  parseCollection,
  isLegacyShopCollection,
  type CollectionDraft,
} from '../utils/marketCollections';
import type { SellerSnapshot } from '../utils/marketSellerSnapshot';
import { createMarketSellerStyles, type MarketSellerStyles } from '../styles/MarketSeller.styles';
import { ReferencePicker } from './CollectionPicker';
import { Alert } from './BrandedAlert';
import { Toast } from './BrandedToast';

const CollectionManager: React.FC<{ snapshot: SellerSnapshot }> = ({ snapshot }) => {
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketSellerStyles(colors), [colors]);
  const { saveCollection, deleteCollection, busy } = useSellerActions(snapshot);
  const [draft, setDraft] = useState<CollectionDraft | null>(null);
  const [base, setBase] = useState<Event | null>(null);
  const choices = useMemo(
    () =>
      snapshot.listings.map((e) => ({
        coordinate: `30402:${e.pubkey}:${e.tags.find((t) => t[0] === 'd')?.[1]}`,
        title: e.tags.find((t) => t[0] === 'title')?.[1] ?? '',
      })),
    [snapshot.listings],
  );
  const execute = useCallback(
    async (action: (force: boolean) => Promise<unknown>): Promise<void> => {
      try {
        await action(false);
        setDraft(null);
      } catch (error) {
        if (error instanceof StaleRevisionError) {
          Alert.alert(t('market.sell.conflictTitle'), t('market.sell.editor.conflictBody'), [
            { text: t('market.sell.cancel'), style: 'cancel' },
            { text: t('market.sell.overwrite'), onPress: () => void execute(() => action(true)) },
          ]);
        } else Toast.show({ type: 'error', text1: t('market.sell.shop.saveFailed') });
      }
    },
    [t],
  );
  const remove = useCallback(
    (event: Event) =>
      Alert.alert(
        t('market.sell.deleteCollectionTitle'),
        t('market.sell.deleteBody', { title: parseCollection(event).title }),
        [
          { text: t('market.sell.cancel'), style: 'cancel' },
          {
            text: t('market.sell.delete'),
            style: 'destructive',
            onPress: () => void execute((force) => deleteCollection(event, { force })),
          },
        ],
      ),
    [t, execute, deleteCollection],
  );
  const edit = useCallback((event: Event) => {
    setBase(event);
    setDraft(parseCollection(event));
  }, []);
  const rows = useMemo(
    () => (snapshot.collections ?? []).filter((e) => !isLegacyShopCollection(e)),
    [snapshot.collections],
  );
  const renderItem = useCallback(
    ({ item }: { item: Event }) => (
      <CollectionRow event={item} busy={busy} styles={styles} onEdit={edit} onDelete={remove} />
    ),
    [busy, styles, edit, remove],
  );
  const shippingChoices = useMemo(
    () => snapshot.zones.map((z) => ({ coordinate: z.coordinate, title: z.title })),
    [snapshot.zones],
  );
  const setProducts = useCallback(
    (products: string[]) => setDraft((prev) => (prev ? { ...prev, products } : prev)),
    [],
  );
  const setShipping = useCallback(
    (shipping: string[]) => setDraft((prev) => (prev ? { ...prev, shipping } : prev)),
    [],
  );
  return (
    <View style={styles.field} testID="my-shop-collections">
      <Text style={styles.sectionTitle}>{t('market.sell.collections')}</Text>
      <FlatList
        horizontal
        data={rows}
        keyExtractor={collectionKey}
        renderItem={renderItem}
        contentContainerStyle={styles.referenceList}
        initialNumToRender={5}
        windowSize={5}
        testID="my-shop-collection-list"
      />
      <TouchableOpacity
        style={styles.secondaryButton}
        disabled={busy}
        testID="collection-create"
        onPress={() => {
          setBase(null);
          setDraft({
            dTag: newIdentifier('collection'),
            title: '',
            summary: '',
            image: '',
            location: '',
            shipping: [],
            products: [],
          });
        }}
      >
        <Text style={styles.secondaryButtonText}>{t('market.sell.createCollection')}</Text>
      </TouchableOpacity>
      {draft ? (
        <View style={styles.card} testID="collection-editor">
          {(['dTag', 'title', 'summary', 'image', 'location'] as const).map((field) => (
            <View key={field} style={styles.field}>
              <Text style={styles.label}>{t(`market.sell.collectionFields.${field}`)}</Text>
              <TextInput
                style={styles.input}
                value={draft[field]}
                editable={field !== 'dTag' || !base}
                testID={`collection-${field}-input`}
                accessibilityLabel={t(`market.sell.collectionFields.${field}`)}
                maxLength={field === 'summary' ? 2000 : 200}
                onChangeText={(value) => setDraft({ ...draft, [field]: value })}
              />
            </View>
          ))}
          <ReferencePicker
            choices={choices}
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
            onPress={() => void execute((force) => saveCollection(draft, base, { force }))}
          >
            <Text style={styles.primaryButtonText}>{t('contactProfileScreen.save')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.textButton}
            disabled={busy}
            testID="collection-cancel"
            onPress={() => setDraft(null)}
          >
            <Text style={styles.secondaryButtonText}>{t('market.sell.cancel')}</Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
};
export default React.memo(CollectionManager);

const collectionKey = (event: Event) => event.id;
const CollectionRow = React.memo(function CollectionRow({
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
  return (
    <View style={[styles.card, styles.collectionCard]} testID={`collection-${event.id}`}>
      <Text style={styles.cardTitle}>{parseCollection(event).title}</Text>
      <TouchableOpacity
        disabled={busy}
        testID={`collection-edit-${event.id}`}
        onPress={() => onEdit(event)}
      >
        <Text style={styles.secondaryButtonText}>{t('market.sell.edit')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        disabled={busy}
        testID={`collection-delete-${event.id}`}
        onPress={() => onDelete(event)}
      >
        <Text style={styles.errorText}>{t('market.sell.delete')}</Text>
      </TouchableOpacity>
    </View>
  );
});
