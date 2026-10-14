import React, { useMemo } from 'react';
import EmbeddedEventCard from './nostr/EmbeddedEventCard';
import { useThemeColors } from '../contexts/ThemeContext';
import { createNostrContentStyles } from '../styles/NostrContent.styles';
import type { EmbedRef } from '../services/nostrEmbedCache';

/**
 * A Market listing shared into a DM (#1541) — a `nostr:naddr1…` reference to
 * a kind-30402 listing on a line of its own. Reuses the notes feed's embedded
 * product card (image, title, price, seller; tap opens the product page),
 * resolved through the same batched, verified, cached embed lookup.
 */
const MessageSharedListing: React.FC<{ token: EmbedRef }> = ({ token }) => {
  const colors = useThemeColors();
  const styles = useMemo(() => createNostrContentStyles(colors), [colors]);
  return <EmbeddedEventCard token={token} styles={styles} />;
};

export default React.memo(MessageSharedListing);
