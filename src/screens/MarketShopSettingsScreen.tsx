import { SellerSigningError } from '../utils/sellerSigning';
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
import { Plus } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useSellerShop } from '../hooks/useSellerShop';
import {
  SellerFetchError,
  StaleRevisionError,
  useSellerActions,
  type ShopBase,
} from '../hooks/useSellerActions';
import { Alert } from '../components/BrandedAlert';
import { Toast } from '../components/BrandedToast';
import MarketSellerHeader from '../components/MarketSellerHeader';
import SellerCurrencyChips from '../components/SellerCurrencyChips';
import ShippingZoneEditor from '../components/ShippingZoneEditor';
import CountryPickerSheet from '../components/CountryPickerSheet';
import { createMarketSellerStyles } from '../styles/MarketSeller.styles';
import { deviceCountryCode } from '../data/countries';
import {
  MAX_SHIPPING_ZONES,
  newIdentifier,
  parseShopDraft,
  validateShop,
  zoneDraftFromOption,
  type ShippingZoneDraft,
  type ShopDraft,
} from '../utils/marketSellerEvents';
import type { ExploreNavigation } from '../navigation/types';

interface Props {
  navigation: ExploreNavigation;
}

interface Form {
  shop: ShopDraft;
  zones: ShippingZoneDraft[];
}

/** Create (first time) or edit the shop: name, description, currency and
 * shipping zones. Saving publishes changed kind-30406 zones, a deletion for
 * removed ones, then the kind-30405 shop collection. */
const MarketShopSettingsScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createMarketSellerStyles(colors), [colors]);
  const { snapshot, status, refresh } = useSellerShop();
  const { saveShop, busy } = useSellerActions(snapshot);
  const [form, setForm] = useState<Form | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [pickingZone, setPickingZone] = useState<number | null>(null);
  // The revision the form was loaded from: an untouched form follows newer
  // revisions; a touched one asks before overwriting them.
  const [base, setBase] = useState<ShopBase | null>(null);
  const [dirty, setDirty] = useState(false);
  const editForm = useCallback((update: (prev: Form | null) => Form | null) => {
    setDirty(true);
    setForm(update);
  }, []);

  const newZone = useCallback(
    (currency: string): ShippingZoneDraft => {
      const home = deviceCountryCode();
      return {
        dTag: newIdentifier('shipping'),
        name: t('market.sell.zone.defaultName'),
        countries: home ? [home] : [],
        cost: '',
        currency,
      };
    },
    [t],
  );

  // Seed the form once: from the published shop, or blank for a first-time
  // setup once a COMPLETED fetch shows there isn't one. A failed fetch must
  // not offer a blank form — saving it would replace an existing shop.
  useEffect(() => {
    const existing = parseShopDraft(snapshot.shop, snapshot.zones);
    if (existing && snapshot.shop) {
      if (form && (dirty || base?.shop?.id === snapshot.shop.id)) return;
      setForm({ shop: existing, zones: snapshot.zones.map(zoneDraftFromOption) });
      setBase({
        shop: snapshot.shop,
        zoneCoordinates: snapshot.zones.map((z) => z.coordinate),
        zoneEvents: new Map(snapshot.zoneEvents),
      });
    } else if (!form && status === 'ready') {
      setForm({ shop: { name: '', description: '', currency: 'SATS' }, zones: [newZone('SATS')] });
      setBase({ shop: null, zoneCoordinates: [], zoneEvents: new Map() });
    }
  }, [form, dirty, base, snapshot.shop, snapshot.zones, snapshot.zoneEvents, status, newZone]);

  const errors = useMemo(() => (form ? validateShop(form.shop, form.zones) : []), [form]);

  const setShop = useCallback(
    (patch: Partial<ShopDraft>) =>
      editForm((prev) => {
        if (!prev) return prev;
        const was = prev.shop.currency;
        // Zones priced in the shop currency follow a currency change; zones
        // priced in their own currency (e.g. a USD option) keep it.
        const zones =
          patch.currency && patch.currency !== was
            ? prev.zones.map((z) => (z.currency === was ? { ...z, currency: patch.currency! } : z))
            : prev.zones;
        return { shop: { ...prev.shop, ...patch }, zones };
      }),
    [editForm],
  );
  const onZoneChange = useCallback(
    (index: number, zone: ShippingZoneDraft) =>
      editForm((prev) =>
        prev ? { ...prev, zones: prev.zones.map((z, i) => (i === index ? zone : z)) } : prev,
      ),
    [editForm],
  );
  const onZoneRemove = useCallback(
    (index: number) =>
      editForm((prev) =>
        prev ? { ...prev, zones: prev.zones.filter((_, i) => i !== index) } : prev,
      ),
    [editForm],
  );
  const onAddZone = useCallback(
    () =>
      editForm((prev) =>
        prev ? { ...prev, zones: [...prev.zones, newZone(prev.shop.currency)] } : prev,
      ),
    [newZone, editForm],
  );
  const onPickCountry = useCallback(
    (code: string) => {
      if (pickingZone === null) return;
      editForm((prev) =>
        prev
          ? {
              ...prev,
              zones: prev.zones.map((z, i) =>
                i === pickingZone && !z.countries.includes(code)
                  ? { ...z, countries: [...z.countries, code] }
                  : z,
              ),
            }
          : prev,
      );
      setPickingZone(null);
    },
    [pickingZone, editForm],
  );

  const onSave = useCallback(async () => {
    if (!form) return;
    if (errors.length > 0) {
      setShowErrors(true);
      Toast.show({ type: 'error', text1: t('market.sell.shop.fixErrors') });
      return;
    }
    const reload = () => {
      // Show the newer shop the relays just returned (and its zones).
      setDirty(false);
      setBase(null);
      setForm(null);
      refresh();
    };
    const save = async (force: boolean) => {
      try {
        await saveShop(
          form.shop,
          form.zones,
          base ?? { shop: null, zoneCoordinates: [], zoneEvents: new Map() },
          {
            force,
          },
        );
        Toast.show({ type: 'success', text1: t('market.sell.shop.saved') });
        navigation.goBack();
      } catch (e) {
        if (e instanceof SellerFetchError) {
          // Unknown is not "no shop": never publish blind.
          Toast.show({ type: 'error', text1: t('market.sell.loadFailedTryAgain') });
          return;
        }
        if (e instanceof StaleRevisionError) {
          if (!e.base) {
            Toast.show({ type: 'info', text1: t('market.sell.shop.existingFound') });
            reload();
            return;
          }
          Alert.alert(t('market.sell.conflictTitle'), t('market.sell.shop.conflictBody'), [
            { text: t('market.sell.cancel'), style: 'cancel', onPress: reload },
            { text: t('market.sell.overwrite'), onPress: () => void save(true) },
          ]);
          return;
        }
        Toast.show({
          type: 'error',
          text1: t('market.sell.shop.saveFailed'),
          text2: e instanceof SellerSigningError ? undefined : (e as Error).message,
        });
      }
    };
    await save(false);
  }, [form, errors, base, saveShop, refresh, navigation, t]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID="shop-settings-screen"
    >
      <MarketSellerHeader
        title={t('market.sell.shop.title')}
        backLabel={t('market.sell.back')}
        onBack={() => navigation.goBack()}
        styles={styles}
        testID="shop-settings-back"
      />
      {!form ? (
        <View style={styles.centered}>
          {status === 'error' ? (
            <>
              <Text style={[styles.cardBody, styles.centerText]}>{t('market.sell.loadError')}</Text>
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={refresh}
                accessibilityLabel={t('market.sell.retry')}
                testID="shop-settings-retry"
              >
                <Text style={styles.secondaryButtonText}>{t('market.sell.retry')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <ActivityIndicator color={colors.brandPink} />
              <Text style={styles.muted}>{t('market.sell.loading')}</Text>
            </>
          )}
        </View>
      ) : (
        <>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            <View style={styles.field}>
              <Text style={styles.label}>{t('market.sell.shop.name')}</Text>
              <TextInput
                style={[
                  styles.input,
                  showErrors && errors.includes('shopName') && styles.inputError,
                ]}
                value={form.shop.name}
                onChangeText={(name) => setShop({ name })}
                placeholder={t('market.sell.shop.namePlaceholder')}
                placeholderTextColor={colors.textSupplementary}
                maxLength={100}
                testID="shop-name-input"
                accessibilityLabel={t('market.sell.shop.name')}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('market.sell.shop.description')}</Text>
              <TextInput
                style={[styles.input, styles.inputMultiline]}
                value={form.shop.description}
                onChangeText={(description) => setShop({ description })}
                placeholder={t('market.sell.shop.descriptionPlaceholder')}
                placeholderTextColor={colors.textSupplementary}
                multiline
                maxLength={2000}
                testID="shop-description-input"
                accessibilityLabel={t('market.sell.shop.description')}
              />
            </View>
            <View style={styles.field}>
              <Text style={styles.label}>{t('market.sell.shop.currency')}</Text>
              <SellerCurrencyChips
                value={form.shop.currency}
                onChange={(currency) => setShop({ currency })}
                styles={styles}
                testIDPrefix="shop-currency"
              />
              <Text style={styles.hint}>{t('market.sell.shop.currencyHint')}</Text>
            </View>

            <Text style={styles.sectionTitle}>{t('market.sell.shop.shipping')}</Text>
            <Text style={styles.hint}>{t('market.sell.shop.shippingHint')}</Text>
            {form.zones.map((zone, index) => (
              <ShippingZoneEditor
                key={zone.dTag}
                zone={zone}
                index={index}
                currency={zone.currency}
                showErrors={showErrors}
                styles={styles}
                onChange={onZoneChange}
                onRemove={onZoneRemove}
                onAddCountry={setPickingZone}
              />
            ))}
            {form.zones.length < MAX_SHIPPING_ZONES ? (
              <TouchableOpacity
                style={styles.secondaryButton}
                onPress={onAddZone}
                accessibilityLabel={t('market.sell.shop.addZone')}
                testID="shop-add-zone"
              >
                <Plus size={18} color={colors.brandPink} strokeWidth={2.5} />
                <Text style={styles.secondaryButtonText}>{t('market.sell.shop.addZone')}</Text>
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
              <TouchableOpacity
                style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}
                onPress={onSave}
                disabled={busy}
                accessibilityState={{ disabled: busy, busy }}
                accessibilityLabel={t('market.sell.shop.save')}
                testID="shop-save"
              >
                {busy ? <ActivityIndicator color={colors.white} /> : null}
                <Text style={styles.primaryButtonText}>
                  {busy ? t('market.sell.shop.saving') : t('market.sell.shop.save')}
                </Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </>
      )}
      <CountryPickerSheet
        visible={pickingZone !== null}
        onClose={() => setPickingZone(null)}
        selectedCode={null}
        onSelect={onPickCountry}
      />
    </KeyboardAvoidingView>
  );
};

export default MarketShopSettingsScreen;
