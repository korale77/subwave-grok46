import * as THREE from "three";
import { mulberry32, noise3, pick } from "./math.js";
import { WORLD_SEED } from "./config.js";
import { GROTTO_WINDOW, archFootY, grottoSDF, grottoWindowDist, grottoWindowRadius, hillsideSDF2D, kelpFloorHint, onIsland, projectToGrotto, raymarchGrottoZ, sculptArchPoint, terrainHeight, windowSDF2D } from "./terrain.js";
import { patchUnderwater, createKelpMaterial } from "./shaders.js";
import { makeCoralMaps, makeSpongeMaps } from "./textures.js";

function mergeGeos(geos) {
  const pos = [];
  const nrm = [];
  const col = [];
  const uv = [];
  const idx = [];
  let base = 0;
  const tmp = new THREE.Vector3();
  for (const g of geos) {
    g.computeVertexNormals();
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const c = g.attributes.color;
    const u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      if (n) nrm.push(n.getX(i), n.getY(i), n.getZ(i));
      else nrm.push(0, 1, 0);
      if (c) col.push(c.getX(i), c.getY(i), c.getZ(i));
      else col.push(1, 1, 1);
      if (u) uv.push(u.getX(i), u.getY(i));
      else uv.push(0, 0);
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) idx.push(g.index.getX(i) + base);
    } else {
      for (let i = 0; i < p.count; i++) idx.push(base + i);
    }
    base += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  out.setIndex(idx);
  out.computeVertexNormals();
  tmp.set(0, 0, 0);
  return out;
}

function paint(geo, fn) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const c = fn(pos.getX(i), pos.getY(i), pos.getZ(i), i);
    col[i * 3] = c[0];
    col[i * 3 + 1] = c[1];
    col[i * 3 + 2] = c[2];
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function wrapAngle(a) {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function makeOstia(seed, n = 14) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      t: 0.16 + ((seed * 1.73 + i * 1.19) % 1) * 0.62,
      a: seed * 2.63 + i * 2.399,
      size: 0.06 + ((seed * 2.11 + i * 0.73) % 1) * 0.08,
      depth: 0.1 + ((seed * 1.41 + i * 0.51) % 1) * 0.12,
    });
  }
  // A few large craters that read at capture distance.
  for (let k = 0; k < 4; k++) {
    out.push({
      t: 0.26 + k * 0.16 + ((seed * 0.8 + k) % 1) * 0.05,
      a: seed * 1.17 + k * 1.93,
      size: 0.13 + ((seed * 0.4 + k) % 1) * 0.05,
      depth: 0.22 + ((seed * 0.6 + k) % 1) * 0.08,
    });
  }
  return out;
}

function spongeRadius(t, a, seed, bulb = false, ostia = null) {
  const n = noise3(Math.cos(a) * 1.35 + seed, t * 2.05, Math.sin(a) * 1.35);
  const n2 = noise3(Math.cos(a) * 3.4 + 4, t * 4.2 + seed, Math.sin(a) * 3.4);
  // Slimmer living vase: foot, belly, neck, flared mouth — not a clay lump.
  const fat = bulb ? 1.1 : 1;
  const foot = 0.24 * fat;
  const belly = (bulb ? 0.5 : 0.4) * fat;
  const neck = 0.28 * fat;
  const mouthR = 0.42 * fat;
  let rad;
  if (t < 0.1) {
    const u = t / 0.1;
    rad = foot * (0.62 + u * 0.38);
  } else if (t < 0.42) {
    const u = (t - 0.1) / 0.32;
    const s = u * u * (3 - 2 * u);
    rad = foot + (belly - foot) * s;
  } else if (t < 0.74) {
    const u = (t - 0.42) / 0.32;
    const s = u * u * (3 - 2 * u);
    rad = belly + (neck - belly) * s;
  } else {
    const u = (t - 0.74) / 0.26;
    rad = neck + (mouthR - neck) * u;
  }
  if (t > 0.84) {
    const k = (t - 0.84) / 0.16;
    rad += (Math.sin(a * 2.4 + seed * 3.1) * 0.045 + Math.sin(a * 6.2 + n * 4) * 0.03) * k;
  }
  rad *= 1 + 0.03 * Math.sin(a * 2 + seed) + 0.018 * Math.sin(a * 3 + n * 1.8);
  rad += (n - 0.5) * 0.014 + (n2 - 0.5) * 0.008;
  let pore = 0;
  if (ostia) {
    for (const o of ostia) {
      const da = wrapAngle(a - o.a);
      const dt = (t - o.t) * 2.15;
      const d = Math.hypot(da, dt);
      const reach = o.size * 2.6;
      if (d < reach) {
        const u = 1 - d / reach;
        rad -= o.depth * u * u;
        pore += u * u;
      }
    }
  }
  return { rad: Math.max(0.08, rad), n, n2, pore };
}

export function makeSpongeGeometry(kind = "tube") {
  const hero = kind === "hero" || kind === "heroBulb";
  const bulb = kind === "bulb" || kind === "heroBulb";
  const height = bulb ? 1.78 : 2.08;
  const segs = hero ? 52 : 36;
  const rings = hero ? 42 : 28;
  const seed = bulb ? 2.4 : 1.15;
  const ostia = makeOstia(seed, hero ? 16 : 11);
  const stride = segs + 1;
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];

  function pushVert(x, y, z, r, g, b, u, v) {
    pos.push(x, y, z);
    col.push(r, g, b);
    uv.push(u, v);
  }

  for (let side = 0; side < 2; side++) {
    for (let j = 0; j <= rings; j++) {
      const t = j / rings;
      const mouth = smooth01(t, 0.7, 1);
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const s = spongeRadius(t, a + (side === 1 ? 0.06 : 0), seed, bulb, ostia);
        let rad = s.rad;
        if (side === 0) {
          rad *= 1 + mouth * 0.02;
        } else {
          // Thin wall so the cavity and rim read as a vase, not a pot.
          const wall = 0.036 + (1 - mouth) * 0.05;
          rad = Math.max(0.04, s.rad - wall);
        }
        const leanX = (bulb ? 0.09 : 0.13) * t * t;
        const leanZ = (s.n - 0.5) * 0.05 * t;
        // Collapsed wet rim: one side flops, lip stays thin.
        let y = t * height + (s.n2 - 0.5) * 0.01;
        if (t > 0.68) {
          const k = (t - 0.68) / 0.32;
          const flop = 0.42 + 0.58 * Math.sin(a * 1.12 + seed * 2.15);
          y -= k * k * (0.05 + flop * 0.34);
          y -= k * Math.max(0, Math.sin(a * 2.9 + s.n * 5)) * 0.07;
          if (side === 0) rad *= 1 - k * 0.1;
        }
        const pore = s.pore;
        const dark = side === 1 ? 0.16 + mouth * 0.1 : 1;
        const wet = side === 0 && t > 0.88 ? 0.1 : 0;
        const pit = Math.min(0.55, pore * 0.7);
        const m = (1.04 + s.n * 0.04 - pit - mouth * 0.03 + wet) * dark;
        // Wetter ochre: keep yellow through teal water, not brown clay.
        pushVert(ca * rad + leanX, y, sa * rad + leanZ, m, m * 0.82, m * 0.16, i / segs, t);
      }
    }
  }

  for (let side = 0; side < 2; side++) {
    const base = side * (rings + 1) * stride;
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const a = base + j * stride + i;
        const b = a + stride;
        if (side === 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
        else idx.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
  }

  const topO = rings * stride;
  const topI = (rings + 1) * stride + rings * stride;
  for (let i = 0; i < segs; i++) {
    idx.push(topO + i, topI + i, topO + i + 1, topO + i + 1, topI + i, topI + i + 1);
  }

  const botC = pos.length / 3;
  pushVert(0, 0.02, 0, 0.58, 0.42, 0.14, 0.5, 0);
  for (let i = 0; i < segs; i++) idx.push(botC, i, i + 1);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function makeBrainCoral() {
  const geo = new THREE.IcosahedronGeometry(0.58, 4);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 2.4, v.y * 2.4, v.z * 2.4);
    const n2 = noise3(v.x * 5.6 + 2, v.y * 5.2, v.z * 5.4);
    const n3 = noise3(v.x * 10.0, v.y * 9.4, v.z * 10.0);
    const groove = Math.sin(n * 22.0 + v.y * 9.2 + v.x * 6.1) * 0.11;
    const groove2 = Math.sin(n2 * 16.0 + v.z * 7.4) * 0.055;
    const lobe = n3 > 0.58 ? (n3 - 0.58) * 0.32 : 0;
    const d = 0.82 + n * 0.24 + n2 * 0.1 + groove + groove2 + lobe;
    v.multiplyScalar(d);
    v.y *= 0.52 + n * 0.16;
    if (v.y < 0.04) v.y *= 0.28;
    v.y += 0.08;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  paint(geo, (x, y, z) => {
    const n = noise3(x * 4, y * 4, z * 4);
    const groove = Math.abs(Math.sin(x * 14 + y * 11));
    const m = 0.78 + n * 0.2 - (groove < 0.18 ? 0.14 : 0);
    return [m, m * 0.72, m * 0.52];
  });
  return geo;
}

function plateRadiusAt(a, seed, radius) {
  const n = noise3(Math.cos(a) * 1.4 + seed, seed * 0.7, Math.sin(a) * 1.4);
  const n2 = noise3(Math.cos(a) * 4.2 + seed, 2.1, Math.sin(a) * 4.2);
  const n3 = noise3(Math.cos(a) * 7.6 + seed, 5.3, Math.sin(a) * 7.6);
  const scallopN = 4 + (((seed * 7.3) | 0) % 4);
  const amp = 0.09 + ((seed * 3.1) % 1) * 0.07;
  // Living table-coral lip: scalloped petals + irregular bites, still a squat cake.
  let r =
    1 +
    0.08 * Math.sin(a * 2 + seed * 2.1) +
    0.05 * Math.sin(a * 3 + seed * 1.37) +
    amp * Math.sin(a * scallopN + seed * 0.8) +
    0.032 * Math.sin(a * (scallopN * 2) + n * 2.4) +
    (n - 0.5) * 0.05 +
    (n2 - 0.5) * 0.03 +
    (n3 - 0.5) * 0.016;
  const biteN = 2 + (((seed * 11.3) | 0) % 3);
  for (let B = 0; B < biteN; B++) {
    const ba = seed * 1.73 + B * (1.55 + ((seed * 2.1 + B) % 1) * 1.05);
    const bw = 0.26 + ((seed * 1.9 + B) % 1) * 0.26;
    const bd = 0.13 + ((seed * 3.3 + B) % 1) * 0.15;
    const da = wrapAngle(a - ba);
    if (Math.abs(da) < bw) {
      const u = 1 - Math.abs(da) / bw;
      r *= 1 - bd * u * u;
    }
  }
  const lobeN = 1 + (((seed * 5.7) | 0) % 2);
  for (let L = 0; L < lobeN; L++) {
    const la = seed * 0.93 + L * (2.05 + ((seed + L) % 1) * 0.7);
    const lw = 0.38 + ((seed * 1.3 + L) % 1) * 0.26;
    const ld = 0.07 + ((seed * 2.6 + L) % 1) * 0.09;
    const da = wrapAngle(a - la);
    if (Math.abs(da) < lw) {
      const u = 1 - Math.abs(da) / lw;
      r *= 1 + ld * u * u;
    }
  }
  return Math.max(0.58, Math.min(1.26, r)) * radius;
}

function pushPlateVert(pos, col, uv, x, y, z, r, g, b, u, v) {
  pos.push(x, y, z);
  col.push(r, g, b);
  uv.push(u, v);
}

function tintCap(t, n, lip) {
  const m = 0.98 + n * 0.08 + (lip ? 0.1 : 0) - (t > 0.86 ? 0.04 : 0);
  return [m, m * 0.74, m * 0.42];
}

function orientPlateVerts(pos, ox, oy, oz, tiltX, tiltZ, yaw) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cx = Math.cos(tiltX);
  const sx = Math.sin(tiltX);
  const cz = Math.cos(tiltZ);
  const sz = Math.sin(tiltZ);
  for (let i = 0; i < pos.length; i += 3) {
    let x = pos[i];
    let y = pos[i + 1];
    let z = pos[i + 2];
    const y2 = y * cx - z * sx;
    z = y * sx + z * cx;
    y = y2;
    const x2 = x * cz - y * sz;
    y = x * sz + y * cz;
    x = x2;
    const x3 = x * cy - z * sy;
    z = x * sy + z * cy;
    pos[i] = x3 + ox;
    pos[i + 1] = y + oy;
    pos[i + 2] = z + oz;
  }
}

// Solid hemisphere / bracket. Table lips are RELIEF on the crown.
// Closed body, no plate cavity, no dark underside. Local +Y = rock normal.
export function makeTable(radius, thick, ox, oy, oz, tiltX, tiltZ, yaw, seed) {
  const segs = 36;
  const rings = 20;
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const radA = new Float32Array(segs + 1);
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const n = noise3(Math.cos(a) * 1.5 + seed, seed * 0.7, Math.sin(a) * 1.5);
    const n2 = noise3(Math.cos(a) * 3.8 + seed, 2.2, Math.sin(a) * 3.8);
    radA[i] = 1 + 0.07 * Math.sin(a * 2 + seed * 2.1) + 0.04 * Math.sin(a * 3 + seed) + (n - 0.5) * 0.07 + (n2 - 0.5) * 0.035;
  }
  const height = radius * (0.94 + ((seed * 2.3) % 1) * 0.08);
  const stretch = 0.94 + ((seed * 1.9) % 1) * 0.1;
  const skewX = (((seed * 0.41) % 1) - 0.5) * 0.06 * radius;
  const skewZ = (((seed * 0.67) % 1) - 0.5) * 0.05 * radius;
  const nRidges = 3 + (((seed * 8.1) | 0) % 2);
  const ridges = [];
  for (let k = 0; k < nRidges; k++) {
    ridges.push({
      t: 0.15 + k * 0.1 + ((seed * 1.4 + k) % 1) * 0.018,
      w: 0.048 + ((seed * 2.2 + k) % 1) * 0.01,
      a: 0.055 + ((seed * 1.8 + k) % 1) * 0.02,
      h: 0.08 + ((seed * 2.6 + k) % 1) * 0.03,
    });
  }
  const stride = segs + 1;

  function profile(t) {
    const theta = t * Math.PI;
    let y = Math.cos(theta);
    let r = Math.sin(theta);
    if (y < 0) y *= 0.36;
    let lip = 0;
    let yLift = 0;
    if (t < 0.55) {
      for (const rg of ridges) {
        const d = (t - rg.t) / rg.w;
        const g = Math.exp(-d * d);
        lip += g * rg.a;
        yLift += g * rg.h;
      }
    }
    return [(y + yLift) * height, r + lip];
  }

  const [y0] = profile(0);
  pushPlateVert(pos, col, uv, 0, y0, 0, ...tintCap(0, noise3(seed, 0.2, 1.1), false), 0.5, 0);
  const topCenter = 0;
  const topFirst = 1;
  for (let j = 1; j <= rings; j++) {
    const t = j / rings;
    const [py, pr] = profile(t);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const n = noise3(Math.cos(a) * 2.2 + seed, t * 2.4, Math.sin(a) * 2.2);
      const n2 = noise3(Math.cos(a) * 5.4 + seed, t * 4.1, Math.sin(a) * 5.4);
      const rr = radius * pr * radA[i] * (1 + (n - 0.5) * 0.04 + (n2 - 0.5) * 0.02);
      const x = Math.cos(a) * rr + skewX * pr;
      const z = Math.sin(a) * rr * stretch + skewZ * pr;
      let y = py + (n - 0.5) * 0.025 * radius;
      if (t < 0.45 && n2 > 0.78) y -= (n2 - 0.78) * 0.05 * radius;
      const lip = t > 0.12 && t < 0.55 && pr > 0.35;
      pushPlateVert(pos, col, uv, x, y, z, ...tintCap(t, n, lip), i / segs, t);
    }
  }
  for (let i = 0; i < segs; i++) idx.push(topCenter, topFirst + i, topFirst + i + 1);
  for (let j = 0; j < rings - 1; j++) {
    const a0 = topFirst + j * stride;
    const b0 = topFirst + (j + 1) * stride;
    for (let i = 0; i < segs; i++) {
      idx.push(a0 + i, a0 + i + 1, b0 + i, a0 + i + 1, b0 + i + 1, b0 + i);
    }
  }

  const [fy] = profile(1);
  const botCenter = pos.length / 3;
  pushPlateVert(pos, col, uv, 0, fy - radius * 0.015, 0, ...tintCap(1, noise3(seed, 1.4, 2.2), false), 0.5, 1);
  const botRim = topFirst + (rings - 1) * stride;
  for (let i = 0; i < segs; i++) idx.push(botCenter, botRim + i + 1, botRim + i);

  orientPlateVerts(pos, ox, oy, oz, tiltX, tiltZ, yaw);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function makeLivingPlate(radius, thick, ox, oy, oz, tiltX, tiltZ, yaw, seed) {
  return makeTable(radius, thick, ox, oy, oz, tiltX, tiltZ, yaw, seed);
}

function makeHoldfast(seed) {
  const geo = new THREE.IcosahedronGeometry(0.55, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 3.4 + seed, v.y * 3.2, v.z * 3.4);
    const n2 = noise3(v.x * 7.2, v.y * 6.8 + seed, v.z * 7.0);
    const ang = Math.atan2(v.z, v.x);
    const lobe = 0.88 + n * 0.4 + n2 * 0.14 + 0.1 * Math.sin(ang * 3 + seed);
    v.x *= lobe * 1.14;
    v.z *= lobe * 1.06;
    // Chunky weld into the rock, not a pancake pad.
    v.y = (v.y - 0.14) * (0.78 + n * 0.16);
    if (v.y < -0.32) v.y = -0.32 + (v.y + 0.32) * 0.35;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  return geo;
}

function tissuePaint(x, y, z) {
  const n = noise3(x * 3.6, y * 3.6, z * 3.6);
  const n2 = noise3(x * 9.2, y * 8.6, z * 9.2);
  const n3 = noise3(x * 18.0, y * 16.0, z * 18.0);
  const r = Math.hypot(x, z);
  const lip = r > 0.52 && n2 > 0.28;
  const polyp = n3 > 0.74 ? 0.05 : 0;
  const m = 0.98 + n * 0.1 + (lip ? 0.1 : 0) - polyp;
  return [m, m * 0.72, m * 0.4];
}

function paintTableStack(geo) {
  geo.computeVertexNormals();
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ny = nrm.getY(i);
    const n = noise3(x * 3.6, y * 3.6, z * 3.6);
    const n2 = noise3(x * 9.2, y * 8.6, z * 9.2);
    const side = Math.min(1, (1 - Math.abs(ny)) * 0.65);
    const lip = ny > 0.12 && side > 0.28 && n2 > 0.2;
    const hue = noise3(x * 1.55 + 2.2, y * 1.05, z * 1.55);
    const olive = hue > 0.58 ? (hue - 0.58) * 0.85 : 0;
    const rose = hue < 0.34 ? (0.34 - hue) * 0.8 : 0;
    const m = 0.98 + n * 0.07 - side * 0.08 + (lip ? 0.1 : 0);
    col[i * 3] = m * (1 - olive * 0.18 + rose * 0.04);
    col[i * 3 + 1] = m * (0.73 + olive * 0.14 - rose * 0.08);
    col[i * 3 + 2] = m * (0.4 + rose * 0.12 - olive * 0.08);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

export function makePlateCoral(variant = 0) {
  const hold = makeHoldfast(variant * 2.1);
  hold.scale(1.5, 1.35, 1.42);
  const layers = [hold];
  // 3–5 thick ruffled shelves fused at a shared holdfast.
  const specs =
    variant === 1
      ? [
          [1.02, 0.34, 0.02, 0.06, 0.0, 0.05, 0.03, 0.2, 2.1],
          [0.8, 0.32, 0.16, 0.48, 0.08, 0.06, -0.04, 1.1, 3.2],
          [0.64, 0.3, -0.14, 0.9, -0.12, -0.05, 0.05, 2.2, 4.0],
          [0.5, 0.28, 0.1, 1.32, 0.1, 0.04, 0.04, 0.7, 4.6],
        ]
      : variant === 2
        ? [
            [0.98, 0.34, 0.03, 0.06, 0.03, 0.06, 0.04, 0.35, 5.1],
            [0.78, 0.32, -0.16, 0.48, 0.1, -0.05, 0.04, 1.4, 5.8],
            [0.62, 0.3, 0.18, 0.9, -0.08, 0.05, -0.04, 2.5, 6.4],
            [0.5, 0.28, 0.04, 1.32, 0.12, 0.04, 0.05, 0.8, 7.0],
            [0.4, 0.26, -0.1, 1.74, 0.06, -0.03, 0.04, 1.6, 7.6],
          ]
        : [
            [1.08, 0.34, 0.0, 0.06, 0.02, 0.04, 0.03, 0.15, 0.6],
            [0.8, 0.32, 0.14, 0.48, 0.06, -0.04, 0.04, 1.2, 1.4],
            [0.6, 0.3, -0.12, 0.9, -0.1, 0.04, -0.04, 2.1, 2.2],
          ];

  for (const spec of specs) {
    layers.push(makeLivingPlate(...spec));
  }

  const geo = mergeGeos(layers);
  paint(geo, tissuePaint);
  return geo;
}

export function makeBracketColony() {
  const hold = makeHoldfast(9.2);
  hold.scale(1.48, 1.32, 1.4);
  const layers = [hold];
  const shelves = [
    [0.92, 0.34, 0.04, 0.06, 0.1, 0.08, 0.03, 0.1, 8.4],
    [0.72, 0.32, -0.12, 0.48, 0.16, 0.06, -0.04, 0.4, 9.1],
    [0.56, 0.3, 0.14, 0.9, 0.22, 0.05, 0.04, 0.15, 9.8],
    [0.44, 0.28, 0.02, 1.32, 0.18, 0.04, 0.03, 0.7, 10.4],
  ];
  for (const spec of shelves) {
    layers.push(makeLivingPlate(...spec));
  }
  const geo = mergeGeos(layers);
  paint(geo, tissuePaint);
  return geo;
}

export function makeEncrust() {
  const geo = new THREE.IcosahedronGeometry(0.55, 4);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 2.4, v.y * 2.4, v.z * 2.4);
    const n2 = noise3(v.x * 5.6, v.y * 5.4, v.z * 5.6);
    const n3 = noise3(v.x * 11.0, v.y * 10.0, v.z * 11.0);
    const ang = Math.atan2(v.z, v.x);
    const lobe = 0.78 + n * 0.42 + n2 * 0.16 + 0.1 * Math.sin(ang * 3 + n * 2);
    const polyp = n3 > 0.6 ? (n3 - 0.6) * 0.42 : 0;
    v.x *= lobe;
    v.z *= lobe;
    v.y = v.y * (0.18 + n * 0.14) + 0.08 + polyp;
    if (n2 > 0.58) v.y += (n2 - 0.58) * 0.2;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  paint(geo, (x, y, z) => {
    const n = noise3(x * 6.2, y * 6.2, z * 6.2);
    const m = 0.8 + n * 0.28;
    return [m, m * 0.78, m * 0.48];
  });
  return geo;
}

export function makeVolumetricColony(seed = 1.2) {
  const hold = makeHoldfast(seed);
  hold.scale(1.48, 1.38, 1.4);
  const layers = [hold];
  const count = 3 + (((seed * 9.1) | 0) % 3);
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0 : i / (count - 1);
    const ang = seed * 1.3 + i * 2.05;
    const ox = Math.cos(ang) * (0.03 + t * 0.14);
    const oz = Math.sin(ang) * (0.02 + t * 0.12);
    const oy = 0.07 + i * 0.42;
    const rad = (i === 0 ? 0.98 : 0.74) - t * 0.1 + noise3(seed, i * 0.8, 1.4) * 0.05;
    const thick = 0.34 - t * 0.03;
    const tiltX = (noise3(i, seed, 3.2) - 0.5) * 0.12;
    const tiltZ = (noise3(i, seed, 4.4) - 0.5) * 0.1;
    layers.push(makeLivingPlate(rad, thick, ox, oy, oz, tiltX, tiltZ, ang * 0.35, seed + i * 0.7));
  }
  const geo = mergeGeos(layers);
  paint(geo, tissuePaint);
  return geo;
}

export function makeMeatyColony(seed = 1.4) {
  const layers = [makeHoldfast(seed + 3)];
  layers[0].scale(1.52, 1.4, 1.45);
  const n = 3 + (((seed * 17) | 0) % 3);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    const ang = seed * 1.7 + i * 2.15;
    const rad = i === 0 ? 1.0 : 0.74 - t * 0.1;
    layers.push(
      makeLivingPlate(
        rad,
        0.34 - t * 0.03,
        Math.cos(ang) * (0.03 + t * 0.14),
        0.07 + i * 0.42,
        Math.sin(ang) * (0.02 + t * 0.12),
        (noise3(i, seed, 1) - 0.5) * 0.12,
        (noise3(i, seed, 2) - 0.5) * 0.1,
        ang * 0.4,
        seed + i * 1.1,
      ),
    );
  }
  const geo = mergeGeos(layers);
  paint(geo, tissuePaint);
  return geo;
}

function makeFusedOrganism(seed = 1.2, variant = -1) {
  const kind = variant >= 0 ? variant % 6 : ((seed * 17.3) | 0) % 6;
  const hold = makeHoldfast(seed * 1.7);
  hold.scale(1.38 + ((seed * 1.4) % 1) * 0.16, 0.94 + ((seed * 0.9) % 1) * 0.1, 1.28 + ((seed * 1.1) % 1) * 0.14);
  hold.translate(0, -0.1, 0);
  const layers = [hold];
  const lobeN = 3 + (((seed * 13.7 + kind) | 0) % 2);
  const baseR = 0.88 + ((seed * 2.7) % 1) * 0.12;
  const side = kind % 2 === 0 ? 1 : -1;
  const spreadDir = seed * 1.37 + kind * 0.9;
  const weld = makeHoldfast(seed * 2.4 + 1.1);
  const weldA = spreadDir + 0.22;
  weld.scale(1.02 + ((seed * 1.8) % 1) * 0.1, 0.78 + ((seed * 0.7) % 1) * 0.08, 0.96 + ((seed * 1.3) % 1) * 0.08);
  weld.translate(side * Math.cos(weldA) * 0.28, -0.06, Math.sin(weldA) * 0.22);
  layers.push(weld);
  for (let i = 0; i < lobeN; i++) {
    const t = lobeN === 1 ? 0 : i / (lobeN - 1);
    const rad = baseR * (1 - t * 0.18) * (0.97 + ((seed * 3.1 + i) % 1) * 0.06);
    const th = rad * (0.62 + ((seed * 4.1 + i) % 1) * 0.1);
    const ang = spreadDir + i * (1.05 + ((seed * 2.1) % 1) * 0.22);
    const spread = i === 0 ? 0.04 * rad : (0.26 + t * 0.1) * rad;
    const ox = side * Math.cos(ang) * spread + (((seed * 3.7 + i) % 1) - 0.5) * 0.04 * rad;
    const oz = Math.sin(ang) * spread * 0.78 + (((seed * 2.1 + i) % 1) - 0.5) * 0.04 * rad;
    const oy = 0.02 + i * 0.045;
    const tiltX = (noise3(i, seed, 1.1) - 0.5) * 0.06;
    const tiltZ = (noise3(i, seed, 2.2) - 0.5) * 0.06;
    const yaw = seed * 0.22 + i * 0.88 + ((seed * 5.1 + i) % 1) * 0.55;
    layers.push(makeTable(rad, th, ox, oy, oz, tiltX, tiltZ, yaw, seed + i * 1.07));
  }
  const geo = mergeGeos(layers);
  paintTableStack(geo);
  return geo;
}

function makeShelfColony(seed = 1.2, stackN = 0) {
  const variant = stackN >= 2 ? (stackN + ((seed * 5.1) | 0)) % 6 : -1;
  return makeFusedOrganism(seed, variant);
}

// Thick horizontal plank. Local +Y = out from wall, +X = along wall, +Z = up the wall.
function makeTableCake(radius, thick, seed) {
  const segs = 28;
  const rings = 10;
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const radA = new Float32Array(segs + 1);
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const n = noise3(Math.cos(a) * 1.5 + seed, seed, Math.sin(a) * 1.5);
    radA[i] = 1 + 0.06 * Math.sin(a * 2 + seed) + 0.04 * Math.sin(a * 3 + seed * 1.3) + (n - 0.5) * 0.06;
  }
  const half = thick * 0.5;
  const stretch = 0.88 + ((seed * 1.6) % 1) * 0.2;
  const stride = segs + 1;

  function profile(t) {
    const theta = t * Math.PI;
    let y = Math.cos(theta) * half;
    let r = Math.sin(theta);
    const u = Math.abs(t - 0.5);
    const lip = Math.exp(-(u * u) / 0.018);
    r += lip * 0.1;
    y += (t < 0.5 ? 1 : -0.15) * lip * half * 0.22;
    return [y, r];
  }

  const [y0] = profile(0);
  pushPlateVert(pos, col, uv, 0, y0, 0, 1, 0.7, 0.25, 0.5, 0);
  const topFirst = 1;
  for (let j = 1; j <= rings; j++) {
    const t = j / rings;
    const [py, pr] = profile(t);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const n = noise3(Math.cos(a) * 2.4 + seed, t * 2.2, Math.sin(a) * 2.4);
      const rr = radius * pr * radA[i] * (1 + (n - 0.5) * 0.04);
      pushPlateVert(pos, col, uv, Math.cos(a) * rr, py + (n - 0.5) * thick * 0.04, Math.sin(a) * rr * stretch, 1, 0.7, 0.25, i / segs, t);
    }
  }
  for (let i = 0; i < segs; i++) idx.push(0, topFirst + i, topFirst + i + 1);
  for (let j = 0; j < rings - 1; j++) {
    const a0 = topFirst + j * stride;
    const b0 = topFirst + (j + 1) * stride;
    for (let i = 0; i < segs; i++) idx.push(a0 + i, a0 + i + 1, b0 + i, a0 + i + 1, b0 + i + 1, b0 + i);
  }
  const [fy] = profile(1);
  const bot = pos.length / 3;
  pushPlateVert(pos, col, uv, 0, fy - thick * 0.02, 0, 0.92, 0.64, 0.22, 0.5, 1);
  const botRim = topFirst + (rings - 1) * stride;
  for (let i = 0; i < segs; i++) idx.push(bot, botRim + i + 1, botRim + i);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

// Solid terrace along +Y (wall normal). Root is buried (y < 0) so it welds
// into the rock — not a proud coin sitting on the face.
function makeGrownPlate(seed = 1.2, kindOverride = null) {
  const hue = (seed * 5.73) % 1;
  const kind = kindOverride || (hue < 0.45 ? "table" : hue < 0.7 ? "olive" : "rose");
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const skew = 0.78 + ((seed * 2.1) % 1) * 0.46;
  const height = 0.48 + ((seed * 3.3) % 1) * 0.12;
  const bury = 0.3;
  const lobes = 3 + (((seed * 4.7) | 0) % 2);
  const lobePhase = seed * 2.3;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const n = noise3(Math.cos(a) * 1.8 + seed, seed * 0.7, Math.sin(a) * 1.8);
    const n2 = noise3(Math.cos(a) * 4.2 + seed, v.y * 3.1, Math.sin(a) * 4.2);
    const y01 = (v.y + 1) * 0.5;
    let pr;
    if (y01 < 0.18) pr = 0.72 + y01 * 1.4;
    else if (y01 < 0.48) pr = 0.96 + 0.14 * Math.sin(((y01 - 0.18) / 0.3) * Math.PI);
    else if (y01 < 0.74) pr = 0.64 + 0.16 * Math.sin(((y01 - 0.48) / 0.26) * Math.PI);
    else pr = 0.64 * (1 - (y01 - 0.74) / 0.26) + 0.14;
    const lobe = Math.pow(0.52 + 0.48 * Math.sin(a * lobes + lobePhase), 1.25);
    const outline = 0.62 + 0.34 * lobe + 0.08 * Math.sin(a * (lobes + 1) + n) + (n - 0.5) * 0.1 + (n2 - 0.5) * 0.05;
    v.x = Math.cos(a) * pr * outline * skew;
    v.z = Math.sin(a) * pr * outline;
    v.y = y01 * height - bury;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  paint(geo, (x, y, z) => {
    const nse = noise3(x * 3.4, y * 3.2, z * 3.4);
    return crustTint(kind, nse, Math.hypot(x, z) > 0.55 && y > 0.02, y);
  });
  return geo;
}

function makeSolidShelf(seed = 1.2, kindOverride = null) {
  const hue = (seed * 5.73) % 1;
  const kind = kindOverride || (hue < 0.45 ? "table" : hue < 0.7 ? "olive" : "rose");
  return makeGrownPlate(seed, kind);
}

function makeOneTube(seed, h, rad0) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const a = Math.atan2(v.z, v.x);
    const n = noise3(Math.cos(a) * 2.2 + seed, v.y * 2.4, Math.sin(a) * 2.2);
    const n2 = noise3(v.x * 5.4 + seed, v.y * 5.1, v.z * 5.4);
    const y01 = (v.y + 1) * 0.5;
    let pr = rad0 * (0.84 + 0.18 * Math.sin(y01 * Math.PI) + (n - 0.5) * 0.16);
    if (y01 > 0.72) pr *= 1.16 + (y01 - 0.72) * 0.55;
    if (n2 > 0.72) pr *= 1 - (n2 - 0.72) * 0.8;
    const lean = (n - 0.5) * 0.16 * y01;
    v.x = Math.cos(a) * pr + lean;
    v.z = Math.sin(a) * pr * (0.82 + ((seed * 1.4) % 1) * 0.16);
    v.y = y01 * h - 0.26;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  return geo;
}

function makeWallSponge(seed = 2.4, flavor = "lump") {
  const n = flavor === "lump" ? 3 : 2;
  const parts = [];
  for (let k = 0; k < n; k++) {
    const h = 0.48 + ((seed * (2.1 + k)) % 1) * 0.18;
    const rad = 0.3 + ((seed * (1.6 + k)) % 1) * 0.1;
    const g = makeOneTube(seed + k * 1.7, h, rad);
    g.translate(((k - (n - 1) * 0.5) * 0.32), 0, ((seed * (0.8 + k)) % 1 - 0.5) * 0.18);
    parts.push(g);
  }
  return mergeGeos(parts);
}

function crustTint(kind, n, lip, y = 0.2) {
  let r;
  let g;
  let b;
  if (kind === "table") {
    r = 0.78 + n * 0.1;
    g = 0.38 + n * 0.07;
    b = 0.08 + n * 0.03;
  } else if (kind === "olive") {
    r = 0.56 + n * 0.08;
    g = 0.4 + n * 0.07;
    b = 0.1 + n * 0.03;
  } else if (kind === "rose" || kind === "brain") {
    r = 0.7 + n * 0.08;
    g = 0.3 + n * 0.05;
    b = 0.24 + n * 0.05;
  } else {
    r = 0.32 + n * 0.06;
    g = 0.36 + n * 0.07;
    b = 0.22 + n * 0.05;
  }
  if (lip) {
    r *= 1.05;
    g *= 1.03;
  }
  if (y < 0.04) {
    const k = Math.max(0, Math.min(1, (0.04 - y) / 0.28));
    r = r * (1 - k) + 0.48 * k;
    g = g * (1 - k) + 0.38 * k;
    b = b * (1 - k) + 0.26 * k;
  }
  return [r, g, b];
}

// Squat crust scab: a few-cm shell along the rock normal. Not a potato, not a chip.
// Local +Y = outward normal. Widest at the rock plane; outer face carries relief.
function makeCrustScab(radius, seed, kind = "table", riseMul = 1) {
  const segs = kind === "table" ? 26 : 18;
  const rings = 9;
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const radA = new Float32Array(segs + 1);
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * Math.PI * 2;
    const n = noise3(Math.cos(a) * 1.6 + seed, seed, Math.sin(a) * 1.6);
    radA[i] = 1 + 0.08 * Math.sin(a * 2 + seed * 2) + 0.05 * Math.sin(a * 3 + seed) + (n - 0.5) * 0.08;
  }
  const rise0 =
    kind === "table" ? 0.2 : kind === "brain" ? 0.26 : kind === "olive" ? 0.12 : 0.16;
  const rise = radius * rise0 * riseMul;
  const bury = radius * 0.16;
  const stretch =
    kind === "table" ? 1.45 + ((seed * 2.1) % 1) * 0.55 : 0.86 + ((seed * 1.7) % 1) * 0.28;
  const nRidges = kind === "table" ? 3 : kind === "brain" ? 0 : 2;
  const stride = segs + 1;

  function profile(t) {
    const theta = t * Math.PI;
    let y = Math.cos(theta);
    let r = Math.sin(theta);
    y = y >= 0 ? y * rise : y * bury;
    if (kind === "table" && t < 0.55) {
      const g = Math.exp(-((t - 0.4) / 0.07) * ((t - 0.4) / 0.07));
      r += g * 0.07;
      y += g * rise * 0.14;
    } else if (kind === "brain" && t < 0.55) {
      const g = 0.5 + 0.5 * Math.sin(t * 18 + seed * 4);
      y += (g - 0.4) * rise * 0.28;
      r += Math.max(0, g - 0.55) * 0.06;
    } else if (t < 0.48) {
      for (let k = 0; k < nRidges; k++) {
        const ct = 0.16 + k * 0.14;
        const g = Math.exp(-((t - ct) / 0.05) * ((t - ct) / 0.05));
        r += g * 0.05;
        y += g * rise * 0.12;
      }
    }
    return [y, r];
  }

  const [y0] = profile(0);
  pushPlateVert(pos, col, uv, 0, y0, 0, ...crustTint(kind, noise3(seed, 0.2, 1), false), 0.5, 0);
  const topFirst = 1;
  for (let j = 1; j <= rings; j++) {
    const t = j / rings;
    const [py, pr] = profile(t);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const n = noise3(Math.cos(a) * 2.4 + seed, t * 2.6, Math.sin(a) * 2.4);
      const n2 = noise3(Math.cos(a) * 6 + seed, t * 5, Math.sin(a) * 6);
      let rr = radius * pr * radA[i] * (1 + (n - 0.5) * 0.05);
      let y = py + (n - 0.5) * rise * 0.08;
      if (kind === "brain" && n2 > 0.62) y += (n2 - 0.62) * rise * 0.45;
      if (kind === "olive" && n2 > 0.7) y += (n2 - 0.7) * rise * 0.3;
      const lip = kind === "table" && t > 0.1 && t < 0.48;
      pushPlateVert(pos, col, uv, Math.cos(a) * rr, y, Math.sin(a) * rr * stretch, ...crustTint(kind, n, lip), i / segs, t);
    }
  }
  for (let i = 0; i < segs; i++) idx.push(0, topFirst + i, topFirst + i + 1);
  for (let j = 0; j < rings - 1; j++) {
    const a0 = topFirst + j * stride;
    const b0 = topFirst + (j + 1) * stride;
    for (let i = 0; i < segs; i++) {
      idx.push(a0 + i, a0 + i + 1, b0 + i, a0 + i + 1, b0 + i + 1, b0 + i);
    }
  }
  const [fy] = profile(1);
  const bot = pos.length / 3;
  pushPlateVert(pos, col, uv, 0, fy - radius * 0.01, 0, ...crustTint(kind, 0.4, false), 0.5, 1);
  const botRim = topFirst + (rings - 1) * stride;
  for (let i = 0; i < segs; i++) idx.push(bot, botRim + i + 1, botRim + i);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function shellKind(x, y, z) {
  const k = noise3(x * 0.16 + 1.6, y * 0.14, z * 0.16) * 0.65 + noise3(x * 0.38 + 4, y * 0.34, z * 0.38) * 0.35;
  if (k < 0.34) return "stone";
  if (k < 0.68) return "table";
  if (k < 0.86) return "olive";
  return "mustard";
}

function shellTint(kind, n, lip) {
  let r = 0.66 + n * 0.08;
  let g = 0.54 + n * 0.05;
  let b = 0.36 + n * 0.03;
  if (kind === "table" && lip) {
    r = 0.9 + n * 0.05;
    g = 0.56 + n * 0.04;
    b = 0.14;
  } else if (kind === "olive" && lip) {
    r = 0.58 + n * 0.05;
    g = 0.5 + n * 0.04;
    b = 0.16;
  } else if (kind === "mustard" && lip) {
    r = 0.86 + n * 0.05;
    g = 0.58 + n * 0.04;
    b = 0.14;
  } else if (kind === "table") {
    r = 0.76 + n * 0.05;
    g = 0.56 + n * 0.04;
    b = 0.28;
  }
  return [r, g, b];
}

function keepShellVert(x, y, z, nx, ny, nz) {
  if (y < 0.7 || y > 16.2) return false;
  if (x < -15.2 || x > 19.4) return false;
  if (z < 0.08 || z > 14.2) return false;
  if (windowSDF2D(x, y) < 0.14) return false;
  if (nz < -0.22 && nx < 0.0) return false;
  if (ny > 0.88 && y > 14.2) return false;
  const cover = noise3(x * 0.07, y * 0.065, z * 0.07) * 0.7 + noise3(x * 0.15 + 2.6, y * 0.14, z * 0.15) * 0.3;
  return cover > 0.16;
}

function shellRelief(x, y, z, kind) {
  const n1 = noise3(x * 1.5, y * 1.45, z * 1.5);
  const n2 = noise3(x * 3.6, y * 3.3, z * 3.5);
  const n3 = noise3(x * 7.2, y * 6.8, z * 7.0);
  let h = 0.035;
  if (kind === "table") {
    const band = y * 1.85 + n1 * 1.05 + x * 0.1;
    const u = band - Math.floor(band);
    const lip = u > 0.7;
    h += lip ? 0.14 + n2 * 0.04 : u > 0.34 ? 0.05 : 0.02;
  } else if (kind === "olive") {
    h += 0.02 + n1 * 0.03 + Math.max(0, n3 - 0.7) * 0.04;
  } else if (kind === "mustard") {
    h += 0.04 + Math.max(0, n1 - 0.48) * 0.08 + n2 * 0.02;
  } else {
    h += n2 * 0.02 + Math.max(0, n3 - 0.72) * 0.03;
  }
  return { h, n1, lip: kind === "table" && h > 0.1 };
}

function makeReefShell(grottoGeo) {
  const p = grottoGeo.attributes.position;
  const nrm = grottoGeo.attributes.normal;
  const index = grottoGeo.index;
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  if (!p || !nrm || !index) return null;

  function emitTri(ax, ay, az, bx, by, bz, cx, cy, cz, nax, nay, naz, nbx, nby, nbz, ncx, ncy, ncz) {
    const ka = keepShellVert(ax, ay, az, nax, nay, naz);
    const kb = keepShellVert(bx, by, bz, nbx, nby, nbz);
    const kc = keepShellVert(cx, cy, cz, ncx, ncy, ncz);
    if ((ka ? 1 : 0) + (kb ? 1 : 0) + (kc ? 1 : 0) < 2) return;
    const mx = (ax + bx + cx) / 3;
    const my = (ay + by + cy) / 3;
    const mz = (az + bz + cz) / 3;
    const kind = shellKind(mx, my, mz);
    const ra = shellRelief(ax, ay, az, kind);
    const rb = shellRelief(bx, by, bz, kind);
    const rc = shellRelief(cx, cy, cz, kind);
    const ha = 0.07 + (ka ? ra.h : 0);
    const hb = 0.07 + (kb ? rb.h : 0);
    const hc = 0.07 + (kc ? rc.h : 0);
    const ca = shellTint(kind, ra.n1, ra.lip);
    const cb = shellTint(kind, rb.n1, rb.lip);
    const cc = shellTint(kind, rc.n1, rc.lip);
    const base = pos.length / 3;
    pos.push(ax + nax * ha, ay + nay * ha, az + naz * ha);
    pos.push(bx + nbx * hb, by + nby * hb, bz + nbz * hb);
    pos.push(cx + ncx * hc, cy + ncy * hc, cz + ncz * hc);
    col.push(ca[0], ca[1], ca[2], cb[0], cb[1], cb[2], cc[0], cc[1], cc[2]);
    uv.push(0, 0, 1, 0, 0.5, 1);
    idx.push(base, base + 1, base + 2);
  }

  function mid(ax, ay, az, bx, by, bz) {
    return [(ax + bx) * 0.5, (ay + by) * 0.5, (az + bz) * 0.5];
  }
  function midN(ax, ay, az, bx, by, bz) {
    let x = ax + bx;
    let y = ay + by;
    let z = az + bz;
    const l = Math.hypot(x, y, z) || 1;
    return [x / l, y / l, z / l];
  }

  for (let t = 0; t < index.count; t += 3) {
    const ia = index.getX(t);
    const ib = index.getX(t + 1);
    const ic = index.getX(t + 2);
    const ax = p.getX(ia);
    const ay = p.getY(ia);
    const az = p.getZ(ia);
    const bx = p.getX(ib);
    const by = p.getY(ib);
    const bz = p.getZ(ib);
    const cx = p.getX(ic);
    const cy = p.getY(ic);
    const cz = p.getZ(ic);
    const nax = nrm.getX(ia);
    const nay = nrm.getY(ia);
    const naz = nrm.getZ(ia);
    const nbx = nrm.getX(ib);
    const nby = nrm.getY(ib);
    const nbz = nrm.getZ(ib);
    const ncx = nrm.getX(ic);
    const ncy = nrm.getY(ic);
    const ncz = nrm.getZ(ic);
    const mx = (ax + bx + cx) / 3;
    const my = (ay + by + cy) / 3;
    const mz = (az + bz + cz) / 3;
    const mnx = nax + nbx + ncx;
    const mny = nay + nby + ncy;
    const mnz = naz + nbz + ncz;
    const mln = Math.hypot(mnx, mny, mnz) || 1;
    if (!keepShellVert(mx, my, mz, mnx / mln, mny / mln, mnz / mln) && !keepShellVert(ax, ay, az, nax, nay, naz)) continue;

    const [abx, aby, abz] = mid(ax, ay, az, bx, by, bz);
    const [bcx, bcy, bcz] = mid(bx, by, bz, cx, cy, cz);
    const [cax, cay, caz] = mid(cx, cy, cz, ax, ay, az);
    const [nabx, naby, nabz] = midN(nax, nay, naz, nbx, nby, nbz);
    const [nbcx, nbcy, nbcz] = midN(nbx, nby, nbz, ncx, ncy, ncz);
    const [ncax, ncay, ncaz] = midN(ncx, ncy, ncz, nax, nay, naz);
    emitTri(ax, ay, az, abx, aby, abz, cax, cay, caz, nax, nay, naz, nabx, naby, nabz, ncax, ncay, ncaz);
    emitTri(bx, by, bz, bcx, bcy, bcz, abx, aby, abz, nbx, nby, nbz, nbcx, nbcy, nbcz, nabx, naby, nabz);
    emitTri(cx, cy, cz, cax, cay, caz, bcx, bcy, bcz, ncx, ncy, ncz, ncax, ncay, ncaz, nbcx, nbcy, nbcz);
    emitTri(abx, aby, abz, bcx, bcy, bcz, cax, cay, caz, nabx, naby, nabz, nbcx, nbcy, nbcz, ncax, ncay, ncaz);
  }

  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function crustCover(x, y, z) {
  const a = noise3(x * 0.12, y * 0.11, z * 0.11);
  const b = noise3(x * 0.24 + 2.7, y * 0.2, z * 0.22);
  const c = noise3(x * 0.08 + 5.1, y * 0.16, z * 0.09);
  let cover = a * 0.42 + b * 0.36 + c * 0.22;
  const wd = windowSDF2D(x, y);
  // Camera-facing mouth: keep the coat alive so the middle is not a clay sheet.
  if (wd < 4.6 && z > -0.9) {
    const mouth = 1 - smooth01(wd, 0.18, 4.6);
    cover = Math.max(cover, 0.44 + mouth * 0.3);
  }
  return cover;
}

function crustKind(x, y, z) {
  const k = noise3(x * 0.22 + 2.1, y * 0.2, z * 0.21);
  const k2 = noise3(x * 0.58 + 4.4, y * 0.5, z * 0.54);
  const mix = k * 0.62 + k2 * 0.38;
  const wd = windowSDF2D(x, y);
  if (wd < 4.2 && z > -1.2) {
    if (mix < 0.44) return "olive";
    if (mix < 0.66) return "rose";
    if (mix < 0.84) return "brain";
    return "table";
  }
  if (mix < 0.28) return "table";
  if (mix < 0.52) return "olive";
  if (mix < 0.74) return "rose";
  return "brain";
}

function crustLive(cover) {
  return smooth01(cover, 0.12, 0.34);
}

// Local relief only. No Y-wrapping bands — those turn stacked grotto
// masses into peach coils.
function crustHeight(x, y, z, cover) {
  const live = crustLive(cover);
  if (live <= 0.02) return 0.015;
  const kind = crustKind(x, y, z);
  const n1 = noise3(x * 1.35, y * 1.28, z * 1.32);
  const n2 = noise3(x * 3.3, y * 3.1, z * 3.25);
  const n3 = noise3(x * 7.1, y * 6.6, z * 6.9);
  const mound = noise3(x * 0.18 + 1.3, y * 0.16, z * 0.18);
  const mound2 = noise3(x * 0.4 + 4.4, y * 0.36, z * 0.38);
  let h = 0.05 + live * 0.06;
  h += live * Math.max(0, mound - 0.34) * 0.18;
  h += live * Math.max(0, mound2 - 0.52) * 0.08;
  const patch = noise3(x * 0.26 + 3.2, y * 0.09, z * 0.24);
  if (kind === "table" && patch > 0.56) {
    const ridge = noise3(x * 0.7 + 1.1, y * 1.6, z * 0.65);
    h += live * Math.max(0, ridge - 0.58) * 0.16 * (patch - 0.56) * 2.2;
  } else if (kind === "olive") {
    const rib = noise3(x * 1.8, y * 0.35, z * 1.7);
    h += live * Math.max(0, rib - 0.55) * 0.08;
  } else if (kind === "rose") {
    h += live * Math.max(0, n2 - 0.52) * 0.1 + live * Math.max(0, n3 - 0.7) * 0.05;
  } else {
    h += live * Math.max(0, n1 - 0.48) * 0.12 + live * Math.max(0, n3 - 0.66) * 0.06;
  }
  h += live * (n3 - 0.5) * 0.018;
  return Math.min(0.26, h);
}

function crustColor(x, y, z, h, cover) {
  const live = crustLive(cover);
  const n = noise3(x * 3.1, y * 2.9, z * 3.05);
  const kind = crustKind(x, y, z);
  let r;
  let g;
  let b;
  if (kind === "table") {
    r = 0.96 + n * 0.06;
    g = 0.56 + n * 0.05;
    b = 0.12 + n * 0.03;
  } else if (kind === "olive") {
    r = 0.42 + n * 0.08;
    g = 0.58 + n * 0.07;
    b = 0.12 + n * 0.03;
  } else if (kind === "rose") {
    r = 0.86 + n * 0.06;
    g = 0.4 + n * 0.05;
    b = 0.24 + n * 0.05;
  } else {
    r = 0.9 + n * 0.05;
    g = 0.52 + n * 0.05;
    b = 0.14 + n * 0.03;
  }
  const sr = 0.62;
  const sg = 0.48;
  const sb = 0.32;
  // Skin that exists should read as living crust, not sandstone clay.
  const k = 0.78 + live * 0.22;
  return [sr * (1 - k) + r * k, sg * (1 - k) + g * k, sb * (1 - k) + b * k];
}

function keepSkinFace(x, y, z, nx, ny, nz) {
  const nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  if (y < 0.35 || y > 18.4) return false;
  if (x < -17.2 || x > 21.2) return false;
  if (z < -6.4 || z > 17.2) return false;
  // Tunnel lining sits at wd <= 0 in XY — that is the middle of the arch.
  if (nz < -0.42 && z < -1.2) return false;
  if (ny > 0.94 && y > 16.8) return false;
  return true;
}

function smoothSkin(geo, iters = 2, lambda = 0.42) {
  const p = geo.attributes.position;
  const index = geo.index;
  if (!p || !index) return geo;
  const n = p.count;
  const acc = new Float32Array(n * 3);
  const cnt = new Uint16Array(n);
  const tmp = new Float32Array(n * 3);
  for (let it = 0; it < iters; it++) {
    acc.fill(0);
    cnt.fill(0);
    for (let t = 0; t < index.count; t += 3) {
      const a = index.getX(t);
      const b = index.getX(t + 1);
      const c = index.getX(t + 2);
      const ax = p.getX(a);
      const ay = p.getY(a);
      const az = p.getZ(a);
      const bx = p.getX(b);
      const by = p.getY(b);
      const bz = p.getZ(b);
      const cx = p.getX(c);
      const cy = p.getY(c);
      const cz = p.getZ(c);
      acc[a * 3] += bx + cx;
      acc[a * 3 + 1] += by + cy;
      acc[a * 3 + 2] += bz + cz;
      cnt[a] += 2;
      acc[b * 3] += ax + cx;
      acc[b * 3 + 1] += ay + cy;
      acc[b * 3 + 2] += az + cz;
      cnt[b] += 2;
      acc[c * 3] += ax + bx;
      acc[c * 3 + 1] += ay + by;
      acc[c * 3 + 2] += az + bz;
      cnt[c] += 2;
    }
    for (let i = 0; i < n; i++) {
      if (!cnt[i]) {
        tmp[i * 3] = p.getX(i);
        tmp[i * 3 + 1] = p.getY(i);
        tmp[i * 3 + 2] = p.getZ(i);
        continue;
      }
      const inv = 1 / cnt[i];
      tmp[i * 3] = p.getX(i) * (1 - lambda) + acc[i * 3] * inv * lambda;
      tmp[i * 3 + 1] = p.getY(i) * (1 - lambda) + acc[i * 3 + 1] * inv * lambda;
      tmp[i * 3 + 2] = p.getZ(i) * (1 - lambda) + acc[i * 3 + 2] * inv * lambda;
    }
    for (let i = 0; i < n; i++) p.setXYZ(i, tmp[i * 3], tmp[i * 3 + 1], tmp[i * 3 + 2]);
  }
  p.needsUpdate = true;
  return geo;
}

// Watertight coat on camera-facing grotto faces. No wrapping Y-bands
// (those were the peach coils). Small lift only — do not inflate masses.
function makeFusedCrustSkin(grottoGeo) {
  const srcP = grottoGeo.attributes.position;
  const srcN = grottoGeo.attributes.normal;
  const srcI = grottoGeo.index;
  if (!srcP || !srcN || !srcI) return null;
  const nSrc = srcP.count;
  const used = new Uint8Array(nSrc);
  const faces = [];
  for (let t = 0; t < srcI.count; t += 3) {
    const ia = srcI.getX(t);
    const ib = srcI.getX(t + 1);
    const ic = srcI.getX(t + 2);
    const ax = srcP.getX(ia);
    const ay = srcP.getY(ia);
    const az = srcP.getZ(ia);
    const bx = srcP.getX(ib);
    const by = srcP.getY(ib);
    const bz = srcP.getZ(ib);
    const cx = srcP.getX(ic);
    const cy = srcP.getY(ic);
    const cz = srcP.getZ(ic);
    const mx = (ax + bx + cx) / 3;
    const my = (ay + by + cy) / 3;
    const mz = (az + bz + cz) / 3;
    if (
      !keepSkinFace(
        mx,
        my,
        mz,
        srcN.getX(ia) + srcN.getX(ib) + srcN.getX(ic),
        srcN.getY(ia) + srcN.getY(ib) + srcN.getY(ic),
        srcN.getZ(ia) + srcN.getZ(ib) + srcN.getZ(ic),
      )
    ) {
      continue;
    }
    const wda = windowSDF2D(ax, ay);
    const wdb = windowSDF2D(bx, by);
    const wdc = windowSDF2D(cx, cy);
    const wdm = windowSDF2D(mx, my);
    const span = Math.max(
      Math.hypot(ax - bx, ay - by, az - bz),
      Math.hypot(bx - cx, by - cy, bz - cz),
      Math.hypot(cx - ax, cy - ay, cz - az),
    );
    // Inner walls have wd <= 0. Drop only a sheet that bridges the opening.
    if (wdm < -2.4 && span > 2.2) continue;
    if (wdm < -0.55 && wdm + 1.1 < Math.min(wda, wdb, wdc)) continue;
    const heroLip = wdm < 4.4 && mz > -0.8;
    if (!heroLip && crustCover(mx, my, mz) < 0.3) continue;
    used[ia] = 1;
    used[ib] = 1;
    used[ic] = 1;
    faces.push(ia, ib, ic);
  }
  if (!faces.length) return null;

  const pos = [];
  const nrm = [];
  const remap = new Int32Array(nSrc);
  remap.fill(-1);
  for (let i = 0; i < nSrc; i++) {
    if (!used[i]) continue;
    remap[i] = pos.length / 3;
    pos.push(srcP.getX(i), srcP.getY(i), srcP.getZ(i));
    nrm.push(srcN.getX(i), srcN.getY(i), srcN.getZ(i));
  }

  const mid = new Map();
  function midVert(a, b) {
    const key = a < b ? a + ":" + b : b + ":" + a;
    let i = mid.get(key);
    if (i != null) return i;
    const ia = remap[a];
    const ib = remap[b];
    i = pos.length / 3;
    pos.push(
      (pos[ia * 3] + pos[ib * 3]) * 0.5,
      (pos[ia * 3 + 1] + pos[ib * 3 + 1]) * 0.5,
      (pos[ia * 3 + 2] + pos[ib * 3 + 2]) * 0.5,
    );
    let nx = nrm[ia * 3] + nrm[ib * 3];
    let ny = nrm[ia * 3 + 1] + nrm[ib * 3 + 1];
    let nz = nrm[ia * 3 + 2] + nrm[ib * 3 + 2];
    const l = Math.hypot(nx, ny, nz) || 1;
    nrm.push(nx / l, ny / l, nz / l);
    mid.set(key, i);
    return i;
  }

  const idx = [];
  for (let f = 0; f < faces.length; f += 3) {
    const a = faces[f];
    const b = faces[f + 1];
    const c = faces[f + 2];
    const ia = remap[a];
    const ib = remap[b];
    const ic = remap[c];
    const iab = midVert(a, b);
    const ibc = midVert(b, c);
    const ica = midVert(c, a);
    idx.push(ia, iab, ica, ib, ibc, iab, ic, ica, ibc, iab, ibc, ica);
  }

  const col = new Float32Array((pos.length / 3) * 3);
  const uv = new Float32Array((pos.length / 3) * 2);
  for (let i = 0; i < pos.length / 3; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    let nx = nrm[i * 3];
    let ny = nrm[i * 3 + 1];
    let nz = nrm[i * 3 + 2];
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const cover = crustCover(x, y, z);
    const h = crustHeight(x, y, z, cover);
    const wd = windowSDF2D(x, y);
    // Hug the tunnel lining. Do not inflate a cap across the mouth.
    const lift = (0.034 + Math.max(0.012, h)) * (wd < 0.12 ? 0.28 : 1);
    const px = x + nx * lift;
    const py = y + ny * lift;
    const pz = z + nz * lift;
    pos[i * 3] = px;
    pos[i * 3 + 1] = py;
    pos[i * 3 + 2] = pz;
    const tint = crustColor(x, y, z, h, cover);
    col[i * 3] = tint[0];
    col[i * 3 + 1] = tint[1];
    col[i * 3 + 2] = tint[2];
    uv[i * 2] = x * 0.09;
    uv[i * 2 + 1] = y * 0.09;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  smoothSkin(geo, 1, 0.26);
  const pOut = geo.attributes.position;
  const srcIdx = geo.index;
  const kept = [];
  for (let t = 0; t < srcIdx.count; t += 3) {
    const ia = srcIdx.getX(t);
    const ib = srcIdx.getX(t + 1);
    const ic = srcIdx.getX(t + 2);
    const ax = pOut.getX(ia);
    const ay = pOut.getY(ia);
    const bx = pOut.getX(ib);
    const by = pOut.getY(ib);
    const cx = pOut.getX(ic);
    const cy = pOut.getY(ic);
    const wdm = windowSDF2D((ax + bx + cx) / 3, (ay + by + cy) / 3);
    const span = Math.max(
      Math.hypot(ax - pOut.getX(ib), ay - pOut.getY(ib), pOut.getZ(ia) - pOut.getZ(ib)),
      Math.hypot(pOut.getX(ib) - pOut.getX(ic), pOut.getY(ib) - pOut.getY(ic), pOut.getZ(ib) - pOut.getZ(ic)),
      Math.hypot(pOut.getX(ic) - ax, pOut.getY(ic) - ay, pOut.getZ(ic) - pOut.getZ(ia)),
    );
    if (wdm < -2.4 && span > 2.2) continue;
    kept.push(ia, ib, ic);
  }
  if (!kept.length) return null;
  geo.setIndex(kept);
  geo.computeVertexNormals();
  return geo;
}

// Solid scab welded into the rock. Table lips / fans are RELIEF on a buried
// sandstone body — not a lime coat and not a hovering chip.
function makeLivingScab(seed, kind = "table") {
  const geo = new THREE.IcosahedronGeometry(1, 4);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const lobes = 3 + (((seed * 7.1) | 0) % 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 2.3 + seed, v.y * 2.5, v.z * 2.3);
    const n2 = noise3(v.x * 6.1 + seed, v.y * 5.8, v.z * 6.1);
    const ang = Math.atan2(v.z, v.x);
    const rad = Math.hypot(v.x, v.z);
    let flap = 0.8 + n * 0.28 + 0.1 * Math.sin(ang * lobes + seed);
    if (kind === "fan") flap *= 1.22 + 0.38 * Math.cos(ang * 2 + seed);
    v.x *= flap;
    v.z *= flap * (kind === "fan" ? 0.52 : kind === "brain" ? 0.9 : 1.04);
    const crown = kind === "brain" ? 0.38 : kind === "fan" ? 0.16 : 0.22;
    v.y = (v.y + 0.48) * (crown + n * 0.08) - 0.26;
    const lip = Math.exp(-((rad - 0.68) * (rad - 0.68)) / 0.016);
    if (kind === "table") v.y += lip * 0.14;
    else if (kind === "fan") v.y += lip * 0.05;
    if (n2 > 0.7) v.y += (n2 - 0.7) * 0.1;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

function paintScab(geo, kind, seed) {
  const hue = (seed * 5.73) % 1;
  paint(geo, (x, y, z) => {
    const n = noise3(x * 3.4 + seed, y * 3.2, z * 3.4);
    const n2 = noise3(x * 8.1 + seed, y * 7.6, z * 8.0);
    const r = Math.hypot(x, z);
    const lip = r > 0.42 && y > 0.01;
    const pit = n2 > 0.7;
    let sr = 0.72 + n * 0.08;
    let sg = 0.58 + n * 0.05;
    let sb = 0.36 + n * 0.03;
    if (pit) {
      sr *= 0.8;
      sg *= 0.8;
      sb *= 0.84;
    }
    let lr;
    let lg;
    let lb;
    if (kind === "fan") {
      lr = 0.86 + n * 0.06;
      lg = 0.52 + n * 0.04;
      lb = 0.12;
    } else if (kind === "brain") {
      lr = 0.78 + n * 0.05;
      lg = 0.4 + n * 0.04;
      lb = 0.2;
    } else if (hue > 0.62) {
      lr = 0.62 + n * 0.06;
      lg = 0.5 + n * 0.04;
      lb = 0.14;
    } else {
      lr = 0.92 + n * 0.06;
      lg = 0.56 + n * 0.04;
      lb = 0.12;
    }
    const live = lip ? 0.88 : y > 0.02 ? 0.42 + n2 * 0.2 : 0.12;
    const k = Math.max(0, Math.min(1, live));
    return [sr * (1 - k) + lr * k, sg * (1 - k) + lg * k, sb * (1 - k) + lb * k];
  });
  return geo;
}

function orientAlongNormal(geo, nx, ny, nz, px, py, pz, yaw = 0) {
  const face = new THREE.Vector3(nx, ny, nz);
  if (face.lengthSq() < 1e-8) face.set(0, 0, 1);
  else face.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  let xAxis = new THREE.Vector3().crossVectors(up, face);
  if (xAxis.lengthSq() < 1e-5) xAxis.set(1, 0, 0);
  else xAxis.normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, face).normalize();
  xAxis.crossVectors(face, zAxis).normalize();
  const m = new THREE.Matrix4().makeBasis(xAxis, face, zAxis);
  if (yaw) m.multiply(new THREE.Matrix4().makeRotationY(yaw));
  m.setPosition(px, py, pz);
  geo.applyMatrix4(m);
  return geo;
}

function orientShelf(geo, nx, ny, nz, px, py, pz, yaw = 0) {
  const face = new THREE.Vector3(nx, ny, nz);
  if (face.lengthSq() < 1e-8) face.set(0, 0, 1);
  else face.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  let xAxis = new THREE.Vector3().crossVectors(up, face);
  if (xAxis.lengthSq() < 1e-5) xAxis.set(1, 0, 0);
  else xAxis.normalize();
  const zAxis = new THREE.Vector3().crossVectors(xAxis, face).normalize();
  xAxis.crossVectors(face, zAxis).normalize();
  const m = new THREE.Matrix4().makeBasis(xAxis, face, zAxis);
  m.multiply(new THREE.Matrix4().makeRotationY(yaw));
  m.multiply(new THREE.Matrix4().makeRotationX(0.72 + (Math.abs(yaw) % 1) * 0.2));
  m.setPosition(px, py, pz);
  geo.applyMatrix4(m);
  return geo;
}

function smooth01(x, a, b) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function fanPaint(x, y, z) {
  const n = noise3(x * 3.4, y * 3.4, z * 3.4);
  const n2 = noise3(x * 8.6, y * 8.0, z * 8.6);
  const under = y < 0.12;
  const lip = y > 0.7 && n2 > 0.42;
  const m = 0.92 + n * 0.1 - (under ? 0.14 : 0) + (lip ? 0.07 : 0);
  return [m * 0.94, m * 0.78, m * 0.32];
}

// Closed sector ribbon: front + back + rim. Wide fan silhouette, meaty Z.
function makeFanRibbon(seed, spread = 1.02, reach = 1.12, thick = 0.4) {
  const aN = 22;
  const rN = 7;
  const a0 = -spread;
  const a1 = spread;
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const stride = aN + 1;

  function vert(ai, t, side) {
    const a = a0 + (a1 - a0) * (ai / aN);
    const n = noise3(Math.cos(a) * 2.2 + seed, t * 2.1, seed);
    const n2 = noise3(Math.sin(a) * 4.1 + seed, t * 4.4, 1.6);
    const scallop = 1 + 0.09 * Math.sin(a * 5 + seed * 1.6) * t + (n - 0.5) * 0.035;
    const r = 0.14 + t * reach * scallop;
    let x = Math.sin(a) * r;
    let y = Math.cos(a) * r * 0.9 + 0.1 + (n2 - 0.5) * 0.02;
    if (t > 0.62) y += Math.sin(a * 4 + seed) * (t - 0.62) * 0.1;
    const half = thick * 0.5 * (1.12 - t * 0.22);
    let z = side * half;
    const bend = t * t * 0.72 + (n - 0.5) * 0.08;
    const cb = Math.cos(bend);
    const sb = Math.sin(bend);
    const nx = x * cb - z * sb;
    const nz = x * sb + z * cb;
    return [nx, y, nz];
  }

  function push(x, y, z, u, v, side) {
    const c = fanPaint(x, y, z);
    if (side < 0) {
      c[0] *= 0.9;
      c[1] *= 0.9;
      c[2] *= 0.9;
    }
    pos.push(x, y, z);
    col.push(c[0], c[1], c[2]);
    uv.push(u, v);
  }

  for (let j = 0; j <= rN; j++) {
    const t = j / rN;
    for (let i = 0; i <= aN; i++) {
      const p = vert(i, t, 1);
      push(p[0], p[1], p[2], i / aN, t, 1);
    }
  }
  for (let j = 0; j < rN; j++) {
    for (let i = 0; i < aN; i++) {
      const a = j * stride + i;
      idx.push(a, a + stride, a + 1, a + stride, a + stride + 1, a + 1);
    }
  }
  const back0 = pos.length / 3;
  for (let j = 0; j <= rN; j++) {
    const t = j / rN;
    for (let i = 0; i <= aN; i++) {
      const p = vert(i, t, -1);
      push(p[0], p[1], p[2], i / aN, t, -1);
    }
  }
  for (let j = 0; j < rN; j++) {
    for (let i = 0; i < aN; i++) {
      const a = back0 + j * stride + i;
      idx.push(a, a + 1, a + stride, a + stride, a + 1, a + stride + 1);
    }
  }
  const frontOuter = rN * stride;
  const backOuter = back0 + rN * stride;
  for (let i = 0; i < aN; i++) {
    idx.push(frontOuter + i, backOuter + i, frontOuter + i + 1, frontOuter + i + 1, backOuter + i, backOuter + i + 1);
  }
  for (let i = 0; i < aN; i++) {
    idx.push(i, i + 1, back0 + i, i + 1, back0 + i + 1, back0 + i);
  }
  for (let j = 0; j < rN; j++) {
    const a = j * stride;
    const b = a + stride;
    const c = back0 + j * stride;
    const d = c + stride;
    idx.push(a, c, b, b, c, d);
    const e = a + aN;
    const f = b + aN;
    const g = c + aN;
    const h = d + aN;
    idx.push(e, f, g, f, h, g);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function makeFanCoral(seed = 6.4) {
  const geo = new THREE.IcosahedronGeometry(1, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const spread = 1.02 + ((seed * 1.7) % 1) * 0.16;
  const thick = 0.42 + ((seed * 2.3) % 1) * 0.1;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 2.6 + seed, v.y * 2.4, v.z * 2.6);
    const n2 = noise3(v.x * 5.2 + seed, v.y * 5.0, v.z * 5.1);
    const y01 = (v.y + 1) * 0.5;
    let x = v.x * spread * (0.62 + y01 * 0.48);
    let z = v.z * thick * (1.02 - y01 * 0.12);
    let y = y01 * 0.38 - 0.26;
    const scallop = 1 + 0.1 * Math.sin(Math.atan2(v.z, v.x) * 4 + seed) * y01;
    x *= scallop * (0.92 + n * 0.14);
    z *= 0.9 + n2 * 0.16;
    pos.setXYZ(i, x, y, z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  const hold = makeHoldfast(seed);
  hold.scale(1.16, 0.62, 1.04);
  hold.translate(0, -0.08, 0);
  const out = mergeGeos([hold, geo]);
  paint(out, fanPaint);
  return out;
}

export function makeBranchCoral() {
  const rng = mulberry32(91);
  const parts = [];
  for (let i = 0; i < 8; i++) {
    const h = 0.32 + rng() * 0.55;
    const g = new THREE.CylinderGeometry(0.018 + rng() * 0.016, 0.042 + rng() * 0.02, h, 5, 2);
    g.translate(0, h * 0.5, 0);
    g.rotateZ((rng() - 0.5) * 0.95);
    g.rotateX((rng() - 0.5) * 0.45);
    g.rotateY(rng() * Math.PI * 2);
    g.translate((rng() - 0.5) * 0.16, 0, (rng() - 0.5) * 0.16);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const n = noise3(pos.getX(k) * 8, pos.getY(k) * 6, pos.getZ(k) * 8);
      pos.setX(k, pos.getX(k) * (1 + n * 0.12));
      pos.setZ(k, pos.getZ(k) * (1 + n * 0.12));
    }
    parts.push(g);
  }
  const geo = mergeGeos(parts);
  paint(geo, (x, y, z) => {
    const n = noise3(x * 6, y * 6, z * 6);
    const m = 0.72 + n * 0.3;
    return [m, m * 0.9, m * 0.7];
  });
  return geo;
}

export function makeBarnacle() {
  const cone = new THREE.ConeGeometry(0.11, 0.13, 6, 1);
  cone.translate(0, 0.065, 0);
  const pos = cone.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const n = noise3(pos.getX(i) * 10, pos.getY(i) * 8, pos.getZ(i) * 10);
    pos.setX(i, pos.getX(i) * (1 + n * 0.18));
    pos.setZ(i, pos.getZ(i) * (1 + n * 0.18));
  }
  cone.computeVertexNormals();
  paint(cone, () => [0.85, 0.78, 0.62]);
  return cone;
}

export function makePebble() {
  const geo = new THREE.SphereGeometry(0.22, 10, 8);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 4.2, v.y * 4.2, v.z * 4.2);
    v.multiplyScalar(0.7 + n * 0.45);
    v.y *= 0.55 + n * 0.16;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  paint(geo, (x, y, z) => {
    const n = noise3(x * 5, y * 5, z * 5);
    const m = 0.7 + n * 0.3;
    return [m * 0.95, m * 0.82, m * 0.6];
  });
  return geo;
}

export function makeShell() {
  const geo = new THREE.SphereGeometry(0.16, 10, 7, 0, Math.PI);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    const swirl = 1 + a * 0.04;
    pos.setXYZ(i, x * swirl * 1.15, y * 0.45 + r * 0.08, z * swirl);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  paint(geo, (x, y, z) => {
    const band = 0.7 + 0.3 * Math.sin(Math.atan2(z, x) * 6);
    return [0.85 * band, 0.72 * band, 0.52 * band];
  });
  return geo;
}

export function makeGrassBlade() {
  const geo = new THREE.PlaneGeometry(0.18, 0.72, 1, 4);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    pos.setX(i, pos.getX(i) * (1.05 - y * 0.85));
    pos.setZ(i, Math.sin(y * 4.2) * 0.05);
    const t = (y + 0.36) / 0.72;
    col[i * 3] = 0.95 + t * 0.05;
    col[i * 3 + 1] = 0.55 + t * 0.25;
    col[i * 3 + 2] = 0.08 + t * 0.04;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.translate(0, 0.36, 0);
  geo.computeVertexNormals();
  return geo;
}

export function makeWeed() {
  const parts = [];
  const rng = mulberry32(44);
  for (let i = 0; i < 5; i++) {
    const h = 0.45 + rng() * 0.55;
    const g = new THREE.PlaneGeometry(0.12, h, 1, 4);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      const y = pos.getY(k);
      pos.setZ(k, Math.sin(y * 6 + i) * 0.06);
      pos.setX(k, pos.getX(k) * (1.1 - y * 0.8));
    }
    g.translate(0, h * 0.5, 0);
    g.rotateY((i / 5) * Math.PI * 2);
    g.rotateZ((rng() - 0.5) * 0.35);
    parts.push(g);
  }
  return mergeGeos(parts);
}

function kelpCenter(t, seed) {
  const amp = 0.08 + ((seed * 5.17) % 1) * 0.34;
  const amp2 = 0.03 + ((seed * 3.41) % 1) * 0.12;
  const f1 = 0.72 + ((seed * 2.23) % 1) * 1.55;
  const f2 = 2.4 + ((seed * 4.71) % 1) * 2.6;
  return [
    Math.sin(t * f1 + seed * 2.05) * amp + Math.sin(t * f2 + seed) * amp2,
    Math.cos(t * f1 * 0.78 + seed * 1.44) * amp * 0.72 + Math.sin(t * f2 * 0.84 + seed * 0.6) * amp2,
  ];
}

function pushKelpVert(pos, col, uv, x, y, z, r, g, b, u, v) {
  pos.push(x, y, z);
  col.push(r, g, b);
  uv.push(u, v);
}

function makeKelpRope(seed, height, radius, style = {}) {
  const rings = 62;
  const segs = 26;
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const stride = segs + 1;
  const twists = style.twists ?? (4.6 + ((seed * 3.1) % 1) * 10.4);
  const lobes = style.lobes ?? (2 + (((seed * 11.3) | 0) % 3));
  const ridgeAmp = style.ridge ?? (0.2 + ((seed * 2.4) % 1) * 0.26);
  const lumpN = style.lumps ?? (2 + (((seed * 9.1) | 0) % 3));
  const lumpAmp = style.lumpAmp ?? (0.16 + ((seed * 2.8) % 1) * 0.18);
  const lumps = [];
  for (let L = 0; L < lumpN; L++) {
    lumps.push({
      t: 0.1 + ((seed * 1.71 + L * 1.93) % 1) * 0.72,
      w: 0.07 + ((seed * 2.23 + L) % 1) * 0.11,
      d: lumpAmp * (0.7 + ((seed * 1.44 + L * 0.8) % 1) * 0.7),
    });
  }
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const y = t * height;
    const [cx, cz] = kelpCenter(t, seed);
    const foot = t < 0.07 ? 1 + (0.07 - t) * 7.5 : 1;
    const bulge = 1 + 0.14 * Math.sin(t * (6.4 + ((seed * 5.1) % 1) * 5) + seed * 2.2);
    let lump = 1;
    for (const L of lumps) {
      const d = (t - L.t) / L.w;
      lump += L.d * Math.exp(-d * d);
    }
    // Stay fat up the visible column — taper only near the unseen top.
    const taper = (1.16 - t * 0.14) * foot * bulge * lump;
    const twist = t * Math.PI * 2 * twists + seed * 2.15 + 0.35 * Math.sin(t * 6.4 + seed);
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const n = noise3(Math.cos(a) * 2.1 + seed, t * 3.4, Math.sin(a) * 2.1);
      const n2 = noise3(Math.cos(a) * 5.4 + seed, t * 7.2, Math.sin(a) * 5.4);
      const n3 = noise3(Math.cos(a) * 11.0 + seed, t * 14.0, Math.sin(a) * 11.0);
      const lobe = Math.cos(a * lobes - twist);
      const fiber = Math.cos(a * (8 + (((seed * 7) | 0) % 6)) - twist * 1.55);
      const ridge = 1 - ridgeAmp + ridgeAmp * 1.7 * Math.pow(0.5 + 0.5 * lobe, 1.35);
      const bark =
        1 +
        0.14 * Math.sin(a * 7 + twist * 0.55) +
        0.1 * Math.sin(a * 15 + t * 18 + seed) +
        0.07 * fiber +
        (n - 0.5) * 0.18 +
        (n2 - 0.5) * 0.1 +
        (n3 - 0.5) * 0.06;
      const rad = radius * taper * ridge * bark;
      const x = cx + Math.cos(a) * rad;
      const z = cz + Math.sin(a) * rad;
      const valley = 1 - Math.pow(0.5 + 0.5 * lobe, 1.45);
      const m = 0.48 + n * 0.14 - valley * 0.22 + t * 0.02 - (1 - fiber) * 0.05;
      pushKelpVert(pos, col, uv, x, y, z, m * 0.058, m * 0.092, m * 0.03, i / segs, t);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * stride + i;
      const b = a + stride;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const [bx, bz] = kelpCenter(0, seed);
  const [tx, tz] = kelpCenter(1, seed);
  const botC = pos.length / 3;
  pushKelpVert(pos, col, uv, bx, 0.01, bz, 0.05, 0.07, 0.028, 0.5, 0);
  for (let i = 0; i < segs; i++) idx.push(botC, i + 1, i);
  const topC = pos.length / 3;
  const topRing = rings * stride;
  pushKelpVert(pos, col, uv, tx, height, tz, 0.07, 0.1, 0.034, 0.5, 1);
  for (let i = 0; i < segs; i++) idx.push(topC, topRing + i, topRing + i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function makeKelpHelix(seed, height, wrapR, strandR, turns, phase, pathSeed) {
  const rings = 56;
  const segs = 12;
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const stride = segs + 1;
  const ps = pathSeed ?? seed;
  const slack = 0.12 + ((seed * 4.7) % 1) * 0.38;
  const jerk = 0.18 + ((seed * 3.2) % 1) * 0.48;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const y = t * height;
    const [cx, cz] = kelpCenter(t, ps);
    const speed = 1 + jerk * Math.sin(t * 5.4 + seed * 2.4) + 0.16 * Math.sin(t * 12.6 + seed);
    const a = t * Math.PI * 2 * turns * speed + phase + 0.4 * Math.sin(t * 8.6 + seed * 3.1);
    const wob = 1 + slack * Math.sin(t * 7.8 + seed * 3.1) + 0.1 * Math.sin(t * 19 + phase);
    const wr = wrapR * (1.02 - t * 0.08) * Math.max(0.62, wob);
    const px = cx + Math.cos(a) * wr;
    const pz = cz + Math.sin(a) * wr;
    const tx = -Math.sin(a);
    const tz = Math.cos(a);
    const taper = strandR * (1.18 - t * 0.16) * (1 + 0.28 * Math.sin(t * 16 + seed));
    for (let i = 0; i <= segs; i++) {
      const u = (i / segs) * Math.PI * 2;
      const n = noise3(Math.cos(u) * 3 + seed, t * 6, Math.sin(u) * 3);
      const rr = taper * (1 + (n - 0.5) * 0.32);
      const x = px + Math.cos(u) * rr * tx * 0.35 + Math.cos(a) * Math.cos(u) * rr;
      const z = pz + Math.cos(u) * rr * tz * 0.35 + Math.sin(a) * Math.cos(u) * rr;
      const yy = y + Math.sin(u) * rr;
      const m = 0.4 + n * 0.14;
      pushKelpVert(pos, col, uv, x, yy, z, m * 0.05, m * 0.082, m * 0.024, i / segs, t);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * stride + i;
      const b = a + stride;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function makeKelpHoldfast(seed) {
  const parts = [];
  const foot = new THREE.SphereGeometry(0.62, 12, 8);
  const fp = foot.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < fp.count; i++) {
    v.fromBufferAttribute(fp, i);
    const n = noise3(v.x * 3.2 + seed, v.y * 3.1, v.z * 3.2);
    v.x *= 1.15 + n * 0.28;
    v.z *= 1.08 + n * 0.22;
    v.y = (v.y + 0.15) * (0.42 + n * 0.18);
    if (v.y < 0.02) v.y *= 0.3;
    fp.setXYZ(i, v.x, v.y, v.z);
  }
  parts.push(foot);
  for (let r = 0; r < 6; r++) {
    const a = seed * 1.7 + r * 1.047;
    const len = 0.7 + ((seed * 2.3 + r) % 1) * 0.45;
    const g = new THREE.CylinderGeometry(0.04, 0.13, len, 6, 3);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const t = (y + len * 0.5) / len;
      p.setX(i, p.getX(i) + t * t * Math.cos(a) * 0.55);
      p.setZ(i, p.getZ(i) + t * t * Math.sin(a) * 0.55);
      p.setY(i, y * 0.35 + t * t * 0.02);
    }
    g.translate(Math.cos(a) * 0.22, 0.04, Math.sin(a) * 0.22);
    parts.push(g);
  }
  const geo = mergeGeos(parts);
  paint(geo, (x, y, z) => {
    const n = noise3(x * 4, y * 4, z * 4);
    const m = 0.62 + n * 0.16;
    return [m * 0.08, m * 0.11, m * 0.04];
  });
  return geo;
}

function makeKelpWhiskers(seed, height, n = 28, radius = 0.4) {
  const parts = [];
  const attach = radius * 1.08 + 0.08;
  for (let k = 0; k < n; k++) {
    const t = 0.08 + (k / n) * 0.88;
    const [cx, cz] = kelpCenter(t, seed);
    const a = seed * 2.7 + k * 2.399;
    const [dx, dz] = kelpCenter(Math.min(1, t + 0.02), seed);
    const px = cx + Math.cos(a) * attach;
    const pz = cz + Math.sin(a) * attach;
    const py = t * height;
    const len = 1.35 + ((seed * 4.1 + k) % 1) * 2.15;
    const rings = 6;
    const segs = 4;
    const pos = [];
    const col = [];
    const uv = [];
    const idx = [];
    const stride = segs + 1;
    const curl = ((seed * 3.3 + k * 0.7) % 1) - 0.5;
    for (let j = 0; j <= rings; j++) {
      const u = j / rings;
      const drop = u * len + u * u * 0.55;
      const out = Math.sin(u * 1.25) * (0.72 + radius * 0.35);
      const lean = (dx - cx) * u * 4;
      const spin = curl * u * u * 0.55;
      const ox = px + Math.cos(a + spin) * out + lean;
      const oz = pz + Math.sin(a + spin) * out;
      const oy = py - drop;
      const rad = 0.078 * (1 - u * 0.68) * (1 + 0.32 * Math.sin(u * 10 + seed));
      for (let i = 0; i <= segs; i++) {
        const b = (i / segs) * Math.PI * 2;
        const m = 0.42 + u * 0.1;
        pushKelpVert(
          pos, col, uv,
          ox + Math.cos(b) * rad, oy, oz + Math.sin(b) * rad,
          m * 0.05, m * 0.085, m * 0.024,
          i / segs, u,
        );
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const a0 = j * stride + i;
        const b0 = a0 + stride;
        idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    parts.push(g);
  }
  return mergeGeos(parts);
}

function makeKelpHair(seed, height, radius, n = 52) {
  const parts = [];
  for (let k = 0; k < n; k++) {
    const t = 0.05 + (k / n) * 0.92 + ((seed * 2.8 + k * 0.13) % 1) * 0.01;
    const [cx, cz] = kelpCenter(t, seed);
    const a = seed * 4.1 + k * 1.746;
    const px = cx + Math.cos(a) * radius * 1.18;
    const pz = cz + Math.sin(a) * radius * 1.18;
    const py = t * height;
    const len = 0.55 + ((seed * 6.2 + k * 0.91) % 1) * 1.55;
    const rings = 5;
    const segs = 3;
    const pos = [];
    const col = [];
    const uv = [];
    const idx = [];
    const stride = segs + 1;
    const side = ((seed * 5.1 + k) % 1) - 0.5;
    for (let j = 0; j <= rings; j++) {
      const u = j / rings;
      const drop = u * len + u * u * 0.42;
      const out = Math.sin(u * 1.45) * (0.28 + len * 0.32);
      const ox = px + Math.cos(a) * out + Math.sin(a) * side * u * 0.28;
      const oz = pz + Math.sin(a) * out - Math.cos(a) * side * u * 0.28;
      const oy = py - drop;
      const rad = 0.048 * (1 - u * 0.72) * (1 + 0.35 * Math.sin(u * 12 + seed + k));
      for (let i = 0; i <= segs; i++) {
        const b = (i / segs) * Math.PI * 2;
        const m = 0.38 + u * 0.08;
        pushKelpVert(
          pos, col, uv,
          ox + Math.cos(b) * rad, oy, oz + Math.sin(b) * rad,
          m * 0.046, m * 0.078, m * 0.022,
          i / segs, u,
        );
      }
    }
    for (let j = 0; j < rings; j++) {
      for (let i = 0; i < segs; i++) {
        const a0 = j * stride + i;
        const b0 = a0 + stride;
        idx.push(a0, b0, a0 + 1, b0, b0 + 1, a0 + 1);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    parts.push(g);
  }
  return mergeGeos(parts);
}

export function makeKelpStalk(seed = 1.1, opts = {}) {
  const dense = typeof opts === "boolean" ? opts : !!opts.dense;
  const height = 48;
  const u = (seed * 2.718) % 1;
  const u2 = (seed * 5.139) % 1;
  const u3 = (seed * 7.331) % 1;
  const radius = opts.radius ?? (0.38 + u * 0.36);
  const turns = opts.turns ?? (3.6 + u2 * 12.8);
  const wrapN = opts.wraps ?? (3 + ((u3 * 5) | 0) + (dense ? 3 : 0));
  const hairN = opts.hair ?? (dense ? 140 : 72);
  const whiskN = opts.whiskers ?? (dense ? 72 : 34);
  const lobes = opts.lobes ?? (2 + (((seed * 11.3) | 0) % 3));
  const parts = [
    makeKelpRope(seed, height, radius, {
      twists: turns * (0.55 + u * 0.5),
      lobes,
      lumps: dense ? 5 : 3,
      lumpAmp: dense ? 0.36 : 0.2,
    }),
    makeKelpHoldfast(seed),
    makeKelpWhiskers(seed, height, whiskN, radius),
    makeKelpHair(seed, height, radius, hairN),
  ];
  for (let w = 0; w < wrapN; w++) {
    // Close fat wraps add bulk; a few looser ones keep the shaggy silhouette.
    const hug = w < (dense ? 4 : 2);
    const wr = radius * (hug ? 0.78 + ((seed * 3.1 + w * 1.73) % 1) * 0.34 : 1.05 + ((seed * 3.1 + w * 1.73) % 1) * 0.48);
    const sr = (hug ? 0.1 : 0.06) + ((seed * 2.4 + w * 0.91) % 1) * (dense ? 0.16 : 0.09);
    const tn = turns * (0.48 + ((seed * 1.8 + w * 0.83) % 1) * 0.95) + w * 0.55;
    const ph = seed * 0.37 + w * 1.41 + ((seed * 4.2 + w) % 1);
    parts.push(makeKelpHelix(seed + w * 1.61, height, wr, sr, tn, ph, seed));
  }
  if (dense) {
    parts.push(makeKelpHair(seed + 3.3, height, radius * 1.22, Math.max(56, (hairN * 0.65) | 0)));
    parts.push(makeKelpWhiskers(seed + 4.7, height, Math.max(28, (whiskN * 0.45) | 0), radius * 1.08));
  }
  const geo = mergeGeos(parts);
  geo.computeVertexNormals();
  return geo;
}

function kelpLeafTint(t, n, edge = 0) {
  // Olive-brown wet cloth; gold only on the last ~10% of the tip.
  const tip = Math.pow(Math.max(0, (t - 0.9) / 0.1), 2.4);
  const olive = 0.84 + n * 0.12;
  const rim = (Math.max(0, Math.abs(edge) - 0.82) / 0.18) * tip;
  return [
    0.118 * olive + tip * 0.48 + rim * 0.1,
    0.235 * olive + tip * 0.1 + rim * 0.02,
    0.04 * olive + tip * 0.006,
  ];
}

// Soft hanging wet-cloth strap. Wide mid, hangs nearly straight, gold only at the tip.
function pushFloraDrape(pos, col, uv, idx, seed, ox, oy, oz, yaw, len, midW) {
  const rings = 32;
  const cols = 8;
  const sag = 0.045 + ((seed * 1.9) % 1) * 0.06;
  const bow = 0.032 + ((seed * 2.8) % 1) * 0.038;
  const twist = (((seed * 5.3) % 1) - 0.5) * 0.14;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const base = pos.length / 3;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const n = noise3(seed, t * 2.2, 0.7);
    const n2 = noise3(seed * 1.4, t * 3.6, 2.1);
    const drop = t * len + t * t * sag * len;
    const out = Math.sin(t * Math.PI * 0.5) * bow + Math.sin(t * 1.9 + seed) * 0.014 * t;
    const side = Math.sin(t * 1.28 + seed * 1.9) * 0.018 * t;
    const spin = twist * t * t;
    const lx = side + Math.sin(spin) * out * 0.18;
    const ly = -drop;
    const lz = out + (n2 - 0.5) * 0.012;
    const flare = Math.sin(Math.min(1, t / 0.94) * Math.PI);
    const root = 0.36 + 0.64 * Math.min(1, t / 0.08);
    const tipKeep = 1 - Math.pow(Math.max(0, (t - 0.82) / 0.18), 1.45) * 0.84;
    const w = midW * (0.44 + 0.56 * flare) * tipKeep * (t < 0.08 ? root : 1) * (1 + (n - 0.5) * 0.035);
    for (let i = 0; i <= cols; i++) {
      const u = (i / cols) * 2 - 1;
      const margin =
        1 +
        0.038 * Math.sin(t * 7.8 + seed * 2.1 + u * 2.1) +
        0.016 * Math.sin(t * 13.6 + seed * 3.4) +
        (n - 0.5) * 0.022;
      const wrinkle = Math.sin(t * 8.8 + u * 3.6 + seed) * 0.009 * t;
      const fold = (1 - u * u) * (0.012 + t * 0.018);
      const px = lx + u * w * margin;
      const py = ly;
      const pz = lz + wrinkle - fold;
      const [cr, cg, cb] = kelpLeafTint(t, n, u);
      pushKelpVert(
        pos, col, uv,
        ox + px * cy - pz * sy,
        oy + py,
        oz + px * sy + pz * cy,
        cr, cg, cb,
        (u + 1) * 0.5, t,
      );
    }
  }
  const stride = cols + 1;
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < cols; i++) {
      const a = base + j * stride + i;
      const b = a + stride;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
}

function makeKelpPaddle(seed, len, width, _thick) {
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const L = len || 3.6;
  const W = width || 0.38;
  // Two slightly offset folds — wet cloth, not a paper kite.
  for (let s = 0; s < 2; s++) {
    const yaw = (s - 0.5) * 0.055 + (((seed * 1.37 + s) % 1) - 0.5) * 0.03;
    const ox = (s - 0.5) * 0.026;
    const oy = s * 0.022;
    const oz = (((seed * 1.8 + s) % 1) - 0.5) * 0.014;
    pushFloraDrape(pos, col, uv, idx, seed + s * 0.37, ox, oy, oz, yaw, L * (1 - s * 0.07), W * (1 - s * 0.08));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function makeKelpMossTuft(seed, rad = 0.48) {
  const geo = new THREE.IcosahedronGeometry(rad, 3);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 4.4 + seed, v.y * 4.1, v.z * 4.4);
    const n2 = noise3(v.x * 9.2 + seed, v.y * 8.4, v.z * 9.2);
    const ang = Math.atan2(v.z, v.x);
    const lobe = 0.9 + n * 0.22 + 0.08 * Math.sin(ang * 4 + seed) + n2 * 0.06;
    v.x *= lobe * 1.22;
    v.z *= lobe * 1.1;
    v.y = v.y * (0.92 + n * 0.22) - rad * 0.4;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  paint(geo, (x, y, z) => {
    const n = noise3(x * 5.2, y * 5.2, z * 5.2);
    const tip = Math.max(0, -y / Math.max(rad, 0.2));
    const [r, g, b] = kelpLeafTint(0.06 + tip * 0.28 + n * 0.08, n);
    return [r, g, b];
  });
  return geo;
}

export function makeKelpLeaf(seed = 1.2) {
  const len = 3.8 + ((seed * 3.3) % 1) * 1.4;
  const flare = 0.34 + ((seed * 2.1) % 1) * 0.16;
  return makeKelpPaddle(seed, len, flare, 0.012);
}

export function makeKelpFrond(seed = 2.2) {
  const len = 3.4 + ((seed * 3.1) % 1) * 1.0;
  const width = 0.32 + ((seed * 2.4) % 1) * 0.12;
  return makeKelpPaddle(seed, len, width, 0.012);
}

// One hanging cloth strap — not a fan of kite blades.
export function makeKelpCrown(seed = 1.4) {
  const len = 4.0 + ((seed * 3.1) % 1) * 1.1;
  const width = 0.36 + ((seed * 2.4) % 1) * 0.14;
  return makeKelpPaddle(seed, len, width, 0.012);
}

export function makeSeedCluster(seed = 1.4) {
  const parts = [];
  const rng = mulberry32(((seed * 9973) | 0) + 17);
  // Tight hanging lantern grapes: irregular amber orbs, not plastic balloons.
  const layers = [
    { y: 0.0, ring: 0.14, n: 3, r: 0.118 },
    { y: -0.26, ring: 0.24, n: 6, r: 0.132 },
    { y: -0.54, ring: 0.22, n: 5, r: 0.126 },
    { y: -0.78, ring: 0.13, n: 4, r: 0.116 },
    { y: -0.98, ring: 0.0, n: 1, r: 0.11 },
  ];
  let gi = 0;
  for (const layer of layers) {
    for (let i = 0; i < layer.n; i++) {
      const a = (i / layer.n) * Math.PI * 2 + seed * 0.7 + layer.y * 1.8;
      const jitter = 0.014 + rng() * 0.022;
      const x = Math.cos(a) * (layer.ring + (rng() - 0.5) * jitter);
      const z = Math.sin(a) * (layer.ring * 0.78 + (rng() - 0.5) * jitter);
      const y = layer.y + (rng() - 0.5) * 0.04;
      const r = layer.r * (0.88 + rng() * 0.2);
      const g = new THREE.SphereGeometry(r, 12, 10);
      const pos = g.attributes.position;
      const p = new THREE.Vector3();
      const squash = 0.86 + rng() * 0.12;
      const tall = 1.04 + rng() * 0.12;
      for (let k = 0; k < pos.count; k++) {
        p.fromBufferAttribute(pos, k);
        const ns = noise3(p.x * 5.2 + seed, p.y * 5.2, p.z * 5.2 + gi);
        const ns2 = noise3(p.x * 9.4 + gi, p.y * 8.8, p.z * 9.4);
        const dimple = ns2 > 0.8 ? (ns2 - 0.8) * 0.12 : 0;
        p.x *= squash * (0.92 + ns * 0.1 + ns2 * 0.04 - dimple);
        p.z *= squash * (0.92 + ns * 0.1 + ns2 * 0.04 - dimple);
        p.y *= tall * (0.94 + ns * 0.07 - dimple * 0.22);
        pos.setXYZ(k, p.x + x, p.y + y, p.z + z);
      }
      parts.push(g);
      gi++;
    }
  }
  const stem = new THREE.CylinderGeometry(0.024, 0.042, 0.28, 6, 2);
  stem.translate(0, 0.08, 0);
  parts.push(stem);
  const geo = mergeGeos(parts);
  paint(geo, (x, y, z) => {
    const n = noise3(x * 6.4, y * 6.4, z * 6.4);
    const n2 = noise3(x * 2.2 + 3, y * 2.2, z * 2.2);
    const rad = Math.hypot(x, z);
    const contact = Math.max(0, 0.1 - rad);
    const hot = Math.max(0, 0.28 - Math.hypot(x, y + 0.46, z));
    const m = 1.02 + n * 0.14 - contact * 0.55 + hot * 0.38;
    const amber = 0.58 + n2 * 0.22;
    return [m * 1.72, m * (0.38 + amber * 0.22), m * 0.042];
  });
  return geo;
}

function srgbHex(hex) {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

export function createFlora(scene, shared, grotto = null) {
  const group = new THREE.Group();
  group.name = "flora";
  const rng = mulberry32(WORLD_SEED + 19);
  const spongeMaps = makeSpongeMaps(256);
  const coralMaps = makeCoralMaps(256);

  const tubeGeo = makeSpongeGeometry("tube");
  const bulbGeo = makeSpongeGeometry("bulb");
  const spongeMat = new THREE.MeshStandardMaterial({
    color: 0xffd428,
    map: spongeMaps.albedo,
    normalMap: spongeMaps.normal,
    normalScale: new THREE.Vector2(1.55, 1.55),
    roughness: 0.48,
    metalness: 0.0,
    vertexColors: true,
    emissive: 0x8a3400,
    emissiveIntensity: 0.32,
  });
  patchUnderwater(spongeMat, shared, { detail: "sponge", absorb: "soft" });

  const TUBE_N = 260;
  const BULB_N = 180;
  const BRAIN_N = 180;
  const PLATE_N = 280;
  const SHELF_N = 240;
  const TALL_N = 180;
  const BRACKET_N = 160;
  const VOL_N = 200;
  const CRUST_N = 420;
  const FAN_N = 140;
  const tubeMesh = new THREE.InstancedMesh(tubeGeo, spongeMat, TUBE_N);
  const bulbMesh = new THREE.InstancedMesh(bulbGeo, spongeMat, BULB_N);
  tubeMesh.castShadow = tubeMesh.receiveShadow = true;
  bulbMesh.castShadow = bulbMesh.receiveShadow = true;
  tubeMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TUBE_N * 3), 3);
  bulbMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BULB_N * 3), 3);

  const brainGeo = makeBrainCoral();
  const brainMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.72,
    vertexColors: true,
    emissive: 0x7a2018,
    emissiveIntensity: 0.22,
  });
  patchUnderwater(brainMat, shared, { detail: "coral", absorb: "soft" });
  const brains = new THREE.InstancedMesh(brainGeo, brainMat, BRAIN_N);
  brains.castShadow = true;
  brains.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BRAIN_N * 3), 3);

  const plateGeo = makePlateCoral(0);
  const shelfGeo = makePlateCoral(1);
  const tallGeo = makePlateCoral(2);
  const plateMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: coralMaps.albedo,
    roughness: 0.58,
    vertexColors: true,
    emissive: 0x8a2808,
    emissiveIntensity: 0.22,
  });
  patchUnderwater(plateMat, shared, { detail: "coral", absorb: "soft" });
  const plates = new THREE.InstancedMesh(plateGeo, plateMat, PLATE_N);
  const shelves = new THREE.InstancedMesh(shelfGeo, plateMat, SHELF_N);
  const talls = new THREE.InstancedMesh(tallGeo, plateMat, TALL_N);
  plates.count = shelves.count = talls.count = 0;
  plates.castShadow = shelves.castShadow = talls.castShadow = true;
  plates.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PLATE_N * 3), 3);
  shelves.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SHELF_N * 3), 3);
  talls.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TALL_N * 3), 3);

  const bracketGeo = makeBracketColony();
  const brackets = new THREE.InstancedMesh(bracketGeo, plateMat, BRACKET_N);
  brackets.castShadow = true;
  brackets.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(BRACKET_N * 3), 3);
  brackets.count = 0;

  const volGeoA = makeVolumetricColony(1.3);
  const volGeoB = makeVolumetricColony(4.7);
  const vols = new THREE.InstancedMesh(volGeoA, plateMat, VOL_N);
  vols.castShadow = true;
  vols.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(VOL_N * 3), 3);
  vols.count = 0;

  const crustGeo = makeEncrust();
  const crustMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: coralMaps.albedo,
    roughness: 0.76,
    vertexColors: true,
    emissive: 0x5a2208,
    emissiveIntensity: 0.12,
  });
  patchUnderwater(crustMat, shared, { detail: "coral", absorb: "soft" });
  const crusts = new THREE.InstancedMesh(crustGeo, crustMat, CRUST_N);
  crusts.castShadow = true;
  crusts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CRUST_N * 3), 3);
  crusts.count = 0;

  const fanGeo = makeFanCoral(6.4);
  const fanMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: coralMaps.albedo,
    roughness: 0.62,
    vertexColors: true,
    emissive: 0x6a2208,
    emissiveIntensity: 0.2,
  });
  patchUnderwater(fanMat, shared, { caustics: false, detail: "coral", absorb: "soft" });
  const fans = new THREE.InstancedMesh(fanGeo, fanMat, FAN_N);
  fans.castShadow = true;
  fans.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FAN_N * 3), 3);

  const branchGeo = makeBranchCoral();
  const branchMat = new THREE.MeshStandardMaterial({
    color: 0x48b058,
    roughness: 0.7,
    vertexColors: true,
    emissive: 0x1a4010,
    emissiveIntensity: 0.14,
  });
  patchUnderwater(branchMat, shared, { detail: "coral", absorb: "soft" });
  const branches = new THREE.InstancedMesh(branchGeo, branchMat, 320);
  branches.castShadow = true;
  branches.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(320 * 3), 3);

  const barnGeo = makeBarnacle();
  const barnMat = new THREE.MeshStandardMaterial({
    color: 0xe8c890,
    roughness: 0.82,
    vertexColors: true,
    emissive: 0x3a2208,
    emissiveIntensity: 0.08,
  });
  patchUnderwater(barnMat, shared, { absorb: false, detail: "rock" });
  const barns = new THREE.InstancedMesh(barnGeo, barnMat, 900);
  barns.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(900 * 3), 3);

  const PEBBLE_N = 520;
  const SHELL_N = 180;
  const pebbleGeo = makePebble();
  const pebbleMat = new THREE.MeshStandardMaterial({
    color: 0xe0b878,
    roughness: 0.9,
    metalness: 0.0,
    vertexColors: true,
    emissive: 0x3a2008,
    emissiveIntensity: 0.08,
  });
  patchUnderwater(pebbleMat, shared, { absorb: false, detail: "rock" });
  const pebbles = new THREE.InstancedMesh(pebbleGeo, pebbleMat, PEBBLE_N);
  pebbles.castShadow = true;
  pebbles.receiveShadow = true;
  pebbles.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(PEBBLE_N * 3), 3);

  const shellGeo = makeShell();
  const shellMat = new THREE.MeshStandardMaterial({
    color: 0xd2b48a,
    roughness: 0.55,
    vertexColors: true,
  });
  patchUnderwater(shellMat, shared, { detail: "coral" });
  const shells = new THREE.InstancedMesh(shellGeo, shellMat, SHELL_N);
  shells.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SHELL_N * 3), 3);

  const grassGeo = makeGrassBlade();
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0xffc040,
    roughness: 0.68,
    side: THREE.DoubleSide,
    vertexColors: true,
    emissive: 0xb84800,
    emissiveIntensity: 0.42,
  });
  patchUnderwater(grassMat, shared, { absorb: "soft" });
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, 900);
  grass.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(900 * 3), 3);

  const weedGeo = makeWeed();
  const weedMat = new THREE.MeshStandardMaterial({
    color: 0xd85838,
    roughness: 0.72,
    side: THREE.DoubleSide,
    emissive: 0x4a1808,
    emissiveIntensity: 0.14,
  });
  patchUnderwater(weedMat, shared, { caustics: false, absorb: "soft" });
  const weeds = new THREE.InstancedMesh(weedGeo, weedMat, 160);
  weeds.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(160 * 3), 3);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();

  const spongeColors = [0xffd020, 0xff8a18, 0xff5a7a, 0xffe040, 0xff9a32, 0xf04080, 0xffc428, 0xff7028];
  const brainColors = [0xff8870, 0xf05880, 0xffb070, 0xff7060, 0xff9a88, 0xf07870];
  const plateColors = [0xffb028, 0xff7a30, 0xff5a68, 0xffc848, 0xf07040, 0xff8a50, 0xffd060, 0x40c878, 0xff9060, 0xe85040, 0xffa040, 0xff7860, 0x58c048, 0xffc040];
  const crustColors = [0xffb058, 0xe88840, 0xff7a50, 0xf0a060, 0xff9860];
  const fanColors = [0xff7040, 0xff4070, 0xffb030, 0x38c070, 0xff8050, 0x30b868, 0xff6060];
  const branchColors = [0xff6a40, 0xff5080, 0x38b060, 0xff8848, 0x30a858];
  const grassColors = [0xffc030, 0xff8a28, 0xf0d050, 0xff6a48, 0xe8a028, 0xff5080];
  const weedColors = [0xff5030, 0xe04028, 0xff7040, 0xd03820];
  const barnColors = [0xf0d4a0, 0xe2b878, 0xffe0b0, 0xd4a060];
  const pebbleColors = [0xf0c888, 0xe0a060, 0xffdca0, 0xd49450, 0xf0b870];
  const shellColors = [0xffe0b8, 0xf0c090, 0xfff0d0, 0xe8a870];

  let ti = 0;
  let bi = 0;
  let bri = 0;
  let pi = 0;
  let si = 0;
  let tli = 0;
  let fi = 0;
  let bci = 0;
  let gi = 0;
  let wi = 0;
  let bai = 0;
  let pei = 0;
  let shi = 0;
  let bki = 0;
  let cri = 0;

  let vi = 0;

  function nextTable() {
    const roll = rng();
    if (roll < 0.28 && vi < VOL_N) return { mesh: vols, idx: vi++, colors: vols.instanceColor, cap: VOL_N };
    if (roll < 0.52 && pi < PLATE_N) return { mesh: plates, idx: pi++, colors: plates.instanceColor, cap: PLATE_N };
    if (roll < 0.76 && si < SHELF_N) return { mesh: shelves, idx: si++, colors: shelves.instanceColor, cap: SHELF_N };
    if (tli < TALL_N) return { mesh: talls, idx: tli++, colors: talls.instanceColor, cap: TALL_N };
    if (vi < VOL_N) return { mesh: vols, idx: vi++, colors: vols.instanceColor, cap: VOL_N };
    if (pi < PLATE_N) return { mesh: plates, idx: pi++, colors: plates.instanceColor, cap: PLATE_N };
    if (si < SHELF_N) return { mesh: shelves, idx: si++, colors: shelves.instanceColor, cap: SHELF_N };
    if (tli < TALL_N) return { mesh: talls, idx: tli++, colors: talls.instanceColor, cap: TALL_N };
    return null;
  }

  function place(mesh, index, x, y, z, sx, sy, sz, rotY, rotX, hex, colors, rotZ = 0) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(rotX || 0, rotY, rotZ);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    color.setHex(hex, THREE.SRGBColorSpace);
    colors.setXYZ(index, color.r, color.g, color.b);
  }

  function placeOnNormal(mesh, index, x, y, z, nx, ny, nz, s, hex, colors, extraYaw = 0) {
    dummy.position.set(x, y, z);
    dummy.scale.setScalar(s);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, ny, nz).normalize());
    dummy.rotateY(extraYaw);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    color.setHex(hex, THREE.SRGBColorSpace);
    colors.setXYZ(index, color.r, color.g, color.b);
  }

  // Horizontal ruffled shelves seated on the surface — not camera-facing cards.
  function placeShelf(mesh, index, x, y, z, nx, ny, nz, s, hex, colors) {
    dummy.position.set(x - nx * 0.1 * s, y - ny * 0.1 * s - 0.03 * s, z - nz * 0.1 * s);
    dummy.rotation.set((rng() - 0.5) * 0.26 + nx * 0.08, rng() * Math.PI * 2, (rng() - 0.5) * 0.22);
    dummy.scale.set(s * (0.72 + rng() * 0.22), s * (0.88 + rng() * 0.16), s * (0.72 + rng() * 0.22));
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    color.setHex(hex, THREE.SRGBColorSpace);
    colors.setXYZ(index, color.r, color.g, color.b);
  }

  // Sit on the visible mesh. Reject anything more than 0.2m off the rock.
  const ROCK_MAX_D = 0.2;
  const ROCK_LIFT = 0;

  function snapToHillside(lx, ly, lzHint = null, lipOk = false) {
    const wd = windowSDF2D(lx, ly);
    if (!lipOk && wd < 0.2) return null;
    if (lipOk && wd < 0.12) return null;
    if (hillsideSDF2D(lx, ly) > 0.6) return null;

    let hit = raymarchGrottoZ(lx, ly, true);
    if (!Number.isFinite(hit.x) || !Number.isFinite(hit.z) || Math.abs(hit.d) > 1.2) {
      if (lzHint == null || !Number.isFinite(lzHint)) return null;
      hit = projectToGrotto(lx, ly, lzHint, 7);
    } else {
      hit = projectToGrotto(hit.x, hit.y, hit.z, 4);
    }
    const residual = Math.abs(hit.d ?? grottoSDF(hit.x, hit.y, hit.z));
    if (residual > ROCK_MAX_D) return null;
    if (Math.hypot(hit.x - lx, hit.y - ly) > 0.7) return null;
    if (!Number.isFinite(hit.z) || hit.z < -0.15 || hit.z > 14.2) return null;
    const hitWd = windowSDF2D(hit.x, hit.y);
    if (!lipOk && hitWd < 0.18) return null;
    if (lipOk && hitWd < 0.16) return null;
    const nx = hit.nx;
    const ny = hit.ny;
    const nz = hit.nz;
    const nlen = Math.hypot(nx, ny, nz) || 1;
    const ox = nx / nlen;
    const oy = ny / nlen;
    const oz = nz / nlen;
    const px = hit.x + ox * ROCK_LIFT;
    const py = hit.y + oy * ROCK_LIFT;
    const pz = hit.z + oz * ROCK_LIFT;
    if (Math.abs(grottoSDF(px, py, pz)) > ROCK_MAX_D) return null;
    return { x: px, y: py, z: pz, nx: ox, ny: oy, nz: oz, d: residual };
  }

  function snapFromHit(hit) {
    if (!hit || !Number.isFinite(hit.x) || !Number.isFinite(hit.z)) return null;
    const residual = Math.abs(hit.d ?? grottoSDF(hit.x, hit.y, hit.z));
    if (residual > ROCK_MAX_D) return null;
    const nlen = Math.hypot(hit.nx, hit.ny, hit.nz) || 1;
    const ox = hit.nx / nlen;
    const oy = hit.ny / nlen;
    const oz = hit.nz / nlen;
    const px = hit.x + ox * ROCK_LIFT;
    const py = hit.y + oy * ROCK_LIFT;
    const pz = hit.z + oz * ROCK_LIFT;
    if (Math.abs(grottoSDF(px, py, pz)) > ROCK_MAX_D) return null;
    return { x: px, y: py, z: pz, nx: ox, ny: oy, nz: oz, d: residual };
  }

  function snapFromSample(s, lipOk = false) {
    if (!s || !Number.isFinite(s.x) || !Number.isFinite(s.z)) return null;
    const wd = windowSDF2D(s.x, s.y);
    if (!lipOk && wd < 0.12) return null;
    if (lipOk && wd < 0.2) return null;
    // Mesh samples are the visible rock. Never SDF-project an origin — that is
    // how previous rounds floated plates in front of the hillside.
    const nlen = Math.hypot(s.nx, s.ny, s.nz) || 1;
    const nx = s.nx / nlen;
    const ny = s.ny / nlen;
    const nz = s.nz / nlen;
    const px = s.x - nx * 0.05;
    const py = s.y - ny * 0.05;
    const pz = s.z - nz * 0.05;
    if (!Number.isFinite(pz) || pz < -0.4 || pz > 16.8) return null;
    const outWd = windowSDF2D(px, py);
    if (!lipOk && outWd < 0.12) return null;
    if (lipOk && outWd < 0.2) return null;
    return { x: px, y: py, z: pz, nx, ny, nz, d: 0 };
  }

  const heroSponges = [
    [-8.4, -4.2, 0.72, 0.85, 0.72, "tube"],
    [22.4, -8.6, 0.8, 0.92, 0.8, "bulb"],
    [-24.0, 8.2, 0.7, 0.78, 0.7, "tube"],
    [36.0, 4.4, 0.66, 0.7, 0.66, "bulb"],
  ];
  for (const [x, z, sx, sy, sz, kind] of heroSponges) {
    const y = terrainHeight(x, z);
    const mesh = kind === "bulb" ? bulbMesh : tubeMesh;
    const colors = mesh.instanceColor;
    if (kind === "bulb") {
      if (bi >= BULB_N) continue;
      place(mesh, bi++, x, y, z, sx, sy, sz, rng() * 6, 0.04, pick(rng, spongeColors), colors);
    } else {
      if (ti >= TUBE_N) continue;
      place(mesh, ti++, x, y, z, sx, sy, sz, rng() * 6, 0.05, pick(rng, spongeColors), colors);
    }
  }

  function scatterShallows(nx, nz, tight = false) {
    const j = tight ? 3.2 : 7;
    const x = nx + (rng() - 0.5) * j;
    const z = nz + (rng() - 0.5) * j;
    if (x > 88) return;
    if (onIsland(x, z)) return;
    const y = terrainHeight(x, z);
    const heroZone = x > -5 && x < 5 && z > 6 && z < 14;
    const onPath = x > -8 && x < 16 && z > -8 && z < 19;
    const r = rng();
    if (!onPath && !heroZone) {
      if (r < 0.18 && ti < TUBE_N) {
        const s = 0.5 + rng() * 1.05;
        place(tubeMesh, ti++, x, y, z, s, s * (0.75 + rng() * 0.8), s, rng() * 6, 0, pick(rng, spongeColors), tubeMesh.instanceColor);
      } else if (r < 0.3 && bi < BULB_N) {
        const s = 0.45 + rng() * 0.85;
        place(bulbMesh, bi++, x, y, z, s, s * (0.7 + rng() * 0.5), s, rng() * 6, 0, pick(rng, spongeColors), bulbMesh.instanceColor);
      } else if (r < 0.46 && bri < BRAIN_N) {
        const s = 0.4 + rng() * 0.85;
        place(brains, bri++, x, y + 0.12, z, s, s * 0.68, s, rng() * 6, 0, pick(rng, brainColors), brains.instanceColor);
      } else if (r < 0.52 && bri < BRAIN_N) {
        const s = 0.35 + rng() * 0.7;
        place(brains, bri++, x, y + 0.1, z, s, s * 0.62, s, rng() * 6, 0, pick(rng, brainColors), brains.instanceColor);
      } else if (r < 0.5 && (x < -30 || x > 32 || z < -8 || z > 28) && Math.hypot(x - 2, z - 8) > 22) {
        const tab = nextTable();
        if (tab) {
          const s = 0.38 + rng() * 0.48;
          place(tab.mesh, tab.idx, x, y + 0.02, z, s, s * (0.88 + rng() * 0.14), s, rng() * 6, 0.05, pick(rng, plateColors), tab.colors);
        }
      } else if (r < 0.72 && fi < FAN_N && !(x > -12 && x < 24 && z > 2 && z < 24)) {
        const s = 0.65 + rng() * 1.2;
        place(fans, fi++, x, y + 0.08, z, s, s, s, rng() * 6, -0.25 + rng() * 0.45, pick(rng, fanColors), fans.instanceColor);
      } else if (r < 0.86 && bci < 320) {
        const s = 0.75 + rng() * 1.35;
        place(branches, bci++, x, y, z, s, s * (1 + rng() * 0.6), s, rng() * 6, 0.15, pick(rng, branchColors), branches.instanceColor);
      }
    }
    if (gi < 900 && rng() < (onPath ? 0.22 : 0.48) && !heroZone && Math.hypot(x - 4, z - 10) > 8) {
      const s = 0.55 + rng() * 1.15;
      place(grass, gi++, x, y, z, s, s * (0.7 + rng()), s, rng() * 6, 0, pick(rng, grassColors), grass.instanceColor);
    }
    if (wi < 160 && rng() < (onPath ? 0.04 : 0.1) && !heroZone && Math.hypot(x - 4, z - 10) > 14) {
      const s = 0.7 + rng() * 1.0;
      place(weeds, wi++, x, y, z, s, s, s, rng() * 6, 0, pick(rng, weedColors), weeds.instanceColor);
    }
    if (pei < PEBBLE_N && rng() < (onPath ? 0.72 : 0.28)) {
      const s = 0.4 + rng() * 1.05;
      place(pebbles, pei++, x, y, z, s, s * (0.68 + rng() * 0.28), s, rng() * 6, rng() * 0.4, pick(rng, pebbleColors), pebbles.instanceColor);
    }
    if (shi < SHELL_N && rng() < (onPath ? 0.14 : 0.06)) {
      const s = 0.7 + rng() * 1.2;
      place(shells, shi++, x, y + 0.02, z, s, s, s, rng() * 6, 0, pick(rng, shellColors), shells.instanceColor);
    }
  }

  const heroMat = new THREE.MeshStandardMaterial({
    color: 0xffd428,
    map: spongeMaps.albedo,
    normalMap: spongeMaps.normal,
    normalScale: new THREE.Vector2(1.65, 1.65),
    roughness: 0.44,
    metalness: 0.0,
    vertexColors: true,
    emissive: 0x8a3400,
    emissiveIntensity: 0.34,
  });
  patchUnderwater(heroMat, shared, { detail: "sponge", absorb: "soft" });
  const heroTube = makeSpongeGeometry("hero");
  const heroBulb = makeSpongeGeometry("heroBulb");
  // 7 separate wet ochre vases. Lean toward the capture camera (+X/+Z) so mouths read.
  const heroCluster = [
    [-3.15, 10.35, 0.98, 1.22, 0.92, 0.22, 0.16, -0.12, 0xf8d038, "tube"],
    [-1.55, 11.55, 0.88, 1.08, 0.84, 1.35, 0.14, -0.1, 0xf0c428, "bulb"],
    [-0.25, 9.65, 0.94, 1.16, 0.88, 2.55, 0.18, -0.08, 0xffdc4a, "tube"],
    [-4.05, 9.45, 0.8, 0.9, 0.76, 0.85, 0.12, -0.14, 0xe8b820, "bulb"],
    [-2.35, 8.55, 0.92, 1.04, 0.86, 3.15, 0.2, -0.1, 0xf4c840, "tube"],
    [0.65, 11.15, 0.78, 1.12, 0.74, 4.05, 0.13, -0.08, 0xdcac18, "bulb"],
    [-1.85, 12.45, 0.72, 0.82, 0.7, 1.85, 0.15, -0.11, 0xffe058, "tube"],
  ];
  for (const [x, z, sx, sy, sz, rot, leanX, leanZ, hex, kind] of heroCluster) {
    const mat = heroMat.clone();
    mat.color.setHex(hex, THREE.SRGBColorSpace);
    patchUnderwater(mat, shared, { detail: "sponge", absorb: "soft" });
    const m = new THREE.Mesh(kind === "bulb" ? heroBulb : heroTube, mat);
    const y = terrainHeight(x, z);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.set(leanX, rot, leanZ);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  const spongeRocks = [
    [-3.6, 9.6, 0.36],
    [-1.2, 11.8, 0.3],
    [-2.8, 8.2, 0.34],
    [0.2, 10.4, 0.28],
    [-4.4, 10.8, 0.32],
    [-0.8, 8.8, 0.3],
  ];
  const spongeRockMat = new THREE.MeshStandardMaterial({
    color: 0xe8c080,
    roughness: 0.9,
    vertexColors: true,
    emissive: 0x3a2008,
    emissiveIntensity: 0.1,
  });
  patchUnderwater(spongeRockMat, shared, { absorb: false, detail: "rock" });
  for (const [x, z, r] of spongeRocks) {
    const g = makePebble();
    const m = new THREE.Mesh(g, spongeRockMat);
    m.position.set(x, terrainHeight(x, z), z);
    m.scale.set(r * 2.4, r * 1.5, r * 2.2);
    m.rotation.set(rng() * 0.5, rng() * 6, rng() * 0.4);
    m.castShadow = true;
    group.add(m);
  }

  function dressGrotto(info) {
    if (!info || !info.origin) return;
    const ox0 = info.origin.x;
    const oy0 = info.origin.y;
    const oz0 = info.origin.z;
    const face = (info.samples || []).filter(
      (s) => (s.nz > 0.02 || s.nx > 0.08) && s.z > -0.8 && s.y > 0.8 && s.y < 18.6 && windowSDF2D(s.x, s.y) > 0.18,
    );
    for (const s of face) {
      if (s.y < 1.5) continue;
      if (bai < 900 && rng() < 0.16) {
        const snap = snapFromSample(s, !!s.lip);
        if (!snap) continue;
        placeOnNormal(
          barns,
          bai++,
          ox0 + snap.x,
          oy0 + snap.y,
          oz0 + snap.z,
          snap.nx,
          snap.ny,
          snap.nz,
          0.38 + rng() * 0.32,
          pick(rng, barnColors),
          barns.instanceColor,
          rng() * 6,
        );
      }
    }
  }

  function dressArch(archX, archY, archZ, R, r, count) {
    for (let i = 0; i < count; i++) {
      const u = 0.08 + rng() * (Math.PI - 0.16);
      const v = rng() * Math.PI * 2;
      const p = sculptArchPoint(u, v, R, r);
      const pu = sculptArchPoint(u + 0.012, v, R, r);
      const pv = sculptArchPoint(u, v + 0.012, R, r);
      const ax = pu.x - p.x;
      const ay = pu.y - p.y;
      const az = pu.z - p.z;
      const bx = pv.x - p.x;
      const by = pv.y - p.y;
      const bz = pv.z - p.z;
      let ox = ay * bz - az * by;
      let oy = az * bx - ax * bz;
      let oz = ax * by - ay * bx;
      const len = Math.hypot(ox, oy, oz) || 1;
      ox /= len;
      oy /= len;
      oz /= len;
      if (ox * p.x + oy * p.y + oz * p.z < 0) {
        ox = -ox;
        oy = -oy;
        oz = -oz;
      }
      if (oy < -0.52) continue;
      const x = archX + p.x + ox * 0.12;
      const y = archY + p.y + oy * 0.12;
      const z = archZ + p.z + oz * 0.12;
      const pickR = rng();
      const s = 0.42 + rng() * 0.38;
      if (pickR < 0.55 && bri < BRAIN_N) {
        placeOnNormal(brains, bri++, x, y, z, ox, oy, oz, s * 0.38, pick(rng, brainColors), brains.instanceColor, rng() * 6);
      } else if (pickR < 0.68 && fi < FAN_N) {
        placeOnNormal(fans, fi++, x, y, z, ox, oy, oz, s * 0.7, pick(rng, fanColors), fans.instanceColor, rng() * 6);
      } else if (pickR < 0.78 && bri < BRAIN_N) {
        placeOnNormal(brains, bri++, x, y, z, ox, oy, oz, s * 0.38, pick(rng, brainColors), brains.instanceColor, rng() * 6);
      } else if (bai < 900) {
        placeOnNormal(barns, bai++, x, y, z, ox, oy, oz, 0.7 + rng() * 1.1, pick(rng, barnColors), barns.instanceColor, rng() * 6);
      }
    }
  }

  function dressBoulder(cx, cz, rx, ry, rz, count, cyOverride = null, face = null, scaleMul = 1) {
    const cy = cyOverride ?? terrainHeight(cx, cz) + ry * 0.35;
    for (let i = 0; i < count; i++) {
      const u = rng() * Math.PI * 2;
      const v = rng() * Math.PI;
      const ox = Math.sin(v) * Math.cos(u);
      const oy = Math.cos(v);
      const oz = Math.sin(v) * Math.sin(u);
      if (face && ox * face[0] + oy * face[1] + oz * face[2] < 0.12) continue;
      const x = cx + rx * ox * 0.86;
      const y = cy + ry * oy * 0.78;
      const z = cz + rz * oz * 0.86;
      if (oy < -0.42) continue;
      const pickR = rng();
      const s = (0.38 + rng() * 0.42) * Math.min(scaleMul, 1.15);
      if (pickR < 0.55 && bri < BRAIN_N) {
        placeOnNormal(brains, bri++, x, y, z, ox, oy, oz, s * 0.38, pick(rng, brainColors), brains.instanceColor, rng() * 6);
      } else if (pickR < 0.7 && bci < 320) {
        placeOnNormal(branches, bci++, x, y, z, ox, oy, oz, s * 0.7, pick(rng, branchColors), branches.instanceColor, rng() * 6);
      } else if (bai < 900) {
        placeOnNormal(barns, bai++, x, y, z, ox, oy, oz, 0.55 + rng() * 0.9, pick(rng, barnColors), barns.instanceColor, rng() * 6);
      }
    }
  }

  dressGrotto(grotto);
  dressArch(-42, archFootY(-42, -36, 2.8), -36, 8.0, 2.8, 6);
  dressBoulder(-19.2, 1.6, 6.0, 5.2, 5.4, 6, terrainHeight(-19.2, 1.6) + 3.4, [0.4, 0.08, 0.9], 0.82);
  dressBoulder(-17.2, 4.6, 3.2, 2.4, 3.0, 3, terrainHeight(-17.2, 4.6) + 0.85, [0.3, 0.08, 0.9], 0.72);

  const colonyMat = new THREE.MeshStandardMaterial({
    color: 0xe8b060,
    roughness: 0.7,
    metalness: 0.02,
    vertexColors: true,
    emissive: 0x4a3010,
    emissiveIntensity: 0.08,
  });
  patchUnderwater(colonyMat, shared, { caustics: true, absorb: "soft", detail: "coral" });

  if (grotto && grotto.samples) {
    const ox = grotto.origin.x;
    const oy = grotto.origin.y;
    const oz = grotto.origin.z;

    function regionOf(p) {
      const wd = windowSDF2D(p.x, p.y);
      if (p.y > 12.0 && p.x > -9.4 && p.x < 12.8) return "lintel";
      if (p.x < -1.6) return "left";
      if (wd < 2.15) return "lip";
      if (p.x > 4.0) return "right";
      return "mid";
    }

    function onMesh(x, y, z, maxD = 0.1) {
      const d = grottoSDF(x, y, z);
      return Number.isFinite(d) && Math.abs(d) <= maxD;
    }
    function attachAt(s, seat = 0.12) {
      if (!s) return null;
      const nlen = Math.hypot(s.nx || 0, s.ny || 0, s.nz || 0.4) || 1;
      const nx = (s.nx || 0) / nlen;
      const ny = (s.ny || 0) / nlen;
      const nz = (s.nz || 0.4) / nlen;
      if (ny > (s.y > 10.2 ? 0.58 : 0.4)) return null;
      if (!onMesh(s.x, s.y, s.z, 0.1)) return null;
      const lx = s.x - nx * seat;
      const ly = s.y - ny * seat;
      const lz = s.z - nz * seat;
      if (ly < 0.82 || ly > 12.6) return null;
      if (lz < 0.32 || lz > 11.4) return null;
      if (s.x > 18.4) return null;
      if (ly > 11.8 && nz < 0.08) return null;
      if (windowSDF2D(s.x, s.y) < -0.04) return null;
      const buried = grottoSDF(lx, ly, lz);
      if (!Number.isFinite(buried) || buried > 0.04) return null;
      return { lx, ly, lz, nx, ny, nz, wx: ox + lx, wy: oy + ly, wz: oz + lz };
    }

    const snapped = [];
    for (const s of grotto.samples) {
      if (s.y < 0.82 || s.y > 13.2) continue;
      if (s.z < 0.32 || s.z > 13.4) continue;
      if (s.x < -15.6 || s.x > 19.6) continue;
      if ((s.ny || 0) > (s.y > 10.2 ? 0.58 : 0.32)) continue;
      const facing = s.nz > -0.06 || s.left || s.lip || s.face || s.cliff || s.x < 3.2;
      if (!facing) continue;
      const lipOk = !!(s.lip || windowSDF2D(s.x, s.y) < 2.6);
      const snap = snapFromSample(s, lipOk);
      if (!snap) continue;
      if (snap.nz < -0.08 && snap.x > 1.2) continue;
      if ((snap.ny || 0) > (snap.y > 10.2 ? 0.58 : 0.32)) continue;
      if (!onMesh(snap.x, snap.y, snap.z, 0.12)) continue;
      snapped.push({ ...snap, region: regionOf(snap), lip: lipOk });
    }

    function seedGrid(x0, x1, y0, y1, n, region, lipOk) {
      let added = 0;
      for (let i = 0; i < n * 6 && added < n; i++) {
        const lx = x0 + rng() * (x1 - x0);
        const ly = y0 + rng() * (y1 - y0);
        let best = null;
        let bestD = 1e9;
        for (const s of snapped) {
          const d = Math.hypot(s.x - lx, s.y - ly);
          if (d < bestD) {
            bestD = d;
            best = s;
          }
        }
        if (!best || bestD > 1.6) continue;
        if (region === "lintel" && best.ny > 0.6) continue;
        snapped.push({ ...best, region, lip: lipOk });
        added++;
      }
    }
    const countReg = (r) => snapped.filter((s) => s.region === r).length;
    if (countReg("left") < 100) seedGrid(-13.8, -2.2, 1.6, 14.4, 52, "left", false);
    if (countReg("lintel") < 48) seedGrid(-8.2, 11.2, 11.8, 15.2, 24, "lintel", true);
    if (countReg("right") < 80) seedGrid(6.0, 18.2, 1.8, 13.6, 36, "right", false);
    if (countReg("lip") < 40) seedGrid(-6.2, 6.4, 2.6, 14.2, 22, "lip", true);
    // Empty camera-facing bands: lower-right cheek + left pillar foot / lip.
    seedGrid(6.2, 18.4, 1.2, 6.2, 32, "right", false);
    seedGrid(-13.6, -1.8, 1.2, 6.4, 28, "left", false);
    seedGrid(-12.8, -2.0, 6.2, 13.6, 18, "left", false);
    seedGrid(-6.4, 7.2, 10.6, 14.6, 16, "lip", true);

    // Window-lip extras come from mesh samples only (seedGrid above).

    for (let i = snapped.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const tmp = snapped[i];
      snapped[i] = snapped[j];
      snapped[j] = tmp;
    }

    const placed = [];
    function nearest(x, y, z) {
      let n = null;
      let nd = 1e9;
      for (const o of placed) {
        const d = Math.hypot(x - o.x, y - o.y, z - o.z);
        if (d < nd) {
          nd = d;
          n = o;
        }
      }
      return { n, nd };
    }
    function tooClose(x, y, z, minD) {
      return nearest(x, y, z).nd < minD;
    }
    function tooCloseKind(x, y, z, minD, kind) {
      for (const o of placed) {
        if (o.kind !== kind) continue;
        if (Math.hypot(x - o.x, y - o.y, z - o.z) < minD) return true;
      }
      return false;
    }

    function snapSite(lx, ly, lipOk) {
      // Prefer nearby camera-facing mesh samples. SDF guesses float plates.
      let best = null;
      let bestScore = -1e9;
      for (const s of snapped) {
        if (!lipOk && s.lip && windowSDF2D(s.x, s.y) < 0.22) continue;
        if (lipOk && windowSDF2D(s.x, s.y) < 0.18) continue;
        const d = Math.hypot(s.x - lx, s.y - ly);
        if (d > 2.4) continue;
        const face = (s.nz || 0) * 1.2 + Math.max(0, s.nx || 0) * 0.3 - Math.max(0, -(s.nz || 0)) * 1.3;
        const score = face - d * 1.6;
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
      return best;
    }

    const up = new THREE.Vector3(0, 1, 0);
    const nrm = new THREE.Vector3();

    function placeOrgan() {
      return false;
    }
    function placeOrganUnused(snap, baseSc, seed, variant, minDOverride = null, seatMul = 1) {
      if (!snap) return false;
      const nx = snap.nx || 0;
      const ny = snap.ny || 0;
      const nz = snap.nz || 0.4;
      const nlen = Math.hypot(nx, ny, nz) || 1;
      const sxn = nx / nlen;
      const syn = ny / nlen;
      const szn = nz / nlen;
      if (snap.y > 15.2 || snap.y < 0.82) return false;
      if (snap.z < 0.22 || snap.z > 14.2) return false;
      if (snap.x < -14.6 || snap.x > 18.6) return false;
      if (snap.region === "left" && sxn < -0.62 && szn < -0.12) return false;
      if (szn < -0.28) return false;
      // Crown lids and lower-shelf tops read as empty stone from the shallows camera.
      if (syn > 0.74 && snap.y > 13.8) return false;
      if (snap.y < 8.2 && syn > 0.42 && szn < 0.55) return false;
      const minD =
        minDOverride != null
          ? minDOverride
          : snap.region === "right"
            ? snap.y < 7.6
              ? 0.52
              : 0.62
            : snap.region === "lintel"
              ? 0.58
              : snap.region === "lip"
                ? 0.54
                : 0.5;
      if (tooClose(snap.x, snap.y, snap.z, minD)) return false;
      let sc = baseSc * (0.96 + rng() * 0.08);
      if (snap.region === "left") sc *= 1.02;
      if (snap.region === "lintel") sc *= 0.94;
      if (snap.region === "lip") sc *= 0.96;
      if (snap.y > 11.8) sc *= 0.96;
      sc = Math.max(0.86, Math.min(1.16, sc));
      const hueBucket = placed.filter((p) => p.kind === "table").length % 4;
      const buckets = [
        [0xe0a038, 0xd4a044, 0xc89038],
        [0xdeb060, 0xc8a060, 0xb89858],
        [0xc88868, 0xc07050, 0xb87858],
        [0x8a7840, 0x9a8048, 0x7a6c38],
      ];
      const { n, nd } = nearest(snap.x, snap.y, snap.z);
      let tint;
      if (n && n.kind === "table" && n.tint && nd < 1.4) {
        // Close neighbors share a family so a group reads as one organism.
        tint = rng() < 0.78 ? n.tint : pick(rng, buckets[hueBucket]);
      } else {
        tint = pick(rng, rng() < 0.7 ? buckets[hueBucket] : heroTints);
      }
      const mat = plateHero.clone();
      mat.color.setHex(tint, THREE.SRGBColorSpace);
      patchUnderwater(mat, shared, { detail: "coral", absorb: "soft" });
      const m = new THREE.Mesh(makeFusedOrganism(seed, variant), mat);
      // Plate face ≈ surface normal. If the rock is grazing the camera, blend toward +Z
      // so the cluster never shows only a thin edge.
      const camX = snap.region === "left" ? 0.5 : snap.region === "lintel" || snap.region === "lip" ? 0.28 : 0.18;
      const camY = snap.region === "lintel" ? -0.08 : snap.y < 7.2 ? -0.12 : 0.06;
      const camZ = snap.y < 7.2 ? 0.96 : 0.9;
      let oxn = sxn;
      let oyn = syn;
      let ozn = szn;
      const facing = oxn * camX + oyn * camY + ozn * camZ;
      if (facing < 0.64) {
        const k = (0.64 - facing) * 1.6;
        oxn += camX * k;
        oyn += camY * k;
        ozn += camZ * k;
      }
      if (oyn > 0.36) {
        const k = (oyn - 0.36) / 0.64;
        oxn += camX * k * 0.55;
        oyn -= k * 0.7;
        ozn += camZ * k * 0.7;
      }
      const flen = Math.hypot(oxn, oyn, ozn) || 1;
      oxn /= flen;
      oyn /= flen;
      ozn /= flen;
      const seat = 0.26 * sc * seatMul;
      m.position.set(ox + snap.x - sxn * seat, oy + snap.y - syn * seat, oz + snap.z - szn * seat);
      const face = new THREE.Vector3(oxn, oyn, ozn);
      let xAxis = new THREE.Vector3().crossVectors(up, face);
      if (xAxis.lengthSq() < 1e-5) xAxis.set(1, 0, 0);
      else xAxis.normalize();
      const zAxis = new THREE.Vector3().crossVectors(xAxis, face).normalize();
      xAxis.crossVectors(face, zAxis).normalize();
      m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, face, zAxis));
      m.rotateY((rng() - 0.5) * 0.16);
      m.rotateX((rng() - 0.5) * 0.06);
      m.scale.set(sc * (0.96 + rng() * 0.08), sc * (0.98 + rng() * 0.04), sc * (0.96 + rng() * 0.08));
      m.castShadow = true;
      group.add(m);
      placed.push({ x: snap.x, y: snap.y, z: snap.z, sc, yaw: 0, stacks: 0, kind: "table", tint, region: snap.region });
      return true;
    }

    function placeFanAt(snap, sc, allowNear = false) {
      if (!snap || fi >= FAN_N) return false;
      if (snap.y > 14.2 || snap.ny > 0.46) return false;
      if (snap.z < 0.4 || snap.z > 14.2) return false;
      if (allowNear) {
        if (tooCloseKind(snap.x, snap.y, snap.z, 0.52, "fan")) return false;
      } else if (tooClose(snap.x, snap.y, snap.z, 0.55)) return false;
      const seat = 0.16 * sc;
      dummy.position.set(
        ox + snap.x - snap.nx * seat,
        oy + snap.y - snap.ny * seat - 0.02,
        oz + snap.z - snap.nz * seat,
      );
      dummy.rotation.set(
        0.18 + rng() * 0.14,
        Math.atan2(snap.nx, snap.nz) + Math.PI * 0.5 + (rng() - 0.5) * 0.28,
        (rng() - 0.5) * 0.18,
      );
      dummy.scale.set(sc * (0.9 + rng() * 0.16), sc * (0.96 + rng() * 0.12), sc * (0.98 + rng() * 0.1));
      dummy.updateMatrix();
      fans.setMatrixAt(fi, dummy.matrix);
      color.setHex(pick(rng, fanColors), THREE.SRGBColorSpace);
      fans.instanceColor.setXYZ(fi, color.r, color.g, color.b);
      fi++;
      placed.push({ x: snap.x, y: snap.y, z: snap.z, sc, yaw: 0, stacks: 0, kind: "fan", region: snap.region });
      return true;
    }

    function placeBrainAt() {
      return false;
    }
    function placeBrainAtUnused(snap, sc, allowNear = false) {
      if (!snap || bri >= BRAIN_N) return false;
      if (snap.y > 14.0 || snap.z < 0.35 || snap.z > 14.2) return false;
      if (allowNear) {
        if (tooCloseKind(snap.x, snap.y, snap.z, 0.4, "brain")) return false;
      } else if (tooClose(snap.x, snap.y, snap.z, 0.5)) return false;
      const seat = 0.1 * sc;
      placeOnNormal(
        brains,
        bri++,
        ox + snap.x - snap.nx * seat,
        oy + snap.y - snap.ny * seat,
        oz + snap.z - snap.nz * seat,
        snap.nx,
        snap.ny,
        snap.nz,
        sc,
        pick(rng, brainColors),
        brains.instanceColor,
        rng() * 6,
      );
      placed.push({ x: snap.x, y: snap.y, z: snap.z, sc, yaw: 0, stacks: 0, kind: "brain", region: snap.region });
      return true;
    }

    function densifyFace(x0, x1, y0, y1, step, lipOk) {
      for (let x = x0; x <= x1; x += step) {
        for (let y = y0; y <= y1; y += step) {
          const jx = x + (rng() - 0.5) * step * 0.7;
          const jy = y + (rng() - 0.5) * step * 0.7;
          const wd = windowSDF2D(jx, jy);
          const hit = snapToHillside(jx, jy, 7.2, lipOk || wd < 2.6);
          if (!hit) continue;
          if (hit.z < 0.32 || hit.z > 13.4) continue;
          if (hit.nz < -0.1 && hit.nx < 0.08) continue;
          if (hit.y < 0.95 || hit.y > 12.8) continue;
          if ((hit.ny || 0) > (hit.y > 10.2 ? 0.58 : 0.32)) continue;
          if (!onMesh(hit.x, hit.y, hit.z, 0.1)) continue;
          snapped.push({ ...hit, region: regionOf(hit), lip: wd < 2.6 });
        }
      }
    }
    densifyFace(-13.5, -1.7, 1.2, 12.6, 0.46, false);
    densifyFace(-8.4, 11.5, 10.4, 12.8, 0.52, true);
    densifyFace(5.0, 18.6, 1.15, 12.6, 0.42, false);
    densifyFace(-6.8, 10.4, 10.8, 12.8, 0.52, true);

    function coverAmt(x, y, z) {
      return noise3(x * 0.05, y * 0.046, z * 0.05) * 0.75 + noise3(x * 0.11 + 2.8, y * 0.1, z * 0.11) * 0.25;
    }
    function speciesAt(x, y, z, ny, nz) {
      const k = noise3(x * 0.16 + 2.2, y * 0.14, z * 0.16);
      if (y > 10.8) return "brain";
      if (ny > 0.48) return "brain";
      if (k < 0.4) return "shelf";
      if (k < 0.68) return "fan";
      return "sponge";
    }
    function shelfHue(x, y, z) {
      const h = noise3(x * 0.12 + 5.1, y * 0.11, z * 0.12);
      if (h < 0.4) return "table";
      if (h < 0.58) return "olive";
      if (h < 0.78) return "rose";
      return "table";
    }
    function nearKind(x, y, z, minD, kind) {
      for (const o of placed) {
        if (kind && o.kind !== kind) continue;
        if (Math.hypot(x - o.x, y - o.y, z - o.z) < minD) return true;
      }
      return false;
    }

    const rightPatches = [
      { x: 8.2, y: 3.5, r: 2.15, hue: "table" },
      { x: 12.8, y: 5.2, r: 2.25, hue: "olive" },
      { x: 16.1, y: 3.4, r: 1.75, hue: "rose" },
      { x: 10.6, y: 7.8, r: 1.85, hue: "table" },
      { x: 14.6, y: 8.4, r: 1.9, hue: "table" },
      { x: 7.4, y: 6.2, r: 1.55, hue: "rose" },
    ];
    function rightPatchOf(s) {
      let best = null;
      let bd = 1e9;
      for (const p of rightPatches) {
        const d = Math.hypot(s.x - p.x, s.y - p.y);
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      if (!best || bd > best.r) return null;
      return { hue: best.hue, u: 1 - bd / best.r };
    }

    const colonyLayers = [];
    const pool = snapped.filter((s) => {
      if (s.y < 0.95 || s.y > 12.4) return false;
      if (s.z < 0.3 || s.z > 13.4) return false;
      if (s.x < -14.4 || s.x > 18.8) return false;
      if (windowSDF2D(s.x, s.y) < 0.22) return false;
      if (s.nz < -0.14 && s.nx < 0.05) return false;
      return coverAmt(s.x, s.y, s.z) > 0.22;
    });
    pool.sort((a, b) => coverAmt(b.x, b.y, b.z) - coverAmt(a.x, a.y, a.z));

    // No fused color coat — it only stuck to some faces and split the hillside
    // into peach/green sides and bare brown tops. The grotto mesh is the rock.

    const fanTintsRGB = [
      [0.86, 0.4, 0.1],
      [0.58, 0.34, 0.1],
      [0.76, 0.3, 0.22],
      [0.46, 0.32, 0.12],
    ];
    const spongeTintsRGB = [
      [0.86, 0.46, 0.08],
      [0.7, 0.28, 0.22],
      [0.58, 0.36, 0.1],
      [0.9, 0.54, 0.12],
    ];

    const volumeSites = [
      // crust skin above — do not add discrete shelf/fan props on top
    ];
    const volumeSitesUnused = [
      [-10.4, 2.8, "shelf"],
      [-8.2, 4.2, "sponge"],
      [-6.0, 5.8, "fan"],
      [-9.4, 6.8, "shelf"],
      [-5.2, 8.2, "sponge"],
      [-7.6, 3.4, "fan"],
      [-11.0, 5.4, "sponge"],
      [-8.4, 8.6, "fan"],
      [-5.6, 6.8, "shelf"],
      [-10.2, 8.0, "sponge"],
      [-4.2, 4.4, "fan"],
      [-6.8, 10.0, "shelf"],
      [-9.6, 2.4, "sponge"],
      [-7.2, 7.4, "sponge"],
      [7.4, 2.6, "sponge"],
      [8.8, 4.2, "fan"],
      [11.4, 3.8, "fan"],
      [14.0, 3.2, "shelf"],
      [9.0, 6.4, "sponge"],
      [12.8, 6.8, "fan"],
      [15.4, 4.8, "shelf"],
      [10.6, 8.4, "sponge"],
      [14.4, 7.6, "fan"],
      [7.2, 5.8, "sponge"],
      [12.0, 5.2, "shelf"],
      [13.6, 9.0, "sponge"],
      [9.4, 7.6, "fan"],
      [16.2, 6.2, "sponge"],
      [8.2, 9.4, "shelf"],
      [15.6, 8.2, "fan"],
      [11.6, 2.6, "sponge"],
      [6.6, 6.8, "fan"],
      [14.8, 2.8, "sponge"],
      [16.8, 5.2, "shelf"],
    ];
    for (let i = 0; i < volumeSites.length; i++) {
      const [lx, ly, kind] = volumeSites[i];
      const s = snapSite(lx, ly, ly > 10.2);
      if (!s) continue;
      const at = attachAt(s, 0.12);
      if (!at) continue;
      if (nearKind(s.x, s.y, s.z, 1.12, null)) continue;
      let g;
      if (kind === "fan") {
        const sc = 0.92 + rng() * 0.18;
        g = makeFanCoral(4 + i * 1.3);
        g.scale(sc * 1.08, sc * 0.82, sc * 1.08);
        const tint = fanTintsRGB[i % fanTintsRGB.length];
        paint(g, (x, y, z) => {
          const n = noise3(x * 4, y * 4, z * 4);
          return [tint[0] * (0.9 + n * 0.12), tint[1] * (0.9 + n * 0.1), tint[2] * (0.88 + n * 0.1)];
        });
        orientAlongNormal(g, at.nx, at.ny, at.nz, at.wx, at.wy, at.wz, i * 0.7);
      } else if (kind === "sponge") {
        const sc = 0.95 + rng() * 0.2;
        g = makeWallSponge(3.2 + i * 1.1, "tube");
        g.scale(sc * 0.78, sc * 0.72, sc * 0.78);
        const tint = spongeTintsRGB[i % spongeTintsRGB.length];
        paint(g, (x, y, z) => {
          const n = noise3(x * 4, y * 4, z * 4);
          return [tint[0] * (0.88 + n * 0.14), tint[1] * (0.88 + n * 0.12), tint[2] * (0.86 + n * 0.1)];
        });
        orientAlongNormal(g, at.nx, at.ny, at.nz, at.wx, at.wy, at.wz, i * 0.7);
      } else {
        const sc = 0.98 + rng() * 0.2;
        const hue = i % 3 === 0 ? "rose" : i % 3 === 1 ? "olive" : "table";
        g = makeSolidShelf(8 + i * 1.7, hue);
        g.scale(sc * 1.06, sc * 0.78, sc * 1.06);
        orientAlongNormal(g, at.nx, at.ny, at.nz, at.wx, at.wy, at.wz, i * 0.7);
      }
      colonyLayers.push(g);
      placed.push({ x: s.x, y: s.y, z: s.z, kind, region: s.region });
    }

    for (const s of []) {
      void s;
    }

    const lintelAnchors = [];
    const lintelAnchorsUnused = [
      [-6.4, 10.8, "shelf"],
      [-4.2, 11.2, "fan"],
      [-1.6, 11.4, "sponge"],
      [1.2, 11.4, "shelf"],
      [3.8, 11.2, "fan"],
      [6.4, 10.9, "sponge"],
      [8.6, 10.6, "shelf"],
      [-7.2, 9.6, "fan"],
      [7.4, 9.8, "fan"],
      [-3.0, 10.6, "shelf"],
      [2.4, 10.7, "sponge"],
      [5.2, 10.4, "shelf"],
      [-8.4, 9.0, "sponge"],
    ];
    for (let i = 0; i < lintelAnchors.length; i++) {
      const [lx, ly, kind] = lintelAnchors[i];
      const s = snapSite(lx, ly, true);
      if (!s || s.z < 0.4 || s.y > 12.6) continue;
      if (nearKind(s.x, s.y, s.z, 1.2, null)) continue;
      const at = attachAt(s, 0.12);
      if (!at) continue;
      let g;
      if (kind === "fan") {
        const sc = 0.88 + rng() * 0.18;
        g = makeFanCoral(8 + i);
        g.scale(sc * 1.06, sc * 0.8, sc * 1.06);
        const tint = fanTintsRGB[i % fanTintsRGB.length];
        paint(g, (x, y, z) => {
          const n = noise3(x * 4, y * 4, z * 4);
          return [tint[0] * (0.9 + n * 0.12), tint[1] * (0.9 + n * 0.1), tint[2] * (0.88 + n * 0.1)];
        });
        orientAlongNormal(g, at.nx, at.ny, at.nz, at.wx, at.wy, at.wz, i * 0.9);
      } else if (kind === "sponge") {
        const sc = 0.9 + rng() * 0.18;
        g = makeWallSponge(12 + i, i % 2 ? "tube" : "lump");
        g.scale(sc * 0.76, sc * 0.7, sc * 0.76);
        const tint = spongeTintsRGB[i % spongeTintsRGB.length];
        paint(g, (x, y, z) => {
          const n = noise3(x * 4, y * 4, z * 4);
          return [tint[0] * (0.88 + n * 0.14), tint[1] * (0.88 + n * 0.12), tint[2] * (0.86 + n * 0.1)];
        });
        orientAlongNormal(g, at.nx, at.ny, at.nz, at.wx, at.wy, at.wz, i * 0.9);
      } else {
        const sc = 0.94 + rng() * 0.18;
        g = makeSolidShelf(30 + i, i % 2 ? "rose" : "table");
        g.scale(sc * 1.04, sc * 0.76, sc * 1.04);
        orientAlongNormal(g, at.nx, at.ny, at.nz, at.wx, at.wy, at.wz, i * 0.9);
      }
      colonyLayers.push(g);
      placed.push({ x: s.x, y: s.y, z: s.z, kind, region: "lintel" });
    }

    let lipN = 0;
    for (const s of snapped) {
      if (lipN >= 0) break;
      if (s.y < 9.8 || s.y > 12.5) continue;
      if (s.x < -8.8 || s.x > 10.2) continue;
      if ((s.nz || 0) < 0.06) continue;
      if (nearKind(s.x, s.y, s.z, 1.15, null)) continue;
      const at = attachAt(s, 0.12);
      if (!at) continue;
      const kind = lipN % 3 === 0 ? "shelf" : lipN % 3 === 1 ? "fan" : "sponge";
      let g;
      const sc = 0.88 + rng() * 0.16;
      if (kind === "fan") {
        g = makeFanCoral(40 + lipN);
        g.scale(sc * 1.06, sc * 0.8, sc * 1.06);
        const tint = fanTintsRGB[lipN % fanTintsRGB.length];
        paint(g, (x, y, z) => {
          const n = noise3(x * 4, y * 4, z * 4);
          return [tint[0] * (0.9 + n * 0.12), tint[1] * (0.9 + n * 0.1), tint[2] * (0.88 + n * 0.1)];
        });
        orientAlongNormal(g, at.nx, at.ny, at.nz, at.wx, at.wy, at.wz, lipN * 0.8);
      } else if (kind === "sponge") {
        g = makeWallSponge(22 + lipN, "tube");
        g.scale(sc * 0.76, sc * 0.7, sc * 0.76);
        const tint = spongeTintsRGB[lipN % spongeTintsRGB.length];
        paint(g, (x, y, z) => {
          const n = noise3(x * 4, y * 4, z * 4);
          return [tint[0] * (0.88 + n * 0.14), tint[1] * (0.88 + n * 0.12), tint[2] * (0.86 + n * 0.1)];
        });
        orientAlongNormal(g, at.nx, at.ny, at.nz, at.wx, at.wy, at.wz, lipN * 0.8);
      } else {
        g = makeSolidShelf(44 + lipN, lipN % 2 ? "rose" : "table");
        g.scale(sc * 1.04, sc * 0.76, sc * 1.04);
        orientAlongNormal(g, at.nx, at.ny, at.nz, at.wx, at.wy, at.wz, lipN * 0.8);
      }
      colonyLayers.push(g);
      placed.push({ x: s.x, y: s.y, z: s.z, kind, region: "lintel" });
      lipN++;
    }

    let leftN = 0;
    for (const s of snapped) {
      if (leftN >= 0) break;
      if (s.x > -3.6 || s.x < -13.2) continue;
      if (s.y < 2.0 || s.y > 10.4) continue;
      if ((s.nz || 0) < 0.02 && (s.nx || 0) < 0.05) continue;
      if (nearKind(s.x, s.y, s.z, 1.18, null)) continue;
      const at = attachAt(s, 0.12);
      if (!at) continue;
      const kind = leftN % 3 === 0 ? "shelf" : leftN % 3 === 1 ? "fan" : "sponge";
      let g;
      const sc = 0.9 + rng() * 0.16;
      if (kind === "fan") {
        g = makeFanCoral(60 + leftN);
        g.scale(sc * 1.06, sc * 0.8, sc * 1.06);
        const tint = fanTintsRGB[leftN % fanTintsRGB.length];
        paint(g, (x, y, z) => {
          const n = noise3(x * 4, y * 4, z * 4);
          return [tint[0] * (0.9 + n * 0.12), tint[1] * (0.9 + n * 0.1), tint[2] * (0.88 + n * 0.1)];
        });
        orientAlongNormal(g, at.nx, at.ny, at.nz, at.wx, at.wy, at.wz, leftN * 0.7);
      } else if (kind === "sponge") {
        g = makeWallSponge(33 + leftN, "tube");
        g.scale(sc * 0.76, sc * 0.7, sc * 0.76);
        const tint = spongeTintsRGB[leftN % spongeTintsRGB.length];
        paint(g, (x, y, z) => {
          const n = noise3(x * 4, y * 4, z * 4);
          return [tint[0] * (0.88 + n * 0.14), tint[1] * (0.88 + n * 0.12), tint[2] * (0.86 + n * 0.1)];
        });
        orientAlongNormal(g, at.nx, at.ny, at.nz, at.wx, at.wy, at.wz, leftN * 0.7);
      } else {
        g = makeSolidShelf(55 + leftN, leftN % 2 ? "olive" : "table");
        g.scale(sc * 1.04, sc * 0.76, sc * 1.04);
        orientAlongNormal(g, at.nx, at.ny, at.nz, at.wx, at.wy, at.wz, leftN * 0.7);
      }
      colonyLayers.push(g);
      placed.push({ x: s.x, y: s.y, z: s.z, kind, region: "left" });
      leftN++;
    }

    if (colonyLayers.length) {
      const colonyGeo = mergeGeos(colonyLayers);
      const colony = new THREE.Mesh(colonyGeo, colonyMat);
      colony.castShadow = true;
      colony.receiveShadow = true;
      group.add(colony);
    }

    // Hero table colonies: facing discs on left pillar, lintel/lip, and right face.
    const organSites = [
      { lx: -6.8, ly: 5.4, sc: 1.12, seed: 2.15, v: 0, lip: false },
      { lx: -5.6, ly: 8.6, sc: 1.1, seed: 4.62, v: 1, lip: false },
      { lx: -7.8, ly: 7.0, sc: 1.12, seed: 7.08, v: 2, lip: false },
      { lx: -5.2, ly: 4.0, sc: 1.08, seed: 11.9, v: 3, lip: false },
      { lx: -7.2, ly: 10.4, sc: 1.06, seed: 26.4, v: 4, lip: false },
      { lx: -4.8, ly: 6.6, sc: 1.1, seed: 31.7, v: 5, lip: false },
      { lx: -8.4, ly: 4.4, sc: 1.1, seed: 33.2, v: 0, lip: false },
      { lx: -6.2, ly: 9.2, sc: 1.08, seed: 34.8, v: 1, lip: false },
      { lx: -8.0, ly: 2.8, sc: 1.08, seed: 36.4, v: 2, lip: false },
      { lx: -3.6, ly: 12.8, sc: 0.98, seed: 13.6, v: 5, lip: true },
      { lx: 1.4, ly: 13.2, sc: 1.0, seed: 15.3, v: 0, lip: true },
      { lx: 5.0, ly: 13.0, sc: 0.96, seed: 17.8, v: 1, lip: true },
      { lx: -1.2, ly: 12.6, sc: 0.96, seed: 19.1, v: 2, lip: true },
      { lx: -5.4, ly: 11.6, sc: 0.98, seed: 21.4, v: 3, lip: true },
      { lx: 3.2, ly: 12.2, sc: 0.96, seed: 23.8, v: 4, lip: true },
      { lx: 9.2, ly: 8.6, sc: 1.06, seed: 20.6, v: 2, lip: false },
      { lx: 11.4, ly: 6.4, sc: 1.02, seed: 22.4, v: 3, lip: false },
      { lx: 7.8, ly: 5.8, sc: 1.02, seed: 38.3, v: 4, lip: false },
      { lx: 10.8, ly: 10.4, sc: 1.04, seed: 41.2, v: 0, lip: false },
      { lx: 13.2, ly: 8.0, sc: 1.0, seed: 44.8, v: 1, lip: false },
      { lx: 8.6, ly: 3.8, sc: 0.98, seed: 48.1, v: 5, lip: false },
      { lx: 12.4, ly: 5.2, sc: 1.02, seed: 51.6, v: 2, lip: false },
      { lx: 9.8, ly: 7.0, sc: 1.02, seed: 55.3, v: 3, lip: false },
      { lx: 14.4, ly: 4.6, sc: 1.0, seed: 58.8, v: 4, lip: false },
      { lx: 13.6, ly: 6.8, sc: 1.04, seed: 62.2, v: 5, lip: false },
      { lx: 11.0, ly: 3.4, sc: 1.0, seed: 65.7, v: 0, lip: false },
      { lx: 15.2, ly: 7.6, sc: 0.98, seed: 69.1, v: 1, lip: false },
      { lx: -9.6, ly: 3.6, sc: 1.04, seed: 71.2, v: 1, lip: false },
      { lx: -10.2, ly: 6.2, sc: 1.06, seed: 72.8, v: 2, lip: false },
      { lx: -9.0, ly: 8.8, sc: 1.04, seed: 74.4, v: 3, lip: false },
      { lx: -9.8, ly: 11.0, sc: 1.0, seed: 76.0, v: 4, lip: false },
      { lx: -3.4, ly: 3.2, sc: 1.04, seed: 77.6, v: 5, lip: false },
      { lx: -3.8, ly: 7.8, sc: 1.06, seed: 79.2, v: 0, lip: false },
      { lx: -4.2, ly: 10.8, sc: 1.02, seed: 80.8, v: 1, lip: false },
      { lx: -6.6, ly: 13.4, sc: 0.96, seed: 82.4, v: 2, lip: true },
      { lx: -0.2, ly: 13.6, sc: 0.96, seed: 84.0, v: 3, lip: true },
      { lx: 6.8, ly: 13.4, sc: 0.94, seed: 85.6, v: 4, lip: true },
      { lx: 2.4, ly: 14.0, sc: 0.94, seed: 87.2, v: 5, lip: true },
      { lx: 8.4, ly: 12.4, sc: 0.96, seed: 88.8, v: 0, lip: true },
      { lx: 8.0, ly: 8.8, sc: 1.04, seed: 90.4, v: 1, lip: false },
      { lx: 10.2, ly: 4.8, sc: 1.02, seed: 92.0, v: 2, lip: false },
      { lx: 12.0, ly: 9.6, sc: 1.04, seed: 93.6, v: 3, lip: false },
      { lx: 14.8, ly: 6.0, sc: 1.0, seed: 95.2, v: 4, lip: false },
      { lx: 7.2, ly: 7.2, sc: 1.02, seed: 96.8, v: 5, lip: false },
      { lx: 15.8, ly: 5.2, sc: 0.98, seed: 98.4, v: 0, lip: false },
      { lx: 11.6, ly: 11.6, sc: 1.0, seed: 100.0, v: 1, lip: false },
      { lx: 9.4, ly: 11.8, sc: 1.0, seed: 101.6, v: 2, lip: false },
      { lx: 16.2, ly: 8.4, sc: 0.98, seed: 103.2, v: 3, lip: false },
      { lx: 6.8, ly: 4.6, sc: 1.0, seed: 104.8, v: 4, lip: false },
      { lx: 8.0, ly: 2.4, sc: 1.04, seed: 200.1, v: 0, lip: false },
      { lx: 10.2, ly: 2.2, sc: 1.02, seed: 201.8, v: 1, lip: false },
      { lx: 12.4, ly: 2.6, sc: 1.04, seed: 203.5, v: 2, lip: false },
      { lx: 14.6, ly: 3.0, sc: 1.02, seed: 205.2, v: 3, lip: false },
      { lx: 16.4, ly: 3.4, sc: 1.0, seed: 206.9, v: 4, lip: false },
      { lx: 7.2, ly: 3.6, sc: 1.04, seed: 208.6, v: 5, lip: false },
      { lx: 9.4, ly: 3.2, sc: 1.04, seed: 210.3, v: 0, lip: false },
      { lx: 11.6, ly: 3.8, sc: 1.02, seed: 212.0, v: 1, lip: false },
      { lx: 13.8, ly: 3.4, sc: 1.02, seed: 213.7, v: 2, lip: false },
      { lx: 15.6, ly: 4.2, sc: 1.0, seed: 215.4, v: 3, lip: false },
      { lx: 8.6, ly: 4.6, sc: 1.04, seed: 217.1, v: 4, lip: false },
      { lx: 10.8, ly: 5.0, sc: 1.02, seed: 218.8, v: 5, lip: false },
      { lx: 13.0, ly: 4.8, sc: 1.02, seed: 220.5, v: 0, lip: false },
      { lx: 6.4, ly: 5.2, sc: 1.02, seed: 222.2, v: 1, lip: false },
      { lx: 15.0, ly: 2.4, sc: 1.0, seed: 223.9, v: 2, lip: false },
      { lx: -8.6, ly: 2.4, sc: 1.08, seed: 230.2, v: 3, lip: false },
      { lx: -6.2, ly: 2.2, sc: 1.08, seed: 231.9, v: 4, lip: false },
      { lx: -10.8, ly: 3.4, sc: 1.06, seed: 233.6, v: 5, lip: false },
      { lx: -4.6, ly: 3.6, sc: 1.06, seed: 235.3, v: 0, lip: false },
      { lx: -11.4, ly: 5.6, sc: 1.06, seed: 237.0, v: 1, lip: false },
      { lx: -5.4, ly: 5.8, sc: 1.08, seed: 238.7, v: 2, lip: false },
      { lx: -9.2, ly: 7.4, sc: 1.06, seed: 240.4, v: 3, lip: false },
      { lx: -3.2, ly: 6.4, sc: 1.06, seed: 242.1, v: 4, lip: false },
      { lx: -11.0, ly: 8.6, sc: 1.04, seed: 243.8, v: 5, lip: false },
      { lx: -6.0, ly: 10.0, sc: 1.06, seed: 245.5, v: 0, lip: false },
      { lx: -8.2, ly: 12.2, sc: 1.02, seed: 247.2, v: 1, lip: true },
      { lx: -4.0, ly: 12.4, sc: 0.98, seed: 250.4, v: 2, lip: true },
      { lx: -2.2, ly: 13.2, sc: 0.96, seed: 252.1, v: 3, lip: true },
      { lx: 0.4, ly: 12.2, sc: 0.96, seed: 253.8, v: 4, lip: true },
      { lx: 2.6, ly: 13.6, sc: 0.96, seed: 255.5, v: 5, lip: true },
      { lx: 4.4, ly: 12.4, sc: 0.96, seed: 257.2, v: 0, lip: true },
      { lx: 6.0, ly: 11.8, sc: 0.96, seed: 258.9, v: 1, lip: true },
    ];
    let organI = 0;
    for (const site of organSites) {
      const snap = snapSite(site.lx, site.ly, site.lip);
      if (!snap) continue;
      snap.region = regionOf(snap);
      if (placeOrgan(snap, site.sc, site.seed, site.v)) organI++;
    }

    function bestFacing(x0, x1, y0, y1) {
      let best = null;
      let score = -1e9;
      for (const s of snapped) {
        if (s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) continue;
        const sc = s.nz * 1.8 + Math.max(0, s.z) * 0.28 + Math.max(0, s.nx) * 0.22 - Math.abs(s.ny) * 0.16;
        if (sc > score) {
          score = sc;
          best = s;
        }
      }
      return best;
    }
    const cheekBoxes = [
      [-9.4, -3.2, 2.2, 5.4, 1.12, 80.1, 0],
      [-8.8, -2.6, 4.8, 7.8, 1.1, 81.4, 1],
      [-9.8, -3.6, 6.8, 10.0, 1.1, 82.8, 2],
      [-7.6, -2.2, 3.4, 6.6, 1.08, 84.2, 3],
      [-8.4, -2.8, 8.4, 11.6, 1.08, 85.6, 4],
      [-7.2, -2.0, 10.2, 13.2, 1.04, 87.0, 5],
      [-6.4, -1.8, 5.2, 8.6, 1.08, 88.4, 0],
      [-6.8, -1.4, 11.2, 14.4, 1.0, 90.1, 1],
      [-2.4, 2.6, 11.8, 14.8, 1.02, 91.5, 2],
      [2.2, 7.0, 11.4, 14.6, 1.0, 92.8, 3],
      [-5.0, 0.4, 10.0, 13.0, 0.98, 94.2, 4],
      [0.0, 4.8, 10.2, 13.2, 0.98, 95.6, 5],
      [-4.6, -0.6, 12.0, 14.6, 1.0, 97.0, 0],
      [7.6, 12.4, 2.0, 4.8, 1.06, 72.1, 0],
      [11.2, 16.8, 2.0, 5.4, 1.04, 73.4, 1],
      [13.0, 18.4, 3.2, 6.8, 1.04, 74.8, 2],
      [8.4, 13.2, 4.4, 7.2, 1.04, 76.2, 3],
      [14.0, 18.6, 6.4, 10.2, 1.0, 77.6, 4],
      [-10.6, -7.2, 2.4, 5.2, 1.06, 106.4, 5],
      [-11.0, -7.6, 5.6, 8.8, 1.06, 107.8, 0],
      [-10.2, -6.8, 8.8, 12.0, 1.04, 109.2, 1],
      [-4.0, -1.2, 2.4, 5.0, 1.06, 110.6, 2],
      [-3.4, 0.4, 6.8, 10.0, 1.04, 112.0, 3],
      [6.8, 11.0, 12.0, 14.6, 0.98, 113.4, 4],
      [8.8, 13.8, 8.8, 11.6, 1.02, 114.8, 5],
      [15.2, 19.0, 3.8, 7.0, 1.02, 116.2, 0],
      [6.2, 10.4, 6.4, 9.2, 1.04, 117.6, 1],
      [12.4, 16.8, 10.0, 13.0, 1.0, 119.0, 2],
      [6.8, 11.2, 1.3, 3.4, 1.04, 260.2, 0],
      [10.4, 15.2, 1.3, 3.6, 1.02, 261.8, 1],
      [13.6, 18.4, 1.4, 3.8, 1.02, 263.4, 2],
      [7.4, 12.0, 3.2, 5.6, 1.04, 265.0, 3],
      [12.0, 16.8, 3.0, 5.4, 1.02, 266.6, 4],
      [15.0, 19.0, 2.2, 5.0, 1.0, 268.2, 5],
      [8.8, 13.6, 4.8, 6.6, 1.04, 269.8, 0],
      [-12.4, -8.0, 1.3, 3.8, 1.06, 271.4, 1],
      [-8.6, -4.2, 1.3, 3.6, 1.08, 273.0, 2],
      [-13.0, -8.6, 3.6, 6.4, 1.06, 274.6, 3],
      [-6.0, -2.2, 2.0, 4.6, 1.06, 276.2, 4],
      [-11.6, -7.4, 9.6, 13.2, 1.04, 277.8, 5],
      [-5.6, -1.6, 8.0, 11.2, 1.06, 279.4, 0],
      [-7.8, -3.0, 12.0, 14.6, 1.0, 281.0, 1],
      [-3.8, 1.2, 11.6, 14.4, 0.98, 282.6, 2],
    ];
    for (const [x0, x1, y0, y1, sc, seed, v] of cheekBoxes) {
      const s = bestFacing(x0, x1, y0, y1);
      if (!s) continue;
      s.region = regionOf(s);
      if (placeOrgan(s, sc, seed, v)) organI++;
    }

    const nReg = (r) => placed.filter((p) => p.kind === "table" && p.region === r).length;
    function tableNear(x, y, z) {
      let nd = 1e9;
      for (const o of placed) {
        if (o.kind !== "table") continue;
        const d = Math.hypot(x - o.x, y - o.y, z - o.z);
        if (d < nd) nd = d;
      }
      return nd;
    }
    function fillGaps(match, target, sc, seed0, countFn) {
      const pool = snapped
        .filter(match)
        .map((s) => ({ s, nd: tableNear(s.x, s.y, s.z) }))
        .sort((a, b) => b.nd - a.nd);
      let n = countFn();
      for (let i = 0; i < pool.length && n < target; i++) {
        const s = pool[i].s;
        if (placeOrgan(s, sc, seed0 + i * 1.67, i % 6)) n++;
      }
    }
    fillGaps(
      (s) =>
        s.region === "left" &&
        s.y > 1.2 &&
        s.y < 14.4 &&
        s.x > -13.6 &&
        s.x < -1.4 &&
        s.z > 0.7 &&
        !(s.nz < -0.1 && s.nx < 0.02),
      24,
      1.04,
      70.4,
      () => nReg("left"),
    );
    fillGaps(
      (s) => (s.region === "lintel" || s.region === "lip") && s.y > 9.0 && s.y < 15.4 && s.z > 0.7,
      16,
      0.96,
      78.2,
      () => nReg("lintel") + nReg("lip"),
    );
    fillGaps(
      (s) => s.region === "right" && s.y > 1.6 && s.y < 14.0 && s.x > 5.4 && s.x < 18.4 && s.z > 0.9 && s.nz > -0.06,
      20,
      1.02,
      120.4,
      () => nReg("right"),
    );
    fillGaps(
      (s) =>
        (s.region === "right" || s.region === "lip") &&
        s.y > 1.1 &&
        s.y < 8.0 &&
        s.x > 5.2 &&
        s.x < 18.8 &&
        s.z > 0.4 &&
        s.nz > -0.14,
      16,
      1.02,
      180.4,
      () => placed.filter((p) => p.kind === "table" && p.x > 5.2 && p.y < 8.0).length,
    );

    function plantEmpty(extra, sc, seed0, pred, minNd = 1.32) {
      const cands = [];
      for (const s of grotto.samples) {
        if (!pred(s)) continue;
        const lipOk = !!(s.lip || windowSDF2D(s.x, s.y) < 2.6);
        const snap = snapFromSample(s, lipOk);
        if (!snap) continue;
        if (snap.z < 0.38 || snap.z > 13.8) continue;
        if (snap.nz < -0.14) continue;
        snap.region = regionOf(snap);
        const nd = tableNear(snap.x, snap.y, snap.z);
        if (nd < minNd) continue;
        cands.push({ snap, nd });
      }
      cands.sort((a, b) => b.nd - a.nd);
      let n = 0;
      for (let i = 0; i < cands.length && n < extra; i++) {
        if (placeOrgan(cands[i].snap, sc, seed0 + i * 1.53, i % 6)) n++;
      }
    }
    plantEmpty(
      8,
      1.04,
      130.1,
      (s) => s.x > -13.4 && s.x < -2.0 && s.y > 1.7 && s.y < 13.8 && s.z > 0.55 && (s.nz > -0.04 || s.nx > -0.2),
    );
    plantEmpty(5, 0.96, 150.2, (s) => s.y > 11.0 && s.y < 15.4 && s.x > -8.8 && s.x < 12.6 && s.z > 0.55);
    plantEmpty(8, 1.02, 170.3, (s) => s.x > 5.6 && s.x < 18.6 && s.y > 1.7 && s.y < 13.8 && s.z > 0.55 && s.nz > -0.05);
    plantEmpty(
      12,
      1.02,
      280.2,
      (s) => s.x > 5.2 && s.x < 18.8 && s.y > 1.1 && s.y < 8.0 && s.z > 0.35 && s.nz > -0.14,
      0.88,
    );
    plantEmpty(
      10,
      1.04,
      300.4,
      (s) => s.x > -13.8 && s.x < -1.5 && s.y > 1.2 && s.y < 14.0 && s.z > 0.38 && (s.nz > -0.1 || s.nx > -0.28),
      0.88,
    );
    plantEmpty(6, 0.96, 320.6, (s) => s.y > 10.2 && s.y < 15.2 && s.x > -8.8 && s.x < 12.8 && s.z > 0.42, 0.9);

    function plantFrontBand(x0, x1, y0, y1, want, sc, seed0, minD) {
      const cands = [];
      for (const s of grotto.samples) {
        if (s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) continue;
        if (s.z < 0.55 || s.z > 13.6) continue;
        if (s.nz < 0.12) continue;
        if (s.y < 8.2 && s.ny > 0.38) continue;
        const lipOk = !!(s.lip || windowSDF2D(s.x, s.y) < 2.6);
        const snap = snapFromSample(s, lipOk);
        if (!snap) continue;
        if (snap.z < 0.55 || snap.nz < 0.12) continue;
        if (snap.y < 8.2 && snap.ny > 0.38) continue;
        snap.region = regionOf(snap);
        const nd = tableNear(snap.x, snap.y, snap.z);
        // Prefer empty vertical camera faces, not shelf-top lids.
        const face = nd * 1.6 + snap.nz * 2.8 - Math.max(0, snap.ny) * 1.8;
        cands.push({ snap, nd, face });
      }
      cands.sort((a, b) => b.face - a.face);
      let n = 0;
      for (let i = 0; i < cands.length && n < want; i++) {
        if (placeOrgan(cands[i].snap, sc, seed0 + i * 1.41, i % 6, minD)) n++;
      }
      return n;
    }
    function plantCheekGrid(x0, x1, y0, y1, dx, dy, zMin, want, sc, seed0, minD) {
      const spots = [];
      for (let x = x0; x <= x1; x += dx) {
        for (let y = y0; y <= y1; y += dy) {
          const hit = snapToHillside(x, y, 7.2, false);
          if (!hit) continue;
          if (hit.z < zMin || hit.z > 10.4) continue;
          if (hit.nz < 0.06 && hit.nx < 0.12) continue;
          if (Math.abs(hit.x - x) > 0.85 || Math.abs(hit.y - y) > 0.7) continue;
          if (Math.abs(hit.d) > 0.16) continue;
          hit.region = regionOf(hit);
          spots.push(hit);
        }
      }
      let n = 0;
      const ys = [];
      for (let i = 0; i < spots.length && n < want; i++) {
        if (placeOrgan(spots[i], sc, seed0 + i * 1.37, i % 6, minD, 2.4)) {
          n++;
        }
      }
      return n;
    }
    plantCheekGrid(6.0, 10.6, 1.55, 4.55, 1.05, 0.95, 3.4, 10, 1.04, 440.2, 0.58);
    plantCheekGrid(8.6, 12.4, 1.7, 4.8, 1.1, 1.0, 3.6, 6, 1.02, 448.8, 0.6);
    plantCheekGrid(-11.6, -3.2, 1.55, 5.2, 1.15, 1.05, 3.2, 5, 1.06, 460.4, 0.6);
    plantFrontBand(6.2, 13.6, 1.3, 5.8, 8, 1.04, 380.2, 0.62);
    plantFrontBand(13.4, 17.4, 1.3, 5.6, 3, 1.0, 390.8, 0.64);
    plantFrontBand(-13.4, -1.6, 1.3, 13.6, 6, 1.06, 400.4, 0.62);
    plantFrontBand(-7.2, 8.4, 10.4, 14.8, 3, 0.96, 420.6, 0.68);

    function snapFront(lx, ly, boxX, boxY, lipOk) {
      let best = null;
      let bestZ = -1e9;
      for (const s of grotto.samples) {
        if (Math.abs(s.x - lx) > boxX || Math.abs(s.y - ly) > boxY) continue;
        if (s.z < 0.38 || s.z > 13.4) continue;
        if (s.nz < -0.08 && s.nx < -0.12) continue;
        if (s.z > bestZ) {
          bestZ = s.z;
          best = s;
        }
      }
      if (!best) return null;
      const snap = snapFromSample(best, lipOk);
      if (!snap || snap.nz < -0.1 || snap.z < 0.38) return null;
      snap.region = regionOf(snap);
      return snap;
    }
    const frontSites = [
      [-10.4, 4.4, 1.04, 240.1, 2, false],
      [-10.8, 7.0, 1.04, 241.7, 3, false],
      [-9.6, 5.6, 1.06, 243.3, 4, false],
      [-10.2, 9.2, 1.02, 244.9, 5, false],
      [-8.8, 3.6, 1.04, 246.5, 0, false],
      [-11.0, 5.2, 1.02, 248.1, 1, false],
      [-9.2, 10.6, 1.0, 249.7, 2, false],
      [-7.4, 3.8, 1.04, 251.3, 3, false],
      [-6.0, 12.2, 0.98, 252.9, 4, true],
      [4.2, 13.6, 0.96, 254.5, 5, true],
      [7.4, 12.8, 0.96, 256.1, 0, true],
      [16.4, 5.8, 1.0, 257.7, 1, false],
      [15.6, 9.2, 1.02, 259.3, 2, false],
      [8.2, 10.8, 1.02, 260.9, 3, false],
      [8.4, 2.2, 1.04, 340.1, 4, false],
      [11.0, 2.4, 1.02, 341.8, 5, false],
      [13.6, 2.6, 1.02, 343.5, 0, false],
      [16.0, 3.0, 1.0, 345.2, 1, false],
      [9.6, 3.8, 1.04, 346.9, 2, false],
      [12.2, 4.2, 1.02, 348.6, 3, false],
      [14.8, 3.6, 1.02, 350.3, 4, false],
      [7.2, 4.4, 1.04, 352.0, 5, false],
      [-9.4, 2.2, 1.06, 353.7, 0, false],
      [-11.6, 3.8, 1.06, 355.4, 1, false],
      [-6.8, 2.6, 1.06, 357.1, 2, false],
      [-4.2, 4.4, 1.06, 358.8, 3, false],
      [-10.6, 6.8, 1.06, 360.5, 4, false],
      [-5.0, 9.4, 1.06, 362.2, 5, false],
      [-3.2, 12.4, 0.98, 363.9, 0, true],
      [1.0, 12.8, 0.96, 365.6, 1, true],
      [5.4, 12.6, 0.96, 367.3, 2, true],
    ];
    for (const [lx, ly, sc, seed, v, lip] of frontSites) {
      const snap = snapFront(lx, ly, 1.7, 1.5, lip);
      if (!snap) continue;
      if (tableNear(snap.x, snap.y, snap.z) < 0.98) continue;
      if (placeOrgan(snap, sc, seed, v)) organI++;
    }

    // 3–5 brain lumps + a few thick fans in crevices — accents, not a second field.
    function creviceNear(x0, x1, y0, y1) {
      let best = null;
      let bestScore = -1e9;
      for (const s of snapped) {
        if (s.x < x0 || s.x > x1 || s.y < y0 || s.y > y1) continue;
        if (s.z < 0.5 || s.z > 13.8 || s.ny > 0.5) continue;
        const { nd } = nearest(s.x, s.y, s.z);
        if (nd < 0.48 || nd > 1.55) continue;
        const score = s.nz * 1.15 + (nd > 0.65 && nd < 1.25 ? 0.45 : 0) + Math.max(0, s.nx) * 0.12;
        if (score > bestScore) {
          bestScore = score;
          best = s;
        }
      }
      return best;
    }

    const brainBoxes = [
      [-9.2, -6.4, 3.2, 5.6, 0.42],
      [-6.4, -3.6, 9.6, 12.2, 0.34],
      [7.4, 10.4, 3.6, 6.0, 0.38],
      [10.6, 14.0, 8.4, 11.0, 0.32],
      [5.2, 8.4, 11.0, 13.4, 0.3],
      [12.4, 16.0, 4.4, 7.2, 0.28],
      [-11.2, -8.0, 4.8, 8.2, 0.36],
    ];
    let brainN = 0;
    for (const [x0, x1, y0, y1, sc] of brainBoxes) {
      if (brainN >= 8) break;
      const s = creviceNear(x0, x1, y0, y1) || snapSite((x0 + x1) * 0.5, (y0 + y1) * 0.5, y1 > 11);
      if (!s) continue;
      s.region = regionOf(s);
      if (placeBrainAt(s, sc, true)) brainN++;
    }

    const fanBoxes = [
      [-8.2, -5.4, 5.2, 7.8, 0.62, 6.4],
      [-6.8, -4.2, 8.4, 10.8, 0.52, 9.7],
      [9.2, 12.4, 3.8, 6.2, 0.58, 8.1],
      [11.4, 14.6, 6.4, 8.8, 0.48, 11.2],
      [7.2, 10.4, 8.8, 11.6, 0.5, 13.4],
      [-10.4, -7.2, 2.8, 5.4, 0.56, 15.1],
    ];
    const fanTints = [0x9a8840, 0x4a8a72, 0xc47868, 0xd4a044, 0x3d7a68, 0xb89850];
    let fanN = 0;
    for (const [x0, x1, y0, y1, sc, seed] of fanBoxes) {
      if (fanN >= 0) break;
      const s = creviceNear(x0, x1, y0, y1) || snapSite((x0 + x1) * 0.5, (y0 + y1) * 0.5, false);
      if (!s) continue;
      s.region = regionOf(s);
      if (s.y > 14.2 || s.ny > 0.46 || s.z < 0.4 || s.z > 14.2) continue;
      if (tooCloseKind(s.x, s.y, s.z, 0.7, "fan")) continue;
      const mat = fanMat.clone();
      mat.color.setHex(pick(rng, fanTints), THREE.SRGBColorSpace);
      patchUnderwater(mat, shared, { caustics: false, detail: "coral" });
      const m = new THREE.Mesh(makeFanCoral(seed), mat);
      const seat = 0.14 * sc;
      m.position.set(ox + s.x - s.nx * seat, oy + s.y - s.ny * seat - 0.02, oz + s.z - s.nz * seat);
      m.rotation.set(0.18 + rng() * 0.12, Math.atan2(s.nx, s.nz) + Math.PI * 0.5 + (rng() - 0.5) * 0.28, (rng() - 0.5) * 0.16);
      m.scale.set(sc * 0.98, sc * 1.06, sc * 1.02);
      m.castShadow = true;
      group.add(m);
      placed.push({ x: s.x, y: s.y, z: s.z, sc, yaw: 0, stacks: 0, kind: "fan", region: s.region });
      fanN++;
    }
  }

  for (let x = -70; x <= 90; x += 5) {
    for (let z = -70; z <= 70; z += 5) {
      scatterShallows(x, z);
      if (rng() < 0.55) scatterShallows(x + 1.8, z - 1.6);
    }
  }

  for (let i = 0; i < 90; i++) {
    scatterShallows(4 + (rng() - 0.5) * 18, 6 + (rng() - 0.5) * 20, true);
  }
  for (let i = 0; i < 70; i++) {
    const x = -4 + rng() * 16;
    const z = 4 + rng() * 12;
    if (x > -5 && x < 5 && z > 6 && z < 14) {
      if (pei < PEBBLE_N) {
        const s = 0.55 + rng() * 1.15;
        place(pebbles, pei++, x, terrainHeight(x, z), z, s, s * 0.72, s, rng() * 6, rng() * 0.3, pick(rng, pebbleColors), pebbles.instanceColor);
      }
      continue;
    }
    scatterShallows(x, z, true);
  }

  // Sand in the capture frustum: pebbles, shells, small weeds, low coral bits.
  const spongePad = (x, z) => Math.hypot(x + 1.8, z - 10.4) < 2.6;
  for (let i = 0; i < 110; i++) {
    const x = -7.5 + rng() * 24;
    const z = 5.2 + rng() * 11.5;
    if (spongePad(x, z)) continue;
    const y = terrainHeight(x, z);
    if (pei < PEBBLE_N) {
      const s = 0.7 + rng() * 2.1;
      place(pebbles, pei++, x, y, z, s, s * (0.7 + rng() * 0.28), s * (0.88 + rng() * 0.2), rng() * 6, rng() * 0.35, pick(rng, pebbleColors), pebbles.instanceColor);
    }
  }
  for (let i = 0; i < 18; i++) {
    const x = -6.5 + rng() * 22;
    const z = 6 + rng() * 10;
    if (spongePad(x, z)) continue;
    if (shi >= SHELL_N) break;
    const s = 1.15 + rng() * 1.6;
    place(shells, shi++, x, terrainHeight(x, z) + 0.02, z, s, s * 0.85, s, rng() * 6, 0.05, pick(rng, shellColors), shells.instanceColor);
  }
  for (let i = 0; i < 10; i++) {
    const x = 10 + rng() * 12;
    const z = 12 + rng() * 8;
    if (spongePad(x, z)) continue;
    if (gi >= 900) break;
    const s = 0.32 + rng() * 0.4;
    place(grass, gi++, x, terrainHeight(x, z), z, s, s * (0.4 + rng() * 0.3), s, rng() * 6, 0, pick(rng, grassColors), grass.instanceColor);
  }
  for (let i = 0; i < 6; i++) {
    const x = 12 + rng() * 10;
    const z = 14 + rng() * 8;
    if (spongePad(x, z)) continue;
    if (wi >= 160) break;
    const s = 0.28 + rng() * 0.28;
    place(weeds, wi++, x, terrainHeight(x, z), z, s, s * 0.7, s, rng() * 6, 0, pick(rng, weedColors), weeds.instanceColor);
  }
  const lowCoral = [
    [3.4, 7.6, 0.55],
    [6.6, 9.4, 0.48],
    [8.8, 11.2, 0.42],
    [5.2, 6.2, 0.4],
    [1.6, 6.8, 0.46],
    [10.4, 8.6, 0.5],
    [-0.4, 7.2, 0.38],
    [7.8, 13.4, 0.44],
  ];
  for (const [x, z, s] of lowCoral) {
    if (bri >= BRAIN_N) break;
    place(brains, bri++, x, terrainHeight(x, z) + 0.06, z, s, s * 0.62, s, rng() * 6, 0.08, pick(rng, brainColors), brains.instanceColor);
  }
  tubeMesh.count = ti;
  bulbMesh.count = bi;
  brains.count = bri;
  plates.count = pi;
  shelves.count = si;
  talls.count = tli;
  fans.count = fi;
  branches.count = bci;
  grass.count = gi;
  weeds.count = wi;
  barns.count = bai;
  pebbles.count = pei;
  shells.count = shi;
  brackets.count = bki;
  crusts.count = cri;
  vols.count = vi;
  for (const m of [tubeMesh, bulbMesh, brains, plates, shelves, talls, fans, branches, grass, weeds, barns, pebbles, shells, brackets, crusts, vols]) {
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    group.add(m);
  }

  const kelpMat = createKelpMaterial(shared, 0xffffff);
  kelpMat.vertexColors = true;
  kelpMat.roughness = 0.96;
  kelpMat.side = THREE.FrontSide;
  const kelpLeafMat = createKelpMaterial(shared, 0xffffff, 0x000000, 0, "leaf");
  kelpLeafMat.vertexColors = true;
  kelpLeafMat.roughness = 0.92;
  kelpLeafMat.side = THREE.DoubleSide;
  const seedMat = createKelpMaterial(shared, 0xffffff, 0xff9418, 2.9);
  seedMat.vertexColors = true;
  seedMat.roughness = 0.34;
  seedMat.side = THREE.FrontSide;
  const lampCanvas = document.createElement("canvas");
  lampCanvas.width = lampCanvas.height = 128;
  {
    const ctx = lampCanvas.getContext("2d");
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "rgba(255, 230, 120, 1)");
    g.addColorStop(0.1, "rgba(255, 176, 42, 0.72)");
    g.addColorStop(0.26, "rgba(255, 118, 10, 0.22)");
    g.addColorStop(0.48, "rgba(255, 78, 0, 0.055)");
    g.addColorStop(1, "rgba(255, 40, 0, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
  }
  const lampTex = new THREE.CanvasTexture(lampCanvas);
  lampTex.colorSpace = THREE.SRGBColorSpace;
  const seedHaloMat = new THREE.SpriteMaterial({
    map: lampTex,
    color: 0xff9618,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.88,
    fog: true,
  });
  const seedGlowMat = new THREE.SpriteMaterial({
    map: lampTex,
    color: 0xff9a22,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.32,
    fog: true,
  });

  const farStalkSpecs = [
    { seed: 1.55, radius: 0.48, turns: 6.2, wraps: 5, hair: 88, whiskers: 40, lobes: 2 },
    { seed: 3.02, radius: 0.38, turns: 14.4, wraps: 4, hair: 102, whiskers: 48, lobes: 3 },
    { seed: 4.91, radius: 0.56, turns: 8.6, wraps: 6, hair: 80, whiskers: 38, lobes: 4 },
    { seed: 6.44, radius: 0.42, turns: 4.8, wraps: 5, hair: 96, whiskers: 44, lobes: 2 },
  ];
  const heroStalkSpecs = [
    { seed: 1.07, dense: true, radius: 0.88, turns: 4.4, wraps: 8, hair: 132, whiskers: 60, lobes: 2 },
    { seed: 2.41, dense: true, radius: 0.66, turns: 11.6, wraps: 6, hair: 144, whiskers: 68, lobes: 3 },
    { seed: 3.88, dense: true, radius: 0.64, turns: 8.4, wraps: 8, hair: 138, whiskers: 70, lobes: 4 },
    { seed: 5.19, dense: true, radius: 0.48, turns: 4.1, wraps: 7, hair: 176, whiskers: 92, lobes: 2 },
    { seed: 6.73, dense: true, radius: 0.72, turns: 12.4, wraps: 8, hair: 128, whiskers: 64, lobes: 3 },
    { seed: 8.05, dense: true, radius: 0.74, turns: 6.0, wraps: 7, hair: 136, whiskers: 64, lobes: 4 },
  ];
  const stalkGeos = farStalkSpecs.map((s) => makeKelpStalk(s.seed, s));
  const heroStalkGeos = heroStalkSpecs.map((s) => makeKelpStalk(s.seed, s));
  const farStalkSeeds = farStalkSpecs.map((s) => s.seed);
  const heroStalkSeeds = heroStalkSpecs.map((s) => s.seed);
  const leafGeos = [makeKelpLeaf(0.72), makeKelpLeaf(1.91), makeKelpLeaf(3.44)];
  const seedGeos = [makeSeedCluster(1.35), makeSeedCluster(2.7)];

  const MAX_STALK = 56;
  const MAX_HERO_STALK = 12;
  const MAX_LEAF = 48;
  const MAX_SEED = 160;
  const stalkMeshes = stalkGeos.map((g) => {
    const m = new THREE.InstancedMesh(g, kelpMat, MAX_STALK);
    m.castShadow = true;
    m.count = 0;
    return m;
  });
  const heroStalkMeshes = heroStalkGeos.map((g) => {
    const m = new THREE.InstancedMesh(g, kelpMat, MAX_HERO_STALK);
    m.castShadow = true;
    m.count = 0;
    return m;
  });
  const leafMeshes = leafGeos.map((g) => {
    const m = new THREE.InstancedMesh(g, kelpLeafMat, MAX_LEAF);
    m.castShadow = true;
    m.count = 0;
    return m;
  });
  const seedMeshes = seedGeos.map((g) => {
    const m = new THREE.InstancedMesh(g, seedMat, MAX_SEED);
    m.castShadow = true;
    m.count = 0;
    return m;
  });
  const stalkN = farStalkSpecs.map(() => 0);
  const heroStalkN = heroStalkSpecs.map(() => 0);
  const leafN = [0, 0, 0];
  const seedN = [0, 0];
  let kelpLights = 0;
  const kelpGroup = new THREE.Group();
  kelpGroup.name = "flora-kelp";

  const kelpPoints = [];
  const kelpRng = mulberry32(WORLD_SEED + 88);
  const placed = [];
  const CAM_X = 170;
  const CAM_Z = 14;

  const heroes = [
    { x: 164.5, z: 1.2, sx: 2.68, sy: 1.14, seed: true, hero: true, vi: 0, lean: 0.18, roll: 0.07, yaw: 0.52 },
    { x: 176.8, z: -3.4, sx: 1.78, sy: 1.36, seed: true, hero: true, vi: 1, lean: -0.28, roll: -0.12, yaw: 2.38 },
    { x: 185.4, z: -6.8, sx: 1.18, sy: 1.46, seed: true, hero: true, vi: 2, lean: 0.26, roll: 0.07, yaw: 4.12 },
    { x: 189.2, z: -9.5, sx: 1.08, sy: 1.4, seed: false, hero: true, vi: 3, lean: -0.11, roll: 0.14, yaw: 1.18 },
    { x: 195.6, z: -2.2, sx: 2.12, sy: 1.16, seed: true, hero: true, vi: 4, lean: 0.04, roll: -0.13, yaw: 3.66 },
    { x: 180.5, z: 9.2, sx: 1.7, sy: 1.1, seed: true, hero: true, vi: 5, lean: -0.2, roll: -0.2, yaw: 5.72 },
    { x: 202.4, z: -14.5, sx: 1.42, sy: 1.3, seed: true, hero: false, lean: -0.18, roll: 0.06, yaw: 5.21 },
    { x: 188.0, z: -19.2, sx: 1.22, sy: 1.24, seed: true, hero: false, lean: 0.19, roll: -0.08, yaw: 0.88 },
    { x: 208.5, z: 3.6, sx: 1.58, sy: 1.08, seed: true, hero: false, lean: -0.08, roll: 0.11, yaw: 2.74 },
    { x: 171.2, z: -11.8, sx: 1.28, sy: 1.32, seed: true, hero: false, lean: 0.12, roll: -0.16, yaw: 4.55 },
    { x: 198.8, z: 8.4, sx: 1.72, sy: 1.12, seed: true, hero: false, lean: -0.24, roll: 0.03, yaw: 1.66 },
    { x: 214.0, z: -8.0, sx: 1.12, sy: 1.38, seed: true, hero: false, lean: 0.09, roll: 0.17, yaw: 3.18 },
  ];

  function tooClose(x, z, minD) {
    if (Math.hypot(x - CAM_X, z - CAM_Z) < 11) return true;
    for (const p of placed) {
      if (Math.hypot(x - p.x, z - p.z) < minD) return true;
    }
    return false;
  }

  function addLeaf(x, y, z, yaw, scale) {
    const vi = (kelpRng() * leafGeos.length) | 0;
    if (leafN[vi] >= MAX_LEAF) return;
    dummy.position.set(x, y, z);
    dummy.rotation.set((kelpRng() - 0.5) * 0.03, yaw, (kelpRng() - 0.5) * 0.025);
    dummy.scale.set(scale * (0.94 + kelpRng() * 0.1), scale * (1.08 + kelpRng() * 0.18), scale);
    dummy.updateMatrix();
    leafMeshes[vi].setMatrixAt(leafN[vi]++, dummy.matrix);
  }

  function addSeed(x, y, z, yaw, scale, lit, hero = false) {
    const vi = (kelpRng() * seedGeos.length) | 0;
    if (seedN[vi] >= MAX_SEED) return;
    dummy.position.set(x, y, z);
    dummy.rotation.set((kelpRng() - 0.5) * 0.35, yaw, (kelpRng() - 0.5) * 0.28);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    seedMeshes[vi].setMatrixAt(seedN[vi]++, dummy.matrix);
    if (lit && kelpLights < 6) {
      kelpLights++;
      const light = new THREE.PointLight(0xff9a1c, hero ? 16 : 9, hero ? 28 : 18, 1.15);
      light.position.set(x, y - 0.38 * scale, z);
      kelpGroup.add(light);
      const halo = new THREE.Sprite(seedHaloMat);
      halo.position.set(x, y - 0.28 * scale, z);
      const hs = (hero ? 1.55 : 1.15) * scale;
      halo.scale.set(hs, hs, 1);
      halo.renderOrder = 3;
      kelpGroup.add(halo);
      const glow = new THREE.Sprite(seedGlowMat);
      glow.position.set(x, y - 0.16 * scale, z);
      const gs = (hero ? 2.8 : 2.1) * scale;
      glow.scale.set(gs, gs, 1);
      glow.renderOrder = 2;
      kelpGroup.add(glow);
    }
  }

  function pickUnusedVi(x, z, n) {
    const used = new Set();
    for (const p of placed) {
      if (p.vi != null && Math.hypot(x - p.x, z - p.z) < 16) used.add(p.vi);
    }
    const free = [];
    for (let i = 0; i < n; i++) if (!used.has(i)) free.push(i);
    if (free.length) return free[(kelpRng() * free.length) | 0];
    return (kelpRng() * n) | 0;
  }

  function plantStalk(spec) {
    const x = spec.x;
    const z = spec.z;
    const y = kelpFloorHint(x, z);
    const dist0 = Math.hypot(x - CAM_X, z - CAM_Z);
    let sx = spec.sx;
    if (dist0 < 16) sx = Math.max(sx, 1.62);
    else if (dist0 < 22) sx = Math.max(sx, 1.4);
    else if (dist0 < 32) sx = Math.max(sx, 1.18);
    else if (dist0 < 46) sx = Math.max(sx, 0.88);
    const sy = spec.sy;
    const yaw = spec.yaw ?? kelpRng() * Math.PI * 2;
    const lean = spec.lean ?? (kelpRng() - 0.5) * 0.28;
    const roll = spec.roll ?? (kelpRng() - 0.5) * 0.18;
    const nearCam = dist0 < 40;
    const wantHero = !!(spec.hero || nearCam);
    dummy.position.set(x, y, z);
    dummy.rotation.set(lean * 0.45, yaw, roll + lean * 0.75);
    dummy.scale.set(sx, sy, sx);
    dummy.updateMatrix();
    let stalkSeed = 1.07;
    let usedVi = 0;
    if (wantHero) {
      const hi = spec.vi != null ? spec.vi % heroStalkGeos.length : pickUnusedVi(x, z, heroStalkGeos.length);
      if (heroStalkN[hi] < MAX_HERO_STALK) {
        heroStalkMeshes[hi].setMatrixAt(heroStalkN[hi]++, dummy.matrix);
        stalkSeed = heroStalkSeeds[hi];
        usedVi = hi;
      } else {
        const fi = pickUnusedVi(x, z, stalkGeos.length);
        if (stalkN[fi] >= MAX_STALK) return;
        stalkMeshes[fi].setMatrixAt(stalkN[fi]++, dummy.matrix);
        stalkSeed = farStalkSeeds[fi];
        usedVi = fi;
      }
    } else {
      const vi = spec.vi != null ? spec.vi % stalkGeos.length : pickUnusedVi(x, z, stalkGeos.length);
      if (stalkN[vi] >= MAX_STALK) return;
      stalkMeshes[vi].setMatrixAt(stalkN[vi]++, dummy.matrix);
      stalkSeed = farStalkSeeds[vi];
      usedVi = vi;
    }
    const h = 48 * sy;
    kelpPoints.push({ x, y, z, h, yaw });
    placed.push({ x, z, vi: usedVi });
    const dist = Math.hypot(x - CAM_X, z - CAM_Z);
    const near = dist < 52;

    const crownT = 0.56 + kelpRng() * 0.14;
    const wantSeed = spec.seed || (near && dist < 26 && kelpRng() > 0.58);

    if (wantSeed) {
      const [cx, cz] = kelpCenter(crownT, stalkSeed);
      const hang = new THREE.Vector3(cx + 0.48, 48 * crownT - 0.35, cz);
      hang.applyMatrix4(dummy.matrix);
      const sc = (spec.hero || dist < 18 ? 1.46 : 1.12) + kelpRng() * 0.08;
      const lit = spec.hero || dist < 48;
      addSeed(hang.x, hang.y, hang.z, yaw, sc, lit, !!(spec.hero || dist < 18));
    }

    // Few large hanging cloth straps on heroes only — hang down, never kite at the camera.
    if (spec.hero) {
      const faceCam = Math.atan2(CAM_X - x, CAM_Z - z);
      const blades = dist < 16 ? 5 : dist < 24 ? 4 : 3;
      const hang = 1.72 + (dist < 16 ? 0.38 : 0.12);
      for (let k = 0; k < blades; k++) {
        const side = (k % 2 === 0 ? -1 : 1) * (0.1 + (k % 3) * 0.055);
        const t = Math.max(0.38, crownT + 0.05 - k * 0.032);
        const [lx, lz] = kelpCenter(t, stalkSeed);
        addLeaf(
          x + lx * sx + Math.sin(faceCam + Math.PI * 0.5) * side * sx * 0.38 - Math.sin(faceCam) * 0.2 * sx,
          y + h * t + 0.16,
          z + lz * sx + Math.cos(faceCam + Math.PI * 0.5) * side * sx * 0.24 - Math.cos(faceCam) * 0.2 * sx,
          faceCam + side * 0.16 + (kelpRng() - 0.5) * 0.07,
          hang + kelpRng() * 0.22,
        );
      }
    }
  }

  for (const h of heroes) plantStalk(h);

  for (let i = 0; i < 420 && placed.length < 118; i++) {
    const x = 122 + kelpRng() * 128;
    const z = -68 + kelpRng() * 132;
    const inAisle = x > 158 && x < 225 && z > -28 && z < 18;
    if (tooClose(x, z, (inAisle ? 5.2 : 6.8) + kelpRng() * 3.4)) continue;
    plantStalk({
      x,
      z,
      sx: 0.62 + kelpRng() * 1.15,
      sy: 0.86 + kelpRng() * 0.56,
      lean: (kelpRng() - 0.5) * 0.3,
      roll: (kelpRng() - 0.5) * 0.2,
      seed: kelpRng() > 0.38,
      hero: false,
    });
  }

  for (let i = 0; i < stalkMeshes.length; i++) {
    stalkMeshes[i].count = stalkN[i];
    stalkMeshes[i].instanceMatrix.needsUpdate = true;
    kelpGroup.add(stalkMeshes[i]);
  }
  for (let i = 0; i < heroStalkMeshes.length; i++) {
    heroStalkMeshes[i].count = heroStalkN[i];
    heroStalkMeshes[i].instanceMatrix.needsUpdate = true;
    kelpGroup.add(heroStalkMeshes[i]);
  }
  for (let i = 0; i < leafMeshes.length; i++) {
    leafMeshes[i].count = leafN[i];
    leafMeshes[i].instanceMatrix.needsUpdate = true;
    kelpGroup.add(leafMeshes[i]);
  }
  for (let i = 0; i < seedMeshes.length; i++) {
    seedMeshes[i].count = seedN[i];
    seedMeshes[i].instanceMatrix.needsUpdate = true;
    kelpGroup.add(seedMeshes[i]);
  }
  group.add(kelpGroup);

  scene.add(group);
  return { group, kelpPoints, kelpGroup };
}
