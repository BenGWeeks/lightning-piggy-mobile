import React, { useEffect, useMemo } from 'react';
import {
  Canvas,
  Group,
  Path,
  Fill,
  BlurMask,
  Skia,
  Shader,
  interpolateColors,
  vec,
  type SkPath,
} from '@shopify/react-native-skia';
import {
  useSharedValue,
  useDerivedValue,
  useFrameCallback,
  type SharedValue,
} from 'react-native-reanimated';
import { generateBolt, boltToSvgPath, type Point } from '../utils/lightningBolt';
import { LIGHTNING_AMBIENT_SKSL } from './lightning.sksl';
import { createLightningOverlayStyles } from '../styles/LightningOverlay.styles';

// Endpoint colours for the purple→green tint. Frozen module-scope literals so
// the Skia worklets capture stable strings (same pattern as the bubbles'
// interpolateColor in PaymentProgressOverlay). PURPLE = in-flight,
// GREEN = success, RED = failure — matched to the brand palette so the two
// animation options transition identically.
const PURPLE = '#9B40FF';
const GREEN = '#4CAF50';
const RED = '#F44336';
// Near-white-blue core so the bolt's centre reads as a hot electric arc on top
// of the coloured halo.
const CORE = '#EAF2FF';

// How many bolts can be alive at once. Lightning is meant to be INTENSE —
// continuous, overlapping strikes — so the pool stays full: as soon as one
// bolt's afterglow expires it is reborn at a fresh random position.
const POOL_SIZE = 7;
// Per-bolt lifetime window (ms): a bright strike then a quick afterglow fade.
const LIFETIME_MIN = 180;
const LIFETIME_MAX = 420;
// How often the JS thread sweeps the pool and reincarnates expired bolts. Far
// cheaper than per-frame JS work — the frame callback only animates opacity.
const REGEN_INTERVAL_MS = 70;

interface BoltState {
  path: SkPath;
  bornAt: number;
  lifetime: number;
  // Per-bolt brightness jitter so the field doesn't pulse in lockstep.
  peak: number;
}

interface Props {
  // Same colour driver the bubbles use: 0 = in-flight (purple), 1 = success
  // (green), -1 = failure (red). Passed straight from
  // PaymentProgressOverlay's `colorProgress`.
  progress: SharedValue<number>;
  width: number;
  height: number;
}

const ambientEffect = Skia.RuntimeEffect.Make(LIGHTNING_AMBIENT_SKSL);

// Build one fresh bolt on the JS thread: a roughly top→bottom strike whose
// endpoints wander across the width so consecutive bolts hit different parts
// of the screen. Geometry comes from the pure, unit-tested generator.
function makeBolt(width: number, height: number, now: number): BoltState {
  const start: Point = { x: width * (0.15 + Math.random() * 0.7), y: -20 };
  const end: Point = { x: width * (0.1 + Math.random() * 0.8), y: height + 20 };
  const branches = generateBolt(start, end, Math.random, {
    detail: 6,
    displacement: 0.16 + Math.random() * 0.12,
    forkProbability: 0.35,
  });
  // Merge trunk + forks into one SkPath so a single stroke pass draws the
  // whole tree — cheaper than one Path node per branch.
  const combined = Skia.Path.Make();
  branches.forEach((b) => {
    const sub = Skia.Path.MakeFromSVGString(boltToSvgPath(b.points));
    if (sub) combined.addPath(sub);
  });
  return {
    path: combined,
    bornAt: now,
    lifetime: LIFETIME_MIN + Math.random() * (LIFETIME_MAX - LIFETIME_MIN),
    peak: 0.7 + Math.random() * 0.3,
  };
}

interface BoltLayerProps {
  index: number;
  bolts: SharedValue<BoltState[]>;
  clock: SharedValue<number>;
  // Skia's interpolateColors yields an RGBA float array (its Color form).
  haloColor: SharedValue<number[]>;
}

// One bolt slot. Reads its current geometry + age every frame and renders a
// blurred coloured halo under a thin near-white core. Opacity rides the
// strike→afterglow curve so the bolt flashes bright then fades.
function BoltLayer({ index, bolts, clock, haloColor }: BoltLayerProps) {
  const path = useDerivedValue(() => bolts.value[index]?.path ?? Skia.Path.Make());

  const opacity = useDerivedValue(() => {
    const bolt = bolts.value[index];
    if (!bolt) return 0;
    const t = (clock.value - bolt.bornAt) / bolt.lifetime;
    if (t < 0 || t > 1) return 0;
    // Fast attack (0→peak over the first 12%) then exponential afterglow.
    const attack = Math.min(t / 0.12, 1);
    const decay = Math.exp(-3.5 * Math.max(t - 0.12, 0));
    return bolt.peak * attack * decay;
  });

  const haloOpacity = useDerivedValue(() => opacity.value * 0.6);

  return (
    <Group opacity={opacity}>
      <Path
        path={path}
        style="stroke"
        strokeWidth={9}
        strokeCap="round"
        strokeJoin="round"
        color={haloColor}
        opacity={haloOpacity}
      >
        <BlurMask blur={12} style="solid" />
      </Path>
      <Path
        path={path}
        style="stroke"
        strokeWidth={2.2}
        strokeCap="round"
        strokeJoin="round"
        color={CORE}
      />
    </Group>
  );
}

// Procedural, continuously-firing lightning rendered on a Skia canvas. Drawn
// behind the overlay card; never intercepts touches (pointerEvents none on the
// canvas). The frame callback advances a UI-thread clock and recomputes each
// bolt's opacity — no per-frame JS. A light JS interval reincarnates expired
// bolts so the field stays saturated and intense.
export default function LightningOverlay({ progress, width, height }: Props) {
  const styles = useMemo(() => createLightningOverlayStyles(), []);

  // Monotonic clock in ms, advanced on the UI thread every frame.
  const clock = useSharedValue(0);
  // The live bolt pool, seeded full so the screen is busy from frame one.
  const bolts = useSharedValue<BoltState[]>([]);

  // Colour the bolts the same way the bubbles colour-morph: red at -1,
  // purple in-flight at 0, green at success 1. Skia's interpolateColors is the
  // direct analogue of Reanimated's interpolateColor used by the bubbles.
  const haloColor = useDerivedValue(() =>
    interpolateColors(progress.value, [-1, 0, 1], [RED, PURPLE, GREEN]),
  );

  // Ambient haze uniforms — tinted by the same progress so the wash morphs in
  // lockstep with the bolts.
  const ambientUniforms = useDerivedValue(() => {
    const c = Skia.Color(interpolateColors(progress.value, [-1, 0, 1], [RED, PURPLE, GREEN]));
    return {
      u_resolution: vec(width, height),
      u_time: clock.value / 1000,
      u_color: [c[0], c[1], c[2], 1],
      u_intensity: 0.9,
    };
  });

  useFrameCallback((frame) => {
    'worklet';
    clock.value = frame.timeSinceFirstFrame;
  });

  // Seed the pool and reincarnate expired bolts from the JS thread. `bornAt`
  // is stamped from the SAME UI-thread `clock` the frame callback advances, so
  // JS-set births line up exactly with the opacity curve read on the UI
  // thread — no cross-thread clock skew.
  useEffect(() => {
    let mounted = true;

    const seed = () => {
      const now = clock.value;
      const seeded: BoltState[] = [];
      for (let i = 0; i < POOL_SIZE; i++) {
        // Stagger births across the first window so they don't all flash at once.
        seeded.push(makeBolt(width, height, now - Math.random() * LIFETIME_MAX));
      }
      bolts.value = seeded;
    };
    seed();

    const id = setInterval(() => {
      if (!mounted) return;
      const now = clock.value;
      const pool = bolts.value;
      if (pool.length === 0) {
        seed();
        return;
      }
      let mutated = false;
      const next = pool.slice();
      for (let i = 0; i < next.length; i++) {
        if (now - next[i].bornAt > next[i].lifetime) {
          next[i] = makeBolt(width, height, now);
          mutated = true;
        }
      }
      if (mutated) bolts.value = next;
    }, REGEN_INTERVAL_MS);

    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, [width, height, bolts, clock]);

  return (
    <Canvas style={styles.canvas} pointerEvents="none">
      {ambientEffect ? (
        <Fill>
          <Shader source={ambientEffect} uniforms={ambientUniforms} />
        </Fill>
      ) : null}
      {Array.from({ length: POOL_SIZE }).map((_, i) => (
        <BoltLayer key={i} index={i} bolts={bolts} clock={clock} haloColor={haloColor} />
      ))}
    </Canvas>
  );
}
