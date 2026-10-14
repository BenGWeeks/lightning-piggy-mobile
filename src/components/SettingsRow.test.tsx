import React from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { render } from '@testing-library/react-native';
import { Globe } from 'lucide-react-native';

import SettingsRow from './SettingsRow';
import { lightPalette as mockPalette } from '../styles/palettes';

jest.mock('../contexts/ThemeContext', () => ({ useThemeColors: () => mockPalette }));
jest.mock('../contexts/LocaleContext', () => ({ useTranslation: () => (key: string) => key }));
jest.mock('./SettingsInfoSheet', () => () => null);
jest.mock('lucide-react-native', () => {
  const { View: MockView } = jest.requireActual('react-native');
  const icon = (name: string) => {
    const MockIcon = () => <MockView testID={`icon-${name}`} />;
    MockIcon.displayName = name;
    return MockIcon;
  };
  return {
    ChevronRight: icon('chevron'),
    ExternalLink: icon('external-link'),
    Info: icon('info'),
    Globe: icon('globe'),
  };
});

type ReactTestInstance = ReturnType<ReturnType<typeof render>['getByTestId']>;

const press = jest.fn();
const minHeight = (node: ReactTestInstance) =>
  StyleSheet.flatten(node.props.style as StyleProp<ViewStyle>)?.minHeight;

/** testIDs in render order: the row's trailing sequence reads left → right. */
function trailingOrder(root: ReactTestInstance, rowTestID: string): string[] {
  return root
    .findAll((n: ReactTestInstance) => n.type === View && typeof n.props.testID === 'string')
    .map((n: ReactTestInstance) => n.props.testID as string)
    .filter((id: string) => id.startsWith(`${rowTestID}-`) && !id.endsWith('-sheet'));
}

describe('SettingsRow trailing affordances (#1552)', () => {
  it('navigate rows: ⓘ first, then the chevron at the far right', () => {
    const r = render(
      <SettingsRow
        kind="navigate"
        icon={Globe}
        title="Trust"
        details="fine print"
        testID="row"
        onPress={press}
      />,
    );
    expect(trailingOrder(r.UNSAFE_root, 'row')).toEqual(['row-info', 'row-chevron']);
    expect(r.getByTestId('row').props.accessibilityRole).toBe('button');
  });

  it('external rows show ↗ instead of a chevron and announce as links', () => {
    const r = render(
      <SettingsRow kind="external" icon={Globe} title="Website" testID="web" onPress={press} />,
    );
    expect(r.queryByTestId('web-chevron')).toBeNull();
    expect(r.getByTestId('web-external')).toBeTruthy();
    const main = r.getByTestId('web');
    expect(main.props.accessibilityRole).toBe('link');
    expect(main.props.accessibilityHint).toBe('settingsKit.opensInBrowser');
  });

  it('toggle rows: ⓘ then the switch, no chevron', () => {
    const r = render(
      <SettingsRow
        kind="toggle"
        icon={Globe}
        title="Previews"
        details="fine print"
        testID="tg"
        toggle={{ value: true, onValueChange: press }}
      />,
    );
    expect(r.getByTestId('tg-info')).toBeTruthy();
    expect(r.getByTestId('tg-toggle')).toBeTruthy();
    expect(r.queryByTestId('tg-chevron')).toBeNull();
  });

  it('value and action rows have no trailing affordance', () => {
    const r = render(
      <>
        <SettingsRow kind="value" icon={Globe} title="Version" value="1.5.2" testID="v" />
        <SettingsRow kind="action" icon={Globe} title="Save" testID="a" onPress={press} />
      </>,
    );
    for (const id of ['v-chevron', 'v-external', 'a-chevron', 'a-external'])
      expect(r.queryByTestId(id)).toBeNull();
  });
});

describe('SettingsRow height (#1552)', () => {
  it('single-line rows are compact and render no empty second line', () => {
    const r = render(
      <SettingsRow
        kind="navigate"
        icon={Globe}
        title="Support"
        testID="one"
        subtitleTestID="one-sub"
        onPress={press}
      />,
    );
    expect(r.queryByTestId('one-sub')).toBeNull();
    expect(minHeight(r.getByTestId('one'))).toBe(56);
  });

  it('two-line rows keep the taller height', () => {
    const r = render(
      <SettingsRow
        kind="navigate"
        icon={Globe}
        title="Website"
        value="lightningpiggy.com"
        testID="two"
        subtitleTestID="two-sub"
        onPress={press}
      />,
    );
    expect(r.getByTestId('two-sub').props.children).toBe('lightningpiggy.com');
    expect(minHeight(r.getByTestId('two'))).toBe(76);
  });
});
