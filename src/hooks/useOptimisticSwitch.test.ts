import { act, renderHook } from '@testing-library/react-native';
import { useState } from 'react';
import { useOptimisticSwitch } from './useOptimisticSwitch';

const setup = (initial = false) => {
  const onError = jest.fn();
  const hook = renderHook(() => {
    const [value, setValue] = useState(initial);
    return { value, ...useOptimisticSwitch(value, setValue, onError) };
  });
  return { ...hook, onError };
};

it('flips immediately, keeps pending through registration, and ignores repeated taps', async () => {
  const { result } = setup();
  let resolve!: () => void;
  const operation = jest.fn(() => new Promise<void>((done) => (resolve = done)));
  let work!: Promise<void>;
  act(() => {
    work = result.current.run(true, operation);
  });
  expect(result.current.value).toBe(true);
  expect(result.current.pending).toBe(true);
  await act(async () => result.current.run(false, operation));
  expect(operation).toHaveBeenCalledTimes(1);
  expect(result.current.value).toBe(true);
  await act(async () => {
    resolve();
    await work;
  });
  expect(result.current.value).toBe(true);
  expect(result.current.pending).toBe(false);
});

it('reverts to the previous value on permission denial', async () => {
  const { result, onError } = setup();
  await act(async () => result.current.run(true, async () => false));
  expect(result.current.value).toBe(false);
  expect(result.current.pending).toBe(false);
  // The caller supplies the specific permission toast.
  expect(onError).not.toHaveBeenCalled();
});

it('reverts a failed disable and reports the error once', async () => {
  const { result, onError } = setup(true);
  await act(async () =>
    result.current.run(false, async () => {
      throw new Error('Registration failed');
    }),
  );
  expect(result.current.value).toBe(true);
  expect(result.current.pending).toBe(false);
  expect(onError).toHaveBeenCalledTimes(1);
});
