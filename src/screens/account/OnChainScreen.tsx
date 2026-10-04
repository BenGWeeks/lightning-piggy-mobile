import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Check } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { createOnChainScreenStyles } from '../../styles/OnChainScreen.styles';
import SwapBackendSettings from '../../components/SwapBackendSettings';
import {
  getElectrumServer,
  getDefaultOnchainWalletId,
  setDefaultOnchainWalletId,
} from '../../services/walletStorageService';
import ServerConnectionTest from '../../components/ServerConnectionTest';
import {
  checkElectrumConnection,
  saveElectrumSetting,
} from '../../services/onchainConnectionService';
import { useWallet } from '../../contexts/WalletContext';

const DEFAULT_ELECTRUM = 'electrum.blockstream.info:50002';

const OnChainScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createOnChainScreenStyles(colors), [colors]);
  const { wallets } = useWallet();
  const [electrumHostPort, setElectrumHostPort] = useState(DEFAULT_ELECTRUM);
  const [electrumSSL, setElectrumSSL] = useState(true);
  const [electrumLoading, setElectrumLoading] = useState(true);
  const [electrumLoaded, setElectrumLoaded] = useState(false);
  const [electrumError, setElectrumError] = useState(false);
  const electrumWrite = useRef(0);
  const mounted = useRef(true);
  const [defaultOnchainId, setDefaultOnchainIdState] = useState<string | null>(null);

  // Onchain wallets the user could pick as default. Empty list = the section
  // renders an empty-state hint prompting the user to add an on-chain wallet.
  const onchainWallets = useMemo(
    () => wallets.filter((w) => w.walletType === 'onchain'),
    [wallets],
  );

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
    getDefaultOnchainWalletId()
      .then(setDefaultOnchainIdState)
      .catch((err) => {
        // AsyncStorage read can throw (corruption/full disk). Fall back to no
        // default (null) rather than surfacing an unhandled promise rejection.
        console.warn('Failed to read default on-chain wallet id', err);
        setDefaultOnchainIdState(null);
      });
    return () => {
      mounted.current = false;
    };
  }, []);

  const handlePickDefault = async (walletId: string) => {
    // Toggle off if tapping the active default — falls back to first-onchain heuristic.
    const prev = defaultOnchainId;
    const next = defaultOnchainId === walletId ? null : walletId;
    setDefaultOnchainIdState(next);
    try {
      await setDefaultOnchainWalletId(next);
    } catch (err) {
      // AsyncStorage write can reject (corruption/full disk). Don't let it
      // surface as an unhandled rejection, and revert the optimistic UI state
      // so we don't show a selection that wasn't actually persisted.
      console.warn('Failed to persist default on-chain wallet id', err);
      setDefaultOnchainIdState(prev);
    }
  };

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
    <AccountScreenLayout title={t('onChainScreen.title')}>
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

      <Text style={[sharedAccountStyles.sectionLabel, styles.sectionGap]}>
        {t('onChainScreen.defaultWalletTitle')}
      </Text>
      {onchainWallets.length === 0 ? (
        <Text style={[sharedAccountStyles.fieldHint, styles.emptyHint]}>
          {t('onChainScreen.defaultWalletEmpty')}
        </Text>
      ) : (
        <>
          {onchainWallets.map((w) => {
            const active = w.id === defaultOnchainId;
            return (
              <TouchableOpacity
                key={w.id}
                style={[styles.walletRow, active && styles.walletRowActive]}
                onPress={() => handlePickDefault(w.id)}
                testID={`default-onchain-row-${w.id}`}
                accessibilityLabel={t('onChainScreen.defaultWalletRowA11y', {
                  wallet: w.alias || t('onChainScreen.walletFallback'),
                })}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
              >
                <Text style={styles.walletName} numberOfLines={1}>
                  {w.alias || w.id.slice(0, 8)}
                </Text>
                {active && <Check size={18} color={colors.brandPink} />}
              </TouchableOpacity>
            );
          })}
          <Text style={sharedAccountStyles.fieldHint}>{t('onChainScreen.defaultWalletHint')}</Text>
        </>
      )}
      <SwapBackendSettings />
    </AccountScreenLayout>
  );
};

export default OnChainScreen;
