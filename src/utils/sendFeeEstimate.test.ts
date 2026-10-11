import { classifySendFeeError } from './sendFeeEstimate';

it('reads amounts from Android BDK InsufficientFunds rejections', () => {
  expect(
    classifySendFeeError(new Error('Insufficient funds: 4851 sat available of 20210 sat needed')),
  ).toEqual({ kind: 'insufficient', availableSats: 4851, neededSats: 20210 });
});
it('reads amounts from the iOS enum description', () => {
  expect(
    classifySendFeeError(
      new Error(
        'InsufficientFunds(message: "Insufficient funds: 0 sat available of 1210 sat needed")',
      ),
    ),
  ).toEqual({ kind: 'insufficient', availableSats: 0, neededSats: 1210 });
});
it('keeps an insufficient-funds error whose amounts cannot be parsed', () => {
  expect(classifySendFeeError('InsufficientFunds')).toEqual({
    kind: 'insufficient',
    availableSats: null,
    neededSats: null,
  });
});
it('treats every other failure as a plain error', () => {
  expect(classifySendFeeError(new Error('Output below the dust limit: 0'))).toEqual({
    kind: 'error',
  });
  expect(classifySendFeeError(undefined)).toEqual({ kind: 'error' });
});
