import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { fetchLinkPreview } from '../services/linkPreviewFetcher';
import {
  getLinkPreviewEnabled,
  subscribeLinkPreviewEnabled,
} from '../services/linkPreviewPreference';
import type { LinkPreview } from '../services/linkPreviewStorage';
import { isBlocklisted } from '../services/linkPreviewBlocklist';

interface Props {
  url: string;
  // The id of the message that contains this URL — used to make
  // testIDs unique per bubble so Maestro can target a specific card.
  eventId: string;
  // Render-side variant — pink bubble (`fromMe`) gets a different
  // border/background. Defaults to "them" (incoming) styling.
  fromMe?: boolean;
}

function deriveDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const MessageLinkPreview: React.FC<Props> = ({ url, eventId, fromMe = false }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors, fromMe), [colors, fromMe]);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<LinkPreview | null>(null);
  const [loading, setLoading] = useState<boolean>(false);

  // Hydrate the user preference at mount, then subscribe so toggling
  // the Security-screen switch flips this card live.
  useEffect(() => {
    let cancelled = false;
    getLinkPreviewEnabled().then((v) => {
      if (!cancelled) setEnabled(v);
    });
    const unsub = subscribeLinkPreviewEnabled((v) => {
      if (!cancelled) setEnabled(v);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // Kick the OG fetch once we know the preference is on. Re-runs if
  // the URL changes (e.g. message edits — we don't currently support
  // those, but the dep is correct).
  useEffect(() => {
    if (!enabled) return;
    if (isBlocklisted(url)) return;
    let cancelled = false;
    setLoading(true);
    fetchLinkPreview(url)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, url]);

  // Preference disabled, blocklisted, or fetch yielded no metadata —
  // render nothing extra. The bare URL stays clickable in the
  // surrounding bubble text.
  if (enabled === false) return null;
  if (isBlocklisted(url)) return null;
  if (!loading && !preview) return null;

  const domain = preview?.domain ?? deriveDomain(url);

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => {
        Linking.openURL(url).catch(() => {
          // No toast — the issue spec calls for silent fallback when
          // OS routing fails (rare; almost always a malformed URL).
        });
      }}
      accessibilityRole="link"
      accessibilityLabel={`Open ${domain}`}
      style={styles.card}
      testID={`message-link-preview-card-${eventId}`}
    >
      <View testID={`message-link-preview-tap-${eventId}`} style={styles.tapTarget}>
        {preview?.image ? (
          <ExpoImage
            source={{ uri: preview.image }}
            style={styles.image}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={150}
            accessibilityIgnoresInvertColors
            testID={`message-link-preview-image-${eventId}`}
          />
        ) : null}
        <View style={styles.body}>
          {loading && !preview ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.brandPink} />
              <Text style={styles.urlFallback} numberOfLines={1}>
                {url}
              </Text>
            </View>
          ) : preview ? (
            <>
              <Text style={styles.title} numberOfLines={2}>
                {preview.title}
              </Text>
              <Text style={styles.domain} numberOfLines={1}>
                {preview.siteName || domain}
              </Text>
            </>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const createStyles = (colors: Palette, fromMe: boolean) =>
  StyleSheet.create({
    card: {
      marginTop: 6,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: fromMe ? 'rgba(255,255,255,0.4)' : colors.brandPink,
      backgroundColor: fromMe ? 'rgba(255,255,255,0.08)' : colors.surface,
      overflow: 'hidden',
      maxWidth: 280,
    },
    tapTarget: {},
    image: {
      width: '100%',
      height: 140,
      backgroundColor: colors.background,
    },
    body: {
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 4,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    urlFallback: {
      flex: 1,
      fontSize: 12,
      color: fromMe ? 'rgba(255,255,255,0.85)' : colors.textSupplementary,
    },
    title: {
      fontSize: 14,
      fontWeight: '700',
      color: fromMe ? colors.white : colors.textHeader,
    },
    domain: {
      fontSize: 11,
      color: fromMe ? 'rgba(255,255,255,0.7)' : colors.textSupplementary,
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginTop: 2,
    },
  });

export default MessageLinkPreview;
