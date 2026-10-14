import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import FullscreenImageModal from './FullscreenImageModal';

jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0 }) }));
jest.mock('react-native-gesture-handler', () => ({
  GestureHandlerRootView: jest.requireActual<typeof import('react-native')>('react-native').View,
}));
jest.mock('./ZoomableImage', () => () => null);

it('updates the counter after an aligned slow drag without a momentum event', () => {
  const view = render(
    <FullscreenImageModal
      url="https://example.com/1"
      urls={['https://example.com/1', 'https://example.com/2']}
      onClose={jest.fn()}
    />,
  );
  const width = view.getByTestId('fullscreen-image-gallery').props.getItemLayout(null, 1).length;
  expect(view.getByTestId('fullscreen-image-counter')).toHaveTextContent('1 / 2');
  fireEvent(view.getByTestId('fullscreen-image-gallery'), 'scrollEndDrag', {
    nativeEvent: { contentOffset: { x: width }, velocity: { x: 0 } },
  });
  expect(view.getByTestId('fullscreen-image-counter')).toHaveTextContent('2 / 2');
});

it('waits for momentum to settle a moving or unaligned drag', () => {
  const view = render(
    <FullscreenImageModal
      url="https://example.com/1"
      urls={['https://example.com/1', 'https://example.com/2']}
      onClose={jest.fn()}
    />,
  );
  const pager = view.getByTestId('fullscreen-image-gallery');
  const width = pager.props.getItemLayout(null, 1).length;
  for (const [x, velocity] of [
    [width, 1],
    [width * 0.7, 0],
  ]) {
    fireEvent(pager, 'scrollEndDrag', {
      nativeEvent: { contentOffset: { x }, velocity: { x: velocity } },
    });
    expect(view.getByTestId('fullscreen-image-counter')).toHaveTextContent('1 / 2');
  }
  fireEvent(pager, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: width } } });
  expect(view.getByTestId('fullscreen-image-counter')).toHaveTextContent('2 / 2');
});
