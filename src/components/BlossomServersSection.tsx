import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { X as XIcon } from 'lucide-react-native';
import { Alert } from './BrandedAlert';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import { createPublishedRelayListsSectionStyles } from '../styles/PublishedRelayListsSection.styles';
import { createBlossomServersSectionStyles } from '../styles/BlossomServersSection.styles';
import { useBlossomServerList } from '../hooks/useBlossomServerList';

/**
 * Image servers (Blossom, #1149): the primary stores uploads; backups get a
 * mirrored copy so media survives one server going down.
 */
export default function BlossomServersSection() {
  const colors = useThemeColors();
  const t = useTranslation();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const list = useMemo(() => createPublishedRelayListsSectionStyles(colors), [colors]);
  const styles = useMemo(() => createBlossomServersSectionStyles(colors), [colors]);
  const { servers, dirty, publishing, addServer, removeServer, makePrimary, publish } =
    useBlossomServerList();
  const [input, setInput] = useState('');
  const [error, setError] = useState(false);

  const submit = () => {
    if (!input.trim()) return;
    if (addServer(input)) {
      setInput('');
      setError(false);
    } else setError(true);
  };

  const onPublish = async () => {
    const outcome = await publish();
    if (outcome.ok)
      Alert.alert(
        t('blossomServers.publishedTitle'),
        t('blossomServers.acceptedCount', { accepted: outcome.accepted, total: outcome.total }),
      );
    else
      Alert.alert(
        t('blossomServers.notPublishedTitle'),
        t(`blossomServers.error.${outcome.error}`),
      );
  };

  return (
    <View testID="blossom-servers">
      <Text style={[shared.sectionLabel, { marginTop: 24 }]}>{t('blossomServers.title')}</Text>
      <Text style={shared.fieldHint}>{t('blossomServers.intro')}</Text>
      <View style={list.list} testID="blossom-server-list">
        {servers.map((url, i) => (
          <View key={url} style={list.row}>
            <View style={list.urlColumn}>
              <Text style={list.url} numberOfLines={1} ellipsizeMode="middle">
                {url}
              </Text>
            </View>
            {i === 0 ? (
              <View style={styles.primaryBadge} testID={`blossom-primary-${url}`}>
                <Text style={styles.primaryBadgeText}>{t('blossomServers.primary')}</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={styles.makePrimary}
                onPress={() => makePrimary(url)}
                accessibilityRole="button"
                accessibilityLabel={t('blossomServers.makePrimaryLabel', { url })}
                testID={`blossom-make-primary-${url}`}
              >
                <Text style={styles.makePrimaryText}>{t('blossomServers.makePrimary')}</Text>
              </TouchableOpacity>
            )}
            {servers.length > 1 && (
              <TouchableOpacity
                style={list.removeButton}
                onPress={() => removeServer(url)}
                accessibilityRole="button"
                accessibilityLabel={t('blossomServers.removeLabel', { url })}
                testID={`blossom-remove-${url}`}
                hitSlop={8}
              >
                <XIcon size={16} color={colors.white} />
              </TouchableOpacity>
            )}
          </View>
        ))}
      </View>
      <View style={list.addRow}>
        <TextInput
          style={[shared.textInput, list.addInput]}
          value={input}
          onChangeText={(v) => {
            setInput(v);
            if (error) setError(false);
          }}
          placeholder="https://blossom.example.com"
          placeholderTextColor="rgba(0,0,0,0.3)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={submit}
          testID="blossom-add-input"
          accessibilityLabel={t('blossomServers.addLabel')}
        />
        <TouchableOpacity
          style={list.addButton}
          onPress={submit}
          accessibilityRole="button"
          accessibilityLabel={t('blossomServers.addLabel')}
          testID="blossom-add-button"
        >
          <Text style={list.addButtonText}>{t('blossomServers.add')}</Text>
        </TouchableOpacity>
      </View>
      {error && (
        <Text style={[shared.fieldHint, { color: colors.white }]} testID="blossom-add-error">
          {t('blossomServers.invalid')}
        </Text>
      )}
      <Text style={shared.fieldHint}>{t('blossomServers.hint')}</Text>
      <TouchableOpacity
        style={[list.publishButton, (!dirty || publishing) && list.publishButtonDisabled]}
        onPress={() => void onPublish()}
        disabled={!dirty || publishing}
        accessibilityRole="button"
        accessibilityState={{ disabled: !dirty || publishing, busy: publishing }}
        accessibilityLabel={t('blossomServers.publish')}
        testID="blossom-publish"
      >
        {publishing ? (
          <ActivityIndicator color={colors.brandPink} />
        ) : (
          <Text style={list.publishButtonText}>{t('blossomServers.publish')}</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}
