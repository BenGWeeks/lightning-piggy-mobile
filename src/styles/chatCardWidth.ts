import { useWindowDimensions } from 'react-native';

export const CHAT_CARD_MAX_WIDTH = 320;

/**
 * Match the order card's typical phone footprint: 78% leaves room to show
 * direction, while the 320 dp cap keeps cards readable on tablets. Every
 * rich chat card uses this outer width; row alignment supplies equal margins.
 * Recompute on rotation / split-screen rather than caching Dimensions.get().
 */
export const chatCardWidth = (windowWidth: number): number =>
  Math.min(windowWidth * 0.78, CHAT_CARD_MAX_WIDTH);

export const useChatCardWidth = (): number => chatCardWidth(useWindowDimensions().width);

/** Preserve the source aspect ratio; invalid or unknown dimensions start square. */
export const chatImageAspectRatio = (width: number, height: number): number =>
  Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : 1;
