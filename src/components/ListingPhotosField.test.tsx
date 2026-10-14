import React from 'react';
import { render } from '@testing-library/react-native';
import ListingPhotosField from './ListingPhotosField';
import { createI18nInstance, SUPPORTED_LOCALES } from '../i18n';
import { createMarketSellerStyles } from '../styles/MarketSeller.styles';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => ({}) }));
jest.mock('../contexts/LocaleContext', () => ({
  useTranslation: () => mockI18n.t.bind(mockI18n),
}));
jest.mock('../components/BrandedSpinner', () => () => null);
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));
jest.mock('../styles/MarketSeller.styles', () => ({
  createMarketSellerStyles: () => new Proxy({}, { get: () => ({}) }),
}));

let mockI18n = createI18nInstance('en');

it.each(SUPPORTED_LOCALES)('interpolates the photo count in %s', (locale) => {
  mockI18n = createI18nInstance(locale);
  const props = {
    uploading: false,
    onAdd: jest.fn(),
    onRemove: jest.fn(),
    onMove: jest.fn(),
    onSetCover: jest.fn(),
    styles: createMarketSellerStyles({} as Parameters<typeof createMarketSellerStyles>[0]),
  };
  const screen = render(<ListingPhotosField {...props} images={[]} />);
  expect(screen.getByTestId('listing-photo-count').props.children).toBe('0 / 8');
  screen.rerender(<ListingPhotosField {...props} images={['https://b.example/1.jpg']} />);
  expect(screen.getByTestId('listing-photo-count').props.children).toBe('1 / 8');
});
