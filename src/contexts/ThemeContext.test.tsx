import React from 'react';
import { act, renderHook, waitFor, render, fireEvent } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ThemeProvider, useTheme } from './ThemeContext';
import OutgoingBubbleStyleSection from '../components/OutgoingBubbleStyleSection';
import { outgoingBubblePalettes } from '../styles/outgoingBubblePalettes';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);
beforeEach(async () => {
  await AsyncStorage.clear();
  jest.clearAllMocks();
});

test('defaults outgoing bubbles to A and persists a palette change', async () => {
  const { result } = renderHook(useTheme, { wrapper });
  await act(async () => {});
  expect(result.current.outgoingBubbleStyle).toBe('A');
  expect(result.current.colors.outgoingBubble).toEqual(outgoingBubblePalettes.A);
  act(() => result.current.setOutgoingBubbleStyle('B'));
  expect(result.current.colors.outgoingBubble).toEqual(outgoingBubblePalettes.B);
  expect(await AsyncStorage.getItem('app_outgoing_bubble_style')).toBe('B');
});

test.each(['B', 'C'] as const)('restores saved palette %s', async (style) => {
  await AsyncStorage.setItem('app_outgoing_bubble_style', style);
  const { result } = renderHook(useTheme, { wrapper });
  await waitFor(() => expect(result.current.outgoingBubbleStyle).toBe(style));
  expect(result.current.colors.outgoingBubble).toEqual(outgoingBubblePalettes[style]);
});

test('invalid saved palette safely falls back to A', async () => {
  await AsyncStorage.setItem('app_outgoing_bubble_style', 'bogus');
  const { result } = renderHook(useTheme, { wrapper });
  await act(async () => {});
  expect(result.current.outgoingBubbleStyle).toBe('A');
});

jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));

test('Advanced developer selector switches the persisted palette between A, B and C', async () => {
  const ui = render(
    <ThemeProvider>
      <OutgoingBubbleStyleSection />
    </ThemeProvider>,
  );
  await act(async () => {});
  for (const style of ['B', 'C', 'A']) {
    fireEvent.press(ui.getByTestId(`advanced-bubble-style-${style}`));
    expect(ui.getByTestId(`advanced-bubble-style-${style}`).props.accessibilityState.selected).toBe(
      true,
    );
    expect(await AsyncStorage.getItem('app_outgoing_bubble_style')).toBe(style);
  }
});
