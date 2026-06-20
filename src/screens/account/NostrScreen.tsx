import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { Alert } from '../../components/BrandedAlert';
import { useFocusEffect } from '@react-navigation/native';
import { X as XIcon } from 'lucide-react-native';
import AccountScreenLayout from './AccountScreenLayout';
import { createSharedAccountStyles } from './sharedStyles';
import {
  getBlossomServer,
  setBlossomServer,
  DEFAULT_BLOSSOM_SERVER,
} from '../../services/walletStorageService';
import * as amberService from '../../services/amberService';
import { DEFAULT_RELAYS, getRelayConnectionStatus } from '../../services/nostrService';
import { GC_RELAYS } from '../../services/geocacheRelays';
import { validateRelayUrl } from '../../services/nostrRelayStorage';
import { useNostr } from '../../contexts/NostrContext';
import { useNostrDmInbox } from '../../contexts/DmInboxContext';
import { useThemeColors } from '../../contexts/ThemeContext';
import { createNostrScreenStyles } from '../../styles/NostrScreen.styles';

type RelayRow = {
  url: string;
  /**
   * 'user' = user-added override only, removable from this screen.
   * 'default' = baked into the app, not removable here.
   * 'nip65' = published in the user's kind-10002 (NIP-65) list, no
   * matching user override (also not removable from this screen —
   * delete the kind-10002 event to drop these).
   * 'both-user-default' = covered by BOTH a user override and a
   * default; the user-added override means it's user-removable
   * (removing here strips the user row, the default still keeps it
   * in the merged list, but the user gets to "downgrade" any custom
   * read/write flags they added on top of the default).
   */
  source: 'user' | 'default' | 'nip65' | 'both-user-default';
  read: boolean;
  write: boolean;
  connected: boolean;
};

const NostrScreen: React.FC = () => {
  const colors = useThemeColors();
  const sharedAccountStyles = useMemo(() => createSharedAccountStyles(colors), [colors]);
  const styles = useMemo(() => createNostrScreenStyles(colors), [colors]);
  const { profile, signerType, relays, userRelays, addUserRelay, removeUserRelay } = useNostr();
  // From the hot DM slice, not `useNostr()` — see DmInboxContext for why.
  const { amberNip44Permission } = useNostrDmInbox();
  const [connStatus, setConnStatus] = useState<Map<string, boolean>>(new Map());
  const [newRelayInput, setNewRelayInput] = useState('');
  const [addRelayError, setAddRelayError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      const tick = () => setConnStatus(new Map(getRelayConnectionStatus()));
      tick();
      const id = setInterval(tick, 3000);
      return () => clearInterval(id);
    }, []),
  );

  const relayRows = useMemo<RelayRow[]>(() => {
    const userSet = new Set(userRelays.map((r) => r.url));
    const defaultSet = new Set<string>(DEFAULT_RELAYS);
    return relays.map((r) => {
      const inUser = userSet.has(r.url);
      const inDefault = defaultSet.has(r.url);
      let source: RelayRow['source'];
      if (inUser && inDefault) source = 'both-user-default';
      else if (inUser) source = 'user';
      else if (inDefault) source = 'default';
      else source = 'nip65';
      // NOTE: a "both-user-nip65" overlap (user explicitly re-added a
      // relay that's also in their NIP-65 list) collapses to plain
      // 'user' here — `relays` doesn't expose which entries came from
      // NIP-65 vs the merge, so we can't disambiguate. Functionally
      // equivalent: the user override row is still removable, and the
      // NIP-65 event itself isn't editable from this screen.
      return {
        url: r.url,
        source,
        read: r.read,
        write: r.write,
        connected: connStatus.get(r.url) === true,
      };
    });
  }, [relays, userRelays, connStatus]);

  // Geo-cache (NIP-GC kind-37516) relay set — surfaced as its own
  // sub-section, distinct from the generic relay list above. These are the
  // relays mobile treasures publish to and read from (#907): the nos.lol /
  // Damus backbone plus the two relays treasures.to uses for read +
  // NIP-50 search (ditto.pub, dreamith.to). The set is baked in and always
  // unioned into every NIP-GC publish/read, so it's shown read-only here.
  const gcRelayRows = useMemo(
    () => GC_RELAYS.map((url) => ({ url, connected: connStatus.get(url) === true })),
    [connStatus],
  );

  const handleAddRelay = useCallback(async () => {
    const result = validateRelayUrl(newRelayInput);
    if (!result.ok) {
      setAddRelayError(result.error);
      return;
    }
    setAddRelayError(null);
    try {
      await addUserRelay({ url: result.url, read: true, write: true });
      setNewRelayInput('');
    } catch (e) {
      setAddRelayError(e instanceof Error ? e.message : 'Failed to add relay.');
    }
  }, [addUserRelay, newRelayInput]);

  const handleRemoveRelay = useCallback(
    async (url: string) => {
      try {
        await removeUserRelay(url);
      } catch (e) {
        Alert.alert('Remove relay', e instanceof Error ? e.message : 'Failed to remove relay.');
      }
    },
    [removeUserRelay],
  );
  const [blossomServer, setBlossomServerInput] = useState(DEFAULT_BLOSSOM_SERVER);

  useEffect(() => {
    getBlossomServer().then(setBlossomServerInput);
  }, []);

  const handleBlossomSave = async () => {
    const normalized = blossomServer.trim() || DEFAULT_BLOSSOM_SERVER;
    setBlossomServerInput(normalized);
    await setBlossomServer(normalized);
  };

  const grantAmberNip44Permission = useCallback(async () => {
    if (!profile?.pubkey) throw new Error('No profile pubkey — log in first.');
    const probePlaintext = 'lightning-piggy-nip44-permission-probe';
    const ciphertext = await amberService.requestNip44Encrypt(
      probePlaintext,
      profile.pubkey,
      profile.pubkey,
    );
    const roundTrip = await amberService.requestNip44Decrypt(
      ciphertext,
      profile.pubkey,
      profile.pubkey,
    );
    if (roundTrip !== probePlaintext) {
      throw new Error('Amber round-trip mismatch — permission may not be set.');
    }
  }, [profile?.pubkey]);

  return (
    <AccountScreenLayout title="Nostr">
      <Text style={sharedAccountStyles.sectionLabel}>Relays</Text>
      <View style={styles.relayList}>
        {relayRows.map((r) => {
          const mode = r.read && r.write ? 'read/write' : r.write ? 'write' : 'read';
          const sourceLabel =
            r.source === 'both-user-default'
              ? 'user + default'
              : r.source === 'user'
                ? 'user'
                : r.source === 'nip65'
                  ? 'NIP-65'
                  : 'default';
          const removable = r.source === 'user' || r.source === 'both-user-default';
          return (
            <View key={r.url} style={styles.relayRow}>
              <View
                style={[
                  styles.statusDot,
                  { backgroundColor: r.connected ? colors.green : colors.red },
                ]}
                accessibilityLabel={r.connected ? 'Connected' : 'Disconnected'}
              />
              <View style={styles.relayMain}>
                <Text style={styles.relayUrl} numberOfLines={1} ellipsizeMode="middle">
                  {r.url}
                </Text>
                <Text style={styles.relaySource}>{sourceLabel}</Text>
              </View>
              <Text style={styles.relayMode}>{mode}</Text>
              {removable && (
                <TouchableOpacity
                  onPress={() => handleRemoveRelay(r.url)}
                  style={styles.removeButton}
                  testID={`relay-list-remove-${r.url}`}
                  accessibilityLabel={`Remove relay ${r.url}`}
                  accessibilityRole="button"
                  hitSlop={8}
                >
                  <XIcon size={16} color={colors.white} />
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>
      <View style={styles.addRelayRow}>
        <TextInput
          style={[sharedAccountStyles.textInput, styles.addRelayInput]}
          value={newRelayInput}
          onChangeText={(t) => {
            setNewRelayInput(t);
            if (addRelayError) setAddRelayError(null);
          }}
          placeholder="wss://relay.example.com"
          placeholderTextColor="rgba(0,0,0,0.3)"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          onSubmitEditing={handleAddRelay}
          testID="relay-list-add-input"
          accessibilityLabel="Add relay URL"
        />
        <TouchableOpacity
          style={styles.addRelayButton}
          onPress={handleAddRelay}
          testID="relay-list-add-button"
          accessibilityLabel="Add relay"
          accessibilityRole="button"
        >
          <Text style={styles.addRelayButtonText}>Add</Text>
        </TouchableOpacity>
      </View>
      {addRelayError && (
        <Text
          style={[sharedAccountStyles.fieldHint, { color: colors.brandPink }]}
          testID="relay-list-add-error"
        >
          {addRelayError}
        </Text>
      )}
      <Text style={sharedAccountStyles.fieldHint}>
        Green dot = currently connected. NIP-65 relays come from your published kind-10002 list;
        defaults are baked into the app and always tried as a fallback. Add your own relays above —
        they&apos;re saved on this device and used for the next subscription / publish.
      </Text>

      <Text style={[sharedAccountStyles.sectionLabel, { marginTop: 24 }]}>Geo-cache relays</Text>
      <View style={styles.relayList} testID="gc-relay-list">
        {gcRelayRows.map((r) => (
          <View key={r.url} style={styles.relayRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: r.connected ? colors.green : colors.red },
              ]}
              accessibilityLabel={r.connected ? 'Connected' : 'Disconnected'}
            />
            <View style={styles.relayMain}>
              <Text style={styles.relayUrl} numberOfLines={1} ellipsizeMode="middle">
                {r.url}
              </Text>
              <Text style={styles.relaySource}>geo-cache</Text>
            </View>
            <Text style={styles.relayMode}>read/write</Text>
          </View>
        ))}
      </View>
      <Text style={sharedAccountStyles.fieldHint}>
        Dedicated relays for Piglets and other geo-caches (NIP-GC). These mirror what the
        treasures.to web app reads and searches, so your Piglets stay discoverable on the web.
        They&apos;re always used for geo-cache publishing and reading, in addition to any relays you
        add above.
      </Text>

      <Text style={[sharedAccountStyles.sectionLabel, { marginTop: 24 }]}>
        Image Server (Blossom)
      </Text>
      <TextInput
        style={sharedAccountStyles.textInput}
        value={blossomServer}
        onChangeText={setBlossomServerInput}
        placeholder={DEFAULT_BLOSSOM_SERVER}
        placeholderTextColor="rgba(0,0,0,0.3)"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        onBlur={handleBlossomSave}
        testID="blossom-server-input"
        accessibilityLabel="Blossom image server"
      />
      <Text style={sharedAccountStyles.fieldHint}>
        Hosts images you send in chats and set as your profile picture. Any Blossom (BUD-01/BUD-02)
        server works — e.g. blossom.primal.net or nostr.build.
      </Text>

      {signerType === 'amber' && amberNip44Permission === 'denied' && (
        <>
          <Text style={[sharedAccountStyles.sectionLabel, { marginTop: 24 }]}>
            Encrypted Messages (NIP-17)
          </Text>
          <Text style={[sharedAccountStyles.fieldHint, { color: colors.brandPink }]}>
            Amber hasn&apos;t granted NIP-44 decrypt permission to this app yet — tap below to grant
            it. One dialog, then subsequent encrypted messages decrypt silently. Messages from
            people you don&apos;t follow stay hidden either way.
          </Text>
          <TouchableOpacity
            style={[sharedAccountStyles.saveButton, { marginTop: 8 }]}
            onPress={async () => {
              try {
                await grantAmberNip44Permission();
              } catch (e) {
                Alert.alert(
                  'Amber permission',
                  e instanceof Error ? e.message : 'Could not grant NIP-44 permission.',
                );
              }
            }}
            accessibilityLabel="Grant Amber NIP-44 permission"
            testID="amber-nip17-grant"
          >
            <Text style={sharedAccountStyles.saveButtonText}>Grant permission in Amber</Text>
          </TouchableOpacity>
        </>
      )}
    </AccountScreenLayout>
  );
};

export default NostrScreen;
