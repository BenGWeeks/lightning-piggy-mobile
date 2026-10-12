export type OutgoingBubbleStyle = 'A' | 'B' | 'C';

// Exact proposal endpoints. A/C need a dark scrim for AA small-text contrast.
export const outgoingBubblePalettes = {
  A: { gradient: ['#EC008C', '#8B5CF6'], foreground: '#FFFFFF', scrim: 'rgba(0,0,0,0.18)' },
  B: { gradient: ['#FDE7F3', '#F3E8FF'], foreground: '#3B0A2A', scrim: 'transparent' },
  C: { gradient: ['#8B5CF6', '#C026D3'], foreground: '#FFFFFF', scrim: 'rgba(0,0,0,0.18)' },
} satisfies Record<
  OutgoingBubbleStyle,
  { gradient: [string, string]; foreground: string; scrim: string }
>;

export function resolveOutgoingBubbleStyle(stored: unknown): OutgoingBubbleStyle {
  return stored === 'B' || stored === 'C' ? stored : 'A';
}
