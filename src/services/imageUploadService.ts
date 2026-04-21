import { getBlossomServer } from './walletStorageService';
import { uploadToBlossom, BlossomSigner } from './blossomService';

const NOSTR_BUILD_UPLOAD_URL = 'https://nostr.build/api/v2/upload/files';

export async function uploadToNostrBuild(imageUri: string): Promise<string> {
  const filename = imageUri.split('/').pop() || 'image.jpg';
  const match = /\.(\w+)$/.exec(filename);
  const type = match ? `image/${match[1]}` : 'image/jpeg';

  const formData = new FormData();
  // React Native FormData accepts {uri, name, type} but TypeScript expects Blob
  formData.append('file', { uri: imageUri, name: filename, type } as unknown as Blob);

  const response = await fetch(NOSTR_BUILD_UPLOAD_URL, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    throw new Error(`Upload failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.status !== 'success') {
    throw new Error('Upload failed: ' + (data.message || 'unknown error'));
  }

  // Validate and extract URL from NIP-94 tags
  if (!data.nip94_event || !Array.isArray(data.nip94_event.tags)) {
    throw new Error('Invalid response structure from nostr.build');
  }
  const urlTag = data.nip94_event.tags.find((t: string[]) => t[0] === 'url');
  if (!urlTag || !urlTag[1]) {
    throw new Error('No URL in upload response');
  }

  return urlTag[1];
}

/**
 * Upload an image using the user's configured Blossom server when a signer is
 * available, falling back to nostr.build otherwise. Callers that don't have a
 * Nostr signer (e.g. not yet logged in) can pass `signer: null` to force the
 * nostr.build path.
 */
export async function uploadImage(imageUri: string, signer: BlossomSigner | null): Promise<string> {
  if (signer) {
    const server = await getBlossomServer();
    return uploadToBlossom(imageUri, server, signer);
  }
  return uploadToNostrBuild(imageUri);
}
