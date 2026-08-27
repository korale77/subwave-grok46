import { fbm, hash2, noise2, noise3, smoothstep } from "./math.js";
import { KELP_FLOOR, SHALLOWS_FLOOR } from "./config.js";
import { BIOMES, JELLY_SINK, biomeWeights } from "./biomes.js";

export function biomeMix(x) {
  return biomeWeights(x, -20, 0).kelp;
}

function localFloor(id, x, z, base) {
  if (id === "shallows") {
    return (
      base +
      (fbm(x * 0.018 + 4.2, z * 0.018) - 0.5) * 4.8 +
      (fbm(x * 0.055, z * 0.055) - 0.5) * 1.8 +
      Math.sin(x * 0.22) * Math.sin(z * 0.17) * 0.18 +
      noise2(x * 0.4, z * 0.4) * 0.12
    );
  }
  if (id === "kelp") {
    return base + (fbm(x * 0.012 + 20, z * 0.012) - 0.5) * 7.0 + (fbm(x * 0.04 + 3, z * 0.04) - 0.45) * 2.6;
  }
  if (id === "grassy") {
    return base + (fbm(x * 0.02, z * 0.02) - 0.5) * 3.4 + Math.sin(x * 0.08) * Math.sin(z * 0.07) * 1.4;
  }
  if (id === "mushroom") {
    return base + (fbm(x * 0.016 + 8, z * 0.016) - 0.5) * 6.2 + (fbm(x * 0.05, z * 0.05) - 0.5) * 2.2;
  }
  if (id === "bulb") {
    return base + (fbm(x * 0.022 + 3, z * 0.022) - 0.5) * 4.2 + noise2(x * 0.12, z * 0.12) * 0.8;
  }
  if (id === "crimson") {
    return base + (fbm(x * 0.014 + 11, z * 0.014) - 0.5) * 5.5 + Math.sin(x * 0.05 + z * 0.04) * 1.1;
  }
  if (id === "jelly") {
    return base + (fbm(x * 0.03, z * 0.03) - 0.5) * 4.0;
  }
  return base + (fbm(x * 0.012 + 15, z * 0.012) - 0.5) * 8.4 + (fbm(x * 0.035, z * 0.035) - 0.5) * 3.2;
}

// Volcanic island NW of the grotto — swimable, peak above the water.
// Do not move the pin; onIsland 48 already sits tight of the shallows grotto.
export const ISLAND = { x: -88, z: -108, radius: 38 };

// Sky-camera / grotto axis (SE). Ridge runs perpendicular (NE–SW).
const IVX = 0.6247;
const IVZ = 0.7809;
const IRX = -0.7809;
const IRZ = 0.6247;

// Crooked spine in along/across: [along, across, height, half-width]
// Narrow crest + deep saddle — a ridgeline, not a gaussian mound.
const ISLAND_SPINE = [
  [-27.4, 2.8, 0.5, 5.6],
  [-22.0, -0.6, 4.8, 6.8],
  [-17.2, -3.4, 10.0, 7.4],
  [-12.6, 0.2, 16.2, 7.0],
  [-8.4, -4.8, 12.2, 5.8],
  [-3.8, -2.4, 6.2, 4.8],
  [1.2, -5.2, 11.4, 5.8],
  [5.8, -1.6, 18.4, 5.8],
  [9.4, -5.6, 22.8, 5.2],
  [12.6, -3.8, 17.2, 5.0],
  [16.8, -2.2, 10.8, 5.6],
  [21.4, 1.6, 4.6, 6.4],
  [26.8, 3.4, 0.6, 5.8],
];

// Camera-face craters [along, across, radAlong, radAcross, depth, floorT]
// Steep walls + flat floors. Math.max-merged so they carve, not dimple.
const ISLAND_PITS = [
  [6.4, 1.4, 7.4, 4.6, 4.4, 0.52],
  [-8.2, 1.6, 6.6, 4.2, 4.0, 0.5],
  [8.6, -0.4, 4.8, 3.2, 4.8, 0.4],
  [-11.8, -1.6, 4.2, 2.8, 4.4, 0.4],
  [1.2, 0.6, 4.4, 3.0, 3.8, 0.42],
  [13.2, 0.2, 4.0, 2.8, 3.4, 0.44],
  [-16.0, 0.2, 3.6, 2.6, 3.2, 0.44],
  [5.0, 2.6, 3.2, 2.2, 2.8, 0.42],
  [-5.4, 2.4, 3.0, 2.2, 2.6, 0.42],
  [9.2, -3.6, 3.4, 2.6, 3.8, 0.4],
  [-4.2, -7.4, 4.0, 3.0, 3.4, 0.42],
];

export function onIsland(x, z) {
  return Math.hypot(x - ISLAND.x, z - ISLAND.z) < 48;
}

function islandAlongAcross(dx, dz) {
  return [dx * IRX + dz * IRZ, dx * IVX + dz * IVZ];
}

function islandVoronoi(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let best = 8;
  let second = 8;
  let hx0 = 0;
  let hy0 = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const hx = hash2(ix + ox, iy + oy);
      const hy = hash2(ix + ox + 19.7, iy + oy + 31.3);
      const px = ox + hx - fx;
      const py = oy + hy - fy;
      const d = px * px + py * py;
      if (d < best) {
        second = best;
        best = d;
        hx0 = hx;
        hy0 = hy;
      } else if (d < second) {
        second = d;
      }
    }
  }
  return { d1: Math.sqrt(best), d2: Math.sqrt(second), h: hash2(hx0 * 17.1, hy0 * 13.7) };
}

function distToSpine(along, across) {
  let best = 1e9;
  let h = 0;
  let w = 8;
  for (let i = 0; i < ISLAND_SPINE.length - 1; i++) {
    const a = ISLAND_SPINE[i];
    const b = ISLAND_SPINE[i + 1];
    const abA = b[0] - a[0];
    const abC = b[1] - a[1];
    const len2 = abA * abA + abC * abC || 1;
    let t = ((along - a[0]) * abA + (across - a[1]) * abC) / len2;
    t = Math.max(0, Math.min(1, t));
    const pa = along - (a[0] + abA * t);
    const pc = across - (a[1] + abC * t);
    const dist = Math.hypot(pa, pc);
    if (dist < best) {
      best = dist;
      h = a[2] + (b[2] - a[2]) * t;
      w = a[3] + (b[3] - a[3]) * t;
    }
  }
  return { dist: best, h, w };
}

export function islandPitAmount(x, z) {
  const dx = x - ISLAND.x;
  const dz = z - ISLAND.z;
  const [along, across] = islandAlongAcross(dx, dz);
  let cut = 0;
  let rim = 0;
  for (let i = 0; i < ISLAND_PITS.length; i++) {
    const p = ISLAND_PITS[i];
    const u = Math.hypot((along - p[0]) / p[2], (across - p[1]) / p[3]);
    if (u >= 1.16) continue;
    const depth = p[4];
    const floorT = p[5];
    if (u < floorT) {
      cut = Math.max(cut, depth * (0.9 + 0.1 * (1 - u / floorT)));
    } else if (u < 1) {
      const w = (u - floorT) / (1 - floorT);
      const s = w * w * (2.15 - 1.15 * w);
      cut = Math.max(cut, depth * 0.9 * Math.max(0, 1 - s));
    } else {
      const t = 1 - (u - 1) / 0.16;
      rim = Math.max(rim, depth * 0.2 * t * t);
    }
  }
  return cut - rim;
}

export function islandVesicleAmount(x, z) {
  let cut = 0;
  const a = islandVoronoi(x * 0.118 + 4.2, z * 0.108);
  if (a.h > 0.2 && a.d1 < 0.54) {
    const t = 1 - a.d1 / 0.54;
    const depth = 2.6 + a.h * 3.6;
    cut += depth * t * t * (a.h > 0.48 ? 1.35 : 0.9);
  }
  const b = islandVoronoi(x * 0.25 + 11.0, z * 0.23);
  if (b.h > 0.28 && b.d1 < 0.38) {
    const t = 1 - b.d1 / 0.38;
    cut += (1.5 + b.h * 1.8) * t * t;
  }
  const n = noise2(x * 0.42, z * 0.4);
  if (n > 0.62) cut += (n - 0.62) * 3.4;
  return cut;
}

export function islandShoreR(dx, dz) {
  const d = Math.hypot(dx, dz);
  const ang = Math.atan2(dz, dx);
  const across = dx * IVX + dz * IVZ;
  const facing = d > 1e-4 ? across / d : 0;
  const n = fbm(ISLAND.x + dx * 0.04 + 2.1, ISLAND.z + dz * 0.04);
  const n2 = noise2(ISLAND.x * 0.07 + dx * 0.1, ISLAND.z * 0.07 + dz * 0.1);
  let r =
    20.8 -
    5.6 * facing +
    4.6 * Math.sin(ang * 2.0 + 0.55) +
    3.2 * Math.cos(ang * 3.0 - 0.35) +
    2.4 * Math.sin(ang * 5.0 + 1.15) +
    1.6 * Math.sin(ang * 9.0 + n * 5.2) +
    (n - 0.5) * 5.4 +
    (n2 - 0.5) * 3.0;
  // Flank spurs — not toward the grotto (facing / ang ~ 0.9).
  r += 5.2 * Math.exp(-((ang - 2.48) * (ang - 2.48)) / 0.07);
  r += 4.4 * Math.exp(-((ang + 0.68) * (ang + 0.68)) / 0.055);
  r += 3.6 * Math.exp(-((ang - 4.05) * (ang - 4.05)) / 0.08);
  // Inlets that break the oval, including a bite on the camera face.
  r -= 6.4 * Math.exp(-((ang - 1.55) * (ang - 1.55)) / 0.085);
  r -= 5.2 * Math.exp(-((ang + 0.15) * (ang + 0.15)) / 0.06);
  r -= 4.6 * Math.exp(-((ang - 3.45) * (ang - 3.45)) / 0.07);
  r -= 3.8 * Math.exp(-((ang - 0.95) * (ang - 0.95)) / 0.05);
  return r;
}

export function islandSandAmount(x, z) {
  const dx = x - ISLAND.x;
  const dz = z - ISLAND.z;
  const d = Math.hypot(dx, dz);
  const [along, across] = islandAlongAcross(dx, dz);
  const shore = islandShoreR(dx, dz);
  // Two pocket beaches on the ridge toes — never a ring, never the camera face.
  const coveL = Math.exp(-((along - 17.2) * (along - 17.2)) / 16) * Math.exp(-((across - 0.8) * (across - 0.8)) / 9);
  const coveR = Math.exp(-((along + 18.4) * (along + 18.4)) / 14) * Math.exp(-((across - 0.2) * (across - 0.2)) / 8);
  const cove = Math.max(coveL, coveR);
  if (cove < 0.18) return 0;
  if (d < shore - 1.4 || d > shore + 5.8) return 0;
  const u = (d - (shore - 1.4)) / 7.2;
  return cove * Math.max(0, 1 - Math.abs(u - 0.42) * 1.85);
}

export function islandHeight(x, z) {
  const dx = x - ISLAND.x;
  const dz = z - ISLAND.z;
  const d = Math.hypot(dx, dz);
  if (d > 58) return null;

  const [along, across] = islandAlongAcross(dx, dz);
  const shore = islandShoreR(dx, dz);
  const sp = distToSpine(along, across);

  // Tent profile: walkable crest, steep camera face. Not exp(-r²) clay.
  const back = across < sp.w * 0.06;
  const half = back ? sp.w * 1.38 : sp.w * 0.68;
  const u = sp.dist / (half + 0.01);
  let face;
  if (u < 0.14) {
    face = 1 - 0.07 * (u / 0.14) * (u / 0.14);
  } else {
    face = Math.max(0, 1 - 0.07 - (u - 0.14) * 1.08);
    face = Math.pow(face, 0.82);
  }
  if (!back && across > 1.8) {
    const cliff = (across - 1.8) / 8.6;
    face *= Math.max(0, 1 - cliff * cliff * 1.65);
  }

  const facing = d > 1e-4 ? across / d : 0;
  const edge = facing > 0.22 ? 1.5 : 2.8;
  const rockMask = smoothstep(shore + 0.55, shore - edge, d);

  const nA = fbm(x * 0.034 + 9.1, z * 0.034);
  const nB = fbm(x * 0.088 + 2.2, z * 0.088);
  const nC = fbm(x * 0.21, z * 0.21);
  const ridged = 1 - Math.abs(nA * 2 - 1);
  const weather = (nA - 0.42) * 4.2 + (ridged - 0.5) * 2.8;
  const rumple = (nB - 0.5) * 3.2;
  const jag = (nC - 0.5) * 2.1;

  const teeth = fbm(along * 0.4 + 7.2, 3.3);
  const crest =
    (teeth - 0.36) * 5.2 * face * smoothstep(half * 0.48, 0, sp.dist);

  let gully = 0;
  const g1 = Math.abs(along - 2.0);
  if (g1 < 3.4) gully += (1 - g1 / 3.4) * (1 - g1 / 3.4) * Math.max(0, across - 0.4) * 0.78;
  const g2 = Math.abs(along + 10.2);
  if (g2 < 2.8) gully += (1 - g2 / 2.8) * (1 - g2 / 2.8) * Math.max(0, across - 0.2) * 0.62;

  const col = Math.abs(Math.sin(along * 0.62 + nA * 3.4 + nB * 1.6));
  let colCut = 0;
  const colBreak = noise2(along * 0.22 + 8.1, across * 0.18);
  if (col < 0.09 && colBreak > 0.48 && across > 0.6 && face > 0.1) {
    colCut = (0.09 - col) * 2.2 * colBreak * smoothstep(0.6, 3.4, across);
  }

  let y =
    -0.55 +
    (sp.h * face + crest) * rockMask +
    (weather + rumple + jag) * rockMask -
    gully * rockMask -
    colCut * rockMask;

  const pit = islandPitAmount(x, z);
  y -= pit * rockMask;
  y -= islandVesicleAmount(x, z) * rockMask * (0.5 + 0.5 * face);

  // Summit calderas — carved bowls, not party-hat tips.
  const calA = along - 9.4;
  const calC = across + 5.2;
  const calU = Math.hypot(calA / 4.4, calC / 3.6);
  if (calU < 1) {
    const crater = calU < 0.48 ? 6.2 : 6.2 * Math.pow(1 - (calU - 0.48) / 0.52, 1.35);
    y -= crater * rockMask;
  }
  const cal2A = along + 12.2;
  const cal2C = across + 2.0;
  const cal2U = Math.hypot(cal2A / 3.6, cal2C / 2.8);
  if (cal2U < 1) {
    const crater = cal2U < 0.46 ? 4.4 : 4.4 * Math.pow(1 - (cal2U - 0.46) / 0.54, 1.3);
    y -= crater * rockMask;
  }

  // Pocket sand only — never lift bowls or build a shelf ring.
  const sand = islandSandAmount(x, z);
  if (sand > 0.1 && pit < 1.1) {
    const sandY = 0.16 + (fbm(x * 0.08, z * 0.08) - 0.5) * 0.22;
    y = Math.max(y, sandY * Math.min(1, sand * 1.15));
  }

  const outer = shore + 4.2 + sand * 2.4;
  if (d > outer) {
    const span = Math.max(6, 58 - outer);
    const t = Math.min(1, (d - outer) / span);
    const floor = -18 + (fbm(x * 0.02, z * 0.02) - 0.5) * 3;
    y = y * (1 - t) + floor * t;
  }
  return y;
}

export function terrainHeight(x, z) {
  const w = biomeWeights(x, -30, z);
  let h = 0;
  for (const b of BIOMES) {
    const k = w[b.id];
    if (k < 0.004) continue;
    h += k * localFloor(b.id, x, z, b.floor);
  }

  const isl = islandHeight(x, z);
  if (isl != null) h = Math.max(h, isl);

  const basin = Math.hypot(x + 2, z + 6);
  if (basin < 38) h += (1 - basin / 38) * 0.6;

  const ridge = Math.abs(x - 98);
  if (ridge < 18) h += (1 - ridge / 18) * 6.5 * (1 - w.kelp * 0.4);

  const sink = Math.hypot(x - JELLY_SINK.x, z - JELLY_SINK.z);
  // Narrow entrance well. The chamber is its own shell below; jelly-floor
  // cratering used to drop sandstone through the cathedral.
  const inner = 11;
  const outer = 20;
  const wellFloor = -122;
  const deckMin = -40;
  if (sink < outer) {
    const deck = Math.max(h, deckMin);
    if (sink <= inner) {
      h = wellFloor;
    } else {
      const u = (sink - inner) / (outer - inner);
      const t = u * u * (3 - 2 * u);
      h = wellFloor + (deck - wellFloor) * t;
    }
  } else if (sink < 150) {
    h = Math.max(h, deckMin);
  }

  return h;
}

export function kelpFloorHint(x, z) {
  return terrainHeight(x, z);
}

// Shared sandstone-arch sculpt so flora can sit on the same surface.
// u: 0..PI along the span (feet at 0 and PI). v: 0..2PI around the tube
// (v=0 is the outer radial, away from the hole).
export function sculptArchPoint(u, v, R, rTube) {
  const cu = Math.cos(u);
  const su = Math.sin(u);
  const cv = Math.cos(v);
  const sv = Math.sin(v);

  const n1 = noise3(cu * 1.55, su * 1.55, 2.35);
  const n2 = noise3(cu * 3.05 + 4.1, su * 3.05, 6.2);
  const n3 = noise3(u * 2.15, 0.42, v * 0.16);

  const Rc = R + (n1 - 0.48) * 2.55 + (n2 - 0.5) * 1.2;
  const lean = (n1 - 0.5) * 2.35 + (n2 - 0.5) * 1.05;

  const outer = cv;
  const foot = Math.pow(Math.abs(cu), 1.22);
  const crown = su;

  let rScale =
    0.7 +
    0.4 * (0.52 + 0.48 * outer) +
    0.46 * foot * (0.55 + 0.45 * Math.max(0, outer)) +
    (n3 - 0.45) * 0.24 +
    (noise3(u * 5.4, v * 1.85, 3.25) - 0.5) * 0.17;

  if (crown > 0.7 && outer > -0.2) {
    rScale += (crown - 0.7) * 0.62;
  }

  const lump = noise3(u * 6.3, v * 4.7, 8.05);
  rScale += (lump - 0.5) * 0.16;

  const pitA = noise3(u * 9.4 + 1.15, v * 7.15, 4.35);
  const pitB = noise3(u * 17.6, v * 15.2 + 2.05, 11.1);
  const pitC = noise3(u * 31.5 + v, v * 27.4, 18.6);
  const bigPit = noise3(u * 3.15, v * 2.35, 7.2);
  let pitCut = 0;
  if (bigPit > 0.58) pitCut += (bigPit - 0.58) * 1.15;
  if (pitA > 0.54) pitCut += (pitA - 0.54) * 0.85;
  if (pitB > 0.62) pitCut += (pitB - 0.62) * 0.48;
  if (pitC > 0.7) pitCut += (pitC - 0.7) * 0.24;

  const bowls = [
    [0.38, 1.35, 0.52],
    [0.72, 4.6, 0.48],
    [1.12, 2.05, 0.55],
    [1.48, 5.4, 0.5],
    [1.85, 1.15, 0.46],
    [2.22, 3.85, 0.5],
    [2.58, 0.85, 0.44],
    [0.95, 0.55, 0.42],
    [1.62, 3.2, 0.48],
    [0.52, 2.7, 0.4],
    [2.05, 5.95, 0.45],
    [1.28, 1.7, 0.42],
    [0.45, 1.55, 0.5],
    [0.85, 1.4, 0.46],
    [1.25, 1.62, 0.5],
    [1.7, 1.48, 0.48],
    [2.15, 1.7, 0.46],
    [2.55, 1.35, 0.44],
  ];
  for (const [pu, pv, rad] of bowls) {
    let du = u - pu;
    let dv = v - pv;
    dv = Math.atan2(Math.sin(dv), Math.cos(dv));
    const d = Math.hypot(du * 1.85, dv);
    if (d < rad) pitCut += (1 - d / rad) * (1 - d / rad) * 0.72;
  }
  rScale -= pitCut;

  const groove = Math.abs(Math.sin(u * 12.6 + v * 2.35 + pitA * 5.1));
  if (groove < 0.15) rScale -= (0.15 - groove) * 0.2;

  const cavity = noise3(u * 4.8 + 9.2, v * 3.6, 14.4);
  if (cavity > 0.78 && outer < 0.35) rScale -= (cavity - 0.78) * 1.15;

  rScale = Math.max(0.26, rScale);
  const r = rTube * rScale;

  let cx = Rc * cu;
  let cy = Rc * su * (0.93 + n1 * 0.07);
  let cz = lean * 0.88;

  let x = cx + r * cv * cu;
  let y = cy + r * cv * su;
  let z = cz + r * sv;

  if (outer > 0.22 && foot > 0.12 && foot < 0.88) {
    const butt = (outer - 0.22) * Math.sin(u * 2);
    x += cu * butt * rTube * 0.2;
    z += (n2 - 0.5) * butt * rTube * 0.14;
  }

  if (y < 0.58) {
    const t = 1 - y / 0.58;
    y = 0.1 + n3 * 0.3;
    const fl = 1 + t * 0.26;
    x *= fl;
    z *= fl;
  }

  const algae = pitB > 0.54 ? (pitB - 0.54) * 1.45 : 0;
  const shade = 0.66 + n1 * 0.2 + n3 * 0.08 - pitCut * 0.58;
  return { x, y, z, shade, algae, pit: pitCut, nx: cu * cv, ny: su * cv, nz: sv };
}

export function archFootY(x, z, tube) {
  return terrainHeight(x, z) + tube * 0.16;
}

// Hero safe-shallows grotto. Local space: y=0 on the sand, +z toward the
// capture camera, +x to the right cliff. A buried sandstone hillside
// with one irregular weathered opening — never a ring / torus.
export const GROTTO_ORIGIN = { x: -0.35, z: -6.6 };
export const GROTTO_WINDOW = { x: 0.55, y: 8.15 };

export function grottoWorldY() {
  return terrainHeight(GROTTO_ORIGIN.x, GROTTO_ORIGIN.z);
}

function sdEllipse2(px, py, rx, ry) {
  const k0 = Math.hypot(px / rx, py / ry);
  if (k0 < 1e-8) return -Math.min(rx, ry);
  const k1 = Math.hypot(px / (rx * rx), py / (ry * ry));
  return (k0 * (k0 - 1)) / Math.max(k1, 1e-8);
}

// 2D hillside silhouette — a landform, not a circle around the hole.
export function hillsideSDF2D(x, y) {
  const n = noise3(x * 0.045, y * 0.04, 1.7);
  const n2 = noise3(x * 0.09 + 3.1, y * 0.085, 4.8);
  const px = x + (n - 0.5) * 1.15;
  const py = y + (n - 0.5) * 0.35;

  let d = sdEllipse2(px + 9.2, py - 6.4, 8.8, 11.4);
  d = smin(d, sdEllipse2(px + 16.4, py - 4.6, 9.2, 8.2), 2.2);
  d = smin(d, sdEllipse2(px - 13.6, py - 8.2, 12.4, 14.2), 2.6);
  d = smin(d, sdEllipse2(px - 17.8, py - 3.8, 8.4, 6.6), 1.8);
  d = smin(d, sdEllipse2(px - 2.2, py - 16.4, 16.8, 7.2), 2.6);
  d = smin(d, sdEllipse2(px + 4.4, py - 15.6, 10.4, 6.0), 2.2);
  d = smin(d, sdEllipse2(px - 0.4, py - 17.4, 13.2, 5.2), 2.0);
  d = smin(d, sdEllipse2(px + 1.2, py - 16.8, 14.6, 5.6), 2.2);
  d = smin(d, sdEllipse2(px - 6.4, py - 16.2, 9.6, 5.2), 1.8);
  d = smin(d, sdEllipse2(px - 0.2, py - 15.2, 11.4, 6.4), 2.4);
  d = smin(d, sdEllipse2(px + 0.6, py - 17.0, 12.8, 5.8), 2.2);
  if (py > 18.8) d += (py - 18.8) * 1.4;
  d = smin(d, sdEllipse2(px + 7.2, py - 1.15, 11.2, 3.8), 1.8);
  d = smin(d, sdEllipse2(px - 9.6, py - 1.25, 12.4, 4.0), 1.8);
  d = smin(d, sdEllipse2(px - 8.4, py - 12.8, 6.2, 8.6), 2.0);
  d += (n - 0.5) * 0.55 + (n2 - 0.5) * 0.22;
  if (py < 1.6) d = smin(d, Math.hypot(px * 0.42, py) - 14.5, 1.4);
  return d;
}

// Irregular cave mouth — rounded, asymmetric, never a circle.
export function windowSDF2D(x, y) {
  const cx = GROTTO_WINDOW.x;
  const cy = GROTTO_WINDOW.y;
  let px = x - cx;
  let py = y - cy;
  const ang = Math.atan2(py, px);
  const n = noise3(Math.cos(ang) * 1.4, Math.sin(ang) * 1.4, 2.4);
  const n2 = noise3(Math.cos(ang) * 3.1, Math.sin(ang) * 2.8, 6.6);
  const n3 = noise3(px * 0.22, py * 0.2, 9.1);

  if (px > 0) px *= 0.92;
  else px *= 1.06;
  if (py < 0) py *= 1.18;
  else py *= 0.88;

  const a = 5.55 + 1.15 * Math.cos(ang * 2.0 + 0.55) + 0.62 * Math.sin(ang * 3.0 + 1.4) + (n - 0.5) * 1.25;
  const b = 5.45 + 0.85 * Math.sin(ang * 2.0 + 0.9) + 0.48 * Math.cos(ang * 4.0) + (n2 - 0.5) * 0.85;
  const p = 2.2;
  const k0 = Math.pow(Math.abs(px / Math.max(a, 0.4)), p) + Math.pow(Math.abs(py / Math.max(b, 0.4)), p);
  let d = (Math.pow(Math.max(k0, 1e-8), 1 / p) - 1.0) * Math.min(a, b);

  const bites = [
    [2.6, 2.4, 1.55],
    [-2.2, 3.1, 1.35],
    [3.4, -1.6, 1.25],
    [-3.1, -2.2, 1.45],
    [0.4, 4.2, 1.15],
    [-1.4, -3.6, 1.2],
    [1.8, -3.2, 1.05],
  ];
  for (const [bx, by, br] of bites) {
    const bd = Math.hypot(x - (cx + bx), y - (cy + by)) - br;
    d = smin(d, bd, 0.7);
  }
  d += (n3 - 0.5) * 0.42;
  return d;
}

export function grottoWindowRadius(theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  for (let r = 0.4; r < 12; r += 0.15) {
    if (windowSDF2D(GROTTO_WINDOW.x + c * r, GROTTO_WINDOW.y + s * r) >= 0) return r;
  }
  return 5.4;
}

export function grottoOuterRadius(theta) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  for (let r = 4; r < 28; r += 0.2) {
    if (hillsideSDF2D(GROTTO_WINDOW.x + c * r, GROTTO_WINDOW.y + s * r) >= 0) return r;
  }
  return 16;
}

export function grottoFrontZ(x, y) {
  const n = noise3(x * 0.07, y * 0.065, 3.3);
  const n2 = noise3(x * 0.16, y * 0.14, 7.1);
  let z = 5.2;
  z += 5.8 * smoothstep(1.2, 16.0, x);
  z += 1.6 * smoothstep(10.0, 16.5, y);
  z += 2.2 * smoothstep(-2.0, -14.0, x);
  z += (n - 0.5) * 1.35 + (n2 - 0.5) * 0.55;
  if (x > 8 && y > 3 && y < 10) z += 1.15 * smoothstep(8, 14, x);
  return z;
}

export function grottoBackZ(x, y) {
  const n = noise3(x * 0.06, y * 0.06, 8.8);
  let z = -5.6;
  z -= 2.4 * smoothstep(-1.0, -16.0, x);
  z -= 1.1 * smoothstep(2.0, 16.0, x);
  z += (n - 0.5) * 1.25;
  return z;
}

export function grottoWindowDist(x, y) {
  const d = windowSDF2D(x, y);
  const edge = 5.2;
  return (d + edge) / edge;
}

function smin(a, b, k) {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

function smax(a, b, k) {
  return -smin(-a, -b, k);
}

function sdBox(px, py, pz, hx, hy, hz) {
  const ax = Math.abs(px) - hx;
  const ay = Math.abs(py) - hy;
  const az = Math.abs(pz) - hz;
  const ox = Math.max(ax, 0);
  const oy = Math.max(ay, 0);
  const oz = Math.max(az, 0);
  return Math.hypot(ox, oy, oz) + Math.min(Math.max(ax, ay, az), 0);
}

function sdEllipsoid(px, py, pz, rx, ry, rz) {
  const k0 = Math.hypot(px / rx, py / ry, pz / rz);
  if (k0 < 1e-8) return -Math.min(rx, ry, rz);
  const k1 = Math.hypot(px / (rx * rx), py / (ry * ry), pz / (rz * rz));
  return k0 * (k0 - 1) / Math.max(k1, 1e-8);
}

// Solid sandstone hillside minus an irregular cave mouth. Not a ring.
export function grottoSDF(x, y, z) {
  const n1 = noise3(x * 0.026, y * 0.024, z * 0.026);
  const n2 = noise3(x * 0.055 + 4.1, y * 0.05, z * 0.052);
  const px = x + (n1 - 0.5) * 0.7;
  const py = y + (n1 - 0.5) * 0.22;
  const pz = z + (n1 - 0.5) * 0.4;

  let d = sdEllipsoid(px + 9.0, py - 6.2, pz - 1.6, 8.6, 11.0, 6.8);
  d = smin(d, sdEllipsoid(px + 15.6, py - 4.4, pz + 0.6, 8.8, 8.0, 6.6), 2.0);
  d = smin(d, sdEllipsoid(px - 13.2, py - 8.0, pz - 4.8, 11.6, 13.6, 8.4), 2.4);
  d = smin(d, sdEllipsoid(px - 17.2, py - 3.6, pz - 6.4, 7.8, 6.4, 6.2), 1.7);
  d = smin(d, sdEllipsoid(px - 2.0, py - 16.0, pz - 1.6, 15.8, 6.6, 7.4), 2.4);
  d = smin(d, sdEllipsoid(px - 1.2, py - 15.2, pz - 4.6, 12.2, 5.2, 5.6), 1.8);
  d = smin(d, sdEllipsoid(px + 1.0, py - 16.6, pz - 2.0, 14.4, 5.4, 6.2), 2.0);
  d = smin(d, sdEllipsoid(px - 0.2, py - 15.4, pz - 2.2, 11.2, 6.2, 6.8), 2.2);
  d = smin(d, sdEllipsoid(px + 0.4, py - 17.2, pz - 1.8, 12.4, 5.6, 6.4), 2.0);
  d = smin(d, sdEllipsoid(px + 8.4, py - 7.2, pz - 3.4, 6.6, 8.4, 5.8), 1.8);
  d = smin(d, sdEllipsoid(px + 7.0, py - 1.4, pz - 2.6, 10.4, 3.4, 6.8), 1.6);
  d = smin(d, sdEllipsoid(px - 9.4, py - 1.5, pz - 3.2, 11.6, 3.5, 6.6), 1.6);
  d = smin(d, sdEllipsoid(px - 2.2, py - 8.0, pz + 6.6, 15.4, 11.6, 4.4), 2.2);

  const zF = grottoFrontZ(px, py);
  const zB = grottoBackZ(px, py);
  const zMid = (zF + zB) * 0.5;
  const zHalf = Math.abs(zF - zB) * 0.5 + 0.35;
  d = smax(d, Math.abs(pz - zMid) - zHalf, 0.8);

  const win = windowSDF2D(px, py);
  const zGate = Math.max(Math.abs(pz) - 14.0, win);
  d = smax(d, -zGate, 0.85);

  d += (n1 - 0.5) * 0.32 + (n2 - 0.5) * 0.14;

  const pA = noise3(x * 0.19, y * 0.17, z * 0.19);
  const pB = noise3(x * 0.42 + 2.4, y * 0.4, z * 0.41);
  const pC = noise3(x * 0.92, y * 0.86, z * 0.9);
  const pD = noise3(x * 1.85 + 1.1, y * 1.7, z * 1.78);
  if (pA > 0.56) d += (pA - 0.56) * 0.95;
  if (pB > 0.62) d += (pB - 0.62) * 0.52;
  if (pC > 0.7) d += (pC - 0.7) * 0.26;
  if (pD > 0.76) d += (pD - 0.76) * 0.12;
  if (pA < 0.34) d -= (0.34 - pA) * 0.55;
  if (pB < 0.3) d -= (0.3 - pB) * 0.22;

  const bowls = [
    [-7.2, 12.4, 4.6, 2.4],
    [6.1, 14.6, 4.0, 2.15],
    [13.0, 8.6, 5.0, 2.35],
    [-12.4, 7.0, 4.2, 2.2],
    [3.0, 19.0, 2.8, 1.95],
    [16.4, 12.2, 3.8, 2.2],
    [9.4, 5.2, 5.2, 2.05],
    [-9.6, 16.0, 2.6, 1.9],
    [8.6, 15.4, 4.0, 2.0],
    [-15.2, 10.2, 3.6, 2.05],
    [11.0, 12.4, 4.4, 1.85],
    [-4.8, 15.2, 4.6, 1.9],
    [14.2, 6.4, 6.2, 1.75],
    [1.2, 13.0, 5.8, 1.7],
    [-11.4, 8.6, 5.0, 1.85],
  ];
  for (const [bx, by, bz, br] of bowls) {
    const pd = Math.hypot(x - bx, y - by, z - bz);
    if (pd < br) {
      const tt = 1 - pd / br;
      d += tt * tt * br * 0.22;
    }
  }

  const groove = Math.abs(Math.sin(y * 1.85 + x * 0.22 + pB * 3.6));
  if (groove < 0.11) d += (0.11 - groove) * 0.35;

  d = smax(d, -y - 0.4, 1.0);

  const cave = sdEllipsoid(px - 14.6, py - 5.4, pz - 8.2, 2.7, 2.9, 2.0);
  d = smax(d, -cave, 0.55);
  return d;
}

export function grottoNormal(x, y, z) {
  const e = 0.14;
  const nx = grottoSDF(x + e, y, z) - grottoSDF(x - e, y, z);
  const ny = grottoSDF(x, y + e, z) - grottoSDF(x, y - e, z);
  const nz = grottoSDF(x, y, z + e) - grottoSDF(x, y, z - e);
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

export function grottoShade(x, y, z, pitHint = 0, ny = 0) {
  const n = noise3(x * 0.11, y * 0.11, z * 0.11);
  const n2 = noise3(x * 0.34, y * 0.32, z * 0.34);
  const n3 = noise3(x * 0.85, y * 0.8, z * 0.82);
  const pit = Math.max(0, n3 - 0.56) * 1.25 + pitHint;
  const algae = n2 > 0.55 ? (n2 - 0.55) * 1.35 : 0;
  const strata = 0.5 + 0.5 * Math.sin(y * 1.35 + n * 2.4 + x * 0.07);
  const wet = Math.max(0, -ny);
  const bleach = Math.max(0, ny);
  const shade = 0.92 + n * 0.12 + strata * 0.05 - pit * 0.38 - algae * 0.08 - wet * 0.08 + bleach * 0.08;
  return {
    r: shade * (0.98 - algae * 0.22 + bleach * 0.05),
    g: shade * (0.9 - algae * 0.02 + bleach * 0.03),
    b: shade * (0.76 + algae * 0.07 - bleach * 0.03),
    algae,
    pit,
  };
}

export function projectToGrotto(x, y, z, steps = 7) {
  for (let i = 0; i < steps; i++) {
    const d = grottoSDF(x, y, z);
    const n = grottoNormal(x, y, z);
    x -= n[0] * d;
    y -= n[1] * d;
    z -= n[2] * d;
  }
  const n = grottoNormal(x, y, z);
  return { x, y, z, nx: n[0], ny: n[1], nz: n[2], d: grottoSDF(x, y, z) };
}

// March along Z onto the solid sandstone. fromFront=true finds the camera face.
export function raymarchGrottoZ(x, y, fromFront = true) {
  let z = fromFront ? 20 : -16;
  const dir = fromFront ? -1 : 1;
  let hit = false;
  for (let i = 0; i < 18; i++) {
    const d = grottoSDF(x, y, z);
    if (d < 0.09) {
      hit = true;
      break;
    }
    z += dir * Math.min(Math.max(d, 0.1), 1.55);
    if (z < -16.5 || z > 21) break;
  }
  if (!hit) z = fromFront ? grottoFrontZ(x, y) : grottoBackZ(x, y);
  const p = projectToGrotto(x, y, z, 5);
  return p;
}
