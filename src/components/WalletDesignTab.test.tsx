import React from 'react';
import { render } from '@testing-library/react-native';
import { createI18nInstance } from '../i18n';
import type { CardTheme } from '../types/wallet';
import WalletDesignTab from './WalletDesignTab';

jest.mock('./WalletCardPicker', () => () => null);
jest.mock('lucide-react-native', () => ({ Palette: () => null, Save: () => null }));
jest.mock('./SettingsRow', () => {
  const { Text } = jest.requireActual('react-native');
  return function MockSettingsRow({ value, testID }: { value?: string; testID: string }) {
    return <Text testID={testID}>{value}</Text>;
  };
});

describe('wallet Design subtitle', () => {
  it.each([
    ['wise-owl', 'Tema de tarjeta seleccionado: Búho'],
    ['lightning-piggy', 'Tema de tarjeta seleccionado: Piggy'],
    ['obsolete-theme', 'Tema de tarjeta seleccionado: Piggy'],
  ])('shows the Spanish subtitle for %s', (theme, expected) => {
    const i18n = createI18nInstance('es');
    const { getByText } = render(
      <WalletDesignTab
        styles={{} as React.ComponentProps<typeof WalletDesignTab>['styles']}
        t={(scope, options) => i18n.t(scope, options)}
        selectedTheme={theme as CardTheme}
        onSelectTheme={jest.fn()}
        onSave={jest.fn()}
      />,
    );

    expect(getByText(expected).props.testID).toBe('wallet-design-row');
  });
});
