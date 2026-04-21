import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  BackHandler,
  Keyboard,
  Platform,
  ActivityIndicator,
  Linking,
  Dimensions,
} from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Search, X } from 'lucide-react-native';
import {
  BottomSheetModal,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetTextInput,
  BottomSheetFlatList,
} from '@gorhom/bottom-sheet';
import { colors } from '../styles/theme';
import { searchGifs, getTrending, isConfigured, Gif } from '../services/giphyService';

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (gif: Gif) => void;
}

const GRID_COLUMNS = 2;
const GRID_GAP = 8;
const TILE_HEIGHT = 110;

const GifPickerSheet: React.FC<Props> = ({ visible, onClose, onSelect }) => {
  const sheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['75%'], []);
  const topInset = 60;

  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [results, setResults] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const configured = isConfigured();

  // Derive tile width from the live window size so rotation and tablet
  // layouts keep a square-ish grid. The sheet is full-width inside a
  // 20 px horizontal padding and the tiles are separated by `GRID_GAP`.
  const tileWidth = useMemo(() => {
    const w = Dimensions.get('window').width;
    const inner = w - 20 * 2;
    const totalGap = GRID_GAP * (GRID_COLUMNS - 1);
    return Math.floor((inner - totalGap) / GRID_COLUMNS);
  }, []);

  useEffect(() => {
    if (visible) {
      setSearch('');
      setError(null);
      sheetRef.current?.present();
    } else {
      sheetRef.current?.dismiss();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Fetch trending / search results as the sheet opens and whenever the
  // deferred query settles. `useDeferredValue` + an in-effect cancel flag
  // keeps us from stomping an older slow search over a newer fast one.
  useEffect(() => {
    if (!visible || !configured) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const run = async () => {
      try {
        const gifs = deferredSearch.trim() ? await searchGifs(deferredSearch) : await getTrending();
        if (!cancelled) setResults(gifs);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load GIFs.');
          setResults([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [visible, deferredSearch, configured]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop {...props} disappearsOnIndex={-1} appearsOnIndex={0} />
    ),
    [],
  );

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  const renderItem = useCallback(
    ({ item }: { item: Gif }) => (
      <TouchableOpacity
        onPress={() => onSelect(item)}
        activeOpacity={0.8}
        style={[styles.tile, { width: tileWidth, height: TILE_HEIGHT }]}
        accessibilityLabel={`Send GIF: ${item.title || 'reaction'}`}
        testID={`gif-tile-${item.id}`}
      >
        <ExpoImage
          source={{ uri: item.previewUrl }}
          style={styles.tileImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          transition={150}
          accessibilityIgnoresInvertColors
        />
      </TouchableOpacity>
    ),
    [onSelect, tileWidth],
  );

  return (
    <BottomSheetModal
      ref={sheetRef}
      snapPoints={snapPoints}
      topInset={topInset}
      onChange={handleSheetChange}
      enablePanDownToClose
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      backdropComponent={renderBackdrop}
      handleIndicatorStyle={styles.handleIndicator}
      backgroundStyle={styles.sheetBackground}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Send a GIF</Text>
        <TouchableOpacity
          onPress={onClose}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityLabel="Close GIF picker"
          testID="gif-close"
        >
          <X size={22} color={colors.textSupplementary} />
        </TouchableOpacity>
      </View>
      <View style={styles.searchRow}>
        <Search size={18} color={colors.textSupplementary} />
        <BottomSheetTextInput
          style={styles.searchInput}
          placeholder="Search for GIFs"
          placeholderTextColor={colors.textSupplementary}
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search GIFs"
          testID="gif-search-input"
        />
      </View>

      {!configured ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>GIFs are not configured</Text>
          <Text style={styles.emptySubtitle}>
            The GIPHY API key hasn&apos;t been set for this build. Add a key to{' '}
            <Text style={styles.code}>EXPO_PUBLIC_GIPHY_API_KEY</Text> in your environment and
            rebuild.
          </Text>
          <TouchableOpacity
            style={styles.emptyAction}
            onPress={() => Linking.openURL('https://developers.giphy.com/dashboard/')}
            accessibilityLabel="Open GIPHY developer dashboard"
          >
            <Text style={styles.emptyActionText}>Open GIPHY dashboard</Text>
          </TouchableOpacity>
        </View>
      ) : error ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Could not load GIFs</Text>
          <Text style={styles.emptySubtitle}>{error}</Text>
        </View>
      ) : (
        <BottomSheetFlatList
          data={results}
          keyExtractor={(item: Gif) => item.id}
          renderItem={renderItem}
          numColumns={GRID_COLUMNS}
          columnWrapperStyle={styles.row}
          contentContainerStyle={[
            styles.grid,
            { paddingBottom: Math.max(keyboardHeight + 24, 40) },
          ]}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.brandPink} />
              </View>
            ) : (
              <View style={styles.emptyState}>
                <Text style={styles.emptySubtitle}>No GIFs matched your search.</Text>
              </View>
            )
          }
          ListFooterComponent={<Text style={styles.attribution}>Powered by GIPHY</Text>}
        />
      )}
    </BottomSheetModal>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: colors.white,
  },
  handleIndicator: {
    backgroundColor: colors.divider,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textHeader,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: colors.background,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.textBody,
    padding: 0,
  },
  grid: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: GRID_GAP,
  },
  row: {
    gap: GRID_GAP,
    marginBottom: GRID_GAP,
  },
  tile: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  tileImage: {
    width: '100%',
    height: '100%',
  },
  loading: {
    paddingVertical: 60,
    alignItems: 'center',
  },
  emptyState: {
    paddingHorizontal: 20,
    paddingVertical: 40,
    alignItems: 'center',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textHeader,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.textSupplementary,
    textAlign: 'center',
    lineHeight: 20,
  },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 13,
    color: colors.textBody,
  },
  emptyAction: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: colors.brandPink,
  },
  emptyActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.white,
  },
  attribution: {
    textAlign: 'center',
    fontSize: 11,
    color: colors.textSupplementary,
    paddingVertical: 12,
  },
});

export default GifPickerSheet;
