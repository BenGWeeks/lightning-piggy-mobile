import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Platform, StyleSheet } from 'react-native';
import MessageLinkPreview from './MessageLinkPreview';

jest.mock('../contexts/ThemeContext', () => ({
  useThemeColors: () => jest.requireActual('../styles/palettes').lightPalette,
}));
jest.mock('../contexts/NostrContext', () => ({ useNostr: () => ({ pubkey: 'owner' }) }));
jest.mock('../hooks/useTapToReveal', () => ({ useTapToReveal: () => [true, jest.fn()] }));
jest.mock('./TapToLoadMedia', () => () => null);
jest.mock('../services/linkPreviewPreference', () => ({
  getLinkPreviewEnabled: async () => true,
  subscribeLinkPreviewEnabled: () => () => {},
}));
jest.mock('../services/linkPreviewBlocklist', () => ({ isBlocklisted: () => false }));
jest.mock('../services/linkPreviewFetcher', () => ({
  fetchLinkPreview: async (url: string) => ({
    title: 'Preview',
    domain: 'example.com',
    image: `${url}/image.png`,
  }),
}));
// Expose the native image props so the test can deliver an actual load event.
jest.mock('expo-image', () => ({
  Image: jest.requireActual('react-native').View,
}));

describe.each(['android', 'ios'] as const)('preview image layout on %s', (platform) => {
  afterEach(() => jest.restoreAllMocks());

  it.each([
    [600, 600],
    [600, 1200],
    [2400, 600],
  ])('preserves the cold-cache frame after loading %i×%i and remounting', async (width, height) => {
    jest.replaceProperty(Platform, 'OS', platform);
    const url = `https://example.com/${platform}/${width}/${height}`;
    const props = { url, eventId: 'message', autoLoad: true };
    const view = render(<MessageLinkPreview {...props} />);
    await act(async () => {});
    const image = await view.findByTestId('message-link-preview-image-message');
    const before = StyleSheet.flatten(image.props.style);
    expect(before.aspectRatio).toBe(1.91);
    // At 240px wide this frame reserves ~126px before any image data arrives.
    fireEvent(image, 'load', { source: { width, height } });
    const loaded = view.getByTestId('message-link-preview-image-message');
    expect(StyleSheet.flatten(loaded.props.style)).toEqual(before);
    expect(loaded.props.contentFit).toBe('contain');
    expect(loaded.props.cachePolicy).toBe('memory-disk');
    view.unmount();
    // A virtualized row coming back into view must reserve the same space.
    const remounted = render(<MessageLinkPreview {...props} />);
    await act(async () => {});
    const cachedImage = await remounted.findByTestId('message-link-preview-image-message');
    expect(StyleSheet.flatten(cachedImage.props.style)).toEqual(before);
  });
});
