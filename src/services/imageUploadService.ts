import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { getBlossomServer } from './walletStorageService';
import { uploadToBlossom, BlossomSigner } from './blossomService';

const NOSTR_BUILD_UPLOAD_URL = 'https://nostr.build/api/v2/upload/files';

/**
 * Re-encode an image through expo-image-manipulator to drop every EXIF tag
 * (GPS coords, capture timestamp, camera make/model, …) before it leaves the
 * device. The fresh JPEG has no metadata chunks at all, so we don't need to
 * parse or allowlist individual tags.
 */
export async function stripImageMetadata(
  uri: string,
): Promise<{ uri: string; base64: string | null }> {
  const result = await manipulateAsync(uri, [], {
    compress: 0.9,
    format: SaveFormat.JPEG,
    base64: true,
  });
  return { uri: result.uri, base64: result.base64 ?? null };
}

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
 *
 * `base64` is the raw image bytes as a base64 string — available directly
 * from `expo-image-picker` when the picker is launched with `base64: true`.
 * Blossom uploads use this to avoid reading `file://` URIs, which is
 * unreliable on Android in React Native. nostr.build uploads use
 * FormData with `{uri, name, type}`, which the native FormData serializer
 * can read without going through the JS fetch layer.
 */
export async function uploadImage(
  imageUri: string,
  signer: BlossomSigner | null,
  base64?: string | null,
): Promise<string> {
  if (signer) {
    const server = await getBlossomServer();
    return uploadToBlossom(imageUri, server, signer, base64);
  }
  return uploadToNostrBuild(imageUri);
}
