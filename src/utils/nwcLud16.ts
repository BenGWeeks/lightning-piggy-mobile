// Lightning address advertised in an NWC connection URL.
export function parseNwcLud16(nwcUrl: string | null): string | null {
  if (!nwcUrl) return null;
  try {
    const parsed = new URL(nwcUrl);
    const lud16 = parsed.searchParams.get('lud16')?.trim();
    if (!lud16 || !/^[^@\s]+@[^@\s]+$/.test(lud16)) return null;
    return lud16;
  } catch {
    return null;
  }
}
