// Ambient haze shader for the lightning overlay. This is the faint, breathing
// glow that sits UNDER the discrete Path bolts — it gives the screen a charged,
// stormy wash so the canvas never reads as empty between strikes.
//
// SkSL (Skia's shading language). Uniforms:
//   u_resolution — canvas size in px.
//   u_time       — seconds since mount (drives the slow pulse).
//   u_color      — RGBA tint, fed from the same purple→green progress driver
//                  as the bolts so the haze morphs colour in lockstep.
//   u_intensity  — overall brightness multiplier [0,1].
//
// Kept as a plain string so it can live in its own module (no inline blobs in
// the component) and be swapped/iterated without touching render code.
export const LIGHTNING_AMBIENT_SKSL = `
uniform float2 u_resolution;
uniform float  u_time;
uniform float4 u_color;
uniform float  u_intensity;

// Cheap value-noise so the haze flickers like a charged sky rather than a flat
// fade. Hash + smooth interpolation — no textures needed.
float hash(float2 p) {
  return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453123);
}

float noise(float2 p) {
  float2 i = floor(p);
  float2 f = fract(p);
  float2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + float2(1.0, 0.0));
  float c = hash(i + float2(0.0, 1.0));
  float d = hash(i + float2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

half4 main(float2 xy) {
  float2 uv = xy / u_resolution;
  // Two drifting noise octaves give a soft, billowing storm wash.
  float n = noise(uv * 3.0 + float2(0.0, u_time * 0.35));
  n += 0.5 * noise(uv * 6.0 - float2(u_time * 0.2, 0.0));
  // Periodic flash so the whole field pulses brighter a few times a second.
  float flash = 0.5 + 0.5 * sin(u_time * 7.0);
  float glow = n * 0.18 * u_intensity * (0.6 + 0.4 * flash);
  return half4(u_color.rgb * glow, glow);
}
`;
