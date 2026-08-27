import * as THREE from "three";
import { hash2, mulberry32, noise2, noise3 } from "../math.js";
import { patchUnderwater } from "../shaders.js";
import { mergeGeos, plantY, srgb } from "./util.js";

const CAM = { x: -176, z: 8 };

function worley3(x, y, z) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  let best = 8;
  let second = 8;
  let bx = ix;
  let bz = iz;
  for (let kz = -1; kz <= 1; kz++) {
    for (let ky = -1; ky <= 1; ky++) {
      for (let kx = -1; kx <= 1; kx++) {
        const cx = ix + kx;
        const cy = iy + ky;
        const cz = iz + kz;
        const ox = hash2(cx, cy * 13.1 + cz);
        const oy = hash2(cy + 19.7, cz * 7.3 + cx);
        const oz = hash2(cz + 3.1, cx * 11.9 + cy);
        const dx = cx + ox - x;
        const dy = cy + oy - y;
        const dz = cz + oz - z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) {
          second = best;
          best = d;
          bx = cx;
          bz = cz;
        } else if (d < second) {
          second = d;
        }
      }
    }
  }
  return { f1: Math.sqrt(best), f2: Math.sqrt(second), id: bx * 13.7 + bz * 5.3 };
}

function camAlong(x, z) {
  return (x - CAM.x) * -0.879 + (z - CAM.z) * -0.476;
}

function camAcross(x, z) {
  return (x - CAM.x) * 0.476 + (z - CAM.z) * -0.879;
}

function fromCam(along, across) {
  return {
    x: CAM.x + along * -0.879 + across * 0.476,
    z: CAM.z + along * -0.476 + across * -0.879,
  };
}

function worley2(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let best = 8;
  let second = 8;
  let bx = ix;
  let bz = iz;
  for (let kz = -1; kz <= 1; kz++) {
    for (let kx = -1; kx <= 1; kx++) {
      const cx = ix + kx;
      const cz = iz + kz;
      const ox = hash2(cx, cz * 13.1);
      const oz = hash2(cz + 3.1, cx * 11.9);
      const dx = cx + ox - x;
      const dz = cz + oz - z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        second = best;
        best = d;
        bx = cx;
        bz = cz;
      } else if (d < second) {
        second = d;
      }
    }
  }
  return { f1: Math.sqrt(best), f2: Math.sqrt(second), id: bx * 13.7 + bz * 5.3 };
}

const RISES = [
  { a: 7.4, c: -11.0, ra: 17.8, rc: 15.6, h: 3.45, p: 1.92 },
  { a: 16.2, c: -20.8, ra: 9.8, rc: 8.6, h: 2.05, p: 1.78 },
  { a: 4.2, c: -5.4, ra: 8.8, rc: 7.6, h: 1.35, p: 1.88 },
  { a: 20.4, c: -10.2, ra: 8.2, rc: 7.2, h: 1.45, p: 1.8 },
  { a: 36.2, c: 8.2, ra: 16.4, rc: 15.0, h: 2.15, p: 1.72 },
  { a: 44.0, c: 16.0, ra: 10.6, rc: 9.8, h: 1.35, p: 1.65 },
  { a: 32.0, c: 2.6, ra: 9.2, rc: 8.4, h: 1.15, p: 1.7 },
  { a: 57.4, c: 9.6, ra: 12.2, rc: 11.0, h: 2.8, p: 1.5 },
  { a: 65.6, c: 20.2, ra: 13.8, rc: 12.0, h: 3.1, p: 1.48 },
  { a: 51.6, c: -14.8, ra: 10.4, rc: 9.2, h: 2.2, p: 1.52 },
];

const DOMES = [
  { along: 34.2, across: 6.0, r: 8.8, h: 2.15, seed: 3.9 },
  { along: 42.8, across: 13.4, r: 10.6, h: 2.45, seed: 7.1 },
  { along: 39.4, across: 20.4, r: 5.2, h: 1.45, seed: 5.9 },
];

const BOWLS = [
  { along: 6.6, across: -11.4, r: 3.2, d: 0.62 },
  { along: 11.4, across: -16.6, r: 2.5, d: 0.48 },
  { along: 4.4, across: -17.2, r: 2.05, d: 0.4 },
  { along: 16.8, across: -9.4, r: 1.9, d: 0.34 },
  { along: 34.4, across: 8.4, r: 2.2, d: 0.42 },
  { along: 41.6, across: 11.0, r: 2.5, d: 0.46 },
];

function riseAt(along, across, r) {
  const da = (along - r.a) / r.ra;
  const dc = (across - r.c) / r.rc;
  const d2 = da * da + dc * dc;
  if (d2 >= 1) return 0;
  return Math.pow(Math.sqrt(1 - d2), r.p) * r.h;
}

function bowlCut(along, across) {
  let d = 0;
  for (let i = 0; i < BOWLS.length; i++) {
    const b = BOWLS[i];
    const da = along - b.along;
    const dc = across - b.across;
    const d2 = da * da + dc * dc;
    const rr = b.r * b.r;
    if (d2 < rr) {
      const t = 1 - d2 / rr;
      d = Math.max(d, t * t * b.d);
    }
  }
  return d;
}

function domeLift(along, across) {
  let y = 0;
  for (let i = 0; i < DOMES.length; i++) {
    const d = DOMES[i];
    const da = (along - d.along) / d.r;
    const dc = (across - d.across) / d.r;
    const d2 = da * da + dc * dc;
    if (d2 < 1) y = Math.max(y, Math.sqrt(1 - d2) * d.h);
  }
  return y;
}

function reefPlateauY(along, across) {
  let y = -77.8 - along * 0.23;
  for (let i = 0; i < RISES.length; i++) y += riseAt(along, across, RISES[i]);
  y += Math.min(20, Math.max(0, -across - 0.4)) * 0.1;
  y -= Math.max(0, across - 20) * 0.42;
  y -= smooth01(44, 86, along) * 24;
  y -= bowlCut(along, across);
  const p = fromCam(along, across);
  y += (noise2(p.x * 0.026, p.z * 0.024) - 0.5) * 0.38;
  return y;
}

function reefHillY(x, z) {
  const al = camAlong(x, z);
  const ac = camAcross(x, z);
  return reefPlateauY(al, ac) + domeLift(al, ac) + 0.12;
}

function smooth01(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

function warpPoint(x, y, z, seed, amt) {
  const wx = x + (noise3(x * 0.17 + seed, y * 0.14, z * 0.16) - 0.5) * amt;
  const wy = y + (noise3(x * 0.15, y * 0.2 + seed, z * 0.14) - 0.5) * amt * 0.72;
  const wz = z + (noise3(x * 0.16, y * 0.13, z * 0.18 + seed) - 0.5) * amt;
  return [wx, wy, wz];
}

function moundRGB(wx, wy, wz, plaque, vein, pore, cell, along) {
  const grain = noise3(wx * 1.7, wy * 1.3, wz * 1.62);
  const blot = noise3(wx * 0.055 + 1.4, wy * 0.038, wz * 0.052);
  const stain = noise3(wx * 0.2 + 6.2, wy * 0.12, wz * 0.19);
  const field = blot * 0.58 + stain * 0.42;
  let r = 0.33 + blot * 0.1 + stain * 0.04;
  let g = 0.4 + blot * 0.08 + stain * 0.03;
  let b = 0.2 + blot * 0.03;
  const cream = (1 - vein) * smooth01(0.28, 0.54, field) * (0.7 + plaque * 0.3);
  const warm = hash2(cell, 2.2);
  r = r * (1 - cream) + (0.8 + grain * 0.05 + warm * 0.07 + stain * 0.03) * cream;
  g = g * (1 - cream) + (0.7 + grain * 0.04 + warm * 0.03) * cream;
  b = b * (1 - cream) + (0.36 + grain * 0.03) * cream;
  const moss = (1 - vein) * (1 - cream * 0.45) * smooth01(0.32, 0.7, 1 - field);
  r = r * (1 - moss) + (0.16 + grain * 0.04) * moss;
  g = g * (1 - moss) + (0.52 + grain * 0.06) * moss;
  b = b * (1 - moss) + (0.28 + grain * 0.04) * moss;
  const teal = (1 - vein) * (1 - cream) * smooth01(0.56, 0.8, stain);
  r = r * (1 - teal) + 0.12 * teal;
  g = g * (1 - teal) + 0.42 * teal;
  b = b * (1 - teal) + 0.34 * teal;
  r = r * (1 - vein) + 0.07 * vein;
  g = g * (1 - vein) + 0.055 * vein;
  b = b * (1 - vein) + 0.032 * vein;
  r = r * (1 - pore) + 0.015 * pore;
  g = g * (1 - pore) + 0.02 * pore;
  b = b * (1 - pore) + 0.014 * pore;
  const shade = 0.84 + grain * 0.1 + cream * 0.07 - vein * 0.18 - pore * 0.2;
  r = Math.max(0.014, r * shade);
  g = Math.max(0.018, g * shade);
  b = Math.max(0.012, b * shade);
  const fade = smooth01(34, 84, along);
  r = r * (1 - fade) + 0.026 * fade;
  g = g * (1 - fade) + 0.08 * fade;
  b = b * (1 - fade) + 0.185 * fade;
  return [r, g, b];
}

function sampleCrust(wx, wy, wz, seed, close) {
  const [qx, qy, qz] = warpPoint(wx, wy, wz, seed, 1.85);
  const [qx2, , qz2] = warpPoint(qx, qy, qz, seed + 2.4, 0.85);
  const wBig = worley2(qx2 * 0.2 + seed, qz2 * 0.2);
  const wMid = worley2(qx * 0.42 + 2.6, qz * 0.42);
  const wFine = worley3(qx * 1.05 + 5.1, qy * 0.9, qz * 1.0);
  const bigEdge = wBig.f2 - wBig.f1;
  const midEdge = wMid.f2 - wMid.f1;
  const ridgeA = Math.abs(noise3(qx * 0.2 + seed, qy * 0.14, qz * 0.19) - 0.5);
  const ridgeB = Math.abs(noise3(qx * 0.38 + 3.1, qy * 0.3, qz * 0.36) - 0.48);
  const ridgeC = Math.abs(noise3(qx * 0.7 + 1.2, qy * 0.55, qz * 0.66) - 0.5);
  const crack = 1 - smooth01(0.014, 0.055, Math.min(ridgeA * 2.0, ridgeB * 2.15));
  const fineCrack = close ? 1 - smooth01(0.01, 0.032, ridgeC * 2.25) : 0;
  const bigVein = 1 - smooth01(0.016, 0.072, bigEdge);
  const midVein = 1 - smooth01(0.012, 0.05, midEdge);
  const vein = Math.min(1, Math.max(crack * 0.28, fineCrack * 0.22, bigVein * 0.18 + midVein * 0.1));
  const rim = smooth01(0.06, 0.11, bigEdge) * (1 - smooth01(0.125, 0.19, bigEdge));
  const plaque = Math.max(smooth01(0.07, 0.2, bigEdge), smooth01(0.045, 0.12, midEdge) * 0.45) * (1 - vein * 0.82);
  const cell = hash2(wBig.id, seed + 1.7);
  const cellMid = hash2(wMid.id, seed + 4.2);
  const n3 = noise3(wx * 1.85 + seed, wy * 1.6, wz * 1.75);
  let pore = 0;
  if (n3 > 0.78 && plaque > 0.16) pore = smooth01(0.78, 0.94, n3);
  if (wFine.f1 < 0.062 && cellMid > 0.64) pore = Math.max(pore, (0.062 - wFine.f1) / 0.062);
  return { plaque, vein, pore, cell, rim };
}

function crustDisp(c, close) {
  const k = close ? 0.34 : 0.2;
  return c.rim * 0.06 * k - c.vein * 0.05 * k - c.pore * 0.05 * k;
}

function makeDome(spec) {
  const { along, across, r, h, seed } = spec;
  const origin = fromCam(along, across);
  const baseY = reefPlateauY(along, across);
  const geo = new THREE.SphereGeometry(1, 96, 52, 0, Math.PI * 2, 0, Math.PI * 0.5);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let px = pos.getX(i) * r;
    let py = pos.getY(i) * h;
    let pz = pos.getZ(i) * r;
    const n = noise3(px * 0.12 + seed, py * 0.14, pz * 0.12);
    px *= 0.98 + n * 0.04;
    pz *= 0.98 + n * 0.04;
    const wx = px + origin.x;
    const wy = py + baseY;
    const wz = pz + origin.z;
    const c = sampleCrust(wx, wy, wz, seed, false);
    const disp = crustDisp(c, false);
    const len = Math.hypot(px, Math.max(py, 0.08), pz) || 1;
    px += (px / len) * disp * 0.35;
    py += disp * 0.7;
    pz += (pz / len) * disp * 0.35;
    pos.setXYZ(i, px + origin.x, py + baseY, pz + origin.z);
    const rgb = moundRGB(px + origin.x, py + baseY, pz + origin.z, c.plaque, c.vein, c.pore, c.cell, along);
    col[i * 3] = rgb[0];
    col[i * 3 + 1] = rgb[1];
    col[i * 3 + 2] = rgb[2];
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeReefPlateau() {
  const nU = 228;
  const nV = 176;
  const pos = [];
  const col = [];
  const idx = [];
  for (let j = 0; j <= nV; j++) {
    for (let i = 0; i <= nU; i++) {
      const u = i / nU;
      const v = j / nV;
      const along = -0.6 + Math.pow(u, 1.28) * 78;
      const across = -34 + Math.pow(v, 0.88) * 64;
      const p = fromCam(along, across);
      let y = reefPlateauY(along, across);
      const close = along < 26;
      const c = sampleCrust(p.x, y, p.z, 2.1, close);
      y += crustDisp(c, close);
      const drop = smooth01(48, 86, along);
      if (drop > 0.2) {
        const step = Math.round(y / 5.6) * 5.6;
        y = y * (1 - drop * 0.28) + step * drop * 0.28;
      }
      const edge = Math.max(u, 1 - u, v, 1 - v);
      if (edge > 0.9) {
        const t = (edge - 0.9) / 0.1;
        y = y * (1 - t) + (plantY(p.x, p.z, 0) - 6) * t;
      }
      pos.push(p.x, y, p.z);
      const deep = smooth01(-98, -128, y);
      const rgb = moundRGB(p.x, y, p.z, c.plaque, c.vein, c.pore, c.cell, along);
      col.push(
        rgb[0] * (1 - deep) + 0.016 * deep,
        rgb[1] * (1 - deep) + 0.045 * deep,
        rgb[2] * (1 - deep) + 0.15 * deep,
      );
    }
  }
  const stride = nU + 1;
  for (let j = 0; j < nV; j++) {
    for (let i = 0; i < nU; i++) {
      const a = j * stride + i;
      idx.push(a, a + stride, a + 1, a + stride, a + stride + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function grooveField(nx, ny, nz, seed, style) {
  const theta = Math.atan2(nz, nx);
  const phi = Math.acos(Math.max(-1, Math.min(1, ny)));
  const n = noise3(nx * 1.7 + seed, ny * 1.55, nz * 1.7);
  const n2v = noise3(nx * 3.4 + 2.2, ny * 3.1 + seed, nz * 3.3);
  if (style === 1) {
    const warp = n * 1.5 + n2v * 0.55;
    const radial = Math.abs(Math.sin(theta * 9.0 + warp * 2.0 + phi * 0.8));
    const rings = Math.abs(Math.sin(phi * 10.2 + n * 1.8 + seed));
    const s = Math.min(radial, rings * 1.15);
    return Math.exp(-s * s * 11);
  }
  const u = theta * 9.4 + n * 2.2 + Math.sin(phi * 5.1 + seed) * 1.15;
  const v = phi * 11.2 + n2v * 1.7 + Math.sin(theta * 3.4 + seed * 0.7) * 0.95;
  const a = Math.abs(Math.sin(u));
  const b = Math.abs(Math.sin(v + Math.sin(u * 0.48) * 0.7));
  const s = Math.min(a, b * 1.04);
  return Math.exp(-s * s * 13);
}

function makeBrain(radius, seed, style) {
  const geo = new THREE.SphereGeometry(radius, 84, 58, 0, Math.PI * 2, 0, Math.PI * 0.66);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const along = Math.hypot(x, y, z) || 1;
    const nx = x / along;
    const ny = y / along;
    const nz = z / along;
    const n = noise3(nx * 2.1 + seed, ny * 1.9, nz * 2.1);
    const n2v = noise3(nx * 4.8, ny * 4.4 + seed, nz * 4.6);
    const n3 = noise3(nx * 9.0 + seed, ny * 8.2, nz * 8.6);
    const valley = grooveField(nx, ny, nz, seed, style);
    const ridge = 1 - valley;
    const cut = valley * radius * (style === 1 ? 0.14 : 0.15);
    x -= nx * cut;
    y -= ny * cut;
    z -= nz * cut;
    x += nx * ridge * radius * 0.035;
    y += ny * ridge * radius * 0.03;
    z += nz * ridge * radius * 0.035;
    y *= 0.86;
    if (style === 1 && ny > 0.55) {
      const crater = (ny - 0.55) / 0.45;
      y -= crater * crater * radius * 0.42;
      const sq = 1 - crater * 0.12;
      x *= sq;
      z *= sq;
    }
    if (n3 > 0.76) {
      const pore = (n3 - 0.76) * radius * 0.08;
      x -= nx * pore;
      y -= ny * pore;
      z -= nz * pore;
    }
    pos.setXYZ(i, x, y, z);
    let cr = 0.2 + n * 0.05 + ridge * 0.14;
    let cg = 0.58 + n * 0.08 + ridge * 0.18;
    let cb = 0.18 + n * 0.03 + ridge * 0.04;
    if (style === 1) {
      cr = 0.32 + n * 0.06 + ridge * 0.12;
      cg = 0.54 + n * 0.07 + ridge * 0.14;
      cb = 0.16 + n * 0.03 + ridge * 0.03;
    }
    const top = Math.max(0, (ny + 0.12) / 1.12);
    const seam = Math.min(1, valley * 1.55) * Math.pow(top, 0.35);
    cr = cr * (1 - seam) + (1.05 + n * 0.04) * seam;
    cg = cg * (1 - seam) + (0.14 + n * 0.04) * seam;
    cb = cb * (1 - seam) + (0.62 + n2v * 0.08) * seam;
    if (style === 1 && ny > 0.58) {
      const glow = Math.min(1, (ny - 0.58) * 2.0) * valley;
      cr = cr * (1 - glow) + 0.88 * glow;
      cg = cg * (1 - glow) + 0.16 * glow;
      cb = cb * (1 - glow) + 0.55 * glow;
    }
    col[i * 3] = cr;
    col[i * 3 + 1] = cg;
    col[i * 3 + 2] = cb;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeJellyProto() {
  const parts = [];
  const bell = new THREE.SphereGeometry(0.4, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  const bpos = bell.attributes.position;
  const bcol = new Float32Array(bpos.count * 3);
  for (let i = 0; i < bpos.count; i++) {
    bpos.setY(i, bpos.getY(i) * 0.68 + 0.05);
    const t = Math.max(0, bpos.getY(i));
    bcol[i * 3] = 0.98;
    bcol[i * 3 + 1] = 0.42 + t * 0.2;
    bcol[i * 3 + 2] = 0.68;
  }
  bell.setAttribute("color", new THREE.Float32BufferAttribute(bcol, 3));
  parts.push(bell);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    const tent = new THREE.ConeGeometry(0.026, 0.62, 4);
    const tcol = new Float32Array(tent.attributes.position.count * 3);
    for (let i = 0; i < tcol.length; i += 3) {
      tcol[i] = 0.92;
      tcol[i + 1] = 0.24;
      tcol[i + 2] = 0.54;
    }
    tent.setAttribute("color", new THREE.Float32BufferAttribute(tcol, 3));
    tent.translate(Math.cos(a) * 0.12, -0.4, Math.sin(a) * 0.12);
    parts.push(tent);
  }
  return mergeGeos(parts);
}

function makeGrazer() {
  const parts = [];
  const body = new THREE.SphereGeometry(1, 16, 12);
  body.scale(9.5, 3.6, 5.4);
  const head = new THREE.SphereGeometry(1, 10, 8);
  head.scale(3.2, 2.2, 2.6);
  head.translate(8.4, 0.2, 0);
  const finL = new THREE.SphereGeometry(1, 8, 6);
  finL.scale(3.4, 0.7, 2.2);
  finL.translate(-1.2, -0.4, 4.4);
  const finR = new THREE.SphereGeometry(1, 8, 6);
  finR.scale(3.4, 0.7, 2.2);
  finR.translate(-1.2, -0.4, -4.4);
  const hump = new THREE.SphereGeometry(1, 10, 8);
  hump.scale(5.2, 2.4, 3.6);
  hump.translate(-1.6, 1.6, 0);
  for (const g of [body, head, finL, finR, hump]) {
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = 0.06;
      col[i * 3 + 1] = 0.1;
      col[i * 3 + 2] = 0.14;
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    parts.push(g);
  }
  return mergeGeos(parts);
}

function mix3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function reaperBend(x) {
  const t = (x + 19.6) / 42.4;
  const y = Math.sin(t * Math.PI) * 1.05 - Math.sin(t * Math.PI * 2.1) * 0.58;
  const z = Math.sin(t * Math.PI * 0.88 + 0.32) * 1.85;
  const dip = t > 0.74 ? ((t - 0.74) / 0.26) ** 2 * 0.95 : 0;
  return { y: y - dip, z };
}

function applyReaperBend(geo) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const b = reaperBend(x);
    p.setXYZ(i, x, p.getY(i) + b.y, p.getZ(i) + b.z);
  }
  p.needsUpdate = true;
}

function bentPoint(x, y, z) {
  const b = reaperBend(x);
  return [x, y + b.y, z + b.z];
}

function reaperEnvelope(t) {
  if (t < 0.07) return 0.1 + (t / 0.07) * 0.48;
  if (t < 0.2) return 0.58 + ((t - 0.07) / 0.13) * 0.56;
  if (t < 0.44) return 1.14 + ((t - 0.2) / 0.24) * 0.5;
  if (t < 0.64) return 1.64 + Math.sin(((t - 0.44) / 0.2) * Math.PI) * 0.3;
  if (t < 0.78) return 1.78 - ((t - 0.64) / 0.14) * 0.42;
  return 1.36 - ((t - 0.78) / 0.22) * 0.18;
}

function reaperRing(t) {
  const u = t * 5.4;
  const f = u - Math.floor(u);
  const g = Math.min(f, 1 - f);
  return 0.93 + 0.07 * Math.pow(smooth01(0, 0.16, g), 0.75);
}

function paintReaperFlesh(geo, kind) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  const rust = [0.66, 0.22, 0.08];
  const rustDark = [0.3, 0.09, 0.035];
  const bellyC = [0.82, 0.66, 0.42];
  const scarC = [0.1, 0.03, 0.018];
  const woundC = [0.38, 0.05, 0.03];
  const gumC = [0.2, 0.04, 0.03];
  const boneC = [0.72, 0.58, 0.4];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = noise3(x * 0.3, y * 0.36, z * 0.32);
    const n2 = noise3(x * 0.78 + 2.4, y * 0.9, z * 0.74);
    const n3 = noise3(x * 2.0 + 5.1, y * 2.1, z * 1.9);
    const n4 = noise3(x * 3.8, y * 3.3 + 1.2, z * 3.5);
    const belly = smooth01(0.25, -2.05, y) * (1 - smooth01(14.8, 20.5, x) * 0.4);
    const dorsum = smooth01(-0.2, 1.9, y);
    const side = 1 - Math.max(belly, dorsum * 0.5);
    let rgb = mix3(rust, rustDark, side * (0.5 + n * 0.35));
    rgb = mix3(rgb, rust, dorsum * (0.32 + n2 * 0.2));
    rgb = mix3(rgb, bellyC, belly * (0.8 + n * 0.12));
    rgb = mix3(rgb, rustDark, smooth01(0.55, 0.84, n2) * (1 - belly * 0.65) * 0.58);
    const band = 0.5 + 0.5 * Math.sin(x * 1.55 + n * 1.2);
    rgb = mix3(rgb, rustDark, band * 0.22 * (1 - belly) * smooth01(-17, 12, x));
    const slash = Math.abs(noise3(x * 0.16 + z * 0.7, y * 0.65, z * 0.1 + 4.2) - 0.5);
    rgb = mix3(rgb, scarC, (1 - smooth01(0.01, 0.036, slash)) * smooth01(0.4, 0.68, n2) * 0.9);
    rgb = mix3(rgb, woundC, smooth01(0.78, 0.93, n3) * (1 - belly * 0.45) * 0.72);
    rgb = mix3(rgb, [0.68, 0.58, 0.42], smooth01(0.86, 0.96, n4) * dorsum * 0.8);
    const grain = 0.88 + n3 * 0.14 + n * 0.05;
    if (kind === "maw") rgb = mix3(gumC, [0.06, 0.015, 0.01], 0.55);
    if (kind === "tooth") rgb = mix3(boneC, [0.5, 0.38, 0.24], n * 0.45);
    if (kind === "inner") rgb = mix3([0.4, 0.08, 0.055], gumC, 0.5 + n * 0.28);
    if (kind === "gill") rgb = mix3([0.16, 0.04, 0.03], rustDark, 0.45 + n * 0.3);
    if (kind === "bone") rgb = mix3([0.48, 0.16, 0.07], rustDark, 0.35 + n2 * 0.4);
    col[i * 3] = Math.max(0.018, rgb[0] * grain);
    col[i * 3 + 1] = Math.max(0.012, rgb[1] * grain);
    col[i * 3 + 2] = Math.max(0.01, rgb[2] * grain);
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function makeReaperBody() {
  const LEN = 33.6;
  const geo = new THREE.CylinderGeometry(1, 1, LEN, 36, 72, false);
  geo.rotateZ(-Math.PI / 2);
  geo.translate(-2.6, 0, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const t = (x + 19.4) / LEN;
    const ang = Math.atan2(y, z);
    const env = reaperEnvelope(Math.max(0, Math.min(1, t)));
    const ring = reaperRing(Math.max(0, Math.min(1, t)));
    let hy = env * ring;
    let wz = hy * (0.72 + 0.12 * Math.sin(t * Math.PI));
    const lobe = 1 + 0.2 * Math.pow(Math.abs(Math.sin(ang * 2.0)), 1.35);
    const keel = y < 0 ? 1.16 : 1;
    const n = noise3(x * 0.2, y * 0.26, z * 0.2);
    const n2 = noise3(x * 0.9 + 3, y * 0.95, z * 0.85);
    const slash = Math.abs(noise3(x * 0.15 + z * 0.6, y * 0.55, z * 0.08) - 0.5);
    const scar = (1 - smooth01(0.01, 0.034, slash)) * 0.2;
    hy *= lobe * keel * (1 + (n - 0.5) * 0.08);
    wz *= (1 + (n - 0.5) * 0.07);
    const rr = Math.hypot(y, z) || 1;
    y = (y / rr) * hy;
    z = (z / rr) * wz;
    if (t > 0.56 && t < 0.8 && Math.abs(z) > hy * 0.38) {
      const gt = (t - 0.56) / 0.24;
      const slits = Math.abs(Math.sin(gt * Math.PI * 7.0));
      const cut = (1 - slits) * 0.28 * smooth01(0, 0.14, Math.abs(z) / Math.max(hy, 0.2) - 0.35);
      const rad = Math.hypot(y, z) || 1;
      y -= (y / rad) * cut;
      z -= (z / rad) * cut;
    }
    const rad = Math.hypot(y, z) || 1;
    const pore = n2 > 0.8 ? (n2 - 0.8) * 0.28 : 0;
    y -= (y / rad) * (scar + pore);
    z -= (z / rad) * (scar + pore);
    p.setXYZ(i, x, y, z);
  }
  return paintReaperFlesh(geo, "body");
}

function makeReaperMuscles() {
  const parts = [];
  for (let i = 1; i < 5; i++) {
    const t = (i + 0.35) / 5.4;
    const x = -19.4 + t * 33.6;
    const hy = reaperEnvelope(t) * reaperRing(t);
    for (const s of [-1, 1]) {
      const g = new THREE.SphereGeometry(1, 12, 10);
      g.scale(1.85, 0.42, 0.38);
      g.translate(x, 0.08, s * (hy * 0.78));
      parts.push(paintReaperFlesh(g, "body"));
    }
    const plate = new THREE.SphereGeometry(0.48, 10, 8);
    plate.scale(2.1, 0.22, 0.72);
    plate.translate(x, hy * 0.96, 0);
    parts.push(paintReaperFlesh(plate, "bone"));
  }
  return parts;
}

function makeReaperSkull() {
  const geo = new THREE.SphereGeometry(1, 52, 40);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const nx = x;
    const ny = y;
    const nz = z;
    x *= 3.35;
    y *= 2.35;
    z *= 1.95;
    if (nx > 0) {
      y += nx * 0.22;
      z *= 1 + nx * 0.06;
    }
    if (ny > 0.15 && nx > -0.25) {
      y += (ny - 0.15) * 0.85 * (0.5 + nx * 0.45);
      x -= (ny - 0.15) * 0.2;
    }
    const sock = Math.min(Math.hypot(nx - 0.08, ny - 0.12, nz - 0.62), Math.hypot(nx - 0.08, ny - 0.12, nz + 0.62));
    if (sock < 0.3) {
      const k = 1 - sock / 0.3;
      z += (nz > 0 ? -1 : 1) * k * k * 0.62;
      x -= k * 0.25;
      y -= k * 0.06;
    }
    if (nx > 0.18) {
      const m = (nx - 0.18) / 0.82;
      const hole = 1 - smooth01(0.35, 0.95, Math.hypot(ny * 1.05, nz * 1.15));
      x -= m * (0.4 + hole * 2.2);
      y *= 1 - hole * m * 0.28;
    }
    const plate = Math.abs(Math.sin(Math.atan2(nz, ny) * 4.2 + nx * 3.5));
    const groove = Math.exp(-plate * plate * 11) * 0.16;
    const n = noise3(nx * 2.3, ny * 2.5, nz * 2.3);
    x += nx * ((n - 0.5) * 0.18 - groove);
    y += ny * ((n - 0.5) * 0.14 - groove * 0.5);
    z += nz * ((n - 0.5) * 0.16 - groove);
    p.setXYZ(i, x + 16.35, y + 0.2, z);
  }
  return paintReaperFlesh(geo, "body");
}

function makeReaperBrow() {
  const g = new THREE.SphereGeometry(1, 16, 10);
  g.scale(1.55, 0.48, 1.85);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const n = noise3(p.getX(i), p.getY(i) * 2, p.getZ(i));
    p.setY(i, p.getY(i) + (n - 0.4) * 0.1);
    p.setX(i, p.getX(i) + Math.max(0, p.getX(i)) * 0.25);
  }
  g.translate(16.95, 1.82, 0);
  return paintReaperFlesh(g, "bone");
}

function makeReaperHinges() {
  const parts = [];
  const spots = [
    [16.85, 1.08, 1.12],
    [16.85, 1.08, -1.12],
    [16.85, -1.15, 1.12],
    [16.85, -1.15, -1.12],
  ];
  for (const [x, y, z] of spots) {
    const g = new THREE.SphereGeometry(0.72, 12, 10);
    g.scale(1.25, 0.95, 0.85);
    g.translate(x, y, z);
    parts.push(paintReaperFlesh(g, "bone"));
  }
  return parts;
}

function makeReaperMandible(index) {
  const upper = index < 2;
  const right = index % 2 === 0;
  const sy = upper ? 1 : -1;
  const sz = right ? 1 : -1;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1.15, sy * 0.12, sz * 0.28),
    new THREE.Vector3(2.35, -sy * 0.08, sz * 0.1),
    new THREE.Vector3(3.45, -sy * 0.42, sz * 0.02),
    new THREE.Vector3(4.25, -sy * 0.08, -sz * 0.06),
  ]);
  const g = new THREE.TubeGeometry(curve, 28, 0.28, 12, false);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const t = Math.max(0, Math.min(1, x / 4.3));
    const s = 1.18 - t * 0.48;
    const cy = curve.getPoint(t).y;
    const cz = curve.getPoint(t).z;
    p.setY(i, cy + (p.getY(i) - cy) * s * 0.55);
    p.setZ(i, cz + (p.getZ(i) - cz) * s * 1.55);
  }
  g.rotateY(sz * 0.08);
  g.rotateZ(sy * 0.06);
  g.translate(17.55, sy * 0.42, sz * 0.58);
  const knuckle = new THREE.SphereGeometry(0.48, 12, 10);
  knuckle.scale(1.25, 0.62, 0.95);
  knuckle.translate(17.55, sy * 0.42, sz * 0.58);
  return [paintReaperFlesh(g, "bone"), paintReaperFlesh(knuckle, "bone")];
}

function makeReaperFin(sign) {
  const g = new THREE.BoxGeometry(6.8, 0.28, 3.6, 16, 2, 10);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const u = (x + 3.4) / 6.8;
    const v = (z + 1.8) / 3.6;
    const env = Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
    z = (z + 1.8) * (0.2 + 0.8 * env) * (1 - v * 0.08) - 1.8;
    x -= v * v * 2.5;
    y *= 0.32 + 0.68 * (1 - v) * env;
    p.setXYZ(i, x, y, z);
  }
  g.rotateX(sign * 0.48);
  g.rotateY(sign * 0.22);
  g.rotateZ(-0.2);
  g.translate(8.6, -0.55, sign * 2.15);
  return paintReaperFlesh(g, "body");
}

function makeReaperPelvic(sign) {
  const g = new THREE.BoxGeometry(2.2, 0.16, 1.35, 8, 1, 5);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const u = (x + 1.1) / 2.2;
    const v = (z + 0.675) / 1.35;
    z = (z + 0.675) * Math.sin(Math.PI * Math.max(0.05, u)) * (1 - v * 0.1) - 0.675;
    x -= v * 0.65;
    y *= 0.4 + 0.6 * (1 - v);
    p.setXYZ(i, x, y, z);
  }
  g.rotateX(sign * 0.72);
  g.rotateZ(0.32);
  g.translate(-3.2, -0.8, sign * 1.05);
  return paintReaperFlesh(g, "body");
}

function makeReaperFluke() {
  const parts = [];
  for (const spec of [
    { h: 3.35, w: 2.55, y: 1.4, zRot: 0.2, x: -18.9 },
    { h: 2.45, w: 2.05, y: -1.1, zRot: Math.PI - 0.24, x: -18.65 },
  ]) {
    const g = new THREE.BoxGeometry(spec.w, spec.h, 0.2, 10, 12, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i);
      let y = p.getY(i);
      let z = p.getZ(i);
      const v = (y + spec.h * 0.5) / spec.h;
      const u = (x + spec.w * 0.5) / spec.w;
      y = (y + spec.h * 0.5) * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0.02, u))), 0.55) - spec.h * 0.5;
      x += v * v * 0.5;
      z *= 0.28 + 0.72 * (1 - v);
      p.setXYZ(i, x, y, z);
    }
    g.rotateZ(spec.zRot);
    g.translate(spec.x, spec.y, 0);
    parts.push(paintReaperFlesh(g, "body"));
  }
  return parts;
}

function makeReaperGills() {
  const parts = [];
  for (let i = 0; i < 7; i++) {
    const x = 6.4 + i * 0.82;
    const h = 1.95 - i * 0.1;
    for (const s of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.22, h, 0.55, 2, 8, 3);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const yy = p.getY(k);
        p.setZ(k, p.getZ(k) + Math.cos((yy / h) * Math.PI) * 0.18);
        p.setX(k, p.getX(k) + Math.sin((yy / h) * Math.PI) * 0.05);
      }
      g.translate(x, 0.08, s * (1.72 - i * 0.05));
      parts.push(paintReaperFlesh(g, "gill"));
    }
  }
  return parts;
}

function makeReaperMawCavity() {
  const parts = [];
  const throat = new THREE.CylinderGeometry(0.42, 1.05, 3.4, 16, 4, true);
  throat.rotateZ(Math.PI / 2);
  throat.translate(16.7, -0.08, 0);
  parts.push(paintReaperFlesh(throat, "maw"));
  const back = new THREE.CircleGeometry(0.44, 16);
  back.rotateY(Math.PI / 2);
  back.translate(15.05, -0.08, 0);
  parts.push(paintReaperFlesh(back, "maw"));
  return parts;
}

function makeReaperTeeth(upper) {
  const parts = [];
  // Cone tip is +Y. Lower row is as long as the upper and sits inside the maw.
  const n = 8;
  for (let i = 0; i < n; i++) {
    const z = -0.86 + i * (1.72 / (n - 1));
    const tooth = new THREE.ConeGeometry(0.18, 1.15, 5);
    if (upper) tooth.rotateZ(Math.PI);
    tooth.translate(18.7, upper ? 0.52 : -0.28, z);
    parts.push(paintReaperFlesh(tooth, "tooth"));
  }
  const fang = new THREE.ConeGeometry(0.24, 1.42, 5);
  if (upper) fang.rotateZ(Math.PI);
  fang.translate(18.88, upper ? 0.42 : -0.22, 0);
  parts.push(paintReaperFlesh(fang, "tooth"));
  return parts;
}

function makeReaperBarnacles() {
  const rng = mulberry32(7741);
  const parts = [];
  for (let i = 0; i < 70; i++) {
    const x = -15 + rng() * 28;
    const t = (x + 19.4) / 33.6;
    const hy = reaperEnvelope(Math.max(0.08, Math.min(0.88, t))) * reaperRing(Math.max(0.08, Math.min(0.88, t)));
    const ang = rng() * Math.PI * 0.8 - 0.1;
    const y = Math.cos(ang) * hy * (0.8 + rng() * 0.2);
    const z = Math.sin(ang) * hy * (0.62 + rng() * 0.22) * (rng() > 0.5 ? 1 : -1);
    if (y < 0.4) continue;
    const r = 0.1 + rng() * 0.17;
    const g = new THREE.SphereGeometry(r, 7, 5, 0, Math.PI * 2, 0, Math.PI * 0.62);
    g.rotateX(-ang * 0.3);
    g.translate(x, y + r * 0.12, z);
    const col = new Float32Array(g.attributes.position.count * 3);
    const cr = 0.6 + rng() * 0.14;
    const cg = 0.52 + rng() * 0.1;
    const cb = 0.38 + rng() * 0.08;
    for (let k = 0; k < col.length; k += 3) {
      col[k] = cr;
      col[k + 1] = cg;
      col[k + 2] = cb;
    }
    g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    parts.push(g);
  }
  return parts;
}

function makeReaperWounds() {
  const parts = [];
  const slash = new THREE.BoxGeometry(5.2, 0.2, 0.48, 8, 1, 2);
  slash.rotateZ(-0.42);
  slash.rotateY(0.14);
  slash.translate(7.6, 0.7, 1.45);
  parts.push(paintReaperFlesh(slash, "inner"));
  const gouge = new THREE.SphereGeometry(0.78, 10, 8);
  gouge.scale(1.7, 0.42, 0.72);
  gouge.translate(4.4, 0.5, 1.28);
  parts.push(paintReaperFlesh(gouge, "inner"));
  const face = new THREE.BoxGeometry(2.0, 0.16, 0.3, 4, 1, 1);
  face.rotateZ(0.48);
  face.translate(15.4, 0.2, 1.55);
  parts.push(paintReaperFlesh(face, "inner"));
  return parts;
}

function makeJawPivot(geos, hinge, mat) {
  const pivot = new THREE.Group();
  pivot.position.copy(hinge);
  for (const geo of geos) {
    applyReaperBend(geo);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(hinge).negate();
    m.castShadow = true;
    m.frustumCulled = false;
    pivot.add(m);
  }
  return pivot;
}

function makeReaperLeviathan(shared) {
  const parts = [makeReaperBody(), makeReaperSkull(), makeReaperBrow(), makeReaperFin(1), makeReaperFin(-1), makeReaperPelvic(1), makeReaperPelvic(-1)];
  parts.push(...makeReaperMuscles(), ...makeReaperHinges());
  parts.push(...makeReaperFluke(), ...makeReaperGills(), ...makeReaperMawCavity(), ...makeReaperWounds(), ...makeReaperBarnacles());
  const flesh = mergeGeos(parts);
  applyReaperBend(flesh);
  flesh.computeVertexNormals();

  const group = new THREE.Group();
  group.name = "reaper-leviathan";

  const fleshMat = new THREE.MeshStandardMaterial({
    color: srgb(0xf0ddd0),
    roughness: 0.8,
    metalness: 0.03,
    vertexColors: true,
    emissive: srgb(0x3a1408),
    emissiveIntensity: 0.12,
  });
  patchUnderwater(fleshMat, shared, { caustics: false, detail: "none" });
  const body = new THREE.Mesh(flesh, fleshMat);
  body.castShadow = true;
  body.receiveShadow = true;
  body.frustumCulled = false;
  group.add(body);

  const hinge = new THREE.Vector3(...bentPoint(17.55, 0, 0));
  const upperGeos = [...makeReaperMandible(0), ...makeReaperMandible(1), ...makeReaperTeeth(true)];
  const lowerGeos = [...makeReaperMandible(2), ...makeReaperMandible(3), ...makeReaperTeeth(false)];
  const upperJaw = makeJawPivot(upperGeos, hinge, fleshMat);
  const lowerJaw = makeJawPivot(lowerGeos, hinge, fleshMat);
  group.add(upperJaw);
  group.add(lowerJaw);
  group.userData.upperJaw = upperJaw;
  group.userData.lowerJaw = lowerJaw;

  const eyeMat = new THREE.MeshStandardMaterial({
    color: srgb(0x181006),
    emissive: srgb(0xf2c43a),
    emissiveIntensity: 3.1,
    roughness: 0.2,
    metalness: 0.1,
  });
  const pupilMat = new THREE.MeshStandardMaterial({
    color: srgb(0x070504),
    emissive: srgb(0x2a1a06),
    emissiveIntensity: 0.35,
    roughness: 0.4,
  });
  for (const s of [-1, 1]) {
    const [ex, ey, ez] = bentPoint(16.25, 0.38, s * 1.68);
    const socket = new THREE.Mesh(
      new THREE.SphereGeometry(0.48, 12, 10),
      new THREE.MeshStandardMaterial({
        color: srgb(0x0a0503),
        roughness: 0.92,
        emissive: srgb(0x120604),
        emissiveIntensity: 0.1,
      }),
    );
    socket.position.set(ex - 0.22, ey + 0.08, ez * 0.82);
    socket.scale.set(0.95, 1.2, 0.55);
    socket.frustumCulled = false;
    group.add(socket);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.26, 14, 12), eyeMat);
    eye.position.set(ex, ey, ez);
    eye.frustumCulled = false;
    group.add(eye);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 7), pupilMat);
    pupil.position.set(ex + 0.16, ey, ez * 1.04);
    pupil.frustumCulled = false;
    group.add(pupil);
    const lamp = new THREE.PointLight(0xffd050, 1.45, 7, 2);
    lamp.position.set(ex + 0.12, ey, ez);
    group.add(lamp);
  }

  const headFill = new THREE.PointLight(0xff6238, 3.2, 22, 1.3);
  const [hx, hy, hz] = bentPoint(17.6, 0.35, 0);
  headFill.position.set(hx, hy + 0.7, hz);
  group.add(headFill);
  const mawLight = new THREE.PointLight(0xff2410, 1.55, 6.5, 1.7);
  const [mx, my, mz] = bentPoint(18.6, -0.1, 0);
  mawLight.position.set(mx, my, mz);
  group.add(mawLight);
  const flank = new THREE.PointLight(0xc44826, 1.55, 15, 1.5);
  const [fx, fy, fz] = bentPoint(7.8, 0.35, 0);
  flank.position.set(fx, fy, fz);
  group.add(flank);

  return group;
}

const PLUME_NOISE = /* glsl */ `
  float hash11(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float n2(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash11(i), hash11(i + vec2(1.0, 0.0)), u.x),
      mix(hash11(i + vec2(0.0, 1.0)), hash11(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }
  float fbm2(vec2 p) {
    return n2(p) * 0.5 + n2(p * 2.07 + 1.3) * 0.28 + n2(p * 4.1 + 5.7) * 0.15 + n2(p * 8.2) * 0.07;
  }
`;

function makePlumeMat(gain) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHot: { value: new THREE.Color(1.25, 0.38, 0.82) },
      uCool: { value: new THREE.Color(0.88, 0.32, 1.05) },
      uGain: { value: gain },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      uniform float uTime;
      uniform vec3 uHot;
      uniform vec3 uCool;
      uniform float uGain;
      ${PLUME_NOISE}

      void main() {
        vec2 uv = vUv;
        float t = uTime;
        vec2 q = vec2(uv.x * 1.7 + fbm2(uv * 2.2 + t * 0.04) * 0.55, uv.y * 1.9 - t * 0.11);
        float wisp = fbm2(q);
        float wispB = fbm2(q * 1.85 + vec2(t * 0.035, 4.2));
        float fil = abs(n2(vec2(uv.x * 2.6 + wisp * 2.4, uv.y * 1.15 - t * 0.09)) - 0.5);
        float streak = 1.0 - smoothstep(0.0, 0.22, fil);
        float waist = 0.48 + uv.y * 0.85;
        vec2 d = vec2((uv.x - 0.5) / waist, (uv.y - 0.02) / 1.12);
        float mask = 1.0 - smoothstep(0.18, 1.12, length(d));
        mask *= smoothstep(0.0, 0.07, uv.y) * (1.0 - smoothstep(0.5, 1.0, uv.y));
        float holes = smoothstep(0.38, 0.78, wispB);
        float dens = mask * (0.18 + wisp * 0.7 + streak * 0.28) * (1.0 - holes * 0.55);
        dens = pow(max(dens, 0.0), 1.35);
        vec3 col = mix(uHot, uCool, clamp(uv.y * 0.7 + wisp * 0.22, 0.0, 1.0));
        float fade = exp(-0.007 * length(vWorldPosition - cameraPosition));
        float alpha = dens * uGain * fade;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(col * alpha, alpha);
      }
    `,
  });
}

function makePlumeConeMat(gain) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uHot: { value: new THREE.Color(1.22, 0.36, 0.8) },
      uCool: { value: new THREE.Color(0.86, 0.3, 1.02) },
      uGain: { value: gain },
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vWorldPosition;
      void main() {
        vLocal = position;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vLocal;
      varying vec3 vWorldPosition;
      uniform float uTime;
      uniform vec3 uHot;
      uniform vec3 uCool;
      uniform float uGain;
      ${PLUME_NOISE}

      void main() {
        float h = clamp(vLocal.y / 34.0 + 0.5, 0.0, 1.0);
        float rad = length(vLocal.xz);
        float maxR = mix(1.3, 14.2, h);
        float nr = rad / max(maxR, 0.08);
        float shell = 1.0 - smoothstep(0.15, 1.0, nr);
        shell *= smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.62, 1.0, h));
        vec2 q = vec2(vLocal.x * 0.18 + vLocal.z * 0.12, h * 2.4 - uTime * 0.1);
        q += 0.45 * vec2(n2(q + 2.1), n2(q.yx + 5.4));
        float wisp = fbm2(q);
        float wispB = fbm2(q * 2.1 + vec2(uTime * 0.04, 3.3));
        float holes = smoothstep(0.42, 0.8, wispB);
        float dens = shell * (0.14 + wisp * 0.55) * (1.0 - holes * 0.62);
        dens = pow(max(dens, 0.0), 1.4);
        vec3 col = mix(uHot, uCool, clamp(h * 0.75 + wisp * 0.2, 0.0, 1.0));
        float fade = exp(-0.007 * length(vWorldPosition - cameraPosition));
        float alpha = dens * uGain * fade;
        if (alpha < 0.003) discard;
        gl_FragColor = vec4(col * alpha, alpha);
      }
    `,
  });
}

export function createGrandReef(scene, shared) {
  const group = new THREE.Group();
  group.name = "grand-reef";
  const rng = mulberry32(1188);

  const rockMat = new THREE.MeshStandardMaterial({
    color: srgb(0xf0ead6),
    roughness: 0.86,
    metalness: 0.02,
    vertexColors: true,
  });
  patchUnderwater(rockMat, shared, { caustics: false, detail: "none" });

  const brainMat = new THREE.MeshStandardMaterial({
    color: srgb(0xd4f090),
    roughness: 0.5,
    metalness: 0.02,
    vertexColors: true,
    emissive: srgb(0x701438),
    emissiveIntensity: 0.22,
  });
  patchUnderwater(brainMat, shared, { caustics: false, detail: "none" });

  const plateau = new THREE.Mesh(makeReefPlateau(), rockMat);
  plateau.castShadow = true;
  plateau.receiveShadow = true;
  group.add(plateau);

  const domeGeos = [];
  for (let i = 0; i < DOMES.length; i++) domeGeos.push(makeDome(DOMES[i]));
  const domes = new THREE.Mesh(mergeGeos(domeGeos), rockMat);
  domes.castShadow = true;
  domes.receiveShadow = true;
  group.add(domes);

  const brains = [
    { along: 34.5, across: 6.2, r: 8.6, style: 0, vent: false, yaw: 0.32 },
    { along: 43.2, across: 13.6, r: 10.4, style: 1, vent: true, yaw: 1.08 },
    { along: 39.8, across: 20.4, r: 5.8, style: 0, vent: false, yaw: 2.15 },
  ];
  const vents = [];
  for (let i = 0; i < brains.length; i++) {
    const b = brains[i];
    const p = fromCam(b.along, b.across);
    const y = reefHillY(p.x, p.z) - b.r * 0.08;
    const geo = makeBrain(b.r, i * 2.4 + 1.1, b.style);
    const mesh = new THREE.Mesh(geo, brainMat);
    mesh.position.set(p.x, y, p.z);
    mesh.rotation.y = b.yaw;
    mesh.castShadow = true;
    group.add(mesh);
    if (b.vent) vents.push({ x: p.x, y: y + b.r * 0.38, z: p.z, r: b.r });
  }

  const vent = vents[0] || { x: -200, y: -78, z: -20, r: 10 };
  const plumeMats = [];
  const plumePlanes = [];
  const coneMat = makePlumeConeMat(0.38);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(14.5, 1.2, 34, 24, 16, true), coneMat);
  cone.position.set(vent.x + 0.2, vent.y + 16.4, vent.z);
  cone.frustumCulled = false;
  cone.renderOrder = 3;
  group.add(cone);
  plumeMats.push(coneMat);

  const plumeSpecs = [
    { w: 9.4, h: 10.6, y: 4.2, ox: 0.2, oz: 0.15, gain: 0.62, phase: 0.2 },
    { w: 12.2, h: 9.8, y: 7.4, ox: -1.4, oz: 1.0, gain: 0.52, phase: 1.1 },
    { w: 17.6, h: 13.4, y: 12.6, ox: 0.6, oz: -0.9, gain: 0.48, phase: 2.0 },
    { w: 20.4, h: 12.2, y: 16.8, ox: -2.0, oz: 1.6, gain: 0.42, phase: 2.8 },
    { w: 15.2, h: 15.0, y: 11.8, ox: 2.1, oz: 0.5, gain: 0.44, phase: 3.5 },
    { w: 26.5, h: 16.2, y: 23.2, ox: 1.0, oz: 1.4, gain: 0.32, phase: 4.2 },
    { w: 22.8, h: 18.0, y: 27.4, ox: -2.4, oz: -1.0, gain: 0.28, phase: 5.0 },
    { w: 24.5, h: 13.8, y: 20.6, ox: 1.6, oz: -1.9, gain: 0.3, phase: 0.8 },
    { w: 18.6, h: 19.2, y: 18.0, ox: -0.7, oz: 2.4, gain: 0.34, phase: 1.7 },
    { w: 12.8, h: 12.2, y: 9.2, ox: 0.9, oz: -1.5, gain: 0.5, phase: 3.9 },
  ];
  for (const spec of plumeSpecs) {
    const mat = makePlumeMat(spec.gain);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(spec.w, spec.h, 1, 1), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    mesh.userData.bx = vent.x + spec.ox;
    mesh.userData.by = vent.y + spec.y;
    mesh.userData.bz = vent.z + spec.oz;
    mesh.userData.phase = spec.phase;
    mesh.position.set(mesh.userData.bx, mesh.userData.by, mesh.userData.bz);
    group.add(mesh);
    plumePlanes.push(mesh);
    plumeMats.push(mat);
  }

  const lamp0 = new THREE.PointLight(0xff86d4, 2.2, 18, 1.5);
  lamp0.position.set(vent.x, vent.y + 2.2, vent.z);
  group.add(lamp0);
  const lamp1 = new THREE.PointLight(0xc070ff, 1.35, 16, 1.65);
  lamp1.position.set(vent.x + 0.5, vent.y + 10.4, vent.z - 0.3);
  group.add(lamp1);
  const lamp2 = new THREE.PointLight(0x88d070, 1.7, 22, 1.45);
  const front = fromCam(34.5, 6.2);
  lamp2.position.set(front.x - 1.6, reefHillY(front.x, front.z) + 7.2, front.z + 1.8);
  group.add(lamp2);

  const jellyGeo = makeJellyProto();
  const jellyMat = new THREE.MeshStandardMaterial({
    color: srgb(0xff88c0),
    emissive: srgb(0xe03080),
    emissiveIntensity: 0.95,
    roughness: 0.26,
    metalness: 0.02,
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
  });
  patchUnderwater(jellyMat, shared, { caustics: false });
  const staged = [
    { along: 22, across: 24, y: -66, sc: 0.82 },
    { along: 16, across: -12, y: -68, sc: 0.5 },
    { along: 28, across: -7, y: -65, sc: 0.42 },
    { along: 12, across: 4, y: -69, sc: 0.56 },
    { along: 40, across: 8, y: -62, sc: 0.4 },
  ];
  const JELLY_N = staged.length;
  const jellies = new THREE.InstancedMesh(jellyGeo, jellyMat, JELLY_N);
  const jellyData = [];
  const dummy = new THREE.Object3D();
  for (let i = 0; i < JELLY_N; i++) {
    const s = staged[i];
    const p = fromCam(s.along, s.across);
    jellyData.push({
      x: p.x,
      y: s.y,
      z: p.z,
      sc: s.sc,
      phase: rng() * 6.28,
      spin: 0.12 + rng() * 0.2,
    });
    dummy.position.set(p.x, s.y, p.z);
    dummy.rotation.set(0, rng() * 6.28, 0);
    dummy.scale.setScalar(s.sc);
    dummy.updateMatrix();
    jellies.setMatrixAt(i, dummy.matrix);
  }
  group.add(jellies);

  const grazerMat = new THREE.MeshStandardMaterial({
    color: srgb(0x102838),
    roughness: 0.9,
    vertexColors: true,
  });
  patchUnderwater(grazerMat, shared, { caustics: false });
  const grazer = new THREE.Mesh(makeGrazer(), grazerMat);
  const gp = fromCam(120, 68);
  grazer.position.set(gp.x, reefHillY(gp.x, gp.z) + 3.2, gp.z);
  grazer.rotation.y = 0.55;
  grazer.scale.setScalar(1.15);
  group.add(grazer);

  const reaper = makeReaperLeviathan(shared);
  const HEAD_X = 19.6;
  // Demo-driven: start left, swim right, then turn and charge. No wrap, no engine-time jump.
  const DEMO = { x: -156, y: -60, z: 16 };
  const demoFwd = new THREE.Vector3(-200 - DEMO.x, 0, -32 - DEMO.z).normalize();
  const demoRight = new THREE.Vector3(-demoFwd.z, 0, demoFwd.x);
  const patrolFwd = new THREE.Vector3();
  const patrolX = new THREE.Vector3();
  const patrolY = new THREE.Vector3();
  const patrolZ = new THREE.Vector3();
  const patrolM = new THREE.Matrix4();
  const huntDir = new THREE.Vector3();
  const CROSS_END = 8.2;
  const hunt = { charge: 0, bite: 0, local: -1 };
  reaper.userData.setHunt = (charge, bite, local) => {
    hunt.charge = THREE.MathUtils.clamp(charge, 0, 1);
    hunt.bite = THREE.MathUtils.clamp(bite, 0, 1);
    hunt.local = local == null ? -1 : local;
  };
  function crossSide(u) {
    const e = THREE.MathUtils.clamp(u, 0, 1);
    const s = e * e * (3 - 2 * e);
    return THREE.MathUtils.lerp(-34, 0, s);
  }
  function placeReaper(t, camera) {
    const dist = 48;
    let side;
    let faceRight = true;
    if (hunt.local >= 0) {
      side = crossSide(hunt.local / CROSS_END);
    } else {
      const u = 0.5 + 0.5 * Math.sin(t * 0.16);
      side = THREE.MathUtils.lerp(-30, 20, u);
      faceRight = Math.cos(t * 0.16) >= 0;
    }
    const head = {
      x: DEMO.x + demoFwd.x * dist + demoRight.x * side,
      z: DEMO.z + demoFwd.z * dist + demoRight.z * side,
    };
    let hy0 = -60.4 + Math.sin(t * 1.35) * 0.7;
    const swim = faceRight ? 1 : -1;
    patrolFwd.set(demoRight.x * swim, Math.sin(t * 1.6) * 0.06, demoRight.z * swim);

    if (camera && hunt.charge > 0.001) {
      const k = hunt.charge * hunt.charge * (3 - 2 * hunt.charge);
      const sx = DEMO.x + demoFwd.x * dist + demoRight.x * crossSide(1);
      const sy = -60.4;
      const sz = DEMO.z + demoFwd.z * dist + demoRight.z * crossSide(1);
      huntDir.set(camera.position.x - sx, 0, camera.position.z - sz);
      if (huntDir.lengthSq() < 1e-6) huntDir.set(demoFwd.x, 0, demoFwd.z);
      else huntDir.normalize();
      const hold = THREE.MathUtils.lerp(18, 2.2, k);
      head.x = sx + (camera.position.x - huntDir.x * hold - sx) * k;
      hy0 = sy + (camera.position.y - sy) * k;
      head.z = sz + (camera.position.z - huntDir.z * hold - sz) * k;
      huntDir.y = (camera.position.y - hy0) * 0.1;
      if (huntDir.lengthSq() > 1e-6) huntDir.normalize();
      if (k < 0.28) {
        patrolFwd.lerpVectors(demoRight, huntDir, k / 0.28);
      } else {
        patrolFwd.copy(huntDir);
      }
    }

    if (patrolFwd.lengthSq() < 1e-6) patrolFwd.set(1, 0, 0);
    else patrolFwd.normalize();
    patrolX.copy(patrolFwd);
    patrolZ.crossVectors(patrolX, new THREE.Vector3(0, 1, 0));
    if (patrolZ.lengthSq() < 1e-6) patrolZ.set(0, 0, 1);
    else patrolZ.normalize();
    patrolY.crossVectors(patrolZ, patrolX).normalize();
    let py = hy0;
    if (hunt.charge < 0.12) {
      for (let s = -22; s <= 22; s += 3) {
        const px = head.x + patrolX.x * s;
        const pz = head.z + patrolX.z * s;
        const floor = reefHillY(px, pz);
        const need = floor + 16;
        const sampleY = py + patrolX.y * s;
        if (sampleY < need) py += need - sampleY;
      }
    }
    reaper.position.set(head.x - patrolX.x * HEAD_X, py - patrolX.y * HEAD_X, head.z - patrolX.z * HEAD_X);
    reaper.quaternion.setFromRotationMatrix(patrolM.makeBasis(patrolX, patrolY, patrolZ));
    const open = hunt.bite * 0.78;
    if (reaper.userData.upperJaw) reaper.userData.upperJaw.rotation.z = open;
    if (reaper.userData.lowerJaw) reaper.userData.lowerJaw.rotation.z = -open;
  }
  placeReaper(0);
  group.add(reaper);

  const tickDummy = new THREE.Object3D();
  group.userData.update = (t, camera) => {
    for (const m of plumeMats) m.uniforms.uTime.value = t;
    cone.position.x = vent.x + 0.2 + Math.sin(t * 0.22) * 0.35;
    cone.position.z = vent.z + Math.cos(t * 0.18) * 0.3;
    cone.rotation.y = Math.sin(t * 0.12) * 0.08;
    for (const p of plumePlanes) {
      p.position.set(
        p.userData.bx + Math.sin(t * 0.32 + p.userData.phase) * 0.7,
        p.userData.by + Math.sin(t * 0.22 + p.userData.phase * 0.7) * 0.4,
        p.userData.bz + Math.cos(t * 0.28 + p.userData.phase) * 0.62,
      );
      if (camera) {
        p.lookAt(camera.position);
        p.rotateZ(Math.sin(t * 0.36 + p.userData.phase) * 0.12);
      }
    }
    for (let i = 0; i < jellyData.length; i++) {
      const j = jellyData[i];
      const pulse = 1 + Math.sin(t * 2.05 + j.phase) * 0.08;
      tickDummy.position.set(
        j.x + Math.sin(t * 0.26 + j.phase) * 1.4,
        j.y + Math.sin(t * 0.4 + j.phase * 1.3) * 0.8,
        j.z + Math.cos(t * 0.22 + j.phase * 0.8) * 1.2,
      );
      tickDummy.rotation.set(Math.sin(t * 0.48 + j.phase) * 0.16, t * j.spin + j.phase, 0);
      tickDummy.scale.set(j.sc * pulse, j.sc * (1.06 - (pulse - 1)), j.sc * pulse);
      tickDummy.updateMatrix();
      jellies.setMatrixAt(i, tickDummy.matrix);
    }
    jellies.instanceMatrix.needsUpdate = true;
    placeReaper(t, camera);
  };

  scene.add(group);
  return group;
}
