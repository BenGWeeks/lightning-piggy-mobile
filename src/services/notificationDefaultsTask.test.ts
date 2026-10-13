import { setActivePubkeyForWalletStorage } from './walletStorageService';
import {
  beginDefaultSetup,
  isDefaultSetupCurrent,
  noteManualNotificationChange,
} from './notificationDefaultsTask';

beforeEach(() => setActivePubkeyForWalletStorage('first'));

it('is current only while its account is the live one', () => {
  const task = beginDefaultSetup('FIRST');
  expect(task.pubkey).toBe('first');
  expect(isDefaultSetupCurrent(task)).toBe(true);
  expect(isDefaultSetupCurrent(beginDefaultSetup('second'))).toBe(false);
});

it.each([
  ['switch', 'second'],
  ['sign-out', null],
])('goes stale on account %s, even if the account comes back', (_action, next) => {
  const task = beginDefaultSetup('first');
  setActivePubkeyForWalletStorage(next);
  expect(isDefaultSetupCurrent(task)).toBe(false);
  setActivePubkeyForWalletStorage('first');
  expect(isDefaultSetupCurrent(task)).toBe(false); // a new generation — restart, don't resume
  expect(isDefaultSetupCurrent(beginDefaultSetup('first'))).toBe(true);
});

it('goes stale when the user makes a notification choice meanwhile', () => {
  const task = beginDefaultSetup('first');
  noteManualNotificationChange();
  expect(isDefaultSetupCurrent(task)).toBe(false);
  // The next run starts after the choice and reads it from storage instead.
  expect(isDefaultSetupCurrent(beginDefaultSetup('first'))).toBe(true);
});

it('stays stale once aborted', () => {
  const task = beginDefaultSetup('first');
  task.aborted = true;
  expect(isDefaultSetupCurrent(task)).toBe(false);
});
