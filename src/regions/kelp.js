import * as THREE from "three";
import { mulberry32, noise3 } from "../math.js";
import { createKelpMaterial, patchUnderwater } from "../shaders.js";
import { mergeGeos, plantY } from "./util.js";

const CAM = { x: 170, y: -47.5, z: 14 };

function wander(t, seed) {
  return [
    Math.sin(t * 1.62 + seed * 2.05) * 0.58 +
      Math.sin(t * 3.85 + seed * 0.71) * 0.22 +
      Math.sin(t * 7.4 + seed * 1.4) * 0.07,
    Math.cos(t * 1.28 + seed * 1.55) * 0.46 +
      Math.sin(t * 3.15 + seed * 2.4) * 0.18 +
      Math.cos(t * 6.2 + seed) * 0.06,
  ];
}

function pathTube(pts, rads, radial, colAt, radAt) {
  const rings = pts.length;
  const pos = [];
  const col = [];
  const idx = [];
  const stride = radial + 1;
  for (let j = 0; j < rings; j++) {
    const t = rings === 1 ? 0 : j / (rings - 1);
    const p = pts[j];
    const nxt = pts[Math.min(j + 1, rings - 1)];
    const prv = pts[Math.max(j - 1, 0)];
    let tx = nxt.x - prv.x;
    let ty = nxt.y - prv.y;
    let tz = nxt.z - prv.z;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    let bx = -tz;
    let by = 0;
    let bz = tx;
    let bl = Math.hypot(bx, by, bz);
    if (bl < 1e-4) {
      bx = 1;
      bz = 0;
      bl = 1;
    }
    bx /= bl;
    bz /= bl;
    let nx = ty * bz - tz * by;
    let ny = tz * bx - tx * bz;
    let nz = tx * by - ty * bx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const rad = rads[j] * (radAt ? radAt(t, a) : 1);
      pos.push(p.x + (bx * ca + nx * sa) * rad, p.y + (by * ca + ny * sa) * rad, p.z + (bz * ca + nz * sa) * rad);
      const c = colAt(t, a, p);
      col.push(c[0], c[1], c[2]);
    }
  }
  for (let j = 0; j < rings - 1; j++) {
    for (let i = 0; i < radial; i++) {
      const a = j * stride + i;
      const b = a + stride;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  return geo;
}

function stalkShade(t, a, n) {
  const ridge = 0.5 + 0.5 * Math.cos(a * 3.0 - t * 14);
  const fiber = 0.5 + 0.5 * Math.sin(a * 9.0 - t * 22);
  const m = 0.58 + n * 0.32 - ridge * 0.26 - fiber * 0.1 + t * 0.03;
  return [m * 0.042, m * 0.062, m * 0.02];
}

function makeMainRope(seed, height, radius) {
  const rings = 64;
  const segs = 16;
  const lumps = [
    { t: 0.12 + ((seed * 1.3) % 1) * 0.06, w: 0.06, d: 0.38 },
    { t: 0.28 + ((seed * 2.1) % 1) * 0.08, w: 0.08, d: 0.32 },
    { t: 0.46 + ((seed * 1.7) % 1) * 0.08, w: 0.07, d: 0.28 },
    { t: 0.64 + ((seed * 2.6) % 1) * 0.07, w: 0.09, d: 0.24 },
    { t: 0.82 + ((seed * 1.9) % 1) * 0.06, w: 0.07, d: 0.2 },
  ];
  const pts = [];
  const rads = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const [cx, cz] = wander(t, seed);
    const n = noise3(cx * 1.4 + seed, t * 3.2, cz * 1.4);
    let rad = radius * (1.12 - t * 0.12) * (1 + 0.12 * Math.sin(t * 6.4 + seed * 2.2));
    if (t < 0.07) rad *= 1 + (0.07 - t) * 7.2;
    for (const L of lumps) {
      const d = (t - L.t) / L.w;
      rad *= 1 + L.d * Math.exp(-d * d);
    }
    rad *= 1 + (n - 0.5) * 0.28;
    pts.push({ x: cx, y: t * height, z: cz });
    rads.push(rad);
  }
  return pathTube(
    pts,
    rads,
    segs,
    (t, a) => {
      const n = noise3(Math.cos(a) * 2.2 + seed, t * 5.4, Math.sin(a) * 2.2);
      return stalkShade(t, a + t * 8.2 + seed, n);
    },
    (t, a) => {
      const twist = t * 16.5 + seed * 2.4;
      const lobe = 0.78 + 0.28 * Math.pow(0.5 + 0.5 * Math.cos(a * 3 - twist), 1.35);
      const fiber = 1 + 0.1 * Math.sin(a * 11 - twist * 1.55) + 0.06 * Math.sin(a * 17 + t * 28);
      return lobe * fiber;
    },
  );
}

function makeCompanion(seed, height, radius, phase) {
  const rings = 48;
  const pts = [];
  const rads = [];
  const strandR = radius * (0.34 + ((seed * 3.3) % 1) * 0.16);
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const [cx, cz] = wander(t, seed);
    const n = noise3(t * 4.1 + seed, phase, t * 2.2);
    const ang = phase + t * 2.55 + Math.sin(t * 5.8 + seed * 2.4) * 1.15 + (n - 0.5) * 0.85;
    const dist = radius * (0.68 + Math.sin(t * 3.6 + seed * 1.8) * 0.52 + n * 0.32);
    pts.push({
      x: cx + Math.cos(ang) * dist,
      y: t * height + Math.sin(t * 7.4 + seed) * 0.16,
      z: cz + Math.sin(ang) * dist,
    });
    rads.push(strandR * (1.22 - t * 0.2) * (1 + 0.32 * Math.sin(t * 15 + seed)));
  }
  return pathTube(
    pts,
    rads,
    7,
    (t, a) => {
      const n = noise3(a + seed, t * 6, phase);
      return stalkShade(t, a, n);
    },
    (t, a) => 1 + 0.16 * Math.sin(a * 5 - t * 12),
  );
}

function makeHangHair(seed, height, radius, count) {
  const rng = mulberry32(((seed * 9973) | 0) + 19);
  const parts = [];
  for (let k = 0; k < count; k++) {
    const t = 0.04 + (k / count) * 0.92 + rng() * 0.01;
    const [cx, cz] = wander(t, seed);
    const a = rng() * Math.PI * 2;
    const attach = radius * (1.04 + rng() * 0.28);
    const ox = cx + Math.cos(a) * attach;
    const oz = cz + Math.sin(a) * attach;
    const oy = t * height;
    const nearCrown = t > 0.36;
    const len = (nearCrown ? 1.05 : 0.55) + rng() * (nearCrown ? 2.4 : 1.7);
    const out = 0.22 + rng() * 0.72;
    const curl = (rng() - 0.5) * 0.85;
    const rings = 6;
    const pts = [];
    const rads = [];
    for (let j = 0; j <= rings; j++) {
      const u = j / rings;
      const drop = u * len + u * u * (0.4 + rng() * 0.4);
      const spread = Math.sin(u * 1.28) * out;
      const spin = a + curl * u * u;
      pts.push({
        x: ox + Math.cos(spin) * spread,
        y: oy - drop,
        z: oz + Math.sin(spin) * spread,
      });
      rads.push((0.03 + rng() * 0.024) * (1 - u * 0.74));
    }
    parts.push(
      pathTube(pts, rads, 3, (u) => {
        const m = 0.48 + u * 0.14;
        return [m * 0.04, m * 0.062, m * 0.018];
      }),
    );
  }
  return mergeGeos(parts);
}

function makeHoldfast(seed, radius) {
  const rng = mulberry32(((seed * 4243) | 0) + 5);
  const parts = [];
  const bulb = new THREE.SphereGeometry(radius * 1.15, 12, 8);
  const bp = bulb.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < bp.count; i++) {
    v.fromBufferAttribute(bp, i);
    const n = noise3(v.x * 2.4 + seed, v.y * 2.6, v.z * 2.4);
    v.x *= 1.25 + n * 0.3;
    v.z *= 1.18 + n * 0.24;
    v.y = (v.y + 0.12) * (0.38 + n * 0.16);
    if (v.y < 0.015) v.y *= 0.25;
    bp.setXYZ(i, v.x, v.y, v.z);
  }
  const bcol = new Float32Array(bp.count * 3);
  for (let i = 0; i < bp.count; i++) {
    bcol[i * 3] = 0.04;
    bcol[i * 3 + 1] = 0.058;
    bcol[i * 3 + 2] = 0.02;
  }
  bulb.setAttribute("color", new THREE.Float32BufferAttribute(bcol, 3));
  parts.push(bulb);
  for (let r = 0; r < 6; r++) {
    const a = seed * 1.8 + r * 1.047;
    const len = 0.85 + rng() * 0.55;
    const pts = [];
    const rads = [];
    for (let j = 0; j <= 5; j++) {
      const u = j / 5;
      pts.push({
        x: Math.cos(a) * (0.28 + u * u * 0.85),
        y: 0.04 + u * 0.02 - u * u * 0.12,
        z: Math.sin(a) * (0.28 + u * u * 0.85),
      });
      rads.push(0.14 * (1 - u * 0.72) * radius);
    }
    parts.push(pathTube(pts, rads, 5, () => [0.038, 0.055, 0.018]));
  }
  return mergeGeos(parts);
}

function makeHeroStalk(seed, height, radius) {
  return mergeGeos([
    makeMainRope(seed, height, radius),
    makeCompanion(seed + 1.61, height, radius, seed * 1.7),
    makeCompanion(seed + 3.27, height, radius, seed * 1.7 + 2.3),
    makeCompanion(seed + 5.04, height, radius * 0.92, seed * 1.7 + 4.1),
    makeHangHair(seed, height, radius, 110),
    makeHangHair(seed + 2.2, height, radius * 1.12, 64),
    makeHangHair(seed + 4.1, height, radius * 1.28, 40),
    makeHoldfast(seed, radius),
  ]);
}

// Soft hanging wet-cloth strap. Wide mid, hangs nearly straight, gold only at the tip.
function pushDrapeStrip(pos, col, idx, seed, ox, oy, oz, yaw) {
  const len = 1.8 + ((seed * 3.7) % 1) * 1.0;
  const midW = 0.28 + ((seed * 2.4) % 1) * 0.17;
  const rings = 30;
  const cols = 8;
  const sag = 0.05 + ((seed * 1.9) % 1) * 0.07;
  const bow = 0.045 + ((seed * 2.8) % 1) * 0.055;
  const twist = ((seed * 5.3) % 1 - 0.5) * 0.16;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const base = pos.length / 3;
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    const n = noise3(seed, t * 2.2, 0.7);
    const n2 = noise3(seed * 1.4, t * 3.6, 2.1);
    const drop = t * len + t * t * sag * len;
    const out = Math.sin(t * Math.PI * 0.55) * bow + Math.sin(t * 1.9 + seed) * 0.018 * t;
    const side = Math.sin(t * 1.28 + seed * 1.9) * 0.024 * t;
    const spin = twist * t * t;
    const lx = side + Math.sin(spin) * out * 0.2;
    const ly = -drop;
    const lz = out + (n2 - 0.5) * 0.014;
    const flare = Math.sin(Math.min(1, t / 0.94) * Math.PI);
    const root = 0.38 + 0.62 * Math.min(1, t / 0.1);
    const tipKeep = 1 - Math.pow(Math.max(0, (t - 0.8) / 0.2), 1.4) * 0.86;
    const w = midW * (0.46 + 0.54 * flare) * tipKeep * (t < 0.1 ? root : 1) * (1 + (n - 0.5) * 0.04);
    for (let i = 0; i <= cols; i++) {
      const u = (i / cols) * 2 - 1;
      const margin =
        1 +
        0.04 * Math.sin(t * 7.8 + seed * 2.1 + u * 2.1) +
        0.018 * Math.sin(t * 13.6 + seed * 3.4) +
        (n - 0.5) * 0.025;
      const wrinkle = Math.sin(t * 8.8 + u * 3.6 + seed) * 0.01 * t;
      const cup = (1 - u * u) * (0.014 + t * 0.02);
      const px = lx + u * w * margin;
      const py = ly;
      const pz = lz + wrinkle - cup;
      pos.push(ox + px * cy - pz * sy, oy + py, oz + px * sy + pz * cy);
      const tip = Math.pow(Math.max(0, (t - 0.88) / 0.12), 2.4);
      const olive = 0.8 + n * 0.1;
      col.push(0.125 * olive + tip * 0.5, 0.25 * olive + tip * 0.1, 0.042 * olive + tip * 0.006);
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

// One hanging cloth blade, doubled as a wet fold — not a kite or tape fringe.
function makeFrond(seed) {
  const pos = [];
  const col = [];
  const idx = [];
  for (let s = 0; s < 2; s++) {
    const yaw = (s - 0.5) * 0.06 + ((seed * 1.37 + s) % 1 - 0.5) * 0.03;
    const ox = (s - 0.5) * 0.028;
    const oy = s * 0.025;
    const oz = ((seed * 1.8 + s) % 1 - 0.5) * 0.016;
    pushDrapeStrip(pos, col, idx, seed + s * 0.37, ox, oy, oz, yaw);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function makeGrapeOrb(seed) {
  const geo = new THREE.SphereGeometry(1, 8, 6);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    const ns = noise3(p.x * 4.1 + seed, p.y * 3.8, p.z * 4.1);
    const ns2 = noise3(p.x * 8.2 + seed, p.y * 7.4, p.z * 8.2);
    const dimple = ns2 > 0.78 ? (ns2 - 0.78) * 0.28 : 0;
    p.x *= 0.86 + ns * 0.1 - dimple;
    p.z *= 0.86 + ns * 0.1 - dimple;
    p.y *= 1.02 + ns * 0.07 - dimple * 0.18;
    pos.setXYZ(i, p.x, p.y, p.z);
    const hot = Math.max(0, 0.55 - Math.abs(p.y));
    col[i * 3] = 1.18 + ns * 0.1 + hot * 0.2;
    col[i * 3 + 1] = 0.38 + ns * 0.08 + hot * 0.08;
    col[i * 3 + 2] = 0.035 + ns * 0.015;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeHaloTex() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, "rgba(255, 196, 64, 0.85)");
  g.addColorStop(0.18, "rgba(255, 132, 18, 0.38)");
  g.addColorStop(0.42, "rgba(255, 86, 4, 0.08)");
  g.addColorStop(1, "rgba(255, 40, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeMurkFish() {
  const body = new THREE.SphereGeometry(0.13, 8, 6);
  body.scale(1.85, 0.58, 0.42);
  const bc = new Float32Array(body.attributes.position.count * 3);
  for (let i = 0; i < bc.length; i += 3) {
    bc[i] = 0.1;
    bc[i + 1] = 0.16;
    bc[i + 2] = 0.07;
  }
  body.setAttribute("color", new THREE.Float32BufferAttribute(bc, 3));
  const tail = new THREE.PlaneGeometry(0.16, 0.1);
  tail.rotateY(Math.PI * 0.5);
  tail.translate(-0.22, 0, 0);
  const tc = new Float32Array(tail.attributes.position.count * 3);
  for (let i = 0; i < tc.length; i += 3) {
    tc[i] = 0.08;
    tc[i + 1] = 0.13;
    tc[i + 2] = 0.05;
  }
  tail.setAttribute("color", new THREE.Float32BufferAttribute(tc, 3));
  return mergeGeos([body, tail]);
}

function grapeLocals(n, seed) {
  const rng = mulberry32(((seed * 6151) | 0) + 3);
  const layers = [
    { y: 0.03, ring: 0.07, w: Math.max(3, Math.round(n * 0.16)) },
    { y: -0.12, ring: 0.14, w: Math.max(5, Math.round(n * 0.28)) },
    { y: -0.26, ring: 0.125, w: Math.max(5, Math.round(n * 0.26)) },
    { y: -0.38, ring: 0.075, w: Math.max(3, Math.round(n * 0.18)) },
    { y: -0.46, ring: 0.0, w: 1 },
  ];
  let left = n;
  const out = [];
  for (let li = 0; li < layers.length; li++) {
    const take = li === layers.length - 1 ? left : Math.min(layers[li].w, left);
    for (let i = 0; i < take; i++) {
      const a = (i / Math.max(take, 1)) * Math.PI * 2 + seed * 0.8 + layers[li].y * 1.6;
      const jx = (rng() - 0.5) * 0.018;
      const jz = (rng() - 0.5) * 0.016;
      out.push({
        x: Math.cos(a) * layers[li].ring + jx,
        y: layers[li].y + (rng() - 0.5) * 0.016,
        z: Math.sin(a) * layers[li].ring * 0.68 + jz,
        s: 0.062 + rng() * 0.03,
        rx: rng() * 1.2,
        ry: rng() * 6.28,
        rz: rng() * 1.2,
      });
    }
    left -= take;
    if (left <= 0) break;
  }
  return out;
}

export function createKelpExtras(scene, shared) {
  const group = new THREE.Group();
  group.name = "kelp-extras";

  const stalkMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.96,
    vertexColors: true,
    side: THREE.FrontSide,
  });
  patchUnderwater(stalkMat, shared, { caustics: false });

  const leafMat = createKelpMaterial(shared, 0xffffff, 0x000000, 0, "leaf");
  leafMat.vertexColors = true;
  leafMat.roughness = 0.78;
  leafMat.side = THREE.DoubleSide;

  const grapeMat = createKelpMaterial(shared, 0xffffff, 0xff9418, 3.6);
  grapeMat.vertexColors = true;
  grapeMat.roughness = 0.26;

  const fishMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.55,
    vertexColors: true,
  });
  patchUnderwater(fishMat, shared, { caustics: false });

  const haloMat = new THREE.SpriteMaterial({
    map: makeHaloTex(),
    color: 0xff9618,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    opacity: 0.72,
    fog: true,
  });

  const ribbonGeos = [
    makeFrond(0.71),
    makeFrond(1.84),
    makeFrond(2.96),
    makeFrond(4.18),
    makeFrond(5.62),
    makeFrond(6.9),
    makeFrond(8.15),
    makeFrond(9.44),
  ];
  const grapeGeo = makeGrapeOrb(1.4);

  const vineSpecs = [
    { x: 175.4, z: 7.6, r: 0.94, grapes: 28, blades: 26, grapeY: -26.4, lean: 0.05, yaw: 0.62, phase: 0.15, lit: true },
    { x: 179.2, z: 10.6, r: 0.98, grapes: 26, blades: 28, grapeY: -25.8, lean: -0.04, yaw: 1.88, phase: 1.05, lit: true },
    { x: 176.8, z: -3.4, r: 0.9, grapes: 30, blades: 24, grapeY: -24.6, lean: 0.08, yaw: 0.42, phase: 0.3, lit: true },
    { x: 183.2, z: 0.4, r: 0.82, grapes: 28, blades: 22, grapeY: -25.2, lean: 0.1, yaw: 1.35, phase: 1.7, lit: true },
    { x: 195.6, z: -2.2, r: 0.86, grapes: 28, blades: 22, grapeY: -23.8, lean: -0.08, yaw: 5.15, phase: 2.8, lit: true },
    { x: 187.6, z: -5.4, r: 0.78, grapes: 26, blades: 20, grapeY: -24.2, lean: -0.06, yaw: 2.2, phase: 4.1, lit: true },
    { x: 192.4, z: -8.2, r: 0.74, grapes: 24, blades: 20, grapeY: -25.6, lean: 0.1, yaw: 3.85, phase: 5.4, lit: false },
  ];

  const dummy = new THREE.Object3D();
  const vines = [];
  const bladeRecs = [];
  const grapeRecs = [];
  let bladeMax = 0;
  let grapeMax = 0;

  for (const spec of vineSpecs) {
    bladeMax += spec.blades;
    grapeMax += spec.grapes;
  }

  const leafMeshes = ribbonGeos.map((g) => {
    const m = new THREE.InstancedMesh(g, leafMat, bladeMax);
    m.castShadow = true;
    m.count = 0;
    m.frustumCulled = false;
    return m;
  });
  const leafN = ribbonGeos.map(() => 0);
  const grapes = new THREE.InstancedMesh(grapeGeo, grapeMat, grapeMax);
  grapes.castShadow = true;
  grapes.count = 0;
  grapes.frustumCulled = false;

  for (const spec of vineSpecs) {
    const y0 = plantY(spec.x, spec.z, 0);
    const height = Math.max(50, -7.5 - y0);
    const vine = new THREE.Group();
    vine.position.set(spec.x, y0, spec.z);
    vine.rotation.set(spec.lean * 0.35, 0, spec.lean * 0.55);
    vine.userData.phase = spec.phase;
    vine.userData.lean = spec.lean;

    const stalk = new THREE.Mesh(makeHeroStalk(spec.x * 0.17 + spec.z * 0.11, height, spec.r), stalkMat);
    stalk.rotation.y = spec.yaw;
    stalk.castShadow = true;
    vine.add(stalk);

    const face = Math.atan2(CAM.x - spec.x, CAM.z - spec.z);
    const distCam0 = Math.hypot(CAM.x - spec.x, CAM.z - spec.z);
    const close = distCam0 < 12;
    const toward = (close ? 1.7 : 2.45) + spec.r * 0.18;
    const gy = spec.grapeY - y0;
    const gx = Math.sin(face) * toward;
    const gz = Math.cos(face) * toward;

    const grapeS = (spec.lit ? 1.02 : 0.94) * (close ? 0.82 : distCam0 < 20 ? 0.92 : 1);
    const bunch = grapeLocals(spec.grapes, spec.x + spec.z);
    for (const g of bunch) {
      grapeRecs.push({
        vine,
        lx: gx + g.x,
        ly: gy + g.y,
        lz: gz + g.z,
        s: g.s * grapeS,
        rx: g.rx,
        ry: g.ry,
        rz: g.rz,
      });
    }

    if (spec.lit) {
      const lamp = new THREE.PointLight(0xff9a1c, close ? 10.5 : 14.5, close ? 18 : 24, 1.15);
      lamp.position.set(gx, gy - 0.18, gz);
      vine.add(lamp);
      const halo = new THREE.Sprite(haloMat);
      halo.position.set(gx, gy - 0.1, gz);
      halo.scale.set(close ? 1.35 : 1.6, close ? 1.35 : 1.6, 1);
      halo.renderOrder = 3;
      vine.add(halo);
    }

    const rng = mulberry32(((spec.x * 80 + spec.z * 40) | 0) + 11);
    // Olive mop hangs behind the lantern as overlapping tissue, not a fringe.
    const mopBack = close ? 0.48 : 0.78;
    const fan = close ? 2.1 : 1.5;
    const shove = spec.z > 9 ? 0.72 : spec.z > 6 ? 0.18 : 0;
    const camRX = 0.737;
    const camRZ = 0.676;
    for (let k = 0; k < spec.blades; k++) {
      const u = spec.blades === 1 ? 0.5 : k / (spec.blades - 1);
      const ring = k % 4;
      const a = face + Math.PI + (u - 0.5) * fan + (rng() - 0.5) * 0.14;
      const rad = 0.08 + ring * (close ? 0.2 : 0.13) + rng() * 0.1 + Math.abs(u - 0.5) * (close ? 0.48 : 0.16);
      const vi = (k + (spec.x | 0)) % ribbonGeos.length;
      bladeRecs.push({
        vine,
        vi,
        lx: gx - Math.sin(face) * mopBack + Math.sin(a) * rad + shove * camRX,
        ly: gy + 1.05 + rng() * 1.05 + (ring % 2) * 0.16 - Math.abs(u - 0.5) * 0.1,
        lz: gz - Math.cos(face) * mopBack + Math.cos(a) * rad + shove * camRZ,
        rx: (rng() - 0.5) * 0.045,
        ry: a + (rng() - 0.5) * 0.5,
        rz: (rng() - 0.5) * 0.04,
        sx: 1,
        sy: 1,
        sz: 1,
      });
    }

    group.add(vine);
    vines.push(vine);
  }

  function stampLocal(rec, sx, sy, sz) {
    dummy.position.set(rec.lx, rec.ly, rec.lz);
    dummy.rotation.set(rec.rx, rec.ry, rec.rz);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    dummy.matrix.premultiply(rec.vine.matrixWorld);
  }

  group.updateMatrixWorld(true);
  for (const rec of bladeRecs) {
    const vi = rec.vi;
    if (leafN[vi] >= bladeMax) continue;
    stampLocal(rec, rec.sx, rec.sy, rec.sz);
    leafMeshes[vi].setMatrixAt(leafN[vi]++, dummy.matrix);
  }
  for (const rec of grapeRecs) {
    stampLocal(rec, rec.s, rec.s, rec.s);
    grapes.setMatrixAt(grapes.count++, dummy.matrix);
  }
  for (let i = 0; i < leafMeshes.length; i++) {
    leafMeshes[i].count = leafN[i];
    leafMeshes[i].instanceMatrix.needsUpdate = true;
    group.add(leafMeshes[i]);
  }
  grapes.instanceMatrix.needsUpdate = true;
  group.add(grapes);

  const FISH_N = 16;
  const fishMesh = new THREE.InstancedMesh(makeMurkFish(), fishMat, FISH_N);
  const fishData = [];
  const frng = mulberry32(4401);
  for (let i = 0; i < FISH_N; i++) {
    fishData.push({
      x: 176 + frng() * 22,
      y: -50 + frng() * 16,
      z: -8 + frng() * 16,
      ax: 1.4 + frng() * 2.2,
      az: 1.1 + frng() * 1.8,
      spd: 0.18 + frng() * 0.22,
      ph: frng() * 6.28,
      s: 0.55 + frng() * 0.7,
    });
  }
  group.add(fishMesh);

  function placeFish(time) {
    for (let i = 0; i < FISH_N; i++) {
      const f = fishData[i];
      const px = f.x + Math.sin(time * f.spd + f.ph) * f.ax;
      const pz = f.z + Math.cos(time * f.spd * 0.82 + f.ph) * f.az;
      const py = f.y + Math.sin(time * f.spd * 0.45 + f.ph) * 0.45;
      dummy.position.set(px, py, pz);
      dummy.rotation.set(
        0,
        Math.atan2(Math.cos(time * f.spd + f.ph) * f.ax, -Math.sin(time * f.spd * 0.82 + f.ph) * f.az),
        0,
      );
      dummy.scale.setScalar(f.s);
      dummy.updateMatrix();
      fishMesh.setMatrixAt(i, dummy.matrix);
    }
    fishMesh.instanceMatrix.needsUpdate = true;
  }
  placeFish(0);

  group.userData.update = (t) => {
    for (const vine of vines) {
      const leanZ = Math.sin(t * 0.23 + vine.userData.phase) * 0.02;
      const leanX = Math.cos(t * 0.19 + vine.userData.phase * 1.35) * 0.013;
      vine.rotation.x = vine.userData.lean * 0.35 + leanX;
      vine.rotation.z = vine.userData.lean * 0.55 + leanZ;
    }
    group.updateMatrixWorld(true);

    const ln = ribbonGeos.map(() => 0);
    for (const rec of bladeRecs) {
      stampLocal(rec, rec.sx, rec.sy, rec.sz);
      leafMeshes[rec.vi].setMatrixAt(ln[rec.vi]++, dummy.matrix);
    }
    for (const m of leafMeshes) m.instanceMatrix.needsUpdate = true;

    let gi = 0;
    for (const rec of grapeRecs) {
      stampLocal(rec, rec.s, rec.s, rec.s);
      grapes.setMatrixAt(gi++, dummy.matrix);
    }
    grapes.instanceMatrix.needsUpdate = true;
    placeFish(t);
  };

  scene.add(group);
  return group;
}
