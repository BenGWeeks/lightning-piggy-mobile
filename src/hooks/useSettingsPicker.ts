import { useCallback, useRef } from 'react';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import type { AccountDrawerNavigation, RootNavigation } from '../navigation/types';
import type { SettingsPickerOption } from '../utils/settingsPicker';

/** Route results stay with the account that opened the presentation-only picker. */
export function useSettingsPicker(owner: string | null, onSelect: (value: string) => void) {
  const navigation = useNavigation<AccountDrawerNavigation>();
  const route = useRoute();
  const openedFor = useRef<{ owner: string | null } | null>(null);
  const previousOwner = useRef(owner);
  if (previousOwner.current !== owner) {
    previousOwner.current = owner;
    openedFor.current = null;
  }
  const params = route.params as { settingsSelection?: string } | undefined;
  const selection = params?.settingsSelection;
  useFocusEffect(
    useCallback(() => {
      if (selection === undefined) return;
      navigation.setParams({ settingsSelection: undefined } as never);
      const opening = openedFor.current;
      openedFor.current = null;
      if (opening?.owner === owner) onSelect(selection);
    }, [navigation, selection, owner, onSelect]),
  );
  return (args: {
    title: string;
    selectedValue: string;
    options: readonly SettingsPickerOption[];
    testID: string;
    searchable?: boolean;
    customOption?: SettingsPickerOption;
  }) => {
    openedFor.current = { owner };
    navigation.getParent<RootNavigation>()?.navigate('SettingsPicker', {
      ...args,
      returnTo: {
        routeKey: route.key,
        navigatorKey: navigation.getState().key,
        param: 'settingsSelection',
      },
    });
  };
}
