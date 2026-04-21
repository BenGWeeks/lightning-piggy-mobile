import { StyleSheet, Platform, StatusBar } from 'react-native';
import { colors } from './theme';

const STATUS_BAR_TOP = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 40) + 4 : 44;

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBackground: {
    height: 140,
    backgroundColor: colors.brandPink,
    overflow: 'hidden',
  },
  headerImage: {
    width: '100%',
    height: '100%',
  },
  homeButton: {
    position: 'absolute',
    top: STATUS_BAR_TOP,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  headerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(236, 0, 140, 0.65)', // brandPink with 65% opacity
  },
  headerTitle: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    color: colors.white,
    fontSize: 22,
    fontWeight: '700',
  },
  scrollArea: {
    flex: 1,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: 16,
    gap: 16,
  },
  courseCard: {
    width: '47%',
    backgroundColor: colors.white,
    borderRadius: 12,
    overflow: 'hidden',
    paddingBottom: 14,
  },
  chipSpacer: {
    flex: 1,
  },
  imageWrapper: {
    width: '100%',
    height: 130,
    position: 'relative',
  },
  courseImage: {
    width: '100%',
    height: '100%',
  },
  completeBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: colors.green,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  completeBadgeText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
  },
  courseTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textHeader,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  courseMeta: {
    fontSize: 12,
    color: colors.textSupplementary,
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 8,
  },
  chipNew: {
    marginHorizontal: 12,
    backgroundColor: colors.brandPink,
    paddingHorizontal: 14,
    height: 26,
    justifyContent: 'center',
    borderRadius: 100,
    alignSelf: 'flex-start',
  },
  chipNewText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  chipProgress: {
    marginHorizontal: 12,
    backgroundColor: colors.brandPinkLight,
    paddingHorizontal: 14,
    height: 26,
    justifyContent: 'center',
    borderRadius: 100,
    alignSelf: 'flex-start',
  },
  chipProgressText: {
    color: colors.brandPink,
    fontSize: 11,
    fontWeight: '700',
  },
  chipEarned: {
    marginHorizontal: 12,
    backgroundColor: colors.greenLight,
    paddingHorizontal: 14,
    height: 26,
    justifyContent: 'center',
    borderRadius: 100,
    alignSelf: 'flex-start',
  },
  chipEarnedText: {
    color: colors.greenDark,
    fontSize: 11,
    fontWeight: '700',
  },
});
