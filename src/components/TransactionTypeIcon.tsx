import React from 'react';
import { View, StyleSheet } from 'react-native';
import { AlertTriangle, Check, Clock, Link2, Zap } from 'lucide-react-native';
import { useThemeColors } from '../contexts/ThemeContext';
import type { TxCategory } from '../utils/txCategory';

/** Badge state shown in the top-right corner of the disc.
 *
 *  Only Boltz-swap rows ever set a state — regular Lightning rows stay
 *  unbadged. The three values are mutually exclusive:
 *
 *  - `pending` (grey `Clock`): the swap is in-flight — LN paying, Boltz
 *    locking, or claim broadcasting. Conveys "something is happening,
 *    nothing for you to do" so the badge lifecycle is legible (clock →
 *    tick or warning) instead of bare → tick.
 *  - `attention` (yellow `AlertTriangle`): Boltz locked funds on-chain
 *    but our claim either failed to broadcast or can't be attempted.
 *    User action: tap into the row → "Retry claim".
 *  - `done` (green `Check`): the swap is fully settled (LN paid AND
 *    on-chain claim confirmed). Marks completed Boltz rows so the user
 *    can tell at a glance which "Send to BTC address" rows are done vs
 *    still mid-flight, since vanilla LN rows don't carry this state.
 *
 *  See issue #519. */
export type TransactionIconState = 'pending' | 'attention' | 'done';

interface Props {
  category: TxCategory;
  size?: number;
  state?: TransactionIconState;
}

const TransactionTypeIcon: React.FC<Props> = ({ category, size = 40, state }) => {
  const colors = useThemeColors();
  const radius = size / 2;
  const glyphSize = Math.round(size * 0.5);
  // Badge is ~45 % of the icon — large enough that the glyph survives
  // the pixel budget (was 35 % → 9 px glyph rendered as a blob).
  // Anchored top-right so it doesn't overlap the row text.
  const badgeSize = Math.round(size * 0.45);
  const badgeGlyph = Math.round(badgeSize * 0.7);
  // Badge overhangs the disc's top-right corner via negative top/right
  // on an absolutely-positioned sibling. Layout box stays exactly
  // `size × size` so callers (e.g. TransactionList's 40×40 avatarWrap)
  // get the dimensions they asked for; only the badge visually escapes
  // via the outer wrapper's `overflow: 'visible'`.
  const badgeOverhang = Math.round(badgeSize * 0.25);

  const bg =
    category === 'onchain'
      ? colors.bitcoinOrange
      : category === 'boltz'
        ? colors.boltzNavy
        : colors.brandPink;
  const fg = colors.zapYellow;

  return (
    <View style={[styles.outer, { width: size, height: size }]}>
      <View
        style={[
          styles.disc,
          { width: size, height: size, borderRadius: radius, backgroundColor: bg },
        ]}
      >
        {category === 'onchain' ? (
          <Link2 size={glyphSize} color={colors.white} strokeWidth={2.5} />
        ) : (
          <Zap size={glyphSize} color={fg} fill={fg} strokeWidth={2} />
        )}
      </View>
      {state
        ? (() => {
            // Sibling of the disc, positioned with negative top/right so it
            // visually overhangs into the outer wrapper's overflow:visible
            // padding. The visual "attached to corner" effect comes from the
            // overhang, not from clipping — the disc has overflow:hidden
            // (implied by borderRadius on Android) but the badge isn't a
            // descendant so it's never clipped by it.
            const variant =
              state === 'done'
                ? { bg: colors.green, ink: colors.white, Icon: Check, label: 'Swap complete' }
                : state === 'attention'
                  ? {
                      bg: colors.zapYellow,
                      // `textHeader` is near-white in dark mode, which fails
                      // contrast on the bright yellow surface. `zapYellowInk`
                      // is a dedicated dark-in-both-themes token for this.
                      ink: colors.zapYellowInk,
                      Icon: AlertTriangle,
                      label: 'Needs attention',
                    }
                  : {
                      bg: colors.textSupplementary,
                      ink: colors.white,
                      Icon: Clock,
                      label: 'Swap in progress',
                    };
            const BadgeIcon = variant.Icon;
            return (
              <View
                style={[
                  styles.badge,
                  {
                    width: badgeSize,
                    height: badgeSize,
                    borderRadius: badgeSize / 2,
                    top: -badgeOverhang,
                    right: -badgeOverhang,
                    backgroundColor: variant.bg,
                    borderColor: colors.white,
                  },
                ]}
                accessible
                accessibilityRole="image"
                accessibilityLabel={variant.label}
              >
                <BadgeIcon
                  size={badgeGlyph}
                  color={variant.ink}
                  strokeWidth={state === 'done' ? 3 : 2.5}
                />
              </View>
            );
          })()
        : null}
    </View>
  );
};

const styles = StyleSheet.create({
  outer: {
    // Layout box is exactly the requested `size × size` (set inline) so
    // callers with fixed-width rows (e.g. TransactionList's avatarWrap)
    // don't see the icon overflow their slot. The badge escapes this box
    // visually via negative top/right + the wrapper's overflow:visible.
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'visible',
  },
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    // Crisp 2 px ring around the badge so it pops against any underlying
    // category colour. `borderColor` comes from the theme palette inline.
    borderWidth: 2,
  },
});

export default React.memo(TransactionTypeIcon);
