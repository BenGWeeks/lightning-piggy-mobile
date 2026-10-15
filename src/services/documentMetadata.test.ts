import { requireOptionalNativeModule } from 'expo-modules-core';
import { selectedDocumentName } from './documentMetadata';

jest.mock('expo-modules-core', () => ({ requireOptionalNativeModule: jest.fn() }));

it('uses the provider display name for opaque Android content URIs', async () => {
  const displayNameAsync = jest.fn(async () => 'invoice.pdf');
  jest.mocked(requireOptionalNativeModule).mockReturnValue({ displayNameAsync });
  await expect(
    selectedDocumentName({ uri: 'content://downloads/document/1234', name: '1234' }),
  ).resolves.toBe('invoice.pdf');
  expect(displayNameAsync).toHaveBeenCalledWith('content://downloads/document/1234');
});

it('retains local file names without a native query', async () => {
  await expect(
    selectedDocumentName({ uri: 'file:///cache/invoice.pdf', name: 'invoice.pdf' }),
  ).resolves.toBe('invoice.pdf');
});

it('refuses opaque names when an older client lacks the metadata module', async () => {
  jest.mocked(requireOptionalNativeModule).mockReturnValue(null);
  await expect(
    selectedDocumentName({ uri: 'content://downloads/document/1234', name: '1234' }),
  ).rejects.toThrow('native module is unavailable');
});
