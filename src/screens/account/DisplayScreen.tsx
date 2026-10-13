import React, { useDeferredValue, useMemo, useState } from 'react';
import { View, Text, TextInput, FlatList } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Search } from 'lucide-react-native';
import SettingsPickerOptionRow from '../../components/SettingsPickerOptionRow';
import AccountScreenLayout from './AccountScreenLayout';
import { useWallet } from '../../contexts/WalletContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useTranslation } from '../../contexts/LocaleContext';
import { createDisplayScreenStyles } from '../../styles/DisplayScreen.styles';
import { CURRENCY_LIST, type CurrencyInfo } from '../../services/fiatService';
import type { AccountDrawerNavigation } from '../../navigation/types';

// Substring match against code OR name (case-insensitive). Mirrors the
// Wallet of Satoshi picker pattern — typing "kr" matches both "KRW" and
// "Danish Krone".
const filterCurrencies = (query: string): readonly CurrencyInfo[] => {
  const q = query.trim().toLowerCase();
  if (!q) return CURRENCY_LIST;
  return CURRENCY_LIST.filter(
    (c) => c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
  );
};

const DisplayScreen: React.FC = () => {
  const colors = useThemeColors();
  const t = useTranslation();
  const styles = useMemo(() => createDisplayScreenStyles(colors), [colors]);
  const { currency, setCurrency } = useWallet();
  const navigation = useNavigation<AccountDrawerNavigation>();
  const [search, setSearch] = useState('');
  // Defer the filter pass off the keystroke so the input stays responsive
  // even with 38 rows re-rendering. Same pattern as FriendPickerSheet.
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => filterCurrencies(deferredSearch), [deferredSearch]);

  // Picking a currency finishes the job: go straight back to Display &
  // language (where the row shows the new choice) rather than leaving the
  // user on a 38-row list with no "Done".
  const handlePick = (code: CurrencyInfo['code']) => {
    void setCurrency(code);
    setSearch('');
    navigation.navigate('AccountDisplayLanguage');
  };

  const renderItem = ({ item }: { item: CurrencyInfo }) => (
    <SettingsPickerOptionRow
      option={{
        value: item.code,
        label: t('settingsScreens.currencyValue', { code: item.code, name: item.name }),
      }}
      selected={item.code === currency}
      onSelect={(value) => handlePick(value as CurrencyInfo['code'])}
      testID={`currency-${item.code}`}
    />
  );

  // Render the section label + search input inside the FlatList header
  // so the FlatList is the only scrollable surface on this screen and
  // RN doesn't warn about VirtualizedList nested inside a ScrollView.
  const listHeader = (
    <>
      <View style={styles.searchRow}>
        <Search size={18} color={colors.textSupplementary} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder={t('displayScreen.searchPlaceholder')}
          placeholderTextColor={colors.textSupplementary}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel={t('displayScreen.searchCurrencies')}
          testID="currency-search"
        />
      </View>
    </>
  );

  return (
    <AccountScreenLayout
      title={t('displayScreen.currency')}
      scrollable={false}
      parent="AccountDisplayLanguage"
    >
      <View style={styles.listCard}>
        <FlatList
          data={filtered}
          keyExtractor={(c) => c.code}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyText}>{t('displayScreen.noMatch')}</Text>
            </View>
          }
          keyboardShouldPersistTaps="handled"
          // Show the active currency on first paint without an extra scroll.
          // Off-screen rows still mount lazily via FlatList's windowing.
          initialNumToRender={12}
        />
      </View>
    </AccountScreenLayout>
  );
};

export default DisplayScreen;
