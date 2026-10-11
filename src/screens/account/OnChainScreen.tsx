import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import SwapBackendSettings from '../../components/SwapBackendSettings';
import { getElectrumServer } from '../../services/walletStorageService';
import ServerConnectionTest from '../../components/ServerConnectionTest';
import {
  checkElectrumConnection,
  saveElectrumSetting,
} from '../../services/onchainConnectionService';

const DEFAULT_ELECTRUM = 'electrum.blockstream.info:50002';

/**
 * Settings → Advanced → Bitcoin network: the Electrum server on-chain
 * wallets use, and the swap server. The default refund wallet moved to
 * Settings → Wallets.
 */
const OnChainScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const [electrumHostPort, setElectrumHostPort] = useState(DEFAULT_ELECTRUM);
  const [electrumSSL, setElectrumSSL] = useState(true);
  const [electrumLoading, setElectrumLoading] = useState(true);
  const [electrumLoaded, setElectrumLoaded] = useState(false);
  const [electrumError, setElectrumError] = useState(false);
  const electrumWrite = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    getElectrumServer()
      .then((server) => {
        if (!mounted.current) return;
        const parts = server.split(':');
        const protocol = parts.pop(); // 's' or 't'
        setElectrumHostPort(parts.join(':'));
        setElectrumSSL(protocol === 's');
        setElectrumLoaded(true);
      })
      .catch(() => {
        if (mounted.current) setElectrumError(true);
      })
      .finally(() => {
        if (mounted.current) setElectrumLoading(false);
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const saveElectrum = async (hostPort: string, ssl: boolean) => {
    const request = ++electrumWrite.current;
    try {
      await saveElectrumSetting(hostPort, ssl);
      if (mounted.current && request === electrumWrite.current) setElectrumError(false);
    } catch {
      if (mounted.current && request === electrumWrite.current) setElectrumError(true);
    }
  };
  const handleElectrumSave = () => {
    if (!electrumLoading && electrumLoaded) void saveElectrum(electrumHostPort, electrumSSL);
  };
  const testElectrum = useCallback(
    async (signal: AbortSignal) => {
      if (mounted.current) setElectrumError(false);
      return checkElectrumConnection(electrumHostPort, electrumSSL, signal);
    },
    [electrumHostPort, electrumSSL],
  );

  return (
    <AccountScreenLayout title={t('onChainScreen.title')} parent="AccountAdvanced">
      <Text style={sharedAccountStyles.sectionLabel}>{t('onChainScreen.electrumServer')}</Text>
      <TextInput
        style={sharedAccountStyles.textInput}
        value={electrumHostPort}
        onChangeText={(value) => {
          ++electrumWrite.current;
          setElectrumHostPort(value);
          setElectrumLoaded(true);
          setElectrumError(false);
        }}
        editable={!electrumLoading}
        placeholder={DEFAULT_ELECTRUM}
        placeholderTextColor="rgba(0,0,0,0.3)"
        autoCapitalize="none"
        autoCorrect={false}
        onBlur={handleElectrumSave}
        testID="electrum-server-input"
        accessibilityLabel={t('onChainScreen.electrumServerA11y')}
      />
      <View style={sharedAccountStyles.sslRow}>
        <Text style={sharedAccountStyles.sslLabel}>{t('onChainScreen.useSsl')}</Text>
        <TouchableOpacity
          style={[
            sharedAccountStyles.sslToggle,
            electrumSSL && sharedAccountStyles.sslToggleActive,
          ]}
          onPress={() => {
            const next = !electrumSSL;
            setElectrumSSL(next);
            void saveElectrum(electrumHostPort, next);
          }}
          disabled={electrumLoading || !electrumLoaded}
          testID="electrum-ssl-toggle"
          accessibilityLabel={t('onChainScreen.useSsl')}
          accessibilityRole="switch"
          accessibilityState={{
            checked: electrumSSL,
            disabled: electrumLoading || !electrumLoaded,
          }}
        >
          <View
            style={[
              sharedAccountStyles.sslToggleThumb,
              electrumSSL && sharedAccountStyles.sslToggleThumbActive,
            ]}
          />
        </TouchableOpacity>
      </View>
      <Text style={sharedAccountStyles.fieldHint}>{t('onChainScreen.hint')}</Text>
      <ServerConnectionTest
        inputKey={`${electrumHostPort}:${electrumSSL}`}
        probe={testElectrum}
        disabled={electrumLoading || !electrumLoaded}
        label={t('serverConnection.electrumTest')}
        testID="electrum-connection"
      />
      {electrumError && (
        <Text
          style={sharedAccountStyles.fieldHint}
          testID="electrum-settings-error"
          accessibilityLiveRegion="polite"
        >
          {t(
            electrumLoaded
              ? 'serverConnection.electrumSaveError'
              : 'serverConnection.electrumLoadError',
          )}
        </Text>
      )}

      <SwapBackendSettings />
    </AccountScreenLayout>
  );
};

export default OnChainScreen;
