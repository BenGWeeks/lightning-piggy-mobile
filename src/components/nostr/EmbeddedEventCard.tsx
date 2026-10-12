import React, { useCallback } from 'react';
import { Linking, Text, TouchableOpacity, View } from 'react-native';
import { Image } from 'expo-image';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Event } from 'nostr-tools';
import AuthorInline from '../AuthorInline';
import MarketProductCard from '../MarketProductCard';
import EmbedSkeleton from './EmbedSkeleton';
import { useEmbeddedEvent } from '../../hooks/useEmbeddedEvent';
import { usePubkeyProfile } from '../../hooks/usePubkeyProfile';
import { useTranslation } from '../../contexts/LocaleContext';
import { PRODUCT_KIND, type EmbedRef } from '../../services/nostrEmbedCache';
import { previewText } from '../../utils/nip27';
import { relativeTime } from '../../utils/relativeTime';
import { safeMarketUrl } from '../../utils/marketListings';
import type { MarketProduct } from '../../data/marketProducts';
import type { RootStackParamList } from '../../navigation/types';
import type { NostrContentStyles } from '../../styles/NostrContent.styles';
import { isPublicHttpUrl } from '../../utils/publicUrl';
import { useIsTrustedAuthor } from '../../hooks/useFollowedPubkeys';

export const ARTICLE_KIND = 30023;

interface Props {
  token: EmbedRef;
  styles: NostrContentStyles;
  /**
   * Compact preview (a reply's parent on the Posts tab): smaller, two lines,
   * and renders nothing when the event can't be found — the caller already
   * shows its own context line.
   */
  compact?: boolean;
}

const tagValue = (event: Event, name: string) => event.tags.find((t) => t[0] === name)?.[1];

/** njump.me renders any NIP-19 entity on the web — used where there's no in-app view. */
function openOnWeb(raw: string): void {
  Linking.openURL(`https://njump.me/${raw.replace(/^nostr:/i, '')}`).catch(() => {
    // No browser / malformed — nothing useful to surface.
  });
}

/**
 * Embedded card for a NIP-27 `nostr:note…` / `nevent…` / `naddr…` reference:
 *   - a note (any non-addressable kind): author, text preview and time;
 *   - a long-form article (30023): kicker, title, summary and cover image;
 *   - a Market product (30402): the Market's own product card, opening the
 *     product page in-app.
 * Shows a skeleton while the batched fetch runs; notes and articles open on
 * the web (there's no in-app note view yet — #540).
 */
const EmbeddedEventCard: React.FC<Props> = ({ token, styles, compact = false }) => {
  const t = useTranslation();
  const { result, loading } = useEmbeddedEvent(token);
  const event = result?.event ?? null;
  const kind = event?.kind ?? token.kind;
  const shortId = token.type === 'event' ? token.id.slice(0, 12) : token.identifier.slice(0, 24);

  if (loading) {
    return (
      <EmbedSkeleton styles={styles} compact={compact} testID={`nostr-embed-skeleton-${shortId}`} />
    );
  }
  if (compact && !event) return null;

  if (kind === PRODUCT_KIND) {
    return result?.product ? (
      <ProductEmbed product={result.product} />
    ) : (
      <Unavailable label={t('nostrContent.productUnavailable')} styles={styles} raw={token.raw} />
    );
  }
  if (!event) {
    return (
      <Unavailable label={t('nostrContent.postUnavailable')} styles={styles} raw={token.raw} />
    );
  }
  if (event.kind === ARTICLE_KIND) {
    return <ArticleEmbed event={event} styles={styles} raw={token.raw} />;
  }
  const preview = previewText(event.content) || t('nostrContent.emptyPost');
  return (
    <TouchableOpacity
      style={[styles.card, compact && styles.cardCompact]}
      onPress={() => openOnWeb(token.raw)}
      accessibilityRole="button"
      accessibilityLabel={t('nostrContent.embeddedPostA11y', { text: preview.slice(0, 120) })}
      testID={`${compact ? 'nostr-embed-parent' : 'nostr-embed-note'}-${shortId}`}
      activeOpacity={0.8}
    >
      <View style={styles.cardHeader}>
        <View style={styles.cardAuthor}>
          <AuthorInline pubkey={event.pubkey} size={compact ? 18 : 22} />
        </View>
        <Text style={styles.cardTime}>{relativeTime(event.created_at)}</Text>
      </View>
      <Text
        style={[styles.cardBody, compact && styles.cardBodyCompact]}
        numberOfLines={compact ? 2 : 5}
      >
        {preview}
      </Text>
    </TouchableOpacity>
  );
};

const Unavailable: React.FC<{ label: string; raw: string; styles: NostrContentStyles }> = ({
  label,
  raw,
  styles,
}) => {
  const t = useTranslation();
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => openOnWeb(raw)}
      accessibilityRole="link"
      accessibilityLabel={`${label}. ${t('nostrContent.openOnWeb')}`}
      testID="nostr-embed-unavailable"
    >
      <Text style={styles.cardMuted}>{label}</Text>
      <Text style={styles.link}>{t('nostrContent.openOnWeb')}</Text>
    </TouchableOpacity>
  );
};

const ArticleEmbed: React.FC<{ event: Event; raw: string; styles: NostrContentStyles }> = ({
  event,
  raw,
  styles,
}) => {
  const t = useTranslation();
  const title = tagValue(event, 'title')?.trim() || t('nostrContent.untitledArticle');
  const summary = tagValue(event, 'summary')?.trim() || previewText(event.content).slice(0, 280);
  const tagged = safeMarketUrl(tagValue(event, 'image'));
  // An embedded article is someone else's event: its cover only loads
  // automatically for me / people I follow, from a public host (#1338).
  const trusted = useIsTrustedAuthor(event.pubkey);
  const image = tagged && trusted && isPublicHttpUrl(tagged) ? tagged : null;
  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => openOnWeb(raw)}
      accessibilityRole="button"
      accessibilityLabel={t('nostrContent.articleA11y', { title })}
      testID={`nostr-embed-article-${event.id.slice(0, 12)}`}
      activeOpacity={0.8}
    >
      {image ? (
        <Image
          source={{ uri: image }}
          style={styles.articleImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={image}
          autoplay={false}
        />
      ) : null}
      <Text style={styles.cardKicker}>{t('nostrContent.article')}</Text>
      <Text style={styles.cardTitle} numberOfLines={2}>
        {title}
      </Text>
      {summary ? (
        <Text style={styles.cardBody} numberOfLines={3}>
          {summary}
        </Text>
      ) : null}
      <View style={styles.cardHeader}>
        <View style={styles.cardAuthor}>
          <AuthorInline pubkey={event.pubkey} size={20} />
        </View>
        <Text style={styles.cardTime}>{relativeTime(event.created_at)}</Text>
      </View>
    </TouchableOpacity>
  );
};

const ProductEmbed: React.FC<{ product: MarketProduct }> = ({ product }) => {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const seller = usePubkeyProfile(product.listing?.event.pubkey ?? null);
  const open = useCallback(
    (p: MarketProduct) => navigation.push('ProductDetail', { productId: p.id, product: p }),
    [navigation],
  );
  return (
    <MarketProductCard
      product={product}
      sellerName={seller.name?.trim() || product.sellerName}
      onPress={open}
      variant="list"
      testID={`nostr-embed-product-${product.listing?.event.id.slice(0, 12) ?? product.id}`}
    />
  );
};

export default React.memo(EmbeddedEventCard);
