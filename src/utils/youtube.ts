/**
 * Shared YouTube utilities for extracting video IDs and thumbnail URLs.
 */

const YOUTUBE_ID_REGEX = /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/;

export function extractYouTubeId(url: string): string | null {
  const match = url.match(YOUTUBE_ID_REGEX);
  return match ? match[1] : null;
}

export function getYouTubeThumbnail(videoUrl: string | null): string | null {
  if (!videoUrl) return null;
  const id = extractYouTubeId(videoUrl);
  return id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : null;
}
