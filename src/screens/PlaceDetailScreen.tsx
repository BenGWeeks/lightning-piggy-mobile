import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Linking,
  Share,
} from 'react-native';
import * as Location from 'expo-location';
import {
  Accessibility,
  ChevronLeft,
  Clock,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Navigation as NavigationIcon,
  Phone,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Trees,
  Truck,
  Zap,
} from 'lucide-react-native';
import type { RouteProp } from '@react-navigation/native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { Palette } from '../styles/palettes';
import { ExploreNavigation, ExploreStackParamList } from '../navigation/types';
import {
  type BtcMapPlace,
  acceptsLightning,
  acceptsOnchain,
  btcMapMerchantUrl,
  btcMapVerifyUrl,
  daysSinceVerified,
  fetchPlaceById,
  fetchPlaceRich,
  formatAddress,
  isBoosted,
  lightningAddressOf,
} from '../services/btcMapService';
import { formatDistance, haversineMetres } from '../utils/geohash';
import { getDevPinnedLocation } from '../utils/devLocation';
import { ExploreMiniMap } from '../components/ExploreMiniMap';
import { btcMapIconComponent } from '../utils/btcMapIcon';
import SocialIcon, { socialLabel, type SocialNetwork } from '../components/SocialIcon';

interface Props {
  navigation: ExploreNavigation;
  route: RouteProp<ExploreStackParamList, 'PlaceDetail'>;
}

/**
 * Detail view for a single BTC Map / OSM merchant. Resolves the place
 * by `id` from a small bbox query (we don't have a "fetch one place
 * by id" endpoint, but the cached bbox the list view already ran
 * almost certainly contains this id, so the cache hit is essentially
 * free). Renders address, payment methods, contact info, a
 * single-pin map preview, and pay / directions actions.
 */
// Format BTC Map's ISO-ish timestamps (e.g. "2022-09-25T08:45:08Z") to
// a friendly YYYY-MM-DD for the lifecycle block. Invalid dates return
// the raw string so a malformed payload doesn't render "NaN-NaN-NaN".
const formatYMD = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
};

// BTC Map / OSM stores some contact:* tags as bare handles
// ("tasteofcambridgefalafels") instead of full URLs. Map each network to its
// canonical web host so the row always renders a recognisable URL.
const SOCIAL_HOSTS: Record<SocialNetwork, string> = {
  facebook: 'facebook.com',
  x: 'x.com',
  instagram: 'instagram.com',
  telegram: 't.me',
  whatsapp: 'wa.me',
};

const normaliseSocialUrl = (
  network: SocialNetwork,
  value: string,
): { display: string; href: string } => {
  const trimmed = value.trim().replace(/^@/, '');
  const isUrl = /^https?:\/\//i.test(trimmed);
  const host = SOCIAL_HOSTS[network];
  const display = isUrl ? trimmed.replace(/^https?:\/\/(www\.)?/i, '') : `${host}/${trimmed}`;
  const href = isUrl ? trimmed : `https://${host}/${trimmed}`;
  return { display, href };
};

const SocialRow: React.FC<{
  network: SocialNetwork;
  url: string;
  styles: Record<string, ReturnType<typeof StyleSheet.create>[string]>;
}> = ({ network, url, styles }) => {
  const { display, href } = normaliseSocialUrl(network, url);
  return (
    <TouchableOpacity
      style={styles.contactRow}
      onPress={() => Linking.openURL(href).catch(() => {})}
      accessibilityLabel={`${socialLabel(network)}: ${display}`}
    >
      <SocialIcon network={network} size={18} />
      <Text style={styles.contactText} numberOfLines={1}>
        {display}
      </Text>
    </TouchableOpacity>
  );
};

const PlaceDetailScreen: React.FC<Props> = ({ navigation, route }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { placeId } = route.params;
  const [place, setPlace] = useState<BtcMapPlace | null>(null);
  const [pos, setPos] = useState<{ lat: number; lon: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Location is a *nice-to-have* on PlaceDetail — it powers the
        // "X km away" chip and the Directions button. Without it the
        // page still shows everything else about the merchant, so we
        // shouldn't block rendering on permission. Try silently and
        // fall through either way (Copilot review on PR #488 flagged
        // the previous flow as a UX blocker: tap merchant → "Location
        // permission required" instead of the merchant detail).
        try {
          const pinned = getDevPinnedLocation();
          if (pinned) {
            if (!cancelled) setPos({ lat: pinned.lat, lon: pinned.lon });
          } else {
            const perm = await Location.requestForegroundPermissionsAsync();
            if (perm.status === 'granted') {
              const fix = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.Balanced,
              });
              if (!cancelled) {
                setPos({ lat: fix.coords.latitude, lon: fix.coords.longitude });
              }
            }
          }
        } catch {
          // Location lookup failed — keep going, `pos` stays null and the
          // distance chip + Directions row hide themselves.
        }
        if (cancelled) return;
        // Fast path: look up the single place by id from the in-memory
        // BTC Map dataset (or hydrate from AsyncStorage). Avoids the
        // 28k-row bbox filter we used to run just to .find() one item,
        // which made the tap → detail transition feel sluggish.
        const found = await fetchPlaceById(placeId);
        if (cancelled) return;
        if (!found) {
          setError("This place isn't in our cached list anymore — try opening it from the map.");
        } else {
          setPlace(found);
          // Bulk dataset only carries list-essential fields (id/lat/lon/
          // name/icon/lightning/etc). Detail screen renders the rich
          // shape (cuisine, contact links, opening_hours, …) so lazy-
          // fetch per-id and overlay. Failure is silent — the slim
          // record is still usable.
          fetchPlaceRich(placeId).then((rich) => {
            if (!cancelled && rich) setPlace((prev) => (prev ? { ...prev, ...rich } : rich));
          });
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [placeId]);

  const openDirections = useCallback(() => {
    if (!place) return;
    const label = encodeURIComponent(place.tags.name ?? 'Bitcoin place');
    const uri = `geo:${place.lat},${place.lon}?q=${place.lat},${place.lon}(${label})`;
    Linking.openURL(uri).catch(() => {
      Linking.openURL(
        `https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lon}#map=18/${place.lat}/${place.lon}`,
      ).catch(() => {});
    });
  }, [place]);

  const openContact = useCallback((scheme: 'tel' | 'mailto' | 'https', value: string) => {
    const uri = scheme === 'https' ? value : `${scheme}:${value}`;
    Linking.openURL(uri).catch(() => {});
  }, []);

  return (
    <View style={styles.container} testID="place-detail-screen">
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          accessibilityLabel="Back to Places"
          testID="place-detail-back-button"
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <ChevronLeft size={24} color={colors.white} strokeWidth={2.5} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {place?.tags.name ?? 'Place'}
        </Text>
        {place && btcMapMerchantUrl(place) ? (
          <TouchableOpacity
            onPress={() => {
              const url = btcMapMerchantUrl(place)!;
              const name = place.tags.name ?? 'this Bitcoin merchant';
              Share.share({
                message: `${name} accepts Bitcoin — ${url}`,
                url,
                title: name,
              }).catch(() => {});
            }}
            accessibilityLabel="Share this merchant"
            testID="place-detail-share-header"
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Share2 size={22} color={colors.white} strokeWidth={2.5} />
          </TouchableOpacity>
        ) : (
          <View style={styles.headerRightSpacer} />
        )}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {loading ? (
          <ActivityIndicator color={colors.brandPink} style={{ marginTop: 40 }} />
        ) : error ? (
          <Text style={styles.errorText}>{error}</Text>
        ) : place ? (
          <>
            <View style={styles.titleRow}>
              {(() => {
                const CategoryIcon = btcMapIconComponent(place.icon);
                return (
                  <View style={styles.categoryIconWrap}>
                    <CategoryIcon size={20} color={colors.brandPink} strokeWidth={2.5} />
                  </View>
                );
              })()}
              <Text style={styles.title}>{place.tags.name ?? 'Unnamed merchant'}</Text>
            </View>
            <View style={styles.chipRow}>
              {isBoosted(place) ? (
                <View style={styles.chipFeatured} testID="place-detail-featured-chip">
                  <Sparkles size={12} color={colors.white} strokeWidth={2.5} />
                  <Text style={styles.chipPinkText}>Featured</Text>
                </View>
              ) : null}
              {acceptsLightning(place) ? (
                <View style={styles.chipPink}>
                  <Zap size={12} color={colors.white} strokeWidth={2.5} />
                  <Text style={styles.chipPinkText}>Lightning</Text>
                </View>
              ) : null}
              {acceptsOnchain(place) ? (
                <View style={styles.chipOrange}>
                  <MapPin size={12} color={colors.white} strokeWidth={2.5} />
                  <Text style={styles.chipPinkText}>On-chain</Text>
                </View>
              ) : null}
              {pos ? (
                <View style={styles.chipGrey}>
                  <Text style={styles.chipGreyText}>
                    {formatDistance(
                      haversineMetres(
                        { lat: pos.lat, lon: pos.lon },
                        { lat: place.lat, lon: place.lon },
                      ),
                    )}{' '}
                    away
                  </Text>
                </View>
              ) : null}
              {/* Accessibility — OSM `wheelchair=yes/limited/no`. We only
                  surface yes/limited (a hard "no" feels stigmatising and
                  the data is too sparse to act on). */}
              {place.tags['wheelchair'] === 'yes' || place.tags['wheelchair'] === 'limited' ? (
                <View style={styles.chipFeature}>
                  <Accessibility size={12} color={colors.textHeader} strokeWidth={2.5} />
                  <Text style={styles.chipFeatureText}>
                    {place.tags['wheelchair'] === 'limited'
                      ? 'Wheelchair limited'
                      : 'Wheelchair accessible'}
                  </Text>
                </View>
              ) : null}
              {place.tags['takeaway'] === 'yes' ? (
                <View style={styles.chipFeature}>
                  <ShoppingBag size={12} color={colors.textHeader} strokeWidth={2.5} />
                  <Text style={styles.chipFeatureText}>Takeaway</Text>
                </View>
              ) : null}
              {place.tags['delivery'] === 'yes' ? (
                <View style={styles.chipFeature}>
                  <Truck size={12} color={colors.textHeader} strokeWidth={2.5} />
                  <Text style={styles.chipFeatureText}>Delivery</Text>
                </View>
              ) : null}
              {place.tags['outdoor_seating'] === 'yes' ? (
                <View style={styles.chipFeature}>
                  <Trees size={12} color={colors.textHeader} strokeWidth={2.5} />
                  <Text style={styles.chipFeatureText}>Outdoor seating</Text>
                </View>
              ) : null}
            </View>

            <Text style={styles.address}>{formatAddress(place)}</Text>

            {place.tags['brand'] ? (
              <Text style={styles.metaLine}>Part of {place.tags['brand']}</Text>
            ) : null}
            {place.tags['cuisine'] ? (
              <Text style={styles.metaLine}>
                Cuisine · {place.tags['cuisine'].replace(/;/g, ', ')}
              </Text>
            ) : null}
            {place.tags['level'] || place.tags['addr:floor'] ? (
              <Text style={styles.metaLine}>
                Floor {place.tags['level'] ?? place.tags['addr:floor']}
              </Text>
            ) : null}
            {place.tags['wheelchair:description'] ? (
              <Text style={styles.metaLine}>{place.tags['wheelchair:description']}</Text>
            ) : null}

            {place.description ? <Text style={styles.description}>{place.description}</Text> : null}

            {/* Single-pin map preview — same component the Hub mini-map
                uses, centred on the merchant. Tap → full Map. */}
            <View style={styles.mapWrap}>
              <ExploreMiniMap
                lat={place.lat}
                lon={place.lon}
                merchants={[place]}
                caches={[]}
                events={[]}
                onTapMap={() => navigation.navigate('Map')}
              />
            </View>

            {lightningAddressOf(place) ? (
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.primaryAction}
                  testID="place-detail-pay-button"
                  accessibilityLabel="Pay this merchant"
                  onPress={() => {
                    // TODO: route through SendSheet with the lud16 pre-filled.
                    // For now nudge into the user's flow via deep-link.
                    const lud16 = lightningAddressOf(place);
                    if (lud16) Linking.openURL(`lightning:${lud16}`).catch(() => {});
                  }}
                >
                  <Zap size={16} color={colors.white} strokeWidth={2.5} />
                  <Text style={styles.primaryActionText}>Pay</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {place.opening_hours ? (
              <View style={styles.contactSection}>
                <Text style={styles.sectionLabel}>Opening hours</Text>
                <View style={styles.contactRow}>
                  <Clock size={14} color={colors.brandPink} strokeWidth={2.5} />
                  <Text style={styles.contactText}>{place.opening_hours}</Text>
                </View>
              </View>
            ) : null}

            {place.phone ||
            place.tags['contact:website'] ||
            place.email ||
            place.facebookUrl ||
            place.twitterUrl ||
            place.instagramUrl ||
            place.telegramUrl ||
            place.whatsappUrl ? (
              <View style={styles.contactSection}>
                <Text style={styles.sectionLabel}>Contact</Text>
                {place.phone ? (
                  <TouchableOpacity
                    style={styles.contactRow}
                    onPress={() => openContact('tel', place.phone!)}
                  >
                    <Phone size={14} color={colors.brandPink} strokeWidth={2.5} />
                    <Text style={styles.contactText}>{place.phone}</Text>
                  </TouchableOpacity>
                ) : null}
                {place.tags['contact:website'] ? (
                  <TouchableOpacity
                    style={styles.contactRow}
                    onPress={() => openContact('https', place.tags['contact:website']!)}
                  >
                    <Globe size={14} color={colors.brandPink} strokeWidth={2.5} />
                    <Text style={styles.contactText} numberOfLines={1}>
                      {place.tags['contact:website']}
                    </Text>
                    <ExternalLink size={12} color={colors.textSupplementary} />
                  </TouchableOpacity>
                ) : null}
                {place.email ? (
                  <TouchableOpacity
                    style={styles.contactRow}
                    onPress={() => openContact('mailto', place.email!)}
                  >
                    <Mail size={14} color={colors.brandPink} strokeWidth={2.5} />
                    <Text style={styles.contactText}>{place.email}</Text>
                  </TouchableOpacity>
                ) : null}
                {place.facebookUrl ? (
                  <SocialRow network="facebook" url={place.facebookUrl} styles={styles} />
                ) : null}
                {place.twitterUrl ? (
                  <SocialRow network="x" url={place.twitterUrl} styles={styles} />
                ) : null}
                {place.instagramUrl ? (
                  <SocialRow network="instagram" url={place.instagramUrl} styles={styles} />
                ) : null}
                {place.telegramUrl ? (
                  <SocialRow network="telegram" url={place.telegramUrl} styles={styles} />
                ) : null}
                {place.whatsappUrl ? (
                  <SocialRow network="whatsapp" url={place.whatsappUrl} styles={styles} />
                ) : null}
              </View>
            ) : null}

            {place.verified_at ||
            place.createdAt ||
            place.updatedAt ||
            place.tags['start_date'] ||
            place.tags['check_date:currency:XBT'] ||
            (place.commentsCount ?? 0) > 0 ? (
              <View style={styles.lifecycleBlock}>
                {place.tags['check_date:currency:XBT'] ? (
                  <Text style={styles.lifecycleText}>
                    Bitcoin acceptance confirmed {place.tags['check_date:currency:XBT']}.
                  </Text>
                ) : null}
                {place.verified_at ? (
                  <Text style={styles.lifecycleText}>
                    Last community-verified {daysSinceVerified(place)} days ago via OpenStreetMap.
                  </Text>
                ) : null}
                {place.updatedAt ? (
                  <Text style={styles.lifecycleText}>
                    Last updated {formatYMD(place.updatedAt)}.
                  </Text>
                ) : null}
                {place.tags['start_date'] ? (
                  <Text style={styles.lifecycleText}>Open since {place.tags['start_date']}.</Text>
                ) : null}
                {place.createdAt ? (
                  <Text style={styles.lifecycleText}>
                    Listed on BTC Map {formatYMD(place.createdAt)}.
                  </Text>
                ) : null}
                {(place.commentsCount ?? 0) > 0 && btcMapMerchantUrl(place) ? (
                  <TouchableOpacity
                    onPress={() => Linking.openURL(btcMapMerchantUrl(place)!)}
                    testID="place-detail-comments-link"
                  >
                    <Text style={[styles.lifecycleText, styles.commentsLink]}>
                      {place.commentsCount}{' '}
                      {place.commentsCount === 1 ? 'community note' : 'community notes'} on BTC Map
                      →
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}

            <View style={styles.btcMapActionsRow}>
              <TouchableOpacity
                // Same pill geometry as Verify / Suggest-an-edit, but
                // filled brand-pink so the primary "get me there" action
                // pops over the outline buttons next to it.
                style={[styles.btcMapActionButton, styles.btcMapActionButtonPrimary]}
                onPress={openDirections}
                testID="place-detail-directions-button"
                accessibilityLabel="Open directions"
              >
                <NavigationIcon size={14} color={colors.white} strokeWidth={2.5} />
                <Text style={[styles.btcMapActionText, styles.btcMapActionTextPrimary]}>
                  Directions
                </Text>
              </TouchableOpacity>
              {btcMapVerifyUrl(place) ? (
                <TouchableOpacity
                  style={styles.btcMapActionButton}
                  onPress={() => Linking.openURL(btcMapVerifyUrl(place)!)}
                  testID="place-detail-verify"
                  accessibilityLabel="Verify this listing on BTC Map"
                >
                  <ShieldCheck size={14} color={colors.brandPink} strokeWidth={2.5} />
                  <Text style={styles.btcMapActionText}>Verify on BTC Map</Text>
                </TouchableOpacity>
              ) : null}
              {btcMapMerchantUrl(place) ? (
                <TouchableOpacity
                  style={styles.btcMapActionButton}
                  onPress={() => Linking.openURL(btcMapMerchantUrl(place)!)}
                  testID="place-detail-suggest-edit"
                  accessibilityLabel="Suggest an edit on BTC Map"
                >
                  <ExternalLink size={14} color={colors.brandPink} strokeWidth={2.5} />
                  <Text style={styles.btcMapActionText}>Suggest an edit</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </>
        ) : null}
      </ScrollView>
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
      gap: 12,
    },
    headerTitle: {
      flex: 1,
      textAlign: 'center',
      fontSize: 18,
      fontWeight: '700',
      color: colors.white,
    },
    headerRightSpacer: { width: 24 },
    body: { padding: 16, gap: 14, paddingBottom: 40 },
    title: { flex: 1, fontSize: 22, fontWeight: '800', color: colors.textHeader, lineHeight: 28 },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    categoryIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    btcMapActionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
    },
    btcMapActionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.brandPink,
    },
    btcMapActionText: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.brandPink,
    },
    btcMapActionButtonPrimary: {
      backgroundColor: colors.brandPink,
      borderColor: colors.brandPink,
    },
    btcMapActionTextPrimary: {
      color: colors.white,
    },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chipPink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.brandPink,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
    },
    chipFeatured: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      // Bitcoin yellow so the Featured pill reads instantly even on
      // a busy chip row (Lightning pink + on-chain orange already
      // crowd the warm end of the palette).
      backgroundColor: colors.zapYellow,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
    },
    chipFeature: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.divider,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
    },
    chipFeatureText: { color: colors.textHeader, fontSize: 11, fontWeight: '700' },
    metaLine: {
      fontSize: 13,
      color: colors.textSupplementary,
      marginTop: 2,
    },
    commentsLink: {
      color: colors.brandPink,
      fontStyle: 'normal',
      fontWeight: '700',
      marginTop: 4,
    },
    chipOrange: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: '#F7931A',
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
    },
    chipPinkText: { color: colors.white, fontSize: 11, fontWeight: '700' },
    chipGrey: {
      backgroundColor: colors.divider,
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 100,
    },
    chipGreyText: { color: colors.textSupplementary, fontSize: 11, fontWeight: '700' },
    address: { fontSize: 14, color: colors.textSupplementary, lineHeight: 20 },
    description: {
      fontSize: 14,
      color: colors.textBody,
      lineHeight: 21,
      marginTop: 4,
    },
    mapWrap: { marginHorizontal: -16, marginVertical: 4 },
    actionRow: { flexDirection: 'row', gap: 10 },
    primaryAction: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.brandPink,
      paddingVertical: 12,
      borderRadius: 100,
    },
    primaryActionText: { color: colors.white, fontSize: 14, fontWeight: '700' },
    secondaryAction: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.surface,
      paddingVertical: 12,
      borderRadius: 100,
      borderWidth: 1,
      borderColor: colors.brandPink,
    },
    secondaryActionText: { color: colors.brandPink, fontSize: 14, fontWeight: '700' },
    contactSection: { gap: 8, marginTop: 8 },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: colors.textSupplementary,
      letterSpacing: 0.5,
    },
    contactRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
    },
    contactText: { fontSize: 14, color: colors.textHeader, flex: 1 },
    verifyText: {
      fontSize: 12,
      color: colors.textSupplementary,
      marginTop: 12,
      fontStyle: 'italic',
    },
    lifecycleBlock: {
      marginTop: 12,
      gap: 2,
    },
    lifecycleText: {
      fontSize: 12,
      color: colors.textSupplementary,
      fontStyle: 'italic',
    },
    errorText: { fontSize: 14, color: colors.brandPink, textAlign: 'center', marginTop: 40 },
  });

export default PlaceDetailScreen;
