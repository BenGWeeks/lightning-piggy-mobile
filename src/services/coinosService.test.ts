/**
 * Pure-logic + fetch-mocked tests for the CoinOS managed-wallet service
 * (#287). Exercises the input validation, the request construction, and
 * the error-mapping table — does NOT hit the live coinos.io endpoint.
 */
import {
  CoinosError,
  DEFAULT_COINOS_BASE_URL,
  createCoinosNwcConnection,
  generateStrongPassword,
  listCoinosApps,
  probeCoinosInstance,
  registerCoinosUser,
  suggestUsername,
} from './coinosService';

type FetchMock = jest.Mock<Promise<Response>, [RequestInfo, RequestInit?]>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/plain' },
  });
}

describe('coinosService.suggestUsername', () => {
  it('returns an `lp_<8 hex>` username matching the validation regex', () => {
    const u = suggestUsername();
    expect(u).toMatch(/^lp_[0-9a-f]{8}$/);
    // Two consecutive calls don't collide (CSPRNG, not a counter).
    expect(suggestUsername()).not.toBe(u);
  });
});

describe('coinosService.generateStrongPassword', () => {
  it('returns a base64url string of >=40 chars (>=240 bits of entropy)', () => {
    const p = generateStrongPassword();
    expect(p.length).toBeGreaterThanOrEqual(40);
    // base64url alphabet only — no `+`, `/`, `=`.
    expect(p).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(generateStrongPassword()).not.toBe(p);
  });
});

describe('coinosService.registerCoinosUser', () => {
  let fetchMock: FetchMock;
  const originalFetch = global.fetch;
  beforeEach(() => {
    fetchMock = jest.fn<Promise<Response>, [RequestInfo, RequestInit?]>();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  });

  it('rejects invalid usernames before hitting the network', async () => {
    await expect(registerCoinosUser({ username: 'AB', password: 'longenoughpassword' })).rejects.toBeInstanceOf(CoinosError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects short passwords before hitting the network', async () => {
    await expect(registerCoinosUser({ username: 'lp_aaaaaaaa', password: 'short' })).rejects.toBeInstanceOf(CoinosError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs JSON to /register and returns the JWT on 200', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ token: 'jwt-abc', sk: 'sk-hex', pubkey: 'pk-hex', username: 'lp_aaaaaaaa' }),
    );
    const result = await registerCoinosUser({ username: 'lp_aaaaaaaa', password: 'longenoughpassword' });
    expect(result.token).toBe('jwt-abc');
    expect(result.sk).toBe('sk-hex');
    expect(result.pubkey).toBe('pk-hex');
    expect(result.username).toBe('lp_aaaaaaaa');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`${DEFAULT_COINOS_BASE_URL}/register`);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({ user: { username: 'lp_aaaaaaaa', password: 'longenoughpassword' } });
  });

  it('honours a custom self-hosted baseUrl and strips trailing slashes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ token: 'jwt' }));
    await registerCoinosUser({
      baseUrl: 'https://my-coinos.example.com/',
      username: 'lp_aaaaaaaa',
      password: 'longenoughpassword',
    });
    expect(fetchMock.mock.calls[0][0]).toBe('https://my-coinos.example.com/register');
  });

  it('classifies "username taken" as username_taken', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('username already exists', 400));
    await expect(
      registerCoinosUser({ username: 'lp_aaaaaaaa', password: 'longenoughpassword' }),
    ).rejects.toMatchObject({ code: 'username_taken' });
  });

  it('classifies HTTP 429 as rate_limited', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('too many', 429));
    await expect(
      registerCoinosUser({ username: 'lp_aaaaaaaa', password: 'longenoughpassword' }),
    ).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('classifies HTTP 5xx as service_down', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('internal', 500));
    await expect(
      registerCoinosUser({ username: 'lp_aaaaaaaa', password: 'longenoughpassword' }),
    ).rejects.toMatchObject({ code: 'service_down' });
  });

  it('classifies a thrown TypeError (DNS / offline) as network', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(
      registerCoinosUser({ username: 'lp_aaaaaaaa', password: 'longenoughpassword' }),
    ).rejects.toMatchObject({ code: 'network' });
  });

  it('rejects when the server returns 200 without a JWT', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    await expect(
      registerCoinosUser({ username: 'lp_aaaaaaaa', password: 'longenoughpassword' }),
    ).rejects.toBeInstanceOf(CoinosError);
  });
});

describe('coinosService.listCoinosApps', () => {
  let fetchMock: FetchMock;
  const originalFetch = global.fetch;
  beforeEach(() => {
    fetchMock = jest.fn<Promise<Response>, [RequestInfo, RequestInit?]>();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  });

  it('GETs /apps with the bearer token and parses the array', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        {
          pubkey: 'pk1',
          secret: 'secret1',
          nwc: 'nostr+walletconnect://srv?relay=wss%3A%2F%2Fr&secret=secret1&lud16=u%40h',
          name: 'Lightning Piggy',
        },
      ]),
    );
    const apps = await listCoinosApps({ token: 'jwt-abc' });
    expect(apps).toHaveLength(1);
    expect(apps[0].pubkey).toBe('pk1');
    expect(apps[0].nwc).toContain('nostr+walletconnect://');

    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe('GET');
    expect((init?.headers as Record<string, string>)?.Authorization).toBe('Bearer jwt-abc');
  });

  it('drops malformed entries instead of throwing', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { pubkey: 'pk1', secret: 's1', nwc: 'nostr+walletconnect://...' },
        { pubkey: 'pk2' /* missing secret + nwc */ },
        null,
      ]),
    );
    const apps = await listCoinosApps({ token: 'jwt' });
    expect(apps).toHaveLength(1);
    expect(apps[0].pubkey).toBe('pk1');
  });

  it('throws when the response is not an array', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ wat: true }));
    await expect(listCoinosApps({ token: 'jwt' })).rejects.toBeInstanceOf(CoinosError);
  });
});

describe('coinosService.createCoinosNwcConnection', () => {
  let fetchMock: FetchMock;
  const originalFetch = global.fetch;
  beforeEach(() => {
    fetchMock = jest.fn<Promise<Response>, [RequestInfo, RequestInit?]>();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  });

  it('POSTs /app with a generated secret + derived pubkey, then resolves the matching /apps entry', async () => {
    // First call is POST /app — server returns {} per upstream impl.
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    // Second call is GET /apps. We capture the body of the first call to
    // know which secret/pubkey to echo back so the resolver matches.
    let mintedPubkey: string | null = null;
    let mintedSecret: string | null = null;
    fetchMock.mockImplementationOnce(async () => {
      // Read the previous /app call's body to know what to echo.
      const sent = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
      mintedPubkey = sent.pubkey;
      mintedSecret = sent.secret;
      return jsonResponse([
        {
          pubkey: sent.pubkey,
          secret: sent.secret,
          nwc: `nostr+walletconnect://srvpk?relay=wss%3A%2F%2Fr&secret=${sent.secret}&lud16=lp_x%40coinos.io`,
        },
      ]);
    });

    const result = await createCoinosNwcConnection({ token: 'jwt-abc', name: 'Lightning Piggy' });
    expect(result.pubkey).toBe(mintedPubkey);
    expect(result.secret).toBe(mintedSecret);
    expect(result.nwc.startsWith('nostr+walletconnect://')).toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(`${DEFAULT_COINOS_BASE_URL}/app`);
    expect(fetchMock.mock.calls[1][0]).toBe(`${DEFAULT_COINOS_BASE_URL}/apps`);

    // /app body must include the derived pubkey + secret + a 'never' budget renewal
    const body = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(body.budget_renewal).toBe('never');
    expect(body.notify).toBe(false);
    expect(typeof body.secret).toBe('string');
    expect(body.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(typeof body.pubkey).toBe('string');
    expect(body.pubkey).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws when the minted app is not present in /apps', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}));
    fetchMock.mockResolvedValueOnce(jsonResponse([])); // empty list
    await expect(
      createCoinosNwcConnection({ token: 'jwt', name: 'Lightning Piggy' }),
    ).rejects.toBeInstanceOf(CoinosError);
  });

  it('propagates auth errors from /app', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('unauthorized', 401));
    await expect(
      createCoinosNwcConnection({ token: 'bad', name: 'Lightning Piggy' }),
    ).rejects.toMatchObject({ code: 'auth' });
  });
});

describe('coinosService.probeCoinosInstance', () => {
  let fetchMock: FetchMock;
  const originalFetch = global.fetch;
  beforeEach(() => {
    fetchMock = jest.fn<Promise<Response>, [RequestInfo, RequestInit?]>();
    (global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    (global as unknown as { fetch: typeof fetch }).fetch = originalFetch;
  });

  it('returns true on a 200', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('ok', 200));
    await expect(probeCoinosInstance('https://my-coinos.example.com')).resolves.toBe(true);
    expect(fetchMock.mock.calls[0][0]).toBe('https://my-coinos.example.com/health');
  });

  it('returns false on network failure', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(probeCoinosInstance('https://bogus.example.com')).resolves.toBe(false);
  });

  it('returns false on 5xx', async () => {
    fetchMock.mockResolvedValueOnce(textResponse('boom', 500));
    await expect(probeCoinosInstance('https://my-coinos.example.com')).resolves.toBe(false);
  });
});
