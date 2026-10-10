import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { BottomSheetModal, SHEET_CONTENT_A11Y_PROPS } from './AccessibleBottomSheetModal';

// Capture the props the wrapper hands to the real library modal.
const mockReceived: Record<string, unknown>[] = [];
const mockPresent = jest.fn();

jest.mock('@gorhom/bottom-sheet', () => {
  const R = jest.requireActual('react');
  const RN = jest.requireActual('react-native');
  return {
    BottomSheetModal: R.forwardRef(function Modal(
      props: Record<string, unknown> & { children?: React.ReactNode },
      ref: React.Ref<unknown>,
    ) {
      mockReceived.push(props);
      R.useImperativeHandle(ref, () => ({ present: mockPresent, dismiss: jest.fn() }));
      return R.createElement(RN.View, null, props.children);
    }),
  };
});

beforeEach(() => {
  mockReceived.length = 0;
  mockPresent.mockClear();
});

describe('AccessibleBottomSheetModal', () => {
  it('turns off the library\'s "Bottom Sheet" a11y collapse on the content container', () => {
    render(
      <BottomSheetModal snapPoints={['50%']}>
        <Text>inside</Text>
      </BottomSheetModal>,
    );
    const props = mockReceived[mockReceived.length - 1];
    expect(props.accessible).toBe(false);
    // null (not undefined) so the library's 'Bottom Sheet' / 'adjustable'
    // destructuring defaults don't kick back in.
    expect(props.accessibilityLabel).toBeNull();
    expect(props.accessibilityRole).toBeNull();
    expect(SHEET_CONTENT_A11Y_PROPS).toEqual({
      accessible: false,
      accessibilityLabel: null,
      accessibilityRole: null,
    });
  });

  it('cannot be re-collapsed by a call site', () => {
    const sneaky = {
      accessible: true,
      accessibilityLabel: 'Bottom Sheet',
    } as unknown as Record<string, never>;
    render(
      <BottomSheetModal snapPoints={['50%']} {...sneaky}>
        <Text>inside</Text>
      </BottomSheetModal>,
    );
    const props = mockReceived[mockReceived.length - 1];
    expect(props.accessible).toBe(false);
    expect(props.accessibilityLabel).toBeNull();
  });

  it('passes other props and children through and forwards the ref', () => {
    const ref = React.createRef<BottomSheetModal>();
    const onDismiss = jest.fn();
    render(
      <BottomSheetModal ref={ref} snapPoints={['90%']} onDismiss={onDismiss}>
        <Text>sheet body</Text>
      </BottomSheetModal>,
    );
    const props = mockReceived[mockReceived.length - 1];
    expect(props.snapPoints).toEqual(['90%']);
    expect(props.onDismiss).toBe(onDismiss);
    expect(screen.getByText('sheet body')).toBeTruthy();
    ref.current?.present();
    expect(mockPresent).toHaveBeenCalledTimes(1);
  });
});
