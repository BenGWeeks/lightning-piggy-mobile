import { devMarmotFileFixture } from './devSeedMarmotFiles';
import { marmotRumorToDmRow, marmotRumorToGroupMessage } from '../services/marmotInbox';
import { decryptMarmotMedia } from '../services/marmotMedia';
import { parseFileAttachment } from './fileAttachment';

it('constructs a MIP-04 PDF rumor that both inbound paths classify and decrypt', () => {
  const fixture = devMarmotFileFixture(100);
  const row = marmotRumorToDmRow('a'.repeat(64), fixture)!;
  const file = parseFileAttachment(row.content)!;
  expect(file).toMatchObject({ name: 'invoice.pdf', mime: 'application/pdf', available: true });
  expect(marmotRumorToGroupMessage(fixture.rumor, fixture.mediaKeys)).toMatchObject({
    text: row.content,
    wireKind: 15,
  });
  const plain = decryptMarmotMedia(fixture.encrypted, {
    mime: file.mime,
    nonceHex: file.nonceHex!,
    marmot: file.marmot!,
  });
  expect(String.fromCharCode(...plain)).toContain('%PDF-1.4');
  expect(plain.length).toBe(file.size);
});
