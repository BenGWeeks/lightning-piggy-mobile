/** Signer state is independent of whether a particular ciphertext is valid. */
export class SignerUnavailableError extends Error {
  readonly kind = 'unavailable';
  constructor(message = 'Signer unavailable') {
    super(message);
    this.name = 'SignerUnavailableError';
  }
}

export class NostrConnectError extends Error {
  constructor(
    readonly kind: 'unavailable' | 'permission' | 'failed' | 'decrypt-failed',
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'NostrConnectError';
  }
}

/** Last resort for crypto libraries / bunkers that expose only a message. */
export function isCiphertextDecryptError(error: unknown): boolean {
  const message = typeof error === 'string' ? error : (error as Error | null)?.message;
  return (
    typeof message === 'string' &&
    /invalid (?:ciphertext|MAC|padding)|(?:bad|wrong) padding|invalid PKCS#7|(?:MAC|authentication tag) (?:check |verification )?failed|ciphertext.*(?:invalid|malformed)|wrong final block length/i.test(
      message,
    )
  );
}
