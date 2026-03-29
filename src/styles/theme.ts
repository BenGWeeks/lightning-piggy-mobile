/** Returns an rgba string for the given 6-digit hex color (e.g. '#EC008C') and opacity (0–1). */
export function withOpacity(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

export const colors = {
  brandPink: __DEV__ ? '#4A90D9' : '#EC008C',
  brandPinkLight: __DEV__ ? '#E3F0FF' : '#FFF0F5',
  white: '#FFFFFF',
  background: '#F5F5F5',
  textHeader: '#15171A',
  textBody: '#333333',
  textSupplementary: '#7C8B9A',
  divider: '#DDE1E3',
  green: '#4CAF50',
  greenLight: '#E8F5E9',
  greenDark: '#2E7D32',
  red: '#F44336',
  courseTeal: '#109AB8',
};
