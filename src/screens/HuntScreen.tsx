import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import * as Location from 'expo-location';
import { useFocusEffect } from '@react-navigation/native';
import { ChevronLeft, ChevronRight, Compass, PiggyBank, Plus } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import { useTrustGraph } from '../contexts/TrustGraphContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation } from '../navigation/types';
import { HiddenPiggy, loadPiggies } from '../services/piggyStorageService';
import { ExploreMiniMap } from '../components/ExploreMiniMap';
import { type ParsedCache } from '../services/nostrPlacesService';
import { subscribeNearbyCaches } from '../services/nostrPlacesPublisher';
import { encodeGeohash, geohashPrefixes } from '../utils/geohash';
import { getDevPinnedLocation } from '../utils/devLocation';

interface Props {
  navigation: ExploreNavigation;
}

/**
 * Hunt sub-screen — the hider's "My Piggies" hub. Lists every LNURL-w
 * Piggy the user has stashed locally, with a CTA to hide a new one.
 *
 * Lightning Piggy is wallet-agnostic for the Hunt feature: the LNURL-w
 * itself is created in the hider's wallet of choice (LNbits, Alby,
 * Mutiny, …) — see project memory `No LNbits-specific APIs`. This
 * screen is the front door to the paste-and-validate create flow that
 * lives in HuntCreateScreen.
 *
 * Closes part of #468.
 */
const HuntScreen: React.FC<Props> = ({ navigation }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [piggies, setPiggies] = useState<HiddenPiggy[]>([]);
  // User position drives the mini-map at the top of the page.
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  // Nearby caches feed the mini-map's pin layer. Subscription is
  // identical to the hub's so the two views stay coherent.
  const [caches, setCaches] = useState<Map<string, ParsedCache>>(new Map());

  // Web-of-trust filter applied to mini-map pins so an Evil-Pig lure
  // doesn't show up on the Hunt page either. See `trustGraphService`.
  const { isTrusted, filterEnabled } = useTrustGraph();
  const isTrustedRef = useRef(isTrusted);
  useEffect(() => {
    isTrustedRef.current = isTrusted;
  }, [isTrusted]);

  useFocusEffect(
    useCallback(() => {
      loadPiggies().then(setPiggies);
    }, []),
  );

  // Resolve location once on mount (with the same dev-fallback every
  // other location-aware screen uses).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pinned = getDevPinnedLocation();
      if (pinned) {
        if (!cancelled) setPos(pinned);
        return;
      }
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== 'granted') return;
        const fix = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        if (!cancelled) setPos({ lat: fix.coords.latitude, lon: fix.coords.longitude });
      } catch {
        /* mini-map renders its own "Locating you…" fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Cache subscription — only kicks off once we have a fix.
  useEffect(() => {
    if (!pos) return;
    const myGeohash = encodeGeohash(pos.lat, pos.lon, 7);
    const prefixes = geohashPrefixes(myGeohash, 5).filter((p) => p.length === 5);
    const closer = subscribeNearbyCaches(prefixes, (c) => {
      if (filterEnabled && !isTrustedRef.current(c.hiderPubkey)) return;
      setCaches((prev) => {
        const existing = prev.get(c.coord);
        if (existing && existing.createdAt >= c.createdAt) return prev;
        const next = new Map(prev);
        next.set(c.coord, c);
        return next;
      });
    });
    return () => closer();
  }, [pos, filterEnabled]);

  return (
    <View style={styles.container} testID="hunt-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to Explore"
          testID="hunt-back-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Hunt</Text>
        <View style={styles.headerRightSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {/* Mini-map at the top mirrors the Explore hub so the user can
            see which Piglets are around without flipping screens. We
            pass empty merchants/events arrays — Hunt is cache-only. */}
        <ExploreMiniMap
          lat={pos?.lat ?? null}
          lon={pos?.lon ?? null}
          merchants={[]}
          caches={[...caches.values()]}
          events={[]}
          onTapMap={() => navigation.navigate('Map')}
        />

        {/* Discover is the primary CTA now — most users will find, not
            hide. The big pink card was previously "Hide a Piggy". */}
        <TouchableOpacity
          style={styles.discoverPrimary}
          onPress={() => navigation.navigate('HuntDiscover')}
          testID="hunt-discover-button"
          accessibilityLabel="Discover nearby Piggies"
        >
          <View style={styles.discoverPrimaryIconWrap}>
            <Compass size={28} color={colors.white} strokeWidth={2.5} />
          </View>
          <View style={styles.createTextWrapper}>
            <Text style={styles.createTitle}>Discover nearby</Text>
            <Text style={styles.createSubtitle}>
              Find Piglets + classic NIP-GC caches around you.
            </Text>
          </View>
          <ChevronRight size={20} color={colors.white} />
        </TouchableOpacity>

        {/* Hide a Piggy demoted to a secondary outlined card. Most
            users won't hide — the affordance is still here for those
            who do, just visually quieter. */}
        <TouchableOpacity
          style={styles.createSecondary}
          onPress={() => navigation.navigate('HuntCreate')}
          testID="hunt-create-piggy-button"
          accessibilityLabel="Hide a Piggy"
        >
          <View style={styles.createSecondaryIconWrap}>
            <Plus size={22} color={colors.brandPink} strokeWidth={2.5} />
          </View>
          <View style={styles.createTextWrapper}>
            <Text style={styles.discoverTitle}>Hide a Piglet</Text>
            <Text style={styles.discoverSubtitle}>
              Stash an LNURL-withdraw link on an NFC tag or QR for someone else to find.
            </Text>
          </View>
          <ChevronRight size={18} color={colors.textSupplementary} />
        </TouchableOpacity>

        <Text style={styles.sectionLabel}>My Piggies</Text>
        {piggies.length === 0 ? (
          <View style={styles.emptyState} testID="hunt-empty-state">
            <PiggyBank size={48} color={colors.textSupplementary} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>No Piggies hidden yet</Text>
            <Text style={styles.emptySubtitle}>
              Tap &ldquo;Hide a Piggy&rdquo; above to stash your first one.
            </Text>
          </View>
        ) : (
          piggies.map((p) => <PiggyRow key={p.id} piggy={p} colors={colors} styles={styles} />)
        )}
      </ScrollView>
    </View>
  );
};

const PiggyRow: React.FC<{
  piggy: HiddenPiggy;
  colors: Palette;
  styles: ReturnType<typeof createStyles>;
}> = ({ piggy, colors, styles }) => {
  const ageMinutes = Math.floor((Date.now() - piggy.createdAt) / 60_000);
  const ageLabel =
    ageMinutes < 60
      ? `${ageMinutes}m ago`
      : ageMinutes < 60 * 24
        ? `${Math.floor(ageMinutes / 60)}h ago`
        : `${Math.floor(ageMinutes / (60 * 24))}d ago`;

  return (
    <View style={styles.piggyRow} testID={`hunt-piggy-row-${piggy.id}`}>
      <View style={styles.piggyIconWrapper}>
        <PiggyBank size={22} color={colors.brandPink} strokeWidth={2} />
      </View>
      <View style={styles.piggyMain}>
        <Text style={styles.piggyMemo} numberOfLines={1}>
          {piggy.memo || 'Untitled Piggy'}
        </Text>
        <Text style={styles.piggyMeta}>
          {ageLabel}
          {piggy.isPublic ? ' • Public' : ' • Private'}
        </Text>
      </View>
      <ChevronRight size={20} color={colors.textSupplementary} />
    </View>
  );
};

const createStyles = (colors: Palette) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 16,
      paddingTop: 48,
      paddingBottom: 16,
      backgroundColor: colors.brandPink,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    headerRightSpacer: { width: 24 },
    body: {
      padding: 16,
      gap: 16,
    },
    createCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: colors.brandPink,
      borderRadius: 12,
      padding: 16,
    },
    createIconWrapper: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: 'rgba(255,255,255,0.25)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    discoverPrimary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: colors.brandPink,
      borderRadius: 12,
      padding: 16,
    },
    discoverPrimaryIconWrap: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: 'rgba(255,255,255,0.25)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    createSecondary: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.brandPinkLight,
    },
    createSecondaryIconWrap: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    createTextWrapper: { flex: 1 },
    createTitle: {
      color: colors.white,
      fontSize: 16,
      fontWeight: '700',
    },
    createSubtitle: {
      color: 'rgba(255,255,255,0.85)',
      fontSize: 12,
      marginTop: 2,
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSupplementary,
      letterSpacing: 0.5,
      marginTop: 8,
    },
    emptyState: {
      alignItems: 'center',
      gap: 8,
      paddingVertical: 36,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.textHeader,
      marginTop: 6,
    },
    emptySubtitle: {
      fontSize: 13,
      color: colors.textSupplementary,
      textAlign: 'center',
      paddingHorizontal: 24,
    },
    piggyRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      backgroundColor: colors.surface,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
    },
    piggyIconWrapper: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    piggyMain: { flex: 1 },
    piggyMemo: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.textHeader,
    },
    piggyMeta: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    discoverCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.brandPinkLight,
    },
    discoverIconWrapper: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.brandPinkLight,
      alignItems: 'center',
      justifyContent: 'center',
    },
    discoverTitle: { color: colors.textHeader, fontSize: 15, fontWeight: '700' },
    discoverSubtitle: { color: colors.textSupplementary, fontSize: 12, marginTop: 2 },
  });

export default HuntScreen;
