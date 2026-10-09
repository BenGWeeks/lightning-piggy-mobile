import {
  createSwapNotPaidError,
  isReverseSwapNeverSettlesStatus,
  neverSettlesStatusFromLockupError,
} from './reverseSwapNotPaid';
import { isReverseSwapNotPaid } from './swapHandoff';

describe('isReverseSwapNeverSettlesStatus', () => {
  it.each(['invoice.expired', 'swap.expired', 'transaction.failed', 'transaction.refunded'])(
    '%s proves the hold invoice can never settle',
    (status) => expect(isReverseSwapNeverSettlesStatus(status)).toBe(true),
  );

  // swap.created is NOT proof: Boltz reports it while holding our HTLC
  // before the lockup broadcast (#891). Lockup/settled statuses are commits.
  it.each([
    'swap.created',
    'minerfee.paid',
    'transaction.mempool',
    'transaction.confirmed',
    'invoice.settled',
    'invoice.pending',
    'invoice.failedToPay',
    '',
    undefined,
    null,
  ])('%s is not proof the swap is dead', (status) =>
    expect(isReverseSwapNeverSettlesStatus(status)).toBe(false),
  );
});

describe('neverSettlesStatusFromLockupError', () => {
  it("extracts a never-settles status from waitForLockup's explicit failure", () => {
    expect(
      neverSettlesStatusFromLockupError(new Error('Swap failed with status: swap.expired')),
    ).toBe('swap.expired');
  });

  it.each([
    new Error('Timeout waiting for swap sw1 after 900s'),
    new Error('Boltz status check failed: 500'),
    new Error('Swap failed with status: transaction.mempool'),
    new Error('Reverse lockup does not pay the verified address and amount'),
    'Swap failed with status: swap.expired',
    undefined,
  ])('ignores ambiguous or non-terminal lockup errors (%p)', (error) => {
    expect(neverSettlesStatusFromLockupError(error)).toBeNull();
  });
});

describe('createSwapNotPaidError', () => {
  it('reads as a definite "nothing was sent" pre-commit failure to every caller', () => {
    const error = createSwapNotPaidError('invoice.expired');
    expect(error.message).toMatch(/^Boltz swap failed: /);
    expect(error.message).toContain('invoice.expired');
    expect(isReverseSwapNotPaid(error)).toBe(true);
  });
});
