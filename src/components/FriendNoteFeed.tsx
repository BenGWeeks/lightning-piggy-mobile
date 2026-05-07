import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import NotePreview from './NotePreview';
import { subscribeAuthorNotes, type RawAuthorNote } from '../services/nostrService';
import { useNostr } from '../contexts/NostrContext';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';

// Embeds a friend's recent kind-1 notes below the profile description
// on ContactProfileScreen. Subscribes once on mount, captures up to
// `limit` events (default 30, render-cap 20), sorts desc by created_at,
// and renders them via NotePreview cards in a FlashList. Shows a small
// inline spinner while events are streaming and "No posts yet" after a
// FIRST_EVENT_GRACE_MS timer expires with no events received (the
// subscription stays open in the background even after the grace fires).
interface Props {
  authorPubkey: string;
  limit?: number;
}

const RENDER_CAP = 20;
// Closes the spinner after this long even if no events arrived — the
// sub stays open in the background but the UI shifts to the empty state.
const FIRST_EVENT_GRACE_MS = 6000;

const FriendNoteFeed: React.FC<Props> = ({ authorPubkey, limit = 30 }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { relays } = useNostr();
  const [notes, setNotes] = useState<RawAuthorNote[]>([]);
  const [loading, setLoading] = useState(true);
  const mountTimeRef = useRef<number>(Date.now());
  const firstEventLoggedRef = useRef(false);

  // Read relays drive the sub; if the user has no NIP-65 list we fall
  // through to the empty-state branch rather than fanning out a fresh
  // SimplePool against DEFAULT_RELAYS — the dedicated subscribe helper
  // already calls trackRelays() on whatever it's given.
  const readRelays = useMemo(() => relays.filter((r) => r.read).map((r) => r.url), [relays]);

  useEffect(() => {
    if (!authorPubkey || readRelays.length === 0) {
      setLoading(false);
      return;
    }
    mountTimeRef.current = Date.now();
    firstEventLoggedRef.current = false;
    setLoading(true);
    setNotes([]);

    const seen = new Set<string>();
    const unsubscribe = subscribeAuthorNotes({
      authorPubkey,
      relays: readRelays,
      limit,
      onEvent: (note) => {
        if (seen.has(note.id)) return;
        seen.add(note.id);
        if (__DEV__ && !firstEventLoggedRef.current) {
          firstEventLoggedRef.current = true;
          console.log(
            `[Perf] ContactProfileScreen feed first event: ${Date.now() - mountTimeRef.current}ms`,
          );
        }
        setNotes((prev) => {
          const next = [...prev, note];
          next.sort((a, b) => b.created_at - a.created_at);
          return next.slice(0, RENDER_CAP);
        });
        setLoading(false);
      },
    });

    // Grace timer to drop the spinner so the user sees "No posts yet"
    // rather than a perpetual loader on quiet pubkeys.
    const graceTimer = setTimeout(() => {
      setLoading(false);
    }, FIRST_EVENT_GRACE_MS);

    return () => {
      clearTimeout(graceTimer);
      unsubscribe();
    };
  }, [authorPubkey, readRelays, limit]);

  if (!authorPubkey) return null;

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Recent posts</Text>
      {loading && notes.length === 0 ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={colors.brandPink} />
        </View>
      ) : notes.length === 0 ? (
        <Text style={styles.emptyText} testID="contact-profile-feed-empty">
          No posts yet
        </Text>
      ) : (
        <FlashList
          data={notes}
          keyExtractor={(item) => item.id}
          scrollEnabled={false}
          renderItem={({ item, index }) => (
            <NotePreview
              content={item.content}
              createdAt={item.created_at}
              testID={`contact-profile-note-card-${index}`}
            />
          )}
        />
      )}
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: {
      width: '100%',
      paddingHorizontal: 16,
      marginTop: 16,
    },
    heading: {
      fontSize: 14,
      fontWeight: '700',
      color: colors.textHeader,
      marginBottom: 10,
    },
    loadingRow: {
      paddingVertical: 24,
      alignItems: 'center',
    },
    emptyText: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      paddingVertical: 24,
    },
  });

export default FriendNoteFeed;
