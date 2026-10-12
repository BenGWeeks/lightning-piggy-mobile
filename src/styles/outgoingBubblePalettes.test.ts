import { outgoingBubblePalettes, resolveOutgoingBubbleStyle } from './outgoingBubblePalettes';
import { createMessageLinkPreviewStyles } from './MessageLinkPreview.styles';
import { createChatMentionChipStyles } from './ChatMentionChip.styles';
import { lightPalette, darkPalette } from './palettes';
import { createMessageBubbleStyles } from './MessageBubble.styles';
import { createVoiceNotePlayerStyles } from './VoiceNotePlayer.styles';

function rgb(hex: string) {
  return [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
}
function luminance(channels: number[]) {
  return channels
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
    .reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);
}

test('keeps the exact issue palettes and A as the default in both themes', () => {
  expect(outgoingBubblePalettes.A.gradient).toEqual(['#EC008C', '#8B5CF6']);
  expect(outgoingBubblePalettes.B.gradient).toEqual(['#FDE7F3', '#F3E8FF']);
  expect(outgoingBubblePalettes.B.foreground).toBe('#3B0A2A');
  expect(outgoingBubblePalettes.C.gradient).toEqual(['#8B5CF6', '#C026D3']);
  expect(lightPalette.outgoingBubble).toEqual(outgoingBubblePalettes.A);
  expect(darkPalette.outgoingBubble).toEqual(outgoingBubblePalettes.A);
  expect(resolveOutgoingBubbleStyle(undefined)).toBe('A');
});

test.each(['A', 'B', 'C'] as const)(
  '%s has AA text and footer contrast throughout the gradient',
  (style) => {
    const palette = outgoingBubblePalettes[style];
    const foreground = luminance(rgb(palette.foreground));
    const alpha = Number(palette.scrim.match(/,([\d.]+)\)$/)?.[1] ?? 0);
    const start = rgb(palette.gradient[0]);
    const end = rgb(palette.gradient[1]);
    for (let step = 0; step <= 100; step++) {
      const background = luminance(
        start.map((c, i) => (c + ((end[i] - c) * step) / 100) * (1 - alpha)),
      );
      expect(
        (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
      ).toBeGreaterThanOrEqual(4.5);
    }
    const colors = { ...lightPalette, outgoingBubble: palette };
    const styles = createMessageBubbleStyles(colors);
    for (const key of [
      'bubbleTextMe',
      'bubbleLinkMe',
      'bubbleTimeMe',
      'invoiceLabelMe',
      'invoiceMemoMe',
      'invoiceExpiryMe',
      'pollOptionTextMe',
      'pollOptionCountMe',
      'locationAccuracyMe',
      'deliveryTickDelivered',
      'deliveryTickPending',
      'deliveryTickFailed',
    ] as const) {
      expect(styles[key].color).toBe(palette.foreground);
    }
    expect(createVoiceNotePlayerStyles(colors).timeMe.color).toBe(palette.foreground);
  },
);

test.each(['A', 'B', 'C'] as const)(
  '%s uses legible foregrounds for embedded previews, mentions and reaction chips',
  (style) => {
    const colors = { ...lightPalette, outgoingBubble: outgoingBubblePalettes[style] };
    const preview = createMessageLinkPreviewStyles(colors, true);
    expect(preview.title.color).toBe(colors.outgoingBubble.foreground);
    expect(preview.domain.color).toBe(colors.outgoingBubble.foreground);
    expect(preview.urlFallback.color).toBe(colors.outgoingBubble.foreground);
    expect(createChatMentionChipStyles(colors).textMe.color).toBe(colors.outgoingBubble.foreground);
    const bubbles = createMessageBubbleStyles(colors);
    expect(bubbles.reactionPillCount.color).toBe(colors.textBody);
    expect(bubbles.reactionPillCountMine.color).toBe(colors.textBody);
  },
);
