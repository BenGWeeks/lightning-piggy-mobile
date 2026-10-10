import React, { memo, useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, Text, TouchableOpacity, View } from 'react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { useThemeColors } from '../../contexts/ThemeContext';
import { useLocale } from '../../contexts/LocaleContext';
import { useInvitationKeys } from '../../hooks/useInvitationKeys';
import type { InvitationKey } from '../../services/marmotInvitationKeys';
import {
  createInvitationKeysScreenStyles,
  type InvitationKeysStyles,
} from '../../styles/InvitationKeysScreen.styles';

const KeyRow = memo(function KeyRow({
  item,
  first,
  styles,
  disabled,
  onRemove,
}: {
  item: InvitationKey;
  first: boolean;
  styles: InvitationKeysStyles;
  disabled: boolean;
  onRemove: (key: InvitationKey) => void;
}) {
  const { t, locale } = useLocale();
  const label = item.thisPhone
    ? t('invitationKeys.thisPhone')
    : /white noise/i.test(item.client)
      ? 'White Noise Android'
      : /lightning piggy/i.test(item.client)
        ? t('invitationKeys.otherDevice')
        : item.client || t('invitationKeys.unknownClient');
  const date = (seconds: number) => new Date(seconds * 1000).toLocaleString(locale);
  return (
    <View>
      {first && (
        <Text style={styles.slot}>
          {t('invitationKeys.slot', { slot: item.slot.slice(0, 12) })}
        </Text>
      )}
      <View style={styles.card} testID={`invitation-key-${item.event.id}`}>
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.text}>
          {t('invitationKeys.published', { date: date(item.event.created_at) })}
        </Text>
        <Text style={styles.text}>
          {t('invitationKeys.expires', {
            date: item.expires ? date(item.expires) : t('invitationKeys.unknownExpiry'),
          })}
        </Text>
        <Text style={styles.detail}>
          {t('invitationKeys.relays', { relays: item.relays.join('\n') })}
        </Text>
        <TouchableOpacity
          accessibilityRole="button"
          disabled={disabled}
          style={[styles.button, disabled && styles.disabled]}
          onPress={() => onRemove(item)}
          testID={`invitation-key-remove-${item.event.id}`}
        >
          <Text style={styles.buttonText}>{t('invitationKeys.remove')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});
const keyExtractor = (item: InvitationKey) => item.event.id;
export default function InvitationKeysScreen() {
  const colors = useThemeColors();
  const { t } = useLocale();
  const styles = useMemo(() => createInvitationKeysScreenStyles(colors), [colors]);
  const state = useInvitationKeys();
  const disabled = state.busy || state.loading;
  const renderItem = useCallback(
    ({ item, index }: { item: InvitationKey; index: number }) => (
      <KeyRow
        item={item}
        first={!index || state.keys[index - 1].slot !== item.slot}
        styles={styles}
        disabled={disabled}
        onRemove={state.remove}
      />
    ),
    [state.keys, state.remove, styles, disabled],
  );
  const header = (
    <View style={styles.header}>
      <Text style={styles.text}>{t('invitationKeys.description')}</Text>
      {state.paused && (
        <Text style={styles.text} testID="invitation-keys-paused">
          {t('invitationKeys.paused')}
        </Text>
      )}
      <TouchableOpacity
        accessibilityRole="button"
        testID="invitation-keys-refresh"
        style={[styles.button, disabled && styles.disabled]}
        disabled={disabled}
        onPress={state.refresh}
      >
        <Text style={styles.buttonText}>{t('invitationKeys.refresh')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        testID="invitation-keys-remove-old"
        style={[styles.button, (disabled || !state.oldCount) && styles.disabled]}
        disabled={disabled || !state.oldCount}
        onPress={state.removeOld}
      >
        <Text style={styles.buttonText}>{t('invitationKeys.removeOld')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        testID="invitation-keys-reload"
        style={[styles.button, disabled && styles.disabled]}
        disabled={disabled}
        onPress={state.reload}
      >
        <Text style={styles.buttonText}>{t('invitationKeys.reload')}</Text>
      </TouchableOpacity>
      {state.partial && <Text style={styles.text}>{t('invitationKeys.partial')}</Text>}
      {state.error && (
        <Text style={styles.text} testID="invitation-keys-error">
          {t('invitationKeys.loadFailed')}
        </Text>
      )}
      {(state.loading || state.busy) && (
        <ActivityIndicator color={colors.white} testID="invitation-keys-loading" />
      )}
    </View>
  );
  return (
    <AccountScreenLayout title={t('invitationKeys.title')} scrollable={false}>
      <FlatList
        testID="invitation-keys-list"
        style={styles.list}
        contentContainerStyle={styles.content}
        data={state.keys}
        renderItem={renderItem}
        keyExtractor={keyExtractor}
        ListHeaderComponent={header}
        ListEmptyComponent={
          !state.loading && !state.error ? (
            <Text style={styles.text}>{t('invitationKeys.empty')}</Text>
          ) : null
        }
      />
    </AccountScreenLayout>
  );
}
