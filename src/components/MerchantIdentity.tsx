import React, { useMemo, useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useNostr } from '../contexts/NostrContext';
import { useTranslation } from '../contexts/LocaleContext';
import { useThemeColors } from '../contexts/ThemeContext';
import { createMarketSellerStyles } from '../styles/MarketSeller.styles';
import EditProfileSheet from './EditProfileSheet';
import { safeMarketUrl } from '../utils/marketListings';

const MerchantIdentity: React.FC = () => {
  const { profile, pubkey } = useNostr();
  const t = useTranslation();
  const colors = useThemeColors();
  const styles = useMemo(() => createMarketSellerStyles(colors), [colors]);
  const [editing, setEditing] = useState(false);
  const picture = safeMarketUrl(profile?.picture);
  return (
    <View style={styles.field} testID="merchant-identity">
      {picture ? (
        <Image
          source={{ uri: picture }}
          style={styles.merchantAvatar}
          cachePolicy="memory-disk"
          testID="merchant-picture"
        />
      ) : null}
      <Text style={styles.cardTitle} testID="merchant-name">
        {profile?.displayName || profile?.name || pubkey}
      </Text>
      <Text style={styles.hint} testID="merchant-account-hint">
        {t('market.sell.identityHint')}
      </Text>
      <TouchableOpacity
        style={styles.secondaryButton}
        onPress={() => setEditing(true)}
        testID="merchant-edit-profile"
      >
        <Text style={styles.secondaryButtonText}>{t('profileScreen.editProfile')}</Text>
      </TouchableOpacity>
      <EditProfileSheet visible={editing} onClose={() => setEditing(false)} />
    </View>
  );
};
export default React.memo(MerchantIdentity);
