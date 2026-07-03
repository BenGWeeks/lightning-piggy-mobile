import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Check } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import type { Palette } from '../../styles/palettes';
import {
  getElectrumServer,
  setElectrumServer,
  getDefaultOnchainWalletId,
  setDefaultOnchainWalletId,
} from '../../services/walletStorageService';
import { disconnectElectrum } from '../../services/onchainService';
import { useWallet } from '../../contexts/WalletContext';

const DEFAULT_ELECTRUM = 'electrum.blockstream.info:50002';

const OnChainScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { wallets } = useWallet();
  const [electrumHostPort, setElectrumHostPort] = useState(DEFAULT_ELECTRUM);
  const [electrumSSL, setElectrumSSL] = useState(true);
  const [defaultOnchainId, setDefaultOnchainIdState] = useState<string | null>(null);

  // Onchain wallets the user could pick as default. Empty list = the section
  // renders an empty-state hint prompting the user to add an on-chain wallet.
  const onchainWallets = useMemo(
    () => wallets.filter((w) => w.walletType === 'onchain'),
    [wallets],
  );

  useEffect(() => {
    getElectrumServer().then((server) => {
      const parts = server.split(':');
      const protocol = parts.pop(); // 's' or 't'
      setElectrumHostPort(parts.join(':'));
      setElectrumSSL(protocol === 's');
    });
    getDefaultOnchainWalletId().then(setDefaultOnchainIdState);
  }, []);

  const handlePickDefault = async (walletId: string) => {
    // Toggle off if tapping the active default — falls back to first-onchain heuristic.
    const next = defaultOnchainId === walletId ? null : walletId;
    setDefaultOnchainIdState(next);
    await setDefaultOnchainWalletId(next);
  };

  const handleElectrumSave = async () => {
    const hostPort = electrumHostPort.trim() || DEFAULT_ELECTRUM;
    setElectrumHostPort(hostPort);
    const value = `${hostPort}:${electrumSSL ? 's' : 't'}`;
    await setElectrumServer(value);
    disconnectElectrum();
  };

  return (
    <AccountScreenLayout title={t('onChainScreen.title')}>
      <Text style={sharedAccountStyles.sectionLabel}>{t('onChainScreen.electrumServer')}</Text>
      <TextInput
        style={sharedAccountStyles.textInput}
        value={electrumHostPort}
        onChangeText={setElectrumHostPort}
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
            const hostPort = electrumHostPort.trim() || DEFAULT_ELECTRUM;
            setElectrumServer(`${hostPort}:${next ? 's' : 't'}`);
            disconnectElectrum();
          }}
          testID="electrum-ssl-toggle"
          accessibilityLabel={t('onChainScreen.useSsl')}
          accessibilityRole="switch"
          accessibilityState={{ checked: electrumSSL }}
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
                accessibilityState={{ checked: active }}
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
    </AccountScreenLayout>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    sectionGap: {
      marginTop: 28,
    },
    walletRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.divider,
      backgroundColor: colors.surface,
      marginBottom: 8,
    },
    walletRowActive: {
      borderColor: colors.brandPink,
      backgroundColor: colors.brandPinkLight,
    },
    walletName: {
      fontSize: 15,
      color: colors.textHeader,
      fontWeight: '500',
      flex: 1,
      marginRight: 8,
    },
    emptyHint: {
      fontStyle: 'italic',
      marginTop: 4,
    },
  });

export default OnChainScreen;
