import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import {
  BottomSheetBackdrop,
  BottomSheetTextInput,
  BottomSheetView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import type { Event } from 'nostr-tools';
import { BottomSheetModal } from './AccessibleBottomSheetModal';
import BrandedSpinner from './BrandedSpinner';
import { Toast } from './BrandedToast';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { SellerFetchError } from '../utils/marketSellerRevision';
import { SellerSigningError } from '../utils/sellerSigning';
import { COLLECTION_KIND, coordinateOf } from '../utils/marketSellerEvents';
import { newCollectionDraft, type CollectionDraft } from '../utils/marketCollections';
import { createNewCollectionSheetStyles } from '../styles/NewCollectionSheet.styles';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** `useSellerActions().saveCollection`: checks the current revision first
   * (fail closed), then signs and publishes. */
  saveCollection: (draft: CollectionDraft, base: Event | null) => Promise<Event>;
  /** Fired with the new collection's `30405:<pubkey>:<d>` coordinate. */
  onCreated: (coordinate: string) => void;
}

/** "New collection" popup from the listing editor (#1534): name plus an
 * optional description, published as a kind-30405 collection. */
const NewCollectionSheet: React.FC<Props> = ({ visible, onClose, saveCollection, onCreated }) => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createNewCollectionSheetStyles(colors), [colors]);
  const sheetRef = useRef<BottomSheetModal>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [showError, setShowError] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setName('');
      setDescription('');
      setShowError(false);
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const onSave = useCallback(async () => {
    const title = name.trim();
    if (!title) {
      setShowError(true);
      return;
    }
    setSaving(true);
    try {
      const signed = await saveCollection(newCollectionDraft(title, description.trim()), null);
      const dTag = signed.tags.find((tag) => tag[0] === 'd')?.[1] ?? '';
      onCreated(coordinateOf(COLLECTION_KIND, signed.pubkey, dTag));
      Toast.show({ type: 'success', text1: t('market.sell.newCollection.created') });
      onClose();
    } catch (e) {
      Toast.show({
        type: 'error',
        text1:
          e instanceof SellerFetchError
            ? t('market.sell.loadFailedTryAgain')
            : t('market.sell.newCollection.failed'),
        text2:
          e instanceof SellerFetchError || e instanceof SellerSigningError
            ? undefined
            : (e as Error).message,
      });
    } finally {
      setSaving(false);
    }
  }, [name, description, saveCollection, onCreated, onClose, t]);

  const invalid = showError && !name.trim();
  return (
    <BottomSheetModal
      ref={sheetRef}
      enableDynamicSizing
      enablePanDownToClose
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handle}
      onDismiss={onClose}
    >
      <BottomSheetView style={styles.container} testID="new-collection-sheet">
        <Text style={styles.title} accessibilityRole="header">
          {t('market.sell.newCollection.title')}
        </Text>
        <View style={styles.field}>
          <Text style={styles.label}>{t('market.sell.newCollection.name')}</Text>
          <BottomSheetTextInput
            style={[styles.input, invalid && styles.inputError]}
            value={name}
            onChangeText={setName}
            placeholder={t('market.sell.newCollection.namePlaceholder')}
            placeholderTextColor={colors.textSupplementary}
            maxLength={200}
            accessibilityLabel={t('market.sell.newCollection.name')}
            testID="new-collection-name"
          />
          {invalid ? (
            <Text style={styles.error}>{t('market.sell.newCollection.nameRequired')}</Text>
          ) : null}
        </View>
        <View style={styles.field}>
          <Text style={styles.label}>{t('market.sell.newCollection.description')}</Text>
          <BottomSheetTextInput
            style={[styles.input, styles.inputMultiline]}
            value={description}
            onChangeText={setDescription}
            placeholder={t('market.sell.newCollection.descriptionPlaceholder')}
            placeholderTextColor={colors.textSupplementary}
            multiline
            maxLength={2000}
            accessibilityLabel={t('market.sell.newCollection.description')}
            testID="new-collection-description"
          />
        </View>
        <TouchableOpacity
          style={[styles.save, saving && styles.saveDisabled]}
          onPress={() => void onSave()}
          disabled={saving}
          accessibilityState={{ disabled: saving, busy: saving }}
          accessibilityLabel={t('market.sell.newCollection.save')}
          testID="new-collection-save"
        >
          {saving ? <BrandedSpinner onGradient /> : null}
          <Text style={styles.saveText}>{t('market.sell.newCollection.save')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.cancel}
          onPress={onClose}
          disabled={saving}
          accessibilityLabel={t('market.sell.cancel')}
          testID="new-collection-cancel"
        >
          <Text style={styles.cancelText}>{t('market.sell.cancel')}</Text>
        </TouchableOpacity>
      </BottomSheetView>
    </BottomSheetModal>
  );
};

export default NewCollectionSheet;
