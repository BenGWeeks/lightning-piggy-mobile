import { requireOptionalNativeModule } from 'expo-modules-core';

/** File.name is a URI basename in Expo 55, not Android's provider display name. */
export async function selectedDocumentName(file: { uri: string; name: string }): Promise<string> {
  if (!file.uri.startsWith('content://')) return file.name;
  const native = requireOptionalNativeModule<{
    displayNameAsync(uri: string): Promise<string | null>;
  }>('DocumentMetadata');
  // Older dev clients must rebuild rather than silently send an opaque ID.
  if (!native) throw new Error('DocumentMetadata native module is unavailable');
  const name = await native.displayNameAsync(file.uri);
  if (!name) throw new Error('Document provider returned no display name');
  return name;
}
