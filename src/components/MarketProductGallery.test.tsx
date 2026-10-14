import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Image } from 'expo-image';
import MarketProductGallery from './MarketProductGallery';
import FullscreenImageModal from './FullscreenImageModal';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({
  useTranslation: () => (key: string) => (key === 'imageGallery.open' ? 'Open image' : key),
}));
jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    View: jest.requireActual<typeof import('react-native')>('react-native').View,
    FlatList: jest.requireActual<typeof import('react-native')>('react-native').FlatList,
  },
}));
jest.mock('./FullscreenImageModal', () => jest.fn(() => null));

beforeEach(() => jest.clearAllMocks());

it.each([undefined, ['https://example.com/product.jpg']])(
  'opens a lone product image in the zoomable single-image viewer (%j)',
  (images) => {
    const image = 'https://example.com/product.jpg';
    const view = render(<MarketProductGallery image={image} images={images} title="Piggy" />);
    const hero = view.getByTestId('market-product-image-open');
    expect(hero.props.accessibilityRole).toBe('imagebutton');
    expect(hero.props.accessibilityLabel).toBe('Open image');
    fireEvent.press(hero);
    const props = jest.mocked(FullscreenImageModal).mock.calls.at(-1)![0];
    expect(props.url).toBe(image);
    expect(props.urls).toBeUndefined();
    fireEvent(view.UNSAFE_getByType(FullscreenImageModal), 'close');
    expect(jest.mocked(FullscreenImageModal).mock.calls.at(-1)![0].url).toBeNull();
  },
);

it('does not open a missing or failed image', () => {
  const view = render(<MarketProductGallery image="" title="Piggy" />);
  expect(view.queryByTestId('market-product-image-open')).toBeNull();
  view.rerender(<MarketProductGallery image="https://example.com/broken.jpg" title="Piggy" />);
  fireEvent(view.UNSAFE_getByType(Image), 'error');
  expect(view.queryByTestId('market-product-image-open')).toBeNull();
  expect(view.getByText('P')).toBeTruthy();
});
