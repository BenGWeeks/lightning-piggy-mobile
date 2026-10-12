import { createToastOwnership } from './toastOwnership';
it('dismisses an owned toast once and preserves a replacing notification', () => {
  const adapter = { show: jest.fn(), hide: jest.fn() };
  const toast = createToastOwnership(adapter);
  const dismiss = toast.showOwned({});
  dismiss();
  dismiss();
  expect(adapter.hide).toHaveBeenCalledTimes(1);
  const stale = toast.showOwned({});
  toast.show({});
  stale();
  expect(adapter.hide).toHaveBeenCalledTimes(1);
});
it('does not hide another owner or an already dismissed toast', () => {
  const adapter = { show: jest.fn(), hide: jest.fn() };
  const toast = createToastOwnership(adapter);
  const first = toast.showOwned({});
  const onHide = jest.fn();
  const second = toast.showOwned({ onHide });
  first();
  expect(adapter.hide).not.toHaveBeenCalled();
  adapter.show.mock.calls[1][0].onHide();
  second();
  expect(adapter.hide).not.toHaveBeenCalled();
  expect(onHide).toHaveBeenCalledTimes(1);
});
