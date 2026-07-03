import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { getElectrumServer, setElectrumServer } from '../../services/walletStorageService';
import { disconnectElectrum } from '../../services/onchainService';

const DEFAULT_ELECTRUM = 'electrum.blockstream.info:50002';

const OnChainScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const [electrumHostPort, setElectrumHostPort] = useState(DEFAULT_ELECTRUM);
  const [electrumSSL, setElectrumSSL] = useState(true);

  useEffect(() => {
    getElectrumServer().then((server) => {
      const parts = server.split(':');
      const protocol = parts.pop(); // 's' or 't'
      setElectrumHostPort(parts.join(':'));
      setElectrumSSL(protocol === 's');
    });
  }, []);

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
    </AccountScreenLayout>
  );
};

export default OnChainScreen;
