import { groupActionItem } from './groupMessageActions';

const me = 'a'.repeat(64);
const row = { id: 'b'.repeat(64), senderPubkey: me, createdAt: 1 };
const payload =
  '[FILE]' +
  JSON.stringify({
    name: '../invoice\u202e.pdf',
    mime: 'application/pdf',
    url: 'https://example.com/file?token=secret',
  });

it('keeps the persisted file kind and sanitized filename without exposing its payload', () => {
  const item = groupActionItem({ ...row, wireKind: 15, text: payload }, me);
  expect(item).toMatchObject({ wireKind: 15, text: '', file: { name: 'invoice.pdf' } });
});

it.each([15, 1234])('does not expose kind %s as plain chat text', (wireKind) => {
  expect(groupActionItem({ ...row, wireKind, text: 'internal body' }, me)).toMatchObject({
    wireKind,
    text: '',
  });
});

it('suppresses malformed legacy file payloads from text actions', () => {
  expect(groupActionItem({ ...row, text: '[FILE]{"url":"secret"' }, me).text).toBe('');
});

it('retains copyable legacy chat text', () => {
  expect(groupActionItem({ ...row, text: 'hello' }, me)).toMatchObject({
    wireKind: 14,
    text: 'hello',
  });
});
