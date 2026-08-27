import * as THREE from "three";
import { fbm, mulberry32, noise3 } from "./math.js";
import { WORLD_SEED } from "./config.js";
import { patchUnderwater } from "./shaders.js";
import {
  GROTTO_ORIGIN,
  archFootY,
  grottoWorldY,
  hillsideSDF2D,
  grottoSDF,
  windowSDF2D,
  sculptArchPoint,
  terrainHeight,
  ISLAND,
  islandHeight,
} from "./terrain.js";
import { biomeWeights, blendFloorColor } from "./biomes.js";
import { createFlora } from "./flora.js";
import { createFauna } from "./fauna.js";
import { createAmberFlats } from "./regions/grassy.js";
import { createMushroomForest } from "./regions/mushroom.js";
import { createBulbGarden } from "./regions/bulb.js";
import { createCrimsonMeadows } from "./regions/crimson.js";
import { createJellyshroomCave, jellySwimFloor } from "./regions/jelly.js";
import { createGrandReef } from "./regions/reef.js";
import { createShallowsLife } from "./regions/shallows.js";
import { createKelpExtras } from "./regions/kelp.js";
import { createIsland } from "./island.js";
import { createSeabase, SEABASE } from "./seabase.js";
import { makeSandMaps, makeSandstoneMaps } from "./textures.js";

function massClearsWindow(x, y, z, r) {
  const wd = windowSDF2D(x, y);
  const tunnel = z > -7.6 && z < 8.2;
  if (tunnel && wd < r * 0.36) return false;
  if (wd < 0.55 && Math.abs(z) < 6.2 && r > 1.6) return false;
  return true;
}

function mergeGeos(geos) {
  const pos = [];
  const nrm = [];
  const col = [];
  const uv = [];
  const idx = [];
  let base = 0;
  for (const g of geos) {
    g.computeVertexNormals();
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const c = g.attributes.color;
    const u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0);
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
  return out;
}

function paintPits(geo) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = noise3(x * 0.18, y * 0.18, z * 0.18);
    const n2 = noise3(x * 0.55, y * 0.5, z * 0.52);
    const pit = noise3(x * 1.35, y * 1.2, z * 1.3);
    const bowl = noise3(x * 0.22, y * 0.2, z * 0.21);
    const pitAmt = Math.min(1, Math.max(0, pit - 0.58) * 2.1 + Math.max(0, bowl - 0.56) * 1.6);
    const dust = n2 > 0.72 ? (n2 - 0.72) * 0.35 : 0;
    const mott = (n - 0.5) * 0.05 + (n2 - 0.5) * 0.025;
    col[i * 3] = 0.78 + mott - pitAmt * 0.16 - dust * 0.04;
    col[i * 3 + 1] = 0.62 + mott * 0.75 - pitAmt * 0.10 - dust * 0.03;
    col[i * 3 + 2] = 0.44 + mott * 0.3 - pitAmt * 0.06 - dust * 0.02;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function makeWeatheredMass(radius, seed = 0) {
  const segs = radius > 3.4 ? 48 : radius > 2.0 ? 36 : 28;
  const rings = radius > 3.4 ? 36 : radius > 2.0 ? 28 : 22;
  const geo = new THREE.SphereGeometry(radius, segs, rings);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const col = new Float32Array(pos.count * 3);
  // Chunky hillside lump, not a sedimentary pancake.
  const stretchY = 0.72 + (seed % 1) * 0.22;
  const stretchZ = 0.86 + ((seed * 1.7) % 1) * 0.16;
  const stretchX = 0.96 + ((seed * 2.3) % 1) * 0.16;
  const lobeN = 2 + (((seed * 11.3) | 0) % 2);
  const lobeAmp = 0.05 + ((seed * 3.3) % 1) * 0.04;
  const nBeds = 1;
  const bedPhase = seed * 5.13;
  const slabShift = 0.02 + ((seed * 4.1) % 1) * 0.015;
  const depthScale = radius > 3.5 ? 1.0 : radius > 2.2 ? 0.72 : 0.42;
  // Few large irregular +Z bowls (camera / shallows face). Not a pit grid.
  const bowls = [];
  const nBowls = radius > 2.4 ? 3 + (((seed * 9.3) | 0) % 2) : 1;
  for (let b = 0; b < nBowls; b++) {
    const t = seed * 6.17 + b * 2.41;
    const u = seed * 3.7 + b * 1.73;
    bowls.push([
      Math.sin(t) * 0.36 + ((b * 0.31) % 0.18) - 0.08,
      Math.cos(u) * 0.28,
      0.52 + Math.abs(Math.sin(t * 1.3 + u)) * 0.42,
      0.4 + Math.abs(Math.sin(u * 2.1 + seed)) * 0.26,
      0.26 + Math.abs(Math.cos(t * 1.6)) * 0.14,
      0.44 + Math.abs(Math.sin(seed * 5.1 + b)) * 0.2,
      (0.78 + Math.abs(Math.sin(t + seed)) * 0.34) * depthScale,
    ]);
  }
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 0.16 + seed, v.y * 0.16, v.z * 0.16);
    const n2 = noise3(v.x * 0.42 + seed * 2.1, v.y * 0.4, v.z * 0.44);
    const n3 = noise3(v.x * 0.92 + seed, v.y * 0.88, v.z * 0.9);
    const n4 = noise3(v.x * 1.85 + seed * 0.7, v.y * 1.72, v.z * 1.8);
    const n5 = noise3(v.x * 3.4, v.y * 3.15 + seed, v.z * 3.3);
    const ang = Math.atan2(v.z, v.x);
    const lobe =
      1 +
      lobeAmp * Math.sin(ang * lobeN + seed * 4.2) +
      0.025 * Math.sin(ang * 2 + n * 3);
    v.x *= stretchX * lobe;
    v.y *= stretchY * (1 + 0.03 * Math.sin(ang * 2 + seed));
    v.z *= stretchZ * (1 + 0.04 * Math.sin(ang * 2 + seed));
    // Mild organic swell only — keep the slab silhouette.
    v.multiplyScalar(0.9 + n * 0.1 + n2 * 0.05);
    const along = v.clone().normalize();
    // Soft weathering only — no stacked-bed coils.
    const yN = v.y / Math.max(radius * stretchY, 0.01);
    const seam = Math.abs(Math.sin(yN * Math.PI * nBeds + bedPhase));
    if (seam < 0.12) {
      const t = (0.12 - seam) / 0.12;
      v.x *= 1 - t * t * 0.04;
      v.z *= 1 - t * t * 0.04;
    }
    v.x += Math.sin(yN * Math.PI + bedPhase) * radius * slabShift;
    // Micro roughness stays small; big holes come from the unique bowls.
    if (n3 > 0.52) v.addScaledVector(along, -(n3 - 0.52) * radius * 0.22);
    if (n4 > 0.64) v.addScaledVector(along, -(n4 - 0.64) * radius * 0.12);
    if (n5 > 0.72) v.addScaledVector(along, -(n5 - 0.72) * radius * 0.07);
    if (n < 0.22) v.addScaledVector(along, (0.22 - n) * radius * 0.08);
    const nx = along.x;
    const ny = along.y;
    const nz = along.z;
    let bowlCut = 0;
    for (const [bx, by, bz, rx, ry, rz, depth] of bowls) {
      const d = Math.hypot((nx - bx) / rx, (ny - by) / ry, (nz - bz) / rz);
      if (d < 1) {
        const t = 1 - d;
        const irreg = 0.78 + n3 * 0.32;
        v.addScaledVector(along, -t * t * (0.5 + t * 0.55) * radius * depth * irreg);
        bowlCut = Math.max(bowlCut, t);
      }
    }
    pos.setXYZ(i, v.x, v.y, v.z);
    const pit = Math.max(0, n3 - 0.48) + Math.max(0, n4 - 0.62) + bowlCut * 1.2;
    const mott = (n - 0.5) * 0.05 + (n2 - 0.5) * 0.03;
    const wet = Math.max(0, nz) * 0.05;
    col[i * 3] = 0.78 + mott - pit * 0.16 - wet * 0.03;
    col[i * 3 + 1] = 0.62 + mott * 0.75 - pit * 0.1 - wet * 0.02;
    col[i * 3 + 2] = 0.44 + mott * 0.3 - pit * 0.06 - wet * 0.02;
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function pockSandstone(geo) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const col = geo.attributes.color;
  // Few large unique +Z bowls — holes, not a ring of matching notches.
  const bowls = [
    [-9.4, 7.6, 5.8, 4.8, 3.2, 3.9],
    [13.4, 6.6, 7.2, 5.4, 3.6, 4.4],
    [16.8, 4.2, 7.6, 3.9, 2.5, 3.3],
    [7.6, 11.0, 6.4, 3.5, 2.3, 2.9],
    [-6.4, 12.6, 4.4, 3.3, 2.2, 2.7],
    [2.2, 15.4, 4.6, 3.7, 2.3, 2.9],
    [10.2, 4.8, 7.4, 2.9, 1.9, 2.7],
  ];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = nrm.getX(i);
    const ny = nrm.getY(i);
    const nz = nrm.getZ(i);
    const n3 = noise3(x * 0.12, y * 0.11, z * 0.12);
    const n4 = noise3(x * 0.28 + 2.2, y * 0.26, z * 0.27);
    const n5 = noise3(x * 0.64, y * 0.58, z * 0.62);
    let cut = 0;
    if (n3 > 0.54) cut += (n3 - 0.54) * 0.55;
    if (n4 > 0.62) cut += (n4 - 0.62) * 0.28;
    if (n5 > 0.72) cut += (n5 - 0.72) * 0.14;
    for (const [bx, by, bz, rx, ry, rz] of bowls) {
      const d = Math.hypot((x - bx) / rx, (y - by) / ry, (z - bz) / rz);
      if (d < 1) {
        const t = 1 - d;
        cut += t * t * (0.55 + t * 0.5) * rx * 0.78;
      }
    }
    // Sparse irregular pits only — no world-Y coil grooves.
    const wd = windowSDF2D(x, y);
    if (wd < 0.95) cut *= Math.max(0.1, wd / 0.95);
    if (cut < 0.012) continue;
    pos.setXYZ(i, x - nx * cut, y - ny * cut, z - nz * cut);
    if (col) {
      const dim = 1 - Math.min(0.42, cut * 0.16);
      col.setXYZ(i, col.getX(i) * dim, col.getY(i) * dim * 0.92, col.getZ(i) * dim * 0.84);
    }
  }
  pos.needsUpdate = true;
  if (col) col.needsUpdate = true;
}

function carveHillsideCavities(geo) {
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  // Few large unique +Z cavities — pull into holes, not a starred ring.
  const cavities = [
    [12.8, 7.0, 7.5, 5.6, 3.6, 4.5],
    [-9.8, 8.1, 5.7, 5.0, 3.4, 3.9],
    [16.4, 4.6, 7.9, 4.1, 2.7, 3.5],
    [6.2, 12.4, 5.9, 3.7, 2.5, 3.1],
    [0.8, 16.1, 4.5, 3.9, 2.3, 3.0],
    [-5.4, 13.5, 4.1, 2.9, 2.1, 2.5],
  ];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    let px = x;
    let py = y;
    let pz = z;
    let dim = 1;
    for (const [cx, cy, cz, rx, ry, rz] of cavities) {
      const dx = x - cx;
      const dy = y - cy;
      const dz = z - cz;
      const d = Math.hypot(dx / rx, dy / ry, dz / rz);
      if (d >= 1 || d < 1e-4) continue;
      const t = 1 - d;
      const fall = t * t * (0.45 + t * 0.55);
      // Pull toward the cavity center so the hole is geometric, not a normal bump.
      const pull = fall * 0.82;
      px -= dx * pull;
      py -= dy * pull;
      pz -= dz * pull;
      dim = Math.min(dim, 1 - fall * 0.38);
    }
    // Unique cavities only. World-Y ledges stacked the hillside into coils.
    const wd = windowSDF2D(px, py);
    if (wd < 0.7) {
      const k = Math.max(0, wd / 0.7);
      px = x + (px - x) * k;
      py = y + (py - y) * k;
      pz = z + (pz - z) * k;
    }
    if (px === x && py === y && pz === z) continue;
    pos.setXYZ(i, px, py, pz);
    if (col && dim < 0.98) {
      col.setXYZ(i, col.getX(i) * dim, col.getY(i) * dim * 0.93, col.getZ(i) * dim * 0.84);
    }
  }
  pos.needsUpdate = true;
  if (col) col.needsUpdate = true;
  geo.computeVertexNormals();
}

function makePittedChunk(radius) {
  const geo = new THREE.IcosahedronGeometry(radius, 4);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 0.48, v.y * 0.48, v.z * 0.48);
    const n2 = noise3(v.x * 1.25, v.y * 1.15, v.z * 1.2);
    const n3 = noise3(v.x * 2.5, v.y * 2.35, v.z * 2.4);
    const n4 = noise3(v.x * 4.6, v.y * 4.3, v.z * 4.4);
    v.multiplyScalar(0.68 + n * 0.42 + n2 * 0.16);
    v.y *= 0.66 + n * 0.24;
    const along = v.clone().normalize();
    if (n3 > 0.5) v.addScaledVector(along, -(n3 - 0.5) * radius * 0.68);
    if (n2 > 0.62) v.addScaledVector(along, -(n2 - 0.62) * radius * 0.48);
    if (n4 > 0.68) v.addScaledVector(along, -(n4 - 0.68) * radius * 0.26);
    if (n < 0.32) v.addScaledVector(along, (0.32 - n) * radius * 0.28);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  paintPits(geo);
  geo.computeVertexNormals();
  return geo;
}

function plantMass(geo) {
  const pos = geo.attributes.position;
  let minY = Infinity;
  for (let i = 0; i < pos.count; i++) minY = Math.min(minY, pos.getY(i));
  if (minY > 0.85) return geo;
  for (let i = 0; i < pos.count; i++) {
    const ly = pos.getY(i);
    if (ly < 0.38) {
      pos.setY(i, 0.08 + noise3(pos.getX(i), 2.2, pos.getZ(i)) * 0.16);
    }
  }
  pos.needsUpdate = true;
  return geo;
}

function collectMassSamples(geo, samples, used) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const step = Math.max(2, (pos.count / 820) | 0);
  for (let i = 0; i < pos.count; i += step) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = nrm.getX(i);
    const ny = nrm.getY(i);
    const nz = nrm.getZ(i);
    if (nz < -0.08 && nx < 0.02) continue;
    if (y < 0.55 || y > 18.8) continue;
    if (z < -1.6) continue;
    const wd = windowSDF2D(x, y);
    if (wd < 0.08) continue;
    if (grottoSDF(x, y, z) < -0.55) continue;
    const facing = nz > 0.04 || nx > 0.08 || x < 1.2 || y > 12.0 || (wd > 0.08 && wd < 2.4);
    const keyScale = facing ? 1.7 : 1.2;
    const key = ((x * keyScale) | 0) + ":" + ((y * keyScale) | 0) + ":" + ((z * keyScale) | 0);
    if (used.has(key)) continue;
    used.add(key);
    samples.push({
      x,
      y,
      z,
      nx,
      ny,
      nz,
      cave: x > 10.2 && y < 8.4 && z > 2.8,
      crown: y > 12.2 && ny > 0.04,
      cliff: x > 6.2 && z > 1.0,
      left: x < 1.2 && z > 0.15 && (nz > 0.02 || nx > -0.18),
      lip: wd > 0.1 && wd < 2.55 && z > 0.1 && y > 2.4,
      face: z > 0.4 && nz > 0.08,
    });
  }
}

// Overlapping weathered sandstone masses forming a hillside with one cave mouth.
function makeGrottoGeometry() {
  const specs = [
    [-11.2, 5.6, 2.6, 6.4, 1.32, 0.88, 1.16],
    [-13.4, 3.2, 3.2, 5.0, 1.22, 0.78, 1.18],
    [-9.2, 9.6, 1.8, 5.1, 1.24, 0.92, 1.08],
    [-14.6, 8.2, 1.1, 5.2, 1.12, 1.05, 1.0],
    [-8.4, 3.2, 4.0, 4.4, 1.05, 0.92, 1.12],
    [-6.8, 12.2, 1.4, 3.9, 1.1, 1.05, 0.92],
    [-10.4, 12.6, 1.0, 3.7, 1.05, 1.08, 0.9],
    [-7.4, 6.6, 3.4, 3.5, 1.02, 1.0, 1.05],
    [-16.2, 5.4, 2.0, 4.2, 1.08, 1.0, 1.05],
    [-12.0, 14.0, 0.6, 3.2, 1.12, 0.95, 0.88],
    [-4.8, 15.4, 1.0, 4.6, 1.18, 1.0, 0.95],
    [-6.6, 14.2, 1.6, 4.4, 1.16, 1.02, 0.95],
    [-3.4, 14.6, 1.4, 4.0, 1.12, 0.98, 0.95],
    [-0.6, 16.8, 0.3, 5.1, 1.22, 0.92, 0.98],
    [4.2, 16.2, 1.1, 4.7, 1.14, 0.95, 1.0],
    [8.2, 14.6, 2.0, 4.3, 1.08, 1.0, 0.95],
    [1.8, 18.6, 0.1, 4.1, 1.2, 0.88, 0.95],
    [-2.2, 18.0, -0.2, 3.7, 1.15, 0.9, 0.92],
    [6.2, 17.6, 0.9, 3.5, 1.1, 0.92, 0.95],
    [10.8, 13.2, 2.4, 3.7, 1.05, 1.02, 0.92],
    [13.6, 7.6, 4.6, 6.9, 1.38, 0.82, 1.18],
    [16.2, 5.0, 5.2, 5.4, 1.22, 0.78, 1.16],
    [12.2, 11.6, 4.0, 5.1, 1.28, 0.88, 1.08],
    [17.4, 10.2, 3.4, 5.0, 1.05, 1.1, 0.95],
    [14.8, 14.2, 2.8, 4.3, 1.08, 1.0, 0.9],
    [15.8, 3.0, 6.1, 4.5, 1.05, 0.92, 1.08],
    [18.8, 7.6, 4.0, 4.1, 1.1, 1.05, 1.0],
    [11.6, 3.6, 6.4, 3.7, 1.02, 0.9, 1.12],
    [19.6, 11.4, 3.0, 3.8, 1.05, 1.08, 0.92],
    [16.8, 16.0, 2.2, 3.4, 1.08, 0.95, 0.9],
    [9.6, 8.8, 5.2, 3.2, 0.95, 1.05, 1.0],
    [-8.2, 7.2, -4.6, 5.6, 1.15, 1.1, 0.95],
    [8.4, 7.4, -5.2, 5.6, 1.12, 1.08, 0.95],
    [0.4, 14.2, -4.2, 5.1, 1.2, 0.95, 0.95],
    [-4.2, 10.2, -5.0, 4.6, 1.1, 1.05, 0.95],
    [12.4, 8.2, -4.0, 5.1, 1.08, 1.05, 0.95],
    [4.2, 11.4, -5.6, 4.6, 1.12, 1.0, 0.95],
    [-10.4, 5.2, -3.6, 4.1, 1.05, 1.0, 1.0],
    [16.2, 6.2, -3.2, 4.1, 1.05, 1.02, 0.95],
    [2.2, 6.4, -6.2, 4.3, 1.15, 1.0, 0.92],
    [-9.2, 1.3, 3.6, 4.1, 1.15, 0.78, 1.12],
    [10.2, 1.5, 5.1, 4.3, 1.12, 0.75, 1.15],
    [-5.2, 1.1, 2.6, 3.3, 1.1, 0.72, 1.08],
    [14.4, 1.3, 5.6, 3.7, 1.08, 0.74, 1.12],
    [6.2, 1.05, 4.2, 2.9, 1.05, 0.7, 1.1],
    [-13.4, 1.15, 2.1, 3.5, 1.12, 0.76, 1.08],
    [18.2, 1.4, 4.8, 3.2, 1.08, 0.72, 1.1],
    [-5.4, 8.0, 2.1, 2.5, 1.05, 1.0, 0.95],
    [-5.0, 10.6, 1.8, 2.3, 1.08, 1.02, 0.92],
    [-4.6, 5.8, 2.3, 2.1, 1.02, 0.95, 1.0],
    [-1.6, 13.7, 1.5, 2.5, 1.12, 0.95, 0.95],
    [2.6, 13.5, 1.6, 2.3, 1.08, 0.95, 0.95],
    [0.5, 14.1, 1.2, 2.1, 1.1, 0.92, 0.95],
    [6.4, 9.1, 2.8, 2.7, 1.05, 1.05, 0.95],
    [6.1, 6.5, 3.1, 2.3, 1.02, 0.98, 1.02],
    [6.6, 11.3, 2.5, 2.3, 1.05, 1.0, 0.95],
    [-1.1, 3.3, 2.1, 2.1, 1.08, 0.82, 1.05],
    [3.1, 3.4, 2.6, 2.1, 1.05, 0.8, 1.08],
    [4.8, 13.0, 2.2, 2.2, 1.06, 0.98, 0.95],
    [-3.4, 13.2, 1.6, 2.2, 1.08, 0.96, 0.92],
    [8.8, 5.2, 5.6, 2.6, 1.0, 0.95, 1.08],
    [13.2, 17.2, 1.6, 2.8, 1.1, 0.9, 0.9],
    [3.9, 11.9, 1.4, 2.5, 1.05, 1.0, 0.95],
    [-3.0, 11.7, 1.2, 2.3, 1.08, 1.0, 0.92],
    [3.7, 5.1, 2.0, 2.2, 1.02, 0.88, 1.05],
    [-2.8, 4.9, 1.8, 2.1, 1.05, 0.86, 1.02],
    [0.4, 12.6, 1.3, 2.0, 1.12, 0.9, 0.95],
    [5.2, 8.0, 2.4, 2.0, 1.0, 1.02, 0.95],
    [0.5, 15.4, 2.0, 6.8, 1.35, 0.92, 1.08],
    [-3.2, 14.8, 1.6, 5.6, 1.18, 0.95, 1.02],
    [4.2, 14.6, 1.8, 5.4, 1.16, 0.94, 1.04],
    [0.2, 17.2, 1.2, 5.2, 1.22, 0.88, 1.0],
  ];

  const rng = mulberry32(WORLD_SEED + 77);
  const placed = specs.map((s) => ({ x: s[0], y: s[1], z: s[2], r: s[3] }));
  for (let i = 0; i < 80 && placed.length < 68; i++) {
    const x = -16.5 + rng() * 36.0;
    const y = 1.4 + rng() * 15.5;
    const z = -5.2 + rng() * 10.4;
    const r = 2.2 + rng() * 2.4;
    if (hillsideSDF2D(x, y) > 1.05) continue;
    if (!massClearsWindow(x, y, z, r)) continue;
    let crowded = false;
    for (const m of placed) {
      if (Math.hypot(x - m.x, y - m.y, z - m.z) < Math.max(m.r, r) * 0.62) {
        crowded = true;
        break;
      }
    }
    if (crowded) continue;
    placed.push({ x, y, z, r });
    specs.push([x, y, z, r, 1.05 + rng() * 0.16, 0.88 + rng() * 0.16, 0.96 + rng() * 0.12]);
  }

  const geos = [];
  const samples = [];
  const used = new Set();
  for (let i = 0; i < specs.length; i++) {
    const [x, y, z, r, sx, sy, sz] = specs[i];
    if (!massClearsWindow(x, y, z, r * Math.max(sx, sy, sz))) continue;
    const seed = 0.37 + i * 0.173;
    const g = makeWeatheredMass(r, seed);
    // Keep local Y up so terrace beds stay world-horizontal.
    g.scale(sx * 1.02, Math.max(0.88, sy * 1.08), sz);
    g.rotateX((z + i) * 0.006);
    g.rotateY(0.02 + (i % 7) * 0.01);
    g.rotateZ(x * 0.005);
    g.translate(x, y, z);
    plantMass(g);
    g.computeVertexNormals();
    pockSandstone(g);
    g.computeVertexNormals();
    collectMassSamples(g, samples, used);
    geos.push(g);
  }

  const geo = mergeGeos(geos);
  geo.computeVertexNormals();
  carveHillsideCavities(geo);
  geo.computeVertexNormals();
  assignHillUVs(geo, 0.09);
  return { geo, samples };
}

function assignHillUVs(geo, scale) {
  const p = geo.attributes.position;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv[i * 2] = p.getX(i) * scale;
    uv[i * 2 + 1] = p.getY(i) * scale;
  }
  geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
}

function makeArch(radius, tube) {
  const radial = 68;
  const tubular = 180;
  const positions = [];
  const uvs = [];
  const colors = [];
  const indices = [];

  for (let i = 0; i <= tubular; i++) {
    const u = (i / tubular) * Math.PI;
    for (let j = 0; j <= radial; j++) {
      const v = (j / radial) * Math.PI * 2;
      const p = sculptArchPoint(u, v, radius, tube);
      positions.push(p.x, p.y, p.z);
      uvs.push((u / Math.PI) * 3.4, (v / (Math.PI * 2)) * 2.6);
      const shade = Math.max(0.78, p.shade);
      colors.push(
        shade * (1.14 - p.algae * 0.05 - p.pit * 0.08),
        shade * (0.82 - p.algae * 0.03 - p.pit * 0.06),
        shade * (0.56 - p.algae * 0.02 - p.pit * 0.05),
      );
    }
  }

  const stride = radial + 1;
  for (let i = 0; i < tubular; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * stride + j;
      const b = a + stride;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const body = new THREE.BufferGeometry();
  body.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  body.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  body.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  body.setIndex(indices);

  const extras = [body];
  const lumps = [
    [0.55, 0.12, 1.55],
    [0.72, 5.4, 1.25],
    [0.38, 2.2, 1.05],
    [0.88, 4.1, 1.35],
    [1.15, 0.85, 1.7],
    [1.95, 3.4, 1.15],
    [0.48, 1.15, 0.95],
    [2.55, 5.8, 1.05],
    [0.62, 4.6, 1.4],
    [2.42, 2.6, 0.88],
    [1.05, 2.95, 1.6],
    [0.92, 0.35, 1.2],
  ];
  for (const [u, v, s] of lumps) {
    const p = sculptArchPoint(u, v, radius, tube);
    const chunk = makePittedChunk(s);
    chunk.translate(p.x + p.nx * s * 0.15, p.y + p.ny * s * 0.15, p.z + p.nz * s * 0.15);
    extras.push(chunk);
  }

  const geo = mergeGeos(extras);
  geo.computeVertexNormals();
  return geo;
}

function makeCliff(radius) {
  const geo = new THREE.SphereGeometry(radius, 72, 56);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const col = new Float32Array(pos.count * 3);
  const bowls = [
    [0.35, 0.15, 0.55, 0.42],
    [-0.2, 0.45, 0.7, 0.38],
    [0.55, -0.1, 0.4, 0.34],
    [-0.45, 0.05, 0.62, 0.36],
    [0.1, 0.55, 0.35, 0.3],
    [0.48, 0.35, 0.15, 0.28],
  ];
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 0.16, v.y * 0.16, v.z * 0.16);
    const n2 = noise3(v.x * 0.42, v.y * 0.4, v.z * 0.44);
    const n3 = noise3(v.x * 1.05, v.y * 0.98, v.z * 1.02);
    const n4 = noise3(v.x * 2.2, v.y * 2.05, v.z * 2.15);
    v.multiplyScalar(0.78 + n * 0.32 + n2 * 0.14);
    v.y *= 0.88 + n * 0.18;
    const along = v.clone().normalize();
    if (n3 > 0.5) v.addScaledVector(along, -(n3 - 0.5) * radius * 0.46);
    if (n4 > 0.58) v.addScaledVector(along, -(n4 - 0.58) * radius * 0.28);
    const nx = v.x / (radius || 1);
    const ny = v.y / (radius || 1);
    const nz = v.z / (radius || 1);
    for (const [bx, by, bz, rad] of bowls) {
      const d = Math.hypot(nx - bx, ny - by, nz - bz);
      if (d < rad) v.addScaledVector(along, -(1 - d / rad) * (1 - d / rad) * radius * 0.52);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
    const pit = Math.max(0, n3 - 0.58) + Math.max(0, n4 - 0.64);
    const shade = 1.0 + n * 0.08 + n2 * 0.04 - pit * 0.16;
    const dust = n2 > 0.72 ? (n2 - 0.72) * 0.3 : 0;
    col[i * 3] = shade * (1.14 - dust * 0.06);
    col[i * 3 + 1] = shade * (0.82 - dust * 0.03);
    col[i * 3 + 2] = shade * (0.56 - dust * 0.02);
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeBoulder(radius) {
  const geo = new THREE.IcosahedronGeometry(radius, 4);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const col = new Float32Array(pos.count * 3);
  const seed = radius * 1.73;
  const bowls = [];
  for (let b = 0; b < 6; b++) {
    const t = seed + b * 1.67;
    bowls.push([
      Math.sin(t * 2.2) * 0.66,
      Math.cos(t * 1.5) * 0.52,
      Math.sin(t * 0.9 + 1.1) * 0.68,
      0.3 + Math.abs(Math.sin(t)) * 0.22,
    ]);
  }
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = noise3(v.x * 0.22, v.y * 0.22, v.z * 0.22);
    const n2 = noise3(v.x * 0.55, v.y * 0.5, v.z * 0.58);
    const n3 = noise3(v.x * 1.2, v.y * 1.1, v.z * 1.15);
    const n4 = noise3(v.x * 2.4, v.y * 2.2, v.z * 2.3);
    const n5 = noise3(v.x * 4.6, v.y * 4.2, v.z * 4.4);
    const nx = v.x / (radius || 1);
    const ny = v.y / (radius || 1);
    const nz = v.z / (radius || 1);
    const facet = Math.max(Math.abs(nx), Math.abs(ny * 0.85), Math.abs(nz));
    v.multiplyScalar((0.78 + n * 0.28 + n2 * 0.12) * (0.82 + facet * 0.28));
    v.y *= 0.62 + n * 0.22;
    const along = v.clone().normalize();
    if (n3 > 0.5) v.addScaledVector(along, -(n3 - 0.5) * radius * 0.46);
    if (n4 > 0.5) v.addScaledVector(along, -(n4 - 0.5) * radius * 0.52);
    if (n5 > 0.64) v.addScaledVector(along, -(n5 - 0.64) * radius * 0.28);
    if (n2 > 0.68) v.addScaledVector(along, -(n2 - 0.68) * radius * 0.54);
    for (const [bx, by, bz, rad] of bowls) {
      const d = Math.hypot(nx - bx, ny - by, nz - bz);
      if (d < rad) v.addScaledVector(along, -(1 - d / rad) * (1 - d / rad) * radius * 0.48);
    }
    pos.setXYZ(i, v.x, v.y, v.z);
    const pit = Math.max(0, n4 - 0.5) + Math.max(0, n5 - 0.64) + Math.max(0, n3 - 0.5);
    const shade = 1.02 + n * 0.08 + n3 * 0.04 - pit * 0.22;
    const dust = n2 > 0.72 ? (n2 - 0.72) * 0.3 : 0;
    col[i * 3] = shade * (0.92 - dust * 0.08);
    col[i * 3 + 1] = shade * (0.7 - dust * 0.04);
    col[i * 3 + 2] = shade * (0.46 - dust * 0.03);
  }
  pos.needsUpdate = true;
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function srgb(hex) {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

export function createWorld(scene, shared, photos = {}) {
  const group = new THREE.Group();
  group.name = "world";
  const rng = mulberry32(WORLD_SEED + 3);

  const width = 640;
  const depth = 620;
  const segX = 170;
  const segZ = 160;
  const terrainGeo = new THREE.PlaneGeometry(width, depth, segX, segZ);
  terrainGeo.rotateX(-Math.PI / 2);
  const pos = terrainGeo.attributes.position;
  const color = new THREE.Float32BufferAttribute(pos.count * 3, 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let y = terrainHeight(x, z);
    const id = Math.hypot(x - ISLAND.x, z - ISLAND.z);
    if (id < 62) y = Math.min(y, -8);
    const w = biomeWeights(x, y, z);
    const ripple = Math.sin(x * 1.65 + fbm(x * 0.08, z * 0.08) * 3.2) * (0.14 - (w.kelp || 0) * 0.08);
    const ripple2 = Math.sin(z * 2.05 + x * 0.35) * 0.07;
    const grain = Math.sin(x * 5.4) * Math.sin(z * 4.8) * 0.035;
    y += ripple + ripple2 + grain;
    pos.setY(i, y);
    const n = fbm(x * 0.07, z * 0.07);
    const wet = fbm(x * 0.03 + 4, z * 0.03);
    blendFloorColor(w, n, wet, c);
    if (id < 56) {
      const elev = islandHeight(x, z) ?? y;
      if (elev > -0.4) {
        c.setRGB(0.7, 0.54, 0.32, THREE.SRGBColorSpace);
      }
    }
    color.setXYZ(i, c.r, c.g, c.b);
  }
  terrainGeo.setAttribute("color", color);
  terrainGeo.computeVertexNormals();

  const sandMaps = makeSandMaps(512);
  const sandMat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: sandMaps.albedo,
    normalMap: sandMaps.normal,
    normalScale: new THREE.Vector2(0.85, 0.85),
    roughness: 0.88,
    metalness: 0.02,
  });
  patchUnderwater(sandMat, shared, { caustics: true, detail: "sand" });
  const sand = new THREE.Mesh(terrainGeo, sandMat);
  sand.receiveShadow = true;
  sand.position.set(0, 0, 0);
  group.add(sand);

  const stone = makeSandstoneMaps(1024);
  const stoneTex = stone.albedo;
  const stoneNrm = stone.normal;
  const stoneRgh = stone.roughness;
  const stoneTex2 = stoneTex.clone();
  stoneTex2.repeat.set(1, 1);
  const stoneNrm2 = stoneNrm.clone();
  stoneNrm2.repeat.set(1, 1);

  const rockMat = new THREE.MeshStandardMaterial({
    color: srgb(0xf6d4a0),
    map: stoneTex,
    normalMap: stoneNrm,
    normalScale: new THREE.Vector2(1.7, 1.7),
    roughnessMap: stoneRgh,
    roughness: 0.9,
    metalness: 0.0,
    vertexColors: true,
    emissive: srgb(0x4a2c0c),
    emissiveIntensity: 0.1,
  });
  patchUnderwater(rockMat, shared, { caustics: true, absorb: false, detail: "rock" });

  const mossMat = new THREE.MeshStandardMaterial({
    color: srgb(0xf0cc88),
    map: stoneTex2,
    normalMap: stoneNrm2,
    normalScale: new THREE.Vector2(1.55, 1.55),
    roughness: 0.9,
    vertexColors: true,
    emissive: srgb(0x3a2810),
    emissiveIntensity: 0.1,
  });
  patchUnderwater(mossMat, shared, { absorb: false, detail: "rock" });

  const sandRock = new THREE.MeshStandardMaterial({
    color: srgb(0xf4d4a4),
    map: stoneTex,
    normalMap: stoneNrm,
    normalScale: new THREE.Vector2(1.75, 1.75),
    roughnessMap: stoneRgh,
    roughness: 0.96,
    metalness: 0.0,
    vertexColors: true,
    emissive: srgb(0x3a2208),
    emissiveIntensity: 0.06,
  });
  patchUnderwater(sandRock, shared, { caustics: true, absorb: false, detail: "rock" });

  function placeArch(mesh, x, z, yaw = 0, tube = 3.2) {
    mesh.position.set(x, archFootY(x, z, tube), z);
    mesh.rotation.y = yaw;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  }

  const grottoBuilt = makeGrottoGeometry();
  const grottoY = grottoWorldY();
  const grottoMesh = new THREE.Mesh(grottoBuilt.geo, sandRock);
  grottoMesh.position.set(GROTTO_ORIGIN.x, grottoY, GROTTO_ORIGIN.z);
  grottoMesh.castShadow = true;
  grottoMesh.receiveShadow = true;
  group.add(grottoMesh);

  placeArch(new THREE.Mesh(makeArch(8.0, 2.8), mossMat), -42, -36, 0.55, 2.8);
  placeArch(new THREE.Mesh(makeArch(7.2, 2.5), rockMat), 26, -28, -0.4, 2.5);
  placeArch(new THREE.Mesh(makeArch(9.4, 3.0), mossMat), 186, -12, 0.2, 3.0);

  const boulders = [
    [-17.2, 4.6, 3.8],
    [-14.8, -17.2, 4.4],
    [8.8, -23.0, 3.4],
    [-8.8, -25.2, 2.8],
    [48, 22, 3.1],
    [-28, -6, 5.0],
    [32, 10, 4.8],
    [-11, 19, 3.0],
    [34, -19, 4.6],
    [6, -34, 3.8],
    [44, -8, 6.4],
    [-34, 13, 4.0],
    [160, -6, 5.6],
    [178, 14, 4.4],
    [194, -22, 6.8],
    [148, 18, 3.8],
    [4.6, 8.4, 0.85],
    [7.4, 6.8, 0.68],
    [2.4, 9.6, 0.58],
    [9.4, 8.8, 0.8],
    [-3.2, 8.2, 0.66],
    [-6.4, 7.4, 0.78],
  ];
  for (const [x, z, r] of boulders) {
    const b = new THREE.Mesh(makeBoulder(r), rng() > 0.4 ? sandRock : mossMat);
    b.position.set(x, terrainHeight(x, z) + r * 0.22, z);
    b.rotation.set(rng() * 0.6, rng() * 6, rng() * 0.5);
    b.castShadow = true;
    b.receiveShadow = true;
    group.add(b);
  }

  const wall2 = new THREE.Mesh(makeCliff(5.2), mossMat);
  wall2.scale.set(1.15, 1.4, 1.08);
  wall2.position.set(28.4, terrainHeight(28.4, 6.8) + 3.2, 6.8);
  wall2.castShadow = true;
  group.add(wall2);

  const caveDark = new THREE.Mesh(
    new THREE.SphereGeometry(1.55, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0x0c0908, roughness: 1, side: THREE.BackSide }),
  );
  patchUnderwater(caveDark.material, shared, { caustics: false, detail: "rock" });
  caveDark.scale.set(1.05, 1.15, 0.72);
  caveDark.position.set(GROTTO_ORIGIN.x + 15.8, grottoY + 5.2, GROTTO_ORIGIN.z + 4.4);
  group.add(caveDark);

  const left = new THREE.Mesh(makeBoulder(6.6), mossMat);
  left.scale.set(1.5, 1.35, 1.35);
  left.position.set(-19.2, terrainHeight(-19.2, 1.6) + 3.4, 1.6);
  left.castShadow = true;
  group.add(left);

  const footL = new THREE.Mesh(makeBoulder(3.4), sandRock);
  footL.position.set(-11.4, terrainHeight(-11.4, -8.2) + 1.2, -8.2);
  footL.castShadow = true;
  group.add(footL);
  const footR = new THREE.Mesh(makeBoulder(3.8), sandRock);
  footR.position.set(10.2, terrainHeight(10.2, -7.6) + 1.4, -7.6);
  footR.castShadow = true;
  group.add(footR);

  scene.add(group);
  const flora = createFlora(scene, shared, {
    samples: grottoBuilt.samples,
    origin: { x: GROTTO_ORIGIN.x, y: grottoY, z: GROTTO_ORIGIN.z },
    geo: grottoBuilt.geo,
    maps: { albedo: stoneTex, normal: stoneNrm, roughness: stoneRgh },
  });
  const fauna = createFauna(scene, shared);
  const regions = [
    { group: createShallowsLife(scene, shared), cx: 2, cz: 4, keep: 90, maxY: -70 },
    { group: createKelpExtras(scene, shared), cx: 186, cz: 0, keep: 100 },
    { group: createAmberFlats(scene, shared), cx: 88, cz: 188, keep: 130 },
    { group: createMushroomForest(scene, shared), cx: 224, cz: -176, keep: 140 },
    { group: createBulbGarden(scene, shared), cx: -168, cz: 164, keep: 130 },
    { group: createCrimsonMeadows(scene, shared), cx: 8, cz: -204, keep: 140 },
    // Only while actually in the cave (or looking down the shaft). keep:200 +
    // deep:true used to leave 40 point lights running in the shallows.
    { group: createJellyshroomCave(scene, shared), cx: 72, cz: 54, keep: 130, minY: -88, shaft: 26 },
    { group: createGrandReef(scene, shared), cx: -208, cz: -16, keep: 140 },
    { group: createIsland(scene, shared), cx: ISLAND.x, cz: ISLAND.z, keep: 155, maxY: -55 },
    { group: createSeabase(scene, shared), cx: SEABASE.x, cz: SEABASE.z, keep: 72, maxY: -70 },
  ];
  const seabase = regions[regions.length - 1].group;

  return {
    group,
    flora,
    fauna,
    grottoMesh,
    sand,
    seabase,
    heightAt(x, y, z) {
      const cave = y != null ? jellySwimFloor(x, y, z) : null;
      if (cave != null) return cave;
      return terrainHeight(x, z);
    },
    update(t, camera) {
      if (!camera) return;
      const px = camera.position.x;
      const py = camera.position.y;
      const pz = camera.position.z;
      const surfaceDeck = py > -95;
      if (surfaceDeck) fauna.update(t);
      if (group.visible !== surfaceDeck) group.visible = surfaceDeck;
      if (flora.group.visible !== surfaceDeck) {
        flora.group.visible = surfaceDeck;
        flora.group.traverse((o) => {
          if (o.isLight) o.visible = surfaceDeck;
        });
      }
      if (fauna.group.visible !== surfaceDeck) fauna.group.visible = surfaceDeck;
      const kelpOn = surfaceDeck && (px - 186) * (px - 186) + pz * pz < 110 * 110;
      if (flora.kelpGroup && flora.kelpGroup.visible !== kelpOn) {
        flora.kelpGroup.visible = kelpOn;
        flora.kelpGroup.traverse((o) => {
          if (o.isLight) o.visible = kelpOn;
        });
      }
      for (const r of regions) {
        const dx = px - r.cx;
        const dz = pz - r.cz;
        const d2 = dx * dx + dz * dz;
        const inShaft = r.shaft != null && d2 < r.shaft * r.shaft && py < -18;
        let near = d2 < r.keep * r.keep;
        if (r.minY != null && py > r.minY && !inShaft) near = false;
        if (r.maxY != null && py < r.maxY) near = false;
        if (inShaft) near = true;
        if (r.group.visible !== near) {
          r.group.visible = near;
          r.group.traverse((o) => {
            if (o.isLight) o.visible = near;
          });
        }
        if (near && r.group.userData.update) r.group.userData.update(t, camera);
      }
    },
  };
}
