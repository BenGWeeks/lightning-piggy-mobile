import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { X as XIcon } from 'lucide-react-native';
import { Alert } from './BrandedAlert';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTranslation } from '../contexts/LocaleContext';
import { createSharedAccountStyles } from '../screens/account/sharedStyles';
import {
  createPublishedRelayListsSectionStyles,
  type PublishedRelayListsSectionStyles,
} from '../styles/PublishedRelayListsSection.styles';
import { useRelayListEditor, type RelayListPublishOutcome } from '../hooks/useRelayListEditor';
import { isPublishableRelayUrl } from '../utils/relayListEvents';

type T = ReturnType<typeof useTranslation>;

/** URL input + Add button; reports invalid (non-public) URLs inline. */
function AddRelayInput({
  onAdd,
  editable,
  testIDPrefix,
  styles,
  t,
}: {
  onAdd: (url: string) => boolean;
  editable: boolean;
  testIDPrefix: string;
  styles: PublishedRelayListsSectionStyles;
  t: T;
}) {
  const colors = useThemeColors();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const submit = () => {
    if (!value.trim()) return;
    if (onAdd(value)) {
      setValue('');
      setError(false);
    } else setError(true);
  };
  return (
    <>
      <View style={styles.addRow}>
        <TextInput
          style={[shared.textInput, styles.addInput]}
          value={value}
          onChangeText={(v) => {
            setValue(v);
            if (error) setError(false);
          }}
          placeholder="wss://relay.example.com"
          placeholderTextColor="rgba(0,0,0,0.3)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={submit}
          editable={editable}
          testID={`${testIDPrefix}-add-input`}
          accessibilityLabel={t('publishedRelays.addUrlLabel')}
        />
        <TouchableOpacity
          style={[styles.addButton, !editable && styles.publishButtonDisabled]}
          onPress={submit}
          disabled={!editable}
          testID={`${testIDPrefix}-add-button`}
          accessibilityState={{ disabled: !editable }}
          accessibilityRole="button"
          accessibilityLabel={t('publishedRelays.addLabel')}
        >
          <Text style={styles.addButtonText}>{t('publishedRelays.add')}</Text>
        </TouchableOpacity>
      </View>
      {error && (
        <Text
          style={[shared.fieldHint, { color: colors.brandPink }]}
          testID={`${testIDPrefix}-add-error`}
        >
          {t('publishedRelays.invalidUrl')}
        </Text>
      )}
    </>
  );
}

function PublishButton({
  onPress,
  disabled,
  busy,
  testID,
  styles,
  t,
}: {
  onPress: () => void;
  disabled: boolean;
  busy: boolean;
  testID: string;
  styles: PublishedRelayListsSectionStyles;
  t: T;
}) {
  return (
    <TouchableOpacity
      style={[styles.publishButton, (disabled || busy) && styles.publishButtonDisabled]}
      onPress={onPress}
      disabled={disabled || busy}
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy, busy }}
      accessibilityLabel={t('publishedRelays.publish')}
    >
      {busy ? (
        <ActivityIndicator />
      ) : (
        <Text style={styles.publishButtonText}>{t('publishedRelays.publish')}</Text>
      )}
    </TouchableOpacity>
  );
}

/**
 * Edit and publish the user's PUBLIC relay lists — NIP-65 (where other apps
 * read/write their posts) and the NIP-17 DM inbox (where others send DMs).
 * Unlike the in-app relay overrides above it, these are signed and published.
 */
export default function PublishedRelayListsSection() {
  const colors = useThemeColors();
  const t = useTranslation();
  const shared = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createPublishedRelayListsSectionStyles(colors), [colors]);
  const editor = useRelayListEditor();

  const report = useCallback(
    (outcome: RelayListPublishOutcome) => {
      if (!outcome.ok && (!outcome.results || outcome.error === 'superseded')) {
        Alert.alert(
          t('publishedRelays.notPublishedTitle'),
          t(`publishedRelays.error.${outcome.error}`),
        );
        return;
      }
      const results = outcome.results ?? [];
      const accepted = results.filter((r) => r.ok).length;
      const failures = results
        .filter((r) => !r.ok)
        .map((r) => `• ${r.url.replace('wss://', '')}: ${r.message ?? '—'}`)
        .join('\n');
      Alert.alert(
        outcome.ok ? t('publishedRelays.publishedTitle') : t('publishedRelays.notPublishedTitle'),
        [t('publishedRelays.acceptedCount', { accepted, total: results.length }), failures]
          .filter(Boolean)
          .join('\n\n'),
      );
    },
    [t],
  );

  const confirmPublish = useCallback(
    (which: 'nip65' | 'inbox') => {
      Alert.alert(
        t(
          which === 'nip65'
            ? 'publishedRelays.confirmNip65Title'
            : 'publishedRelays.confirmInboxTitle',
        ),
        t('publishedRelays.confirmBody'),
        [
          { text: t('publishedRelays.cancel'), style: 'cancel' },
          {
            text: t('publishedRelays.publish'),
            onPress: async () =>
              report(await (which === 'nip65' ? editor.publishNip65() : editor.publishInbox())),
          },
        ],
      );
    },
    [editor, report, t],
  );

  const pill = (on: boolean, label: string, onPress: () => void, testID: string) => (
    <TouchableOpacity
      style={[
        styles.pill,
        on && styles.pillOn,
        !editor.nip65Editable && styles.publishButtonDisabled,
      ]}
      onPress={onPress}
      disabled={!editor.nip65Editable}
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: !editor.nip65Editable }}
      accessibilityLabel={label}
      hitSlop={6}
    >
      <Text style={[styles.pillText, on && styles.pillTextOn]}>{label}</Text>
    </TouchableOpacity>
  );

  const removeButton = (url: string, testID: string) => {
    const editable = testID.startsWith('nip65') ? editor.nip65Editable : editor.inboxEditable;
    return (
      <TouchableOpacity
        style={[styles.removeButton, !editable && styles.publishButtonDisabled]}
        disabled={!editable}
        onPress={() =>
          testID.startsWith('nip65') ? editor.removeNip65(url) : editor.removeInbox(url)
        }
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={t('publishedRelays.removeLabel', { url })}
        hitSlop={8}
      >
        <XIcon size={16} color={colors.white} />
      </TouchableOpacity>
    );
  };

  return (
    <View testID="published-relay-lists">
      <Text style={[shared.sectionLabel, { marginTop: 24 }]}>{t('publishedRelays.title')}</Text>
      <Text style={shared.fieldHint}>{t('publishedRelays.intro')}</Text>

      <Text style={[shared.sectionLabel, { marginTop: 12 }]}>
        {t('publishedRelays.nip65Title')}
      </Text>
      <View style={styles.list} testID="nip65-relay-list">
        {editor.nip65Loading ? (
          <ActivityIndicator style={{ paddingVertical: 10 }} testID="nip65-loading" />
        ) : (
          editor.nip65Draft.length === 0 && (
            <Text style={styles.empty}>{t('publishedRelays.nip65Empty')}</Text>
          )
        )}
        {editor.nip65Draft.map((r) => (
          <View key={r.url} style={styles.row}>
            <View style={styles.urlColumn}>
              <Text style={styles.url} numberOfLines={1} ellipsizeMode="middle">
                {r.url}
              </Text>
              {!isPublishableRelayUrl(r.url) && (
                <Text style={styles.urlWarning}>{t('publishedRelays.notPublishable')}</Text>
              )}
            </View>
            {pill(
              r.read,
              t('publishedRelays.read'),
              () => editor.toggleNip65(r.url, 'read'),
              `nip65-read-${r.url}`,
            )}
            {pill(
              r.write,
              t('publishedRelays.write'),
              () => editor.toggleNip65(r.url, 'write'),
              `nip65-write-${r.url}`,
            )}
            {removeButton(r.url, `nip65-remove-${r.url}`)}
          </View>
        ))}
      </View>
      <AddRelayInput
        onAdd={editor.addNip65}
        editable={editor.nip65Editable}
        testIDPrefix="nip65"
        styles={styles}
        t={t}
      />
      <Text style={shared.fieldHint}>{t('publishedRelays.nip65Hint')}</Text>
      <PublishButton
        onPress={() => confirmPublish('nip65')}
        disabled={!editor.nip65Dirty || editor.nip65Loading}
        busy={editor.publishing === 'nip65'}
        testID="nip65-publish"
        styles={styles}
        t={t}
      />

      <Text style={[shared.sectionLabel, { marginTop: 24 }]}>
        {t('publishedRelays.inboxTitle')}
      </Text>
      <View style={styles.list} testID="inbox-relay-list">
        {editor.inboxLoading ? (
          <ActivityIndicator style={{ paddingVertical: 10 }} />
        ) : (
          editor.inboxDraft.length === 0 && (
            <Text style={styles.empty}>{t('publishedRelays.inboxEmpty')}</Text>
          )
        )}
        {editor.inboxDraft.map((url) => (
          <View key={url} style={styles.row}>
            <View style={styles.urlColumn}>
              <Text style={styles.url} numberOfLines={1} ellipsizeMode="middle">
                {url}
              </Text>
            </View>
            {removeButton(url, `inbox-remove-${url}`)}
          </View>
        ))}
      </View>
      <AddRelayInput
        onAdd={editor.addInbox}
        editable={editor.inboxEditable}
        testIDPrefix="inbox"
        styles={styles}
        t={t}
      />
      <Text style={shared.fieldHint}>{t('publishedRelays.inboxHint')}</Text>
      <PublishButton
        onPress={() => confirmPublish('inbox')}
        disabled={!editor.inboxDirty || editor.inboxLoading}
        busy={editor.publishing === 'inbox'}
        testID="inbox-publish"
        styles={styles}
        t={t}
      />
    </View>
  );
}
