# Brand guidelines

Lightning Piggy's visual language, and how to produce new assets that fit it. Copy and terminology rules live in `CONTRIBUTING.md` → _Terminology and wording_; this file is about the visuals.

## Colours

- **Brand gradient:** hot pink `#FF2D95` → purple `#9B40FF` (the app bar, the wallet carousel background, primary buttons).
- **Accents:** gold `#FFD700` (sats, highlights), green `#4CAF50` (connected / success), red `#E53935` (errors).
- Dark theme keeps the pink/purple identity on near-black surfaces; never swap the brand colours for a flat corporate blue.

## Wallet card designs

Each design is a _theme entry_ in `src/themes/cardThemes.ts`: a two-colour gradient, text/accent colours and one transparent artwork PNG, positioned by its `bgStyle` in `src/themes/cards/index.ts`. The card is 360 × 200 points; the artwork sits on the **right** so the balance text on the left stays readable.

### House style for the artwork

Every mascot (bee, whale, cat, owl, …) follows the same style, so a new one must too:

- hand-painted cartoon illustration with **bold black ink outlines**;
- **big glossy expressive eyes**, friendly, slightly cheeky;
- vivid saturated colour;
- an **explosive burst of paint splatters and drips** behind the subject in hot pink, electric blue, yellow and orange;
- **transparent background**; no text, letters, numbers, logos or borders.

For a card, the splatter should reach well beyond the character (towards the middle of the card and to the top and bottom edges), thinning to a few flicks on the left third where the balance is printed.

### Recipe (GPT-image via Codex)

1. Generate the character square first, 3 variations, with the prompt below plus one line describing the character. Review on the card gradient; pick one.
2. Extend the pick to a **landscape 3:2 canvas** (1536 × 1024) in image-edit mode with the square as the reference: character in the right 55 %, splatter extended left as above. Make two extents; pick one.
3. Downscale to **1200 × 800**, keep transparency, compress (target ≤ 400 KB), save as `assets/images/<id>.png`.
4. Add the theme entry in `src/themes/cardThemes.ts` (`id`, `name`, `gradientColors`, `textColor`, `accentColor`, `backgroundImage`, `backgroundImageStyle`, `backgroundImageResizeMode: 'contain'`), add the id to the `CardTheme` union in `src/types/wallet.ts`, and **register the layout separately**: `backgroundImageStyle` is a key into `cardBgStyles` in `src/themes/cards/index.ts`, so add a matching `bgStyle` there (for these landscape images: fill the card height, width = height × 1.5, anchored right). A theme entry without its `bgStyle` registration renders nothing. Watch-only wallets grey the artwork automatically.
5. PR with device screenshots: Wallets tab with the card active, the Design picker, dark theme, and the watch-only grey variant. Designs are approved on screenshots before merging.

Prompt (shared part):

> Energetic hand-painted cartoon illustration with bold black ink outlines, big glossy expressive eyes, vivid saturated colour, and an explosive burst of paint splatters and drips in hot pink, electric blue, yellow and orange radiating out behind the subject; transparent background; square; the subject fills most of the frame; no text, letters, numbers, logos or borders.

Examples that shipped: **Owl** (`wise-owl`: owl in a graduate's mortarboard, wings spread, lightning bolt on its chest, on an indigo night gradient) and **Invaders** (`invaders`: painted pixel-art alien with lightning-bolt antennae zapping a coin, on black).

Don't hand-draw vector art for cards: it won't match the painted set.

## Mascot and iconography

- The brand mascot is the Lightning Piggy pig; "Piglets" are geo-caches (see `CONTRIBUTING.md`).
- In-app icons are line icons (the `*Icon` components in `src/components/icons/`), 1.5–2.5 stroke, tinted with the card or theme text colour.

## Screenshots in PRs

Light theme unless the change is theme-specific; resized to 540 px wide WebP under `docs/screenshots/<topic>/`; before/after side by side.
