import * as THREE from "three";

// Hub layout. Shallows + kelp keep their current world positions.
// Other biomes sit on the compass around that pair so a swim tour
// never requires a load screen.
export const BIOMES = [
  {
    id: "shallows",
    name: "Shallows",
    cx: 6,
    cz: 2,
    radius: 92,
    power: 1.4,
    floor: -22,
    fog: 0x1a888c,
    absorb: [0.04, 0.011, 0.013],
    fogDensity: 0.0062,
    caustic: 1.68,
    hemi: 0x6ec8c4,
    hemiGround: 0xa07a42,
    sun: 3.15,
    hemiInt: 0.55,
    exposure: 1.18,
    floorColor: [0.86, 0.7, 0.42],
    shot: { position: [8.0, -7.6, 16.4], target: [1.8, -13.6, -2.4], hideHud: false },
  },
  {
    id: "kelp",
    name: "Kelp Forest",
    cx: 188,
    cz: -6,
    radius: 82,
    power: 1.25,
    floor: -64,
    fog: 0x1a6c2c,
    absorb: [0.044, 0.014, 0.04],
    fogDensity: 0.0196,
    caustic: 0.3,
    hemi: 0x3a8040,
    hemiGround: 0x243414,
    sun: 1.6,
    hemiInt: 0.41,
    exposure: 1.12,
    floorColor: [0.16, 0.22, 0.14],
    shot: { position: [170, -31.5, 14], target: [190, -16, -6], hideHud: false },
  },
  {
    id: "grassy",
    name: "Amber Flats",
    cx: 88,
    cz: 188,
    radius: 88,
    power: 1.05,
    floor: -34,
    fog: 0x3a8840,
    absorb: [0.03, 0.01, 0.038],
    fogDensity: 0.0084,
    caustic: 1.15,
    hemi: 0x8ec84a,
    hemiGround: 0x6a4a18,
    sun: 2.55,
    hemiInt: 0.62,
    exposure: 1.2,
    floorColor: [0.42, 0.38, 0.16],
    shot: { position: [82, -11.5, 152], target: [92, -18, 182], hideHud: true },
  },
  {
    id: "mushroom",
    name: "Mushroom Forest",
    cx: 224,
    cz: -176,
    radius: 94,
    power: 1.05,
    floor: -48,
    fog: 0x245860,
    absorb: [0.036, 0.014, 0.018],
    fogDensity: 0.0076,
    caustic: 0.72,
    hemi: 0x4aa0a0,
    hemiGround: 0x2a3a28,
    sun: 2.05,
    hemiInt: 0.48,
    exposure: 1.1,
    floorColor: [0.38, 0.42, 0.34],
    shot: { position: [198, -22, -148], target: [236, -18, -188], hideHud: true },
  },
  {
    id: "bulb",
    name: "Bulb Garden",
    cx: -168,
    cz: 164,
    radius: 90,
    power: 1.05,
    floor: -38,
    fog: 0x2a4878,
    absorb: [0.028, 0.016, 0.012],
    fogDensity: 0.007,
    caustic: 0.95,
    hemi: 0x6a88c8,
    hemiGround: 0x3a2460,
    sun: 2.35,
    hemiInt: 0.52,
    exposure: 1.14,
    floorColor: [0.55, 0.52, 0.48],
    shot: { position: [-148, -20, 142], target: [-178, -26, 178], hideHud: true },
  },
  {
    id: "crimson",
    name: "Crimson Meadows",
    cx: 8,
    cz: -204,
    radius: 96,
    power: 1.05,
    floor: -56,
    fog: 0x4a6878,
    absorb: [0.026, 0.018, 0.016],
    fogDensity: 0.0058,
    caustic: 0.88,
    hemi: 0x88a0a8,
    hemiGround: 0x5a2028,
    sun: 2.7,
    hemiInt: 0.5,
    exposure: 1.16,
    floorColor: [0.62, 0.52, 0.42],
    shot: { position: [6, -32, -168], target: [10, -42, -214], hideHud: true },
  },
  {
    id: "jelly",
    name: "Glow Cave",
    cx: 70,
    cz: 52,
    radius: 48,
    power: 0.9,
    floor: -188,
    fog: 0x3a1460,
    absorb: [0.02, 0.04, 0.012],
    fogDensity: 0.0052,
    caustic: 0.05,
    hemi: 0x8840c8,
    hemiGround: 0x180828,
    sun: 0.35,
    hemiInt: 0.72,
    exposure: 1.08,
    floorColor: [0.22, 0.1, 0.28],
    shot: { position: [16, -168, 88], target: [118, -182, 8], hideHud: true },
  },
  {
    id: "reef",
    name: "Grand Reef",
    cx: -208,
    cz: -16,
    radius: 102,
    power: 1.05,
    floor: -118,
    fog: 0x0c3a78,
    absorb: [0.018, 0.014, 0.008],
    fogDensity: 0.0046,
    caustic: 0.42,
    hemi: 0x2a68b8,
    hemiGround: 0x143040,
    sun: 1.85,
    hemiInt: 0.44,
    exposure: 1.08,
    floorColor: [0.22, 0.38, 0.34],
    shot: { position: [-176, -72, 8], target: [-212, -84, -30], hideHud: true },
  },
];

export const BIOME_INDEX = Object.fromEntries(BIOMES.map((b, i) => [b.id, i]));

const _tmp = BIOMES.map(() => 0);

export const JELLY_SINK = { x: 70, z: 52, inner: 7.2, outer: 22 };

function dist2(x, z, b) {
  const dx = x - b.cx;
  const dz = z - b.cz;
  return dx * dx + dz * dz;
}

export function biomeWeights(x, y, z) {
  let sum = 0;
  for (let i = 0; i < BIOMES.length; i++) {
    const b = BIOMES[i];
    const d2 = dist2(x, z, b);
    const r = b.radius;
    const fall = Math.max(0, 1 - d2 / (r * r));
    let w = Math.pow(fall, b.power);
    if (b.id === "jelly") {
      const depth = y < -90 ? Math.min(1, (-y - 90) / 50) : 0;
      const inCave = y < -110 && Math.hypot(x - JELLY_SINK.x, z - JELLY_SINK.z) < 130;
      const nearHole = Math.hypot(x - JELLY_SINK.x, z - JELLY_SINK.z) < JELLY_SINK.outer + 8;
      w = inCave || nearHole ? Math.max(w * 0.35, depth * 1.8) : depth * 0.05;
    } else if (b.id === "reef") {
      if (y > -40) w *= 0.45;
    } else if (y < -140) {
      w *= 0.12;
    }
    _tmp[i] = w;
    sum += w;
  }
  if (sum < 1e-5) {
    _tmp[0] = 1;
    sum = 1;
  }
  const out = {};
  for (let i = 0; i < BIOMES.length; i++) out[BIOMES[i].id] = _tmp[i] / sum;
  return out;
}

export function dominantBiome(x, y, z) {
  const w = biomeWeights(x, y, z);
  let best = BIOMES[0];
  let bestW = -1;
  for (const b of BIOMES) {
    if (w[b.id] > bestW) {
      bestW = w[b.id];
      best = b;
    }
  }
  return { biome: best, weight: bestW, weights: w };
}

export function blendBiomeValue(weights, pick) {
  let acc = 0;
  for (const b of BIOMES) acc += (weights[b.id] || 0) * pick(b);
  return acc;
}

const _fog = new THREE.Color();
const _a = new THREE.Color();

export function blendFogColor(weights, target) {
  let r = 0;
  let g = 0;
  let bch = 0;
  for (const b of BIOMES) {
    const k = weights[b.id] || 0;
    if (k < 0.004) continue;
    _a.setHex(b.fog, THREE.SRGBColorSpace);
    r += _a.r * k;
    g += _a.g * k;
    bch += _a.b * k;
  }
  target.setRGB(r, g, bch);
  return target;
}

export function blendFloorColor(weights, n, wet, target) {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const bio of BIOMES) {
    const k = weights[bio.id] || 0;
    if (k < 0.004) continue;
    r += bio.floorColor[0] * k;
    g += bio.floorColor[1] * k;
    b += bio.floorColor[2] * k;
  }
  r *= 1 + n * 0.08;
  g *= 1 + n * 0.05;
  b *= 1 + n * 0.03;
  if (wet < 0.4) {
    const d = 0.86 + wet * 0.2;
    r *= d;
    g *= d;
    b *= d;
  }
  target.setRGB(r, g, b, THREE.SRGBColorSpace);
  return target;
}

export { _fog };
