// Bottom-sheet preview of a NIP-GC kind-37516 cache. Shows the name,
// type/size/difficulty/terrain chips, description, and a "View details"
// action that opens HuntPiggyDetail. Used by both MapScreen (full map)
// and ExploreHomeScreen (mini-map, #627 / PR #630).
//
// Self-contained — takes the cache, callbacks, and a Palette. Builds
// its own dismissible-sheet behaviour + sheet styles internally so
// callers don't need to thread a styles prop through.

import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, Animated } from 'react-native';
import { PiggyBank } from 'lucide-react-native';
import { type ParsedCache } from '../services/nostrPlacesService';
import { useDismissibleSheet } from '../hooks/useDismissibleSheet';
import { createSheetStyles } from '../styles/sheetStyles';
import { useTranslation } from '../contexts/LocaleContext';
import type { Palette } from '../styles/palettes';

interface Props {
  cache: ParsedCache;
  colors: Palette;
  onClose: () => void;
  onViewDetails: () => void;
}

export const CacheDetailSheet: React.FC<Props> = ({ cache, colors, onClose, onViewDetails }) => {
  const t = useTranslation();
  const styles = useMemo(() => createSheetStyles(colors), [colors]);
  const { translateY, panHandlers } = useDismissibleSheet(onClose);
  const kindLabel = cache.isLpPiggy
    ? t('cacheDetailSheet.piglet')
    : t('cacheDetailSheet.nipGcCache');
  const specBits = [
    cache.cacheType,
    cache.size,
    cache.difficulty != null ? `D${cache.difficulty}` : null,
    cache.terrain != null ? `T${cache.terrain}` : null,
  ].filter(Boolean) as string[];
  return (
    <View style={styles.sheetBackdrop} testID="cache-detail-sheet">
      <TouchableOpacity
        style={styles.sheetTapAway}
        onPress={onClose}
        activeOpacity={1}
        accessibilityRole="button"
        accessibilityLabel={t('cacheDetailSheet.closeDetails')}
        testID="cache-detail-tap-away"
      />
      <Animated.View style={[styles.sheet, { transform: [{ translateY }] }]}>
        <View {...panHandlers} style={styles.sheetHandleGrabber} testID="cache-detail-grabber">
          <View style={styles.sheetHandle} />
        </View>
        <View style={styles.sheetTitleRow}>
          <View
            style={[
              styles.sheetIconWrap,
              {
                backgroundColor: cache.isLpPiggy ? colors.brandPink : colors.surface,
              },
            ]}
          >
            <PiggyBank
              size={18}
              color={cache.isLpPiggy ? colors.white : colors.brandPink}
              strokeWidth={2.5}
            />
          </View>
          <Text style={styles.sheetTitle} testID="cache-detail-name">
            {cache.name}
          </Text>
        </View>
        <View style={styles.sheetChipRow}>
          <View style={cache.isLpPiggy ? styles.sheetChipPink : styles.sheetChipGrey}>
            <Text style={cache.isLpPiggy ? styles.sheetChipPinkText : styles.sheetChipGreyText}>
              {kindLabel}
            </Text>
          </View>
          {specBits.length > 0 ? (
            <View style={styles.sheetChipGrey}>
              <Text style={styles.sheetChipGreyText}>{specBits.join(' · ')}</Text>
            </View>
          ) : null}
        </View>
        {cache.description ? (
          <Text style={styles.sheetDescription} numberOfLines={4}>
            {cache.description}
          </Text>
        ) : null}
        <View style={styles.sheetActions}>
          <TouchableOpacity
            style={styles.sheetButton}
            onPress={onViewDetails}
            testID="cache-detail-view-button"
            accessibilityLabel={t('cacheDetailSheet.openDetailA11y', { kind: kindLabel })}
          >
            <Text style={styles.sheetButtonText}>{t('cacheDetailSheet.viewDetails')}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </View>
  );
};
