import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  BlossomUploadFailedError,
  ENCRYPTED_BLOB_FALLBACK_SERVERS,
  blossomBlobUrl,
  uploadEncryptedBlobToBlossom,
  uploadToBlossomServers,
  type BlossomSigner,
} from './blossomService';

// Minimal XMLHttpRequest fake: each PUT is answered by `respond(url, body)`.
type Call = { url: string; body: unknown; headers: Record<string, string> };
let calls: Call[] = [];
let respond: (url: string) => { status: number; responseText: string } | 'network-error' | 'hang';

class FakeXhr {
  status = 0;
  responseText = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  timeout = 0;
  private url = '';
  private headers: Record<string, string> = {};
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(k: string, v: string) {
    this.headers[k] = v;
  }
  send(body: unknown) {
    calls.push({ url: this.url, body, headers: this.headers });
    const r = respond(this.url);
    setTimeout(() => {
      if (r === 'network-error') return this.onerror?.();
      // A server that never answers: the request's timeout fires instead.
      if (r === 'hang') return this.timeout > 0 ? this.ontimeout?.() : undefined;
      this.status = r.status;
      this.responseText = r.responseText;
      this.onload?.();
    }, 0);
  }
}

const HASH = bytesToHex(sha256(Buffer.from('hello')));
const ok = (url: string) => ({
  status: 200,
  responseText: JSON.stringify({ url: `${new URL(url).origin}/${HASH}` }),
});
const signer: BlossomSigner = jest.fn(async (e) => ({ ...e, id: 'id', pubkey: 'p', sig: 's' }));
const B64 = Buffer.from('hello').toString('base64');

beforeEach(() => {
  calls = [];
  (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
  (signer as jest.Mock).mockClear();
});

const flush = () => new Promise((r) => setTimeout(r, 10));

it('uploads to the primary and mirrors to the backups with one signature', async () => {
  respond = (url) => ok(url.replace('/upload', '/blob'));
  const url = await uploadToBlossomServers(
    'file.jpg',
    ['https://a.example/', 'https://b.example', 'https://c.example'],
    signer,
    B64,
  );
  await flush();
  expect(url).toBe(`https://a.example/${HASH}`);
  expect(signer).toHaveBeenCalledTimes(1);
  expect(calls.map((c) => c.url)).toEqual([
    'https://a.example/upload',
    'https://b.example/mirror',
    'https://c.example/mirror',
  ]);
  expect(JSON.parse(calls[1].body as string)).toEqual({ url: `https://a.example/${HASH}` });
  expect(calls[1].headers.Authorization).toBe(calls[0].headers.Authorization);
});

it('fails over to the next server when the primary is down', async () => {
  respond = (url) => (url.startsWith('https://a.example') ? 'network-error' : ok(url));
  const url = await uploadToBlossomServers(
    'file.jpg',
    ['https://a.example', 'https://b.example'],
    signer,
    B64,
  );
  await flush();
  expect(url).toBe(`https://b.example/${HASH}`);
  // The (down) primary is still asked to mirror the stored blob.
  expect(calls.map((c) => c.url)).toEqual([
    'https://a.example/upload',
    'https://b.example/upload',
    'https://a.example/mirror',
  ]);
});

it("doesn't let a failing backup affect the upload", async () => {
  respond = (url) => (url.includes('/mirror') ? { status: 500, responseText: '' } : ok(url));
  await expect(
    uploadToBlossomServers('file.jpg', ['https://a.example', 'https://b.example'], signer, B64),
  ).resolves.toBe(`https://a.example/${HASH}`);
});

it('throws a branded error, keeping the last cause, when every server rejects the upload', async () => {
  respond = () => ({ status: 413, responseText: 'too big' });
  const error = await uploadToBlossomServers(
    'file.jpg',
    ['https://a.example', 'https://b.example'],
    signer,
    B64,
  ).catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BlossomUploadFailedError);
  expect((error as Error).message).toMatch("Couldn't upload to any storage server");
  expect(((error as Error).cause as Error).message).toBe('Blossom upload failed: 413 too big');
  expect(calls.map((c) => c.url)).toEqual(['https://a.example/upload', 'https://b.example/upload']);
});

it('times out an unresponsive primary and fails over to the next server', async () => {
  respond = (url) => (url.startsWith('https://a.example') ? 'hang' : ok(url));
  await expect(
    uploadToBlossomServers('file.jpg', ['https://a.example', 'https://b.example'], signer, B64),
  ).resolves.toBe(`https://b.example/${HASH}`);
  await flush(); // let the background mirror to the hung server settle
});

it('keeps the upload authorization valid for the whole failover budget', async () => {
  respond = (url) => ok(url);
  const servers = [
    'https://a.example',
    'https://b.example',
    'https://c.example',
    'https://d.example',
  ];
  await uploadToBlossomServers('file.jpg', servers, signer, B64);
  await flush();
  const auth = (signer as jest.Mock).mock.calls[0][0];
  const expiration = Number(auth.tags.find((t: string[]) => t[0] === 'expiration')[1]);
  // Four attempts of up to 120 s each, plus the mirror window.
  expect(expiration - auth.created_at).toBeGreaterThanOrEqual(4 * 120 + 300);
});

describe('uploadEncryptedBlobToBlossom', () => {
  const refuse = { status: 415, responseText: 'unsupported media type application/octet-stream' };

  it("falls back to servers that store ciphertext when the user's refuse it", async () => {
    // blossom.primal.net (the default) answers octet-stream with a 415.
    respond = (url) => (url.startsWith('https://blossom.primal.net') ? refuse : ok(url));
    const url = await uploadEncryptedBlobToBlossom(
      'f',
      ['https://blossom.primal.net'],
      signer,
      B64,
    );
    await flush();
    expect(url).toBe(`${ENCRYPTED_BLOB_FALLBACK_SERVERS[0]}/${HASH}`);
    // Refused by the user's server, stored on the first fallback…
    expect(calls.slice(0, 2).map((c) => c.url)).toEqual([
      'https://blossom.primal.net/upload',
      'https://blossom.divine.video/upload',
    ]);
    expect(calls[1].headers['Content-Type']).toBe('application/octet-stream');
    // …and mirrored among the fallbacks only, never back to the refusing server.
    expect(calls.slice(2).map((c) => c.url)).toEqual([
      'https://blossom.ditto.pub/mirror',
      'https://cdn.hzrd149.com/mirror',
    ]);
  });

  it("keeps using the user's server when it accepts ciphertext", async () => {
    respond = (url) => ok(url);
    const url = await uploadEncryptedBlobToBlossom('f', ['https://mine.example'], signer, B64);
    expect(url).toBe(`https://mine.example/${HASH}`);
    expect(calls).toHaveLength(1);
  });
});

describe('blossomBlobUrl (descriptor rule, #1508 / #1558)', () => {
  it.each([
    `https://a.example/${HASH}`,
    `https://a.example/${HASH}.jpg`,
    `https://a.example/media/${HASH}.bin`,
    // BUD-02: a server may serve its blobs from another host (its CDN).
    `https://cdn.divine.video/${HASH}`,
    `https://cdn.divine.video/${HASH}.bin`,
  ])('accepts %s', (url) => {
    expect(blossomBlobUrl(url, HASH)).toBe(url);
  });

  it.each([
    ['plain http', `http://a.example/${HASH}`],
    ['userinfo', `https://user@a.example/${HASH}`],
    ['loopback IP', `https://127.0.0.1/${HASH}`],
    ['private IP', `https://192.168.1.10/${HASH}`],
    ['localhost', `https://localhost/${HASH}`],
    ['non-default port', `https://a.example:8443/${HASH}`],
    ['no hash', 'https://a.example/wrong'],
    ['a different hash', `https://cdn.divine.video/${'0'.repeat(64)}`],
    ['hash with a suffix', `https://a.example/${HASH}extra`],
    ['hash not the last segment', `https://a.example/${HASH}/other`],
    ['hash only in the query', `https://a.example/?x=${HASH}`],
    ['upper-case hash', `https://a.example/${HASH.toUpperCase()}`],
    ['not a string', 42],
  ])('rejects %s', (_label, url) => {
    expect(blossomBlobUrl(url, HASH)).toBeNull();
  });

  it('rejects a descriptor whose declared sha256 disagrees with the bytes we sent', () => {
    expect(blossomBlobUrl(`https://a.example/${HASH}`, HASH, '0'.repeat(64))).toBeNull();
    expect(blossomBlobUrl(`https://a.example/${HASH}`, HASH, HASH.toUpperCase())).toBe(
      `https://a.example/${HASH}`,
    );
  });
});

it.each([
  'http://a.example/' + HASH,
  'https://user@a.example/' + HASH,
  'https://127.0.0.1/' + HASH,
  'https://a.example:8443/' + HASH,
  'https://a.example/wrong',
  'https://a.example/' + HASH + 'extra',
  `https://cdn.example/${'0'.repeat(64)}`,
])('skips a server with an invalid descriptor and uses the next one: %s', async (bad) => {
  respond = (url) =>
    url.startsWith('https://a.example')
      ? { status: 200, responseText: JSON.stringify({ url: bad }) }
      : ok(url);
  await expect(
    uploadToBlossomServers('f', ['https://a.example', 'https://b.example'], signer, B64),
  ).resolves.toBe(`https://b.example/${HASH}`);
  await flush();
  // The rejected URL is never mirrored; the next server's blob is.
  expect(calls.map((c) => c.url)).toEqual([
    'https://a.example/upload',
    'https://b.example/upload',
    'https://a.example/mirror',
  ]);
  expect(JSON.parse(calls[2].body as string)).toEqual({ url: `https://b.example/${HASH}` });
});

it('accepts the expected hash with a file extension', async () => {
  respond = () => ({
    status: 200,
    responseText: JSON.stringify({ url: `https://a.example/${HASH}.jpg` }),
  });
  await expect(uploadToBlossomServers('f', ['https://a.example'], signer, B64)).resolves.toBe(
    `https://a.example/${HASH}.jpg`,
  );
});

describe('encrypted uploads across fallbacks (#1558)', () => {
  const refuse = { status: 415, responseText: 'unsupported media type application/octet-stream' };
  const [divine, ditto, hzrd] = ENCRYPTED_BLOB_FALLBACK_SERVERS;

  it('accepts a CDN descriptor on another host when the hash matches', async () => {
    respond = (url) =>
      url.startsWith('https://blossom.primal.net')
        ? refuse
        : url.startsWith(divine)
          ? {
              status: 200,
              responseText: JSON.stringify({ url: `https://cdn.divine.video/${HASH}` }),
            }
          : ok(url);
    await expect(
      uploadEncryptedBlobToBlossom('f', ['https://blossom.primal.net'], signer, B64),
    ).resolves.toBe(`https://cdn.divine.video/${HASH}`);
    await flush();
  });

  it('moves on to the next fallback when one returns a wrong-hash descriptor', async () => {
    respond = (url) =>
      url.startsWith('https://blossom.primal.net')
        ? refuse
        : url.startsWith(divine)
          ? {
              status: 200,
              responseText: JSON.stringify({ url: `https://cdn.divine.video/${'0'.repeat(64)}` }),
            }
          : ok(url);
    await expect(
      uploadEncryptedBlobToBlossom('f', ['https://blossom.primal.net'], signer, B64),
    ).resolves.toBe(`${ditto}/${HASH}`);
    await flush();
    expect(calls.slice(0, 3).map((c) => c.url)).toEqual([
      'https://blossom.primal.net/upload',
      `${divine}/upload`,
      `${ditto}/upload`,
    ]);
  });

  it("falls back when the user's own server returns an invalid descriptor", async () => {
    respond = (url) =>
      url.startsWith('https://mine.example')
        ? { status: 200, responseText: JSON.stringify({ url: 'https://127.0.0.1/' + HASH }) }
        : ok(url);
    await expect(
      uploadEncryptedBlobToBlossom('f', ['https://mine.example'], signer, B64),
    ).resolves.toBe(`${divine}/${HASH}`);
    await flush();
  });

  it('throws the branded error only after every server has failed', async () => {
    respond = (url) =>
      url.startsWith(hzrd)
        ? {
            status: 200,
            responseText: JSON.stringify({ url: `http://${new URL(hzrd).host}/${HASH}` }),
          }
        : refuse;
    const error = await uploadEncryptedBlobToBlossom(
      'f',
      ['https://blossom.primal.net'],
      signer,
      B64,
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BlossomUploadFailedError);
    expect(calls.map((c) => c.url)).toEqual([
      'https://blossom.primal.net/upload',
      `${divine}/upload`,
      `${ditto}/upload`,
      `${hzrd}/upload`,
    ]);
  });

  it("doesn't fall back (or re-prompt the signer) when signing is declined", async () => {
    respond = (url) => ok(url);
    const declining: BlossomSigner = jest.fn(async () => null);
    await expect(
      uploadEncryptedBlobToBlossom('f', ['https://mine.example'], declining, B64),
    ).rejects.toThrow('Could not sign upload authorization');
    expect(declining).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([]);
  });

  it('skips a blocked user server and uses the fallbacks without contacting it', async () => {
    respond = (url) => ok(url);
    await expect(
      uploadEncryptedBlobToBlossom('f', ['https://192.168.1.10'], signer, B64),
    ).resolves.toBe(`${divine}/${HASH}`);
    await flush();
    expect(calls.some((c) => c.url.includes('192.168.1.10'))).toBe(false);
  });
});

it('never uploads to a blocked Blossom server', async () => {
  await expect(uploadToBlossomServers('f', ['https://127.0.0.1'], signer, B64)).rejects.toThrow();
  expect(calls).toEqual([]);
});
