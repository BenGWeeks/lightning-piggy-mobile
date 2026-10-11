import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Eye, Trash2 } from 'lucide-react-native';
import type { Event } from 'nostr-tools';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useSellerShop } from '../hooks/useSellerShop';
import { useSellerActions } from '../hooks/useSellerActions';
import { useListingPhotoUpload } from '../hooks/useListingPhotoUpload';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import MarketSellerHeader from '../components/MarketSellerHeader';
import SellerCurrencyChips from '../components/SellerCurrencyChips';
import ListingPhotosField from '../components/ListingPhotosField';
import ListingShippingPicker from '../components/ListingShippingPicker';
import { createMarketSellerStyles } from '../styles/MarketSeller.styles';
import {
  buildListingTemplate,
  newIdentifier,
  parseListingDraft,
  parseShopDraft,
  splitCategories,
  validateListingDraft,
  type ListingDraft,
} from '../utils/marketSellerEvents';
import { parseMarketListing } from '../utils/marketListings';
import type { ExploreNavigation, MarketListingEditorRoute } from '../navigation/types';

interface Props {
  navigation: ExploreNavigation;
  route: MarketListingEditorRoute;
}

const dTagOf = (event: Event) => event.tags.find((t) => t[0] === 'd')?.[1];

/** Create a listing, or edit one (republished under the same `d`). */
const MarketListingEditorScreen: React.FC<Props> = ({ navigation, route }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMarketSellerStyles(colors), [colors]);
  const editDTag = route.params?.dTag;
  const { pubkey, snapshot, status, refresh } = useSellerShop();
  const { saveListing, deleteListing, busy } = useSellerActions(snapshot);
  const { uploading, pickAndUpload } = useListingPhotoUpload();
  const [draft, setDraft] = useState<ListingDraft | null>(null);
  const [categoriesText, setCategoriesText] = useState('');
  const [showErrors, setShowErrors] = useState(false);
  // Revision the form was loaded from: an untouched form follows newer
  // revisions; a touched one asks before overwriting them.
  const [baseId, setBaseId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const existing = useMemo(
    () => (editDTag ? (snapshot.listings.find((e) => dTagOf(e) === editDTag) ?? null) : null),
    [editDTag, snapshot.listings],
  );
  const shop = useMemo(
    () => parseShopDraft(snapshot.shop, snapshot.zones),
    [snapshot.shop, snapshot.zones],
  );

  // Seed: the listing being edited (re-seeded while untouched if a newer
  // revision arrives), or a blank draft in the shop's currency with every
  // shipping zone switched on.
  useEffect(() => {
    if (existing) {
      if (draft && (dirty || existing.id === baseId)) return;
      const parsed = parseListingDraft(existing);
      setDraft(parsed);
      setCategoriesText(parsed.categories.join(', '));
      setBaseId(existing.id);
    } else if (!draft && !editDTag && shop) {
      setDraft({
        dTag: newIdentifier('item'),
        title: '',
        description: '',
        images: [],
        price: '',
        currency: shop.currency,
        quantity: '1',
        categories: [],
        shipping: snapshot.zones.map((z) => ({ coordinate: z.coordinate, extraCost: '' })),
      });
    }
  }, [draft, dirty, baseId, existing, editDTag, shop, snapshot.zones]);

  const fullDraft = useMemo(
    () => (draft ? { ...draft, categories: splitCategories(categoriesText) } : null),
    [draft, categoriesText],
  );
  const errors = useMemo(() => (fullDraft ? validateListingDraft(fullDraft) : []), [fullDraft]);
  const invalid = (field: (typeof errors)[number]) => showErrors && errors.includes(field);

  const editDraft = useCallback((change: (prev: ListingDraft) => ListingDraft) => {
    setDirty(true);
    setDraft((prev) => (prev ? change(prev) : prev));
  }, []);
  const update = useCallback(
    (patch: Partial<ListingDraft>) => editDraft((prev) => ({ ...prev, ...patch })),
    [editDraft],
  );
  const onCategoriesChange = useCallback((text: string) => {
    setDirty(true);
    setCategoriesText(text);
  }, []);
  const onAddPhoto = useCallback(async () => {
    const url = await pickAndUpload();
    if (url) editDraft((prev) => ({ ...prev, images: [...prev.images, url] }));
  }, [pickAndUpload, editDraft]);
  const onRemovePhoto = useCallback(
    (index: number) =>
      editDraft((prev) => ({ ...prev, images: prev.images.filter((_, i) => i !== index) })),
    [editDraft],
  );

  const checkValid = useCallback(() => {
    if (errors.length === 0) return true;
    setShowErrors(true);
    Toast.show({ type: 'error', text1: t('market.sell.editor.fixErrors') });
    return false;
  }, [errors, t]);

  const onPreview = useCallback(() => {
    if (!fullDraft || !pubkey || !checkValid()) return;
    const now = Math.floor(Date.now() / 1000);
    const template = buildListingTemplate({
      draft: fullDraft,
      pubkey,
      nowSeconds: now,
      previous: existing,
    });
    // Unsigned stand-in so the shopper-facing detail screen can render it.
    const product = parseMarketListing(
      { ...template, pubkey, created_at: now, id: '0'.repeat(64), sig: '' } as Event,
      now,
    );
    if (product) {
      navigation.navigate('MarketProductDetail', { productId: product.id, product, preview: true });
    }
  }, [fullDraft, pubkey, existing, checkValid, navigation]);

  const onPublish = useCallback(async () => {
    if (!fullDraft || !checkValid()) return;
    const publish = async () => {
      try {
        await saveListing(fullDraft, existing);
        Toast.show({
          type: 'success',
          text1: existing ? t('market.sell.editor.updated') : t('market.sell.editor.published'),
        });
        navigation.goBack();
      } catch (e) {
        Toast.show({
          type: 'error',
          text1: t('market.sell.editor.publishFailed'),
          text2: (e as Error).message,
        });
      }
    };
    if (existing && baseId && existing.id !== baseId) {
      Alert.alert(t('market.sell.conflictTitle'), t('market.sell.editor.conflictBody'), [
        { text: t('market.sell.cancel'), style: 'cancel' },
        { text: t('market.sell.overwrite'), onPress: () => void publish() },
      ]);
      return;
    }
    await publish();
  }, [fullDraft, existing, baseId, checkValid, saveListing, navigation, t]);

  const onDelete = useCallback(() => {
    if (!existing) return;
    const title = parseListingDraft(existing).title;
    Alert.alert(t('market.sell.deleteTitle'), t('market.sell.deleteBody', { title }), [
      { text: t('market.sell.cancel'), style: 'cancel' },
      {
        text: t('market.sell.delete'),
        style: 'destructive',
        onPress: () => {
          deleteListing(existing)
            .then(() => {
              Toast.show({ type: 'success', text1: t('market.sell.deleted') });
              navigation.goBack();
            })
            .catch((e: Error) =>
              Toast.show({ type: 'error', text1: t('market.sell.deleteFailed'), text2: e.message }),
            );
        },
      },
    ]);
  }, [existing, deleteListing, navigation, t]);

  const loading = status === 'loading' || status === 'idle';
  // Only a completed fetch proves "no shop" / "no such listing"; an
  // unreachable relay set offers a retry instead.
  let blocker: string | null = null;
  if (!draft && status === 'error') blocker = t('market.sell.loadError');
  else if (!draft && !loading) {
    blocker = editDTag ? t('market.sell.editor.notFound') : t('market.sell.editor.needsShop');
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="listing-editor-screen"
    >
      <MarketSellerHeader
        title={editDTag ? t('market.sell.editor.editTitle') : t('market.sell.editor.newTitle')}
        backLabel={t('market.sell.back')}
        onBack={() => navigation.goBack()}
        styles={styles}
        testID="listing-editor-back"
      />
      {!draft ? (
        <View style={styles.centered}>
          {blocker ? (
            <>
              <Text style={[styles.cardBody, styles.centerText]}>{blocker}</Text>
              {status === 'error' ? (
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={refresh}
                  accessibilityLabel={t('market.sell.retry')}
                  testID="listing-editor-retry"
                >
                  <Text style={styles.secondaryButtonText}>{t('market.sell.retry')}</Text>
                </TouchableOpacity>
              ) : !editDTag ? (
                <TouchableOpacity
                  style={styles.primaryButton}
                  onPress={() => navigation.replace('MarketShopSettings')}
                  accessibilityLabel={t('market.sell.setupButton')}
                  testID="listing-editor-setup-shop"
                >
                  <Text style={styles.primaryButtonText}>{t('market.sell.setupButton')}</Text>
                </TouchableOpacity>
              ) : null}
            </>
          ) : (
            <ActivityIndicator color={colors.brandPink} />
          )}
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <ListingPhotosField
              images={draft.images}
              uploading={uploading}
              onAdd={onAddPhoto}
              onRemove={onRemovePhoto}
              styles={styles}
            />
            <View style={styles.field}>
              <Text style={styles.label}>{t('market.sell.editor.title')}</Text>
              <TextInput
                style={[styles.input, invalid('title') && styles.inputError]}
                value={draft.title}
                onChangeText={(title) => update({ title })}
                placeholder={t('market.sell.editor.titlePlaceholder')}
                placeholderTextColor={colors.textSupplementary}
                maxLength={200}
                testID="listing-title-input"
                accessibilityLabel={t('market.sell.editor.title')}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('market.sell.editor.description')}</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={draft.description}
                onChangeText={(description) => update({ description })}
                placeholder={t('market.sell.editor.descriptionPlaceholder')}
                placeholderTextColor={colors.textSupplementary}
                multiline
                maxLength={8000}
                testID="listing-description-input"
                accessibilityLabel={t('market.sell.editor.description')}
              />
            </View>
            <View style={styles.footerRow}>
              <View style={[styles.field, styles.flex1]}>
                <Text style={styles.label}>
                  {t('market.sell.editor.price')} ({draft.currency})
                </Text>
                <TextInput
                  style={[styles.input, invalid('price') && styles.inputError]}
                  value={draft.price}
                  onChangeText={(price) => update({ price })}
                  placeholder="0"
                  placeholderTextColor={colors.textSupplementary}
                  keyboardType="decimal-pad"
                  maxLength={16}
                  testID="listing-price-input"
                  accessibilityLabel={t('market.sell.editor.price')}
                />
              </View>
              <View style={[styles.field, styles.flex1]}>
                <Text style={styles.label}>{t('market.sell.editor.quantity')}</Text>
                <TextInput
                  style={[styles.input, invalid('quantity') && styles.inputError]}
                  value={draft.quantity}
                  onChangeText={(quantity) => update({ quantity })}
                  placeholder={t('market.sell.editor.quantityPlaceholder')}
                  placeholderTextColor={colors.textSupplementary}
                  keyboardType="number-pad"
                  maxLength={9}
                  testID="listing-quantity-input"
                  accessibilityLabel={t('market.sell.editor.quantity')}
                />
              </View>
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('market.sell.editor.currency')}</Text>
              <SellerCurrencyChips
                value={draft.currency}
                onChange={(currency) => update({ currency })}
                styles={styles}
                testIDPrefix="listing-currency"
              />
            </View>
            <Text style={styles.sectionTitle}>{t('market.sell.editor.shipping')}</Text>
            <Text style={styles.hint}>{t('market.sell.editor.shippingHint')}</Text>
            <ListingShippingPicker
              zones={snapshot.zones}
              value={draft.shipping}
              currency={draft.currency}
              showErrors={showErrors}
              onChange={(shipping) => update({ shipping })}
              styles={styles}
            />
            <View style={styles.field}>
              <Text style={styles.label}>{t('market.sell.editor.categories')}</Text>
              <TextInput
                style={[styles.input, invalid('categories') && styles.inputError]}
                value={categoriesText}
                onChangeText={onCategoriesChange}
                placeholder={t('market.sell.editor.categoriesPlaceholder')}
                placeholderTextColor={colors.textSupplementary}
                autoCapitalize="none"
                maxLength={400}
                testID="listing-categories-input"
                accessibilityLabel={t('market.sell.editor.categories')}
              />
              <Text style={styles.hint}>{t('market.sell.editor.categoriesHint')}</Text>
            </View>
            {existing ? (
              <TouchableOpacity
                style={[styles.secondaryButton, styles.dangerButton]}
                onPress={onDelete}
                disabled={busy}
                accessibilityLabel={t('market.sell.editor.delete')}
                testID="listing-delete"
              >
                <Trash2 size={18} color={colors.red} strokeWidth={2.25} />
                <Text style={[styles.secondaryButtonText, styles.dangerButtonText]}>
                  {t('market.sell.editor.delete')}
                </Text>
              </TouchableOpacity>
            ) : null}
            <View style={styles.formActions}>
              {showErrors
                ? errors.map((error) => (
                    <Text key={error} style={styles.errorText}>
                      {t(`market.sell.errors.${error}`)}
                    </Text>
                  ))
                : null}
              <View style={styles.footerRow}>
                <TouchableOpacity
                  style={[styles.secondaryButton, styles.flex1]}
                  onPress={onPreview}
                  disabled={busy}
                  accessibilityLabel={t('market.sell.editor.preview')}
                  testID="listing-preview"
                >
                  <Eye size={18} color={colors.brandPink} strokeWidth={2.25} />
                  <Text style={styles.secondaryButtonText}>{t('market.sell.editor.preview')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.primaryButton, styles.flex1, busy && styles.primaryButtonDisabled]}
                  onPress={onPublish}
                  disabled={busy || uploading}
                  accessibilityState={{ disabled: busy || uploading, busy }}
                  accessibilityLabel={
                    existing ? t('market.sell.editor.update') : t('market.sell.editor.publish')
                  }
                  testID="listing-publish"
                >
                  {busy ? <ActivityIndicator color={colors.white} /> : null}
                  <Text style={styles.primaryButtonText} numberOfLines={1}>
                    {busy
                      ? t('market.sell.editor.publishing')
                      : existing
                        ? t('market.sell.editor.update')
                        : t('market.sell.editor.publish')}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </>
      )}
    </KeyboardAvoidingView>
  );
};

export default MarketListingEditorScreen;
