/** Local-only, test-account-only fixtures. No relay traffic or account switching.
 * The PDF primes the authenticated media cache; Jest covers the cold download.
 */
import { encryptMediaFile } from '@internet-privacy/marmot-ts';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { cacheDirectory, makeDirectoryAsync, writeAsStringAsync } from 'expo-file-system/legacy';
import { fromByteArray } from 'base64-js';
import { upsertDmMessages } from '../services/dmDb';
import { mediaCacheKey, ownerDirName } from '../services/decryptedMediaCache';
import { decryptMarmotMedia, marmotImetaTag } from '../services/marmotMedia';
import { marmotRumorToDmRow } from '../services/marmotInbox';
import type { MarmotGroupSummary } from '../services/marmotSession';
import { parseFileAttachment } from './fileAttachment';
import { isHiddenInProdPubkey } from './testAccounts';

export const DEV_FILE_PEER = 'd9b33280ba733261d8b559fde0d662b6cb0786e30785313a086cdca95639457e';
export function devMarmotFileFixture(now: number) {
  const plain = utf8ToBytes(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF',
  );
  const key = new Uint8Array(32).fill(17);
  const { encrypted, attachment } = encryptMediaFile(plain, key, {
    version: 'encrypted-media-v2',
    mediaType: 'application/pdf',
    filename: 'invoice.pdf',
    plaintextSha256: bytesToHex(sha256(plain)),
  });
  const url = `https://blossom.example/${attachment.ciphertextSha256}.bin`;
  const group: MarmotGroupSummary = {
    id: 'marmot:dev-files',
    name: '',
    description: '',
    memberPubkeys: [DEV_FILE_PEER],
    adminPubkeys: [],
    isDm: true,
    relays: [],
    createdAt: now,
  };
  const rumor = {
    id: 'file0001'.padEnd(64, '0'),
    pubkey: DEV_FILE_PEER,
    created_at: now - 10,
    kind: 9,
    content: '',
    tags: [[...marmotImetaTag(attachment, url), 'name invoice.pdf', `size ${plain.length}`]],
  };
  return {
    encrypted,
    group,
    rumor,
    mediaKeys: { [attachment.ciphertextSha256]: { url, keysHex: [bytesToHex(key)] } },
  };
}

export async function seedDevMarmotFiles(owner: string) {
  if (!__DEV__ || !isHiddenInProdPubkey(owner) || !cacheDirectory) return null;
  const now = Math.floor(Date.now() / 1000);
  const fixture = devMarmotFileFixture(now);
  const fileRow = marmotRumorToDmRow(owner, fixture)!;
  const file = parseFileAttachment(fileRow.content)!;
  const ref = { ...file, kind: 'file' as const };
  const plain = decryptMarmotMedia(fixture.encrypted, {
    mime: file.mime,
    nonceHex: file.nonceHex!,
    marmot: file.marmot!,
  });
  const dir = `${cacheDirectory}decrypted/${ownerDirName(owner)}/`;
  await makeDirectoryAsync(dir, { intermediates: true });
  await writeAsStringAsync(`${dir}file-${mediaCacheKey(ref)}.pdf`, fromByteArray(plain), {
    encoding: 'base64',
  });
  const unknown = marmotRumorToDmRow(owner, {
    group: fixture.group,
    rumor: {
      ...fixture.rumor,
      id: 'unknown1'.padEnd(64, '0'),
      kind: 1234,
      content: '',
      tags: [],
      created_at: now,
    },
  })!;
  await upsertDmMessages([fileRow, unknown]);
  return { pubkey: DEV_FILE_PEER };
}
