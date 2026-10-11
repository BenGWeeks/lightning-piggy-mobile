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
import { useSellerActions } from '../hooks/useSellerActions';
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

  const newZone = useCallback((): ShippingZoneDraft => {
    const home = deviceCountryCode();
    return {
      dTag: newIdentifier('shipping'),
      name: t('market.sell.zone.defaultName'),
      countries: home ? [home] : [],
      cost: '',
    };
  }, [t]);

  // Seed the form once: from the published shop, or blank for a first-time
  // setup once a COMPLETED fetch shows there isn't one. A failed fetch must
  // not offer a blank form — saving it would replace an existing shop.
  useEffect(() => {
    if (form) return;
    const existing = parseShopDraft(snapshot.shop, snapshot.zones);
    if (existing) {
      setForm({ shop: existing, zones: snapshot.zones.map(zoneDraftFromOption) });
    } else if (status === 'ready') {
      setForm({ shop: { name: '', description: '', currency: 'SATS' }, zones: [newZone()] });
    }
  }, [form, snapshot.shop, snapshot.zones, status, newZone]);

  const errors = useMemo(() => (form ? validateShop(form.shop, form.zones) : []), [form]);

  const setShop = useCallback(
    (patch: Partial<ShopDraft>) =>
      setForm((prev) => (prev ? { ...prev, shop: { ...prev.shop, ...patch } } : prev)),
    [],
  );
  const onZoneChange = useCallback(
    (index: number, zone: ShippingZoneDraft) =>
      setForm((prev) =>
        prev ? { ...prev, zones: prev.zones.map((z, i) => (i === index ? zone : z)) } : prev,
      ),
    [],
  );
  const onZoneRemove = useCallback(
    (index: number) =>
      setForm((prev) =>
        prev ? { ...prev, zones: prev.zones.filter((_, i) => i !== index) } : prev,
      ),
    [],
  );
  const onAddZone = useCallback(
    () => setForm((prev) => (prev ? { ...prev, zones: [...prev.zones, newZone()] } : prev)),
    [newZone],
  );
  const onPickCountry = useCallback(
    (code: string) => {
      if (pickingZone === null) return;
      setForm((prev) =>
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
    [pickingZone],
  );

  const onSave = useCallback(async () => {
    if (!form) return;
    if (errors.length > 0) {
      setShowErrors(true);
      Toast.show({ type: 'error', text1: t('market.sell.shop.fixErrors') });
      return;
    }
    try {
      await saveShop(form.shop, form.zones);
      Toast.show({ type: 'success', text1: t('market.sell.shop.saved') });
      navigation.goBack();
    } catch (e) {
      Toast.show({
        type: 'error',
        text1: t('market.sell.shop.saveFailed'),
        text2: (e as Error).message,
      });
    }
  }, [form, errors, saveShop, navigation, t]);

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
                currency={form.shop.currency}
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
