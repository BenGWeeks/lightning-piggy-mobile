import { Buffer } from 'buffer';
import { stripImageMetadataBytes } from '../utils/imageMetadataStrip';
import { stripImageMetadata } from './imageUploadService';

/** File attachments preserve non-image bytes; image failures must re-encode or abort. */
export async function prepareFileAttachment(
  uri: string,
  base64: string,
  mime: string,
  filename: string,
): Promise<{ uri: string; base64: string; mime: string; filename: string }> {
  if (!mime.toLowerCase().startsWith('image/')) return { uri, base64, mime, filename };
  try {
    const bytes = stripImageMetadataBytes(Buffer.from(base64, 'base64'), mime);
    return { uri, base64: Buffer.from(bytes).toString('base64'), mime, filename };
  } catch {
    // HEIC/other images and malformed streams take the existing native path.
    // Disable its GIF passthrough: arbitrary File images must also be sanitized.
    const stripped = await stripImageMetadata(uri, base64, { preserveGif: false });
    const png = /\.png$/i.test(stripped.uri);
    const extension = png ? '.png' : '.jpg';
    return {
      ...stripped,
      mime: png ? 'image/png' : 'image/jpeg',
      filename: filename.replace(/\.[^.]*$/, '') + extension,
    };
  }
}
