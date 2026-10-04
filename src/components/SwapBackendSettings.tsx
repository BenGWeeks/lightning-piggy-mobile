import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import { createSwapBackendSettingsStyles } from '../styles/SwapBackendSettings.styles';
import {
  DEFAULT_SWAP_BACKEND,
  getSwapBackend,
  checkAndSaveSwapBackend,
} from '../services/swapBackendService';

export default function SwapBackendSettings() {
  const colors = useThemeColors();
  const t = useTranslation();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createSwapBackendSettingsStyles(), []);
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    getSwapBackend()
      .then((value) => {
        if (active) setUrl(value);
      })
      .catch(() => {
        if (active) setMessage(t('swapBackend.loadError'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [t]);

  const save = async () => {
    setBusy(true);
    setMessage('');
    try {
      const saved = await checkAndSaveSwapBackend(url);
      setUrl(saved);
      setMessage(t('swapBackend.saved'));
    } catch (error) {
      setMessage(`${t('swapBackend.saveError')} ${error instanceof Error ? error.message : ''}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.section}>
      <Text style={shared.sectionLabel}>{t('swapBackend.title')}</Text>
      <TextInput
        style={shared.textInput}
        value={url}
        onChangeText={(value) => {
          setUrl(value);
          setMessage('');
        }}
        editable={!loading && !busy}
        placeholder={DEFAULT_SWAP_BACKEND}
        placeholderTextColor={colors.textSupplementary}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        testID="swap-backend-url"
        accessibilityLabel={t('swapBackend.title')}
      />
      <Text style={shared.fieldHint}>{t('swapBackend.hint')}</Text>
      <TouchableOpacity
        style={shared.saveButton}
        onPress={save}
        disabled={loading || busy || !url.trim()}
        accessibilityRole="button"
        accessibilityState={{ disabled: loading || busy || !url.trim(), busy }}
        accessibilityLabel={t('swapBackend.save')}
        testID="swap-backend-save"
      >
        <Text style={shared.saveButtonText}>
          {t(busy ? 'swapBackend.checking' : 'swapBackend.save')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.reset}
        onPress={() => {
          setUrl(DEFAULT_SWAP_BACKEND);
          setMessage('');
        }}
        disabled={loading || busy}
        accessibilityRole="button"
        accessibilityState={{ disabled: loading || busy }}
        accessibilityLabel={t('swapBackend.default')}
        testID="swap-backend-default"
      >
        <Text style={shared.fieldHint}>{t('swapBackend.default')}</Text>
      </TouchableOpacity>
      {!!message && (
        <Text
          style={shared.fieldHint}
          accessibilityLiveRegion="polite"
          testID="swap-backend-message"
        >
          {message}
        </Text>
      )}
    </View>
  );
}
