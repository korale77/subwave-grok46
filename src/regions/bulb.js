import * as THREE from "three";
import { mulberry32, noise3 } from "../math.js";
import { patchUnderwater } from "../shaders.js";
import { mergeGeos, plantY, srgb, tint } from "./util.js";

const PHI = Math.PI * (3 - Math.sqrt(5));
const CAM = [-148, -20, 142];
const FWD = [-0.6366, -0.1273, 0.7639];
const RIGHT = [-0.7681, 0, -0.6403];

function fibDir(i, n) {
  const y = 1 - ((i + 0.5) / n) * 2;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const th = PHI * i;
  return [Math.cos(th) * r, y, Math.sin(th) * r];
}

function camXZ(along, right) {
  return [CAM[0] + along * FWD[0] + right * RIGHT[0], CAM[2] + along * FWD[2] + right * RIGHT[2]];
}

function makeSpikes(count, seed, opt) {
  const len0 = opt.len0 ?? 0.055;
  const len1 = opt.len1 ?? 0.12;
  const rad = opt.rad ?? 0.034;
  const inner0 = opt.inner ?? 0.5;
  const sides = opt.sides ?? 4;
  const pos = [];
  const col = [];
  const idx = [];
  let v = 0;
  for (let i = 0; i < count; i++) {
    let [dx, dy, dz] = fibDir(i, count);
    const n = noise3(dx * 3.1 + seed, dy * 3.4, dz * 3.1);
    const n2 = noise3(dx * 7.2, dy * 6.8 + seed, dz * 7.0);
    dx += (n - 0.5) * 0.055;
    dy += (n2 - 0.5) * 0.055;
    dz += (noise3(dz * 4.1, seed, dx * 4.1) - 0.5) * 0.055;
    const lenN = Math.hypot(dx, dy, dz) || 1;
    dx /= lenN;
    dy /= lenN;
    dz /= lenN;
    if (opt.up) {
      dy = Math.abs(dy) * 0.52 + 0.48;
      const n2l = Math.hypot(dx, dy, dz) || 1;
      dx /= n2l;
      dy /= n2l;
      dz /= n2l;
    }
    const len = len0 + (len1 - len0) * (0.35 + n * 0.5 + n2 * 0.15);
    const inner = inner0 + n * 0.015;
    const br = rad * (0.78 + n * 0.4);
    const tipX = dx * (inner + len);
    const tipY = dy * (inner + len);
    const tipZ = dz * (inner + len);
    const ux = Math.abs(dy) < 0.92 ? 0 : 1;
    const uy = Math.abs(dy) < 0.92 ? 1 : 0;
    let bx = -dz * uy;
    let by = dz * ux;
    let bz = dx * uy - dy * ux;
    const bl = Math.hypot(bx, by, bz) || 1;
    bx /= bl;
    by /= bl;
    bz /= bl;
    const cx = dy * bz - dz * by;
    const cy = dz * bx - dx * bz;
    const cz = dx * by - dy * bx;
    pos.push(tipX, tipY, tipZ);
    col.push(0.78 + n * 0.16, 0.2 + n * 0.1, 0.92 + n * 0.08);
    const tip = v++;
    const base = v;
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pos.push(dx * inner + (bx * ca + cx * sa) * br, dy * inner + (by * ca + cy * sa) * br, dz * inner + (bz * ca + cz * sa) * br);
      col.push(0.48 + n * 0.1, 0.08 + n * 0.04, 0.7 + n * 0.1);
      v++;
    }
    for (let s = 0; s < sides; s++) idx.push(tip, base + s, base + ((s + 1) % sides));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function makeKoosh(spikeN, seed, opt = {}) {
  const coreR = opt.coreR ?? 0.22;
  const core = new THREE.SphereGeometry(coreR, 16, 12);
  const pos = core.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = noise3(x * 3.4 + seed, y * 3.2, z * 3.4);
    const n2 = noise3(x * 8.2, y * 7.6 + seed, z * 8.0);
    const bump = 1 + n * 0.28 + n2 * 0.12;
    const lift = y > 0 ? 1.15 : 0.82;
    pos.setXYZ(i, x * bump * 1.05, y * bump * lift, z * bump * 1.05);
    col[i * 3] = 0.42 + n * 0.14;
    col[i * 3 + 1] = 0.08 + n * 0.05;
    col[i * 3 + 2] = 0.62 + n * 0.14;
  }
  core.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const fibers = makeSpikes(spikeN, seed, {
    len0: opt.len0 ?? 0.2,
    len1: opt.len1 ?? 0.48,
    rad: opt.rad ?? 0.016,
    inner: opt.inner ?? 0.16,
    sides: opt.sides ?? 4,
    up: true,
  });
  return mergeGeos([core, fibers]);
}

function makeStem() {
  const pts = [];
  const h = 0.82;
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    let r;
    if (t < 0.16) {
      const u = t / 0.16;
      r = 0.34 - u * 0.08;
    } else if (t < 0.52) {
      const u = (t - 0.16) / 0.36;
      const s = u * u * (3 - 2 * u);
      r = 0.26 - s * 0.07;
    } else if (t < 0.8) {
      const u = (t - 0.52) / 0.28;
      r = 0.19 + u * 0.05;
    } else {
      const u = (t - 0.8) / 0.2;
      const s = u * u * (2.2 - u);
      r = 0.24 + s * 0.34;
    }
    pts.push(new THREE.Vector2(r, t * h));
  }
  const geo = new THREE.LatheGeometry(pts, 18);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const a = Math.atan2(z, x);
    const n = noise3(x * 2.4, y * 0.7, z * 2.4);
    const fold = 1 + Math.sin(a * 10 + n * 1.6) * 0.12 + n * 0.04;
    pos.setXYZ(i, x * fold, y, z * fold);
    const t = y / h;
    col[i * 3] = 0.72 + t * 0.1 + n * 0.04;
    col[i * 3 + 1] = 0.7 + t * 0.08 + n * 0.03;
    col[i * 3 + 2] = 0.74 + t * 0.08 + n * 0.04;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeFleshyRing(radius, tube, seed) {
  const geo = new THREE.TorusGeometry(radius, tube, 14, 36);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = noise3(x * 0.7 + seed, y * 0.7, z * 1.1 + seed);
    const along = Math.hypot(x, y) / Math.max(radius, 0.01);
    pos.setXYZ(i, x * (1 + n * 0.1), y * (1 + n * 0.1), z * 0.85 + n * 0.1);
    const inner = 1 - Math.abs(along - 1);
    col[i * 3] = 0.92 + n * 0.06 + inner * 0.05;
    col[i * 3 + 1] = 0.38 + n * 0.1 + inner * 0.2;
    col[i * 3 + 2] = 0.48 + n * 0.08 + inner * 0.16;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeOstium(r, seed) {
  const depth = r * 0.16;
  const parts = [];
  const profile = [];
  for (let i = 0; i <= 14; i++) {
    const t = i / 14;
    const lip = t < 0.16 ? Math.sin((t / 0.16) * Math.PI) * r * 0.12 : 0;
    const rad = r * (1.06 - t * 0.78) + lip;
    profile.push(new THREE.Vector2(Math.max(rad, r * 0.16), -t * depth));
  }
  const bowl = new THREE.LatheGeometry(profile, 28);
  bowl.rotateX(-Math.PI / 2);
  const bp = bowl.attributes.position;
  const bc = new Float32Array(bp.count * 3);
  for (let i = 0; i < bp.count; i++) {
    const z = bp.getZ(i);
    const n = noise3(bp.getX(i) * 1.4 + seed, bp.getY(i) * 1.4, z * 1.6);
    const u = Math.min(1, Math.max(0, z / depth));
    bc[i * 3] = 0.92 - u * 0.74 + n * 0.05;
    bc[i * 3 + 1] = 0.36 - u * 0.26 + n * 0.04;
    bc[i * 3 + 2] = 0.46 - u * 0.34 + n * 0.03;
  }
  bowl.setAttribute("color", new THREE.Float32BufferAttribute(bc, 3));
  parts.push(bowl);

  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const ring = makeFleshyRing(r * (0.98 - t * 0.58), r * (0.07 - t * 0.008), seed + i * 0.7);
    ring.translate(0, 0, t * depth);
    parts.push(ring);
  }

  const hole = new THREE.CircleGeometry(r * 0.2, 20);
  hole.translate(0, 0, depth);
  const hp = hole.attributes.position;
  const hc = new Float32Array(hp.count * 3);
  for (let i = 0; i < hp.count; i++) {
    hc[i * 3] = 0.05;
    hc[i * 3 + 1] = 0.018;
    hc[i * 3 + 2] = 0.03;
  }
  hole.setAttribute("color", new THREE.Float32BufferAttribute(hc, 3));
  parts.push(hole);
  return mergeGeos(parts);
}

function makeDarkRock(rx, ry, rz, seed) {
  const geo = new THREE.SphereGeometry(1, 40, 28);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = noise3(x * 1.15 + seed, y * 1.05, z * 1.15);
    const n2 = noise3(x * 2.8, y * 2.5 + seed, z * 2.7);
    const n3 = noise3(x * 6.8 + seed, y * 6.2, z * 6.5);
    const n4 = noise3(x * 13.2, y * 12.4 + seed, z * 12.8);
    const bowl = n2 > 0.44 ? Math.pow(n2 - 0.44, 1.15) * 1.05 : 0;
    const pit = n3 > 0.52 ? (n3 - 0.52) * 0.72 : 0;
    const pore = n4 > 0.64 ? (n4 - 0.64) * 0.48 : 0;
    let k = 1 + n * 0.34 + n2 * 0.16 - bowl - pit - pore;
    if (y < 0.08) {
      k += (-y) * (0.14 + n * 0.2);
      if (n3 > 0.42) k -= (n3 - 0.42) * 0.85;
    }
    pos.setXYZ(i, x * rx * k, y * ry * k, z * rz * k);
    const moss = n > 0.46 ? (n - 0.46) * 0.22 : 0;
    const crust = n2 > 0.5 ? (n2 - 0.5) * 0.16 : 0;
    col[i * 3] = 0.1 + n * 0.08 + n2 * 0.04 + crust * 0.22;
    col[i * 3 + 1] = 0.09 + n * 0.07 + moss + crust * 0.08;
    col[i * 3 + 2] = 0.08 + n * 0.05 + crust * 0.1;
    if (bowl > 0.05 || pit > 0.05 || y < -0.2) {
      col[i * 3] *= 0.36;
      col[i * 3 + 1] *= 0.42;
      col[i * 3 + 2] *= 0.36;
    }
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function carveCraters(geo, craters) {
  const pos = geo.attributes.position;
  const col = geo.attributes.color;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    let band = -1;
    for (const c of craters) {
      const dx = x - c.x;
      const dy = y - c.y;
      const dz = z - c.z;
      const along = dx * c.nx + dy * c.ny + dz * c.nz;
      const px = dx - along * c.nx;
      const py = dy - along * c.ny;
      const pz = dz - along * c.nz;
      const rad = Math.hypot(px, py, pz);
      if (rad >= c.r * 1.22) continue;
      const u = rad / c.r;
      const rim = u < 1 ? 1 : Math.max(0, 1 - (u - 1) / 0.22);
      const bowl = Math.max(0, 1 - u * u) * c.depth * rim;
      if (along > -c.depth * 1.2 && along < c.r * 0.55) {
        const target = -bowl;
        if (along > target) {
          const push = (along - target) * rim;
          x -= c.nx * push;
          y -= c.ny * push;
          z -= c.nz * push;
        }
        if (u < 1.05) band = Math.max(band, u);
      }
    }
    pos.setXYZ(i, x, y, z);
    if (col && band >= 0) {
      const ring = 0.5 + 0.5 * Math.cos(band * Math.PI * 6.2);
      const inner = 1 - band;
      col.setXYZ(
        i,
        0.12 + inner * 0.18 + ring * 0.72,
        0.04 + inner * 0.06 + ring * 0.22,
        0.05 + inner * 0.08 + ring * 0.26,
      );
    }
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
}

function makeFish() {
  const body = new THREE.SphereGeometry(0.15, 8, 6);
  body.scale(0.42, 0.58, 1.65);
  tint(body, 0.58, 0.84, 0.9);
  const tail = new THREE.ConeGeometry(0.1, 0.2, 4);
  tail.rotateX(-Math.PI / 2);
  tail.translate(0, 0, -0.28);
  tint(tail, 0.42, 0.68, 0.76);
  return mergeGeos([body, tail]);
}

function tooClose(specs, x, z, pad) {
  for (const s of specs) {
    const dx = s.x - x;
    const dz = s.z - z;
    const min = (s.sc + pad) * 1.18;
    if (dx * dx + dz * dz < min * min) return true;
  }
  return false;
}

function nearPillar(x, z) {
  const dR = (x + 168.5) * (x + 168.5) + (z - 146.5) * (z - 146.5);
  if (dR < 9.2 * 9.2) return true;
  const dL = (x + 152.5) * (x + 152.5) + (z - 174) * (z - 174);
  return dL < 7.4 * 7.4;
}

export function createBulbGarden(scene, shared) {
  const group = new THREE.Group();
  group.name = "bulb-garden";
  const rng = mulberry32(4410);

  const kooshMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.38,
    metalness: 0.04,
    vertexColors: true,
    emissive: srgb(0x401060),
    emissiveIntensity: 0.62,
  });
  patchUnderwater(kooshMat, shared, { caustics: true, detail: "coral", absorb: false });
  const stemMat = new THREE.MeshStandardMaterial({
    color: srgb(0xc4bec8),
    roughness: 0.7,
    metalness: 0.02,
    vertexColors: true,
    emissive: srgb(0x6a6470),
    emissiveIntensity: 0.32,
  });
  patchUnderwater(stemMat, shared, { caustics: true });
  const beadMat = new THREE.MeshStandardMaterial({
    color: srgb(0x6ef4ff),
    emissive: srgb(0x24c4e0),
    emissiveIntensity: 0.88,
    roughness: 0.1,
    metalness: 0.28,
  });
  patchUnderwater(beadMat, shared, { caustics: true, absorb: false });
  const fleshMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.5,
    metalness: 0.02,
    vertexColors: true,
    emissive: srgb(0xb02048),
    emissiveIntensity: 0.58,
  });
  patchUnderwater(fleshMat, shared, { caustics: false, detail: "coral", absorb: false });
  const rockMat = new THREE.MeshStandardMaterial({
    color: srgb(0x243028),
    roughness: 0.94,
    metalness: 0.02,
    vertexColors: true,
    emissive: srgb(0x121810),
    emissiveIntensity: 0.12,
  });
  patchUnderwater(rockMat, shared, { caustics: true, detail: "coral" });
  const fishMat = new THREE.MeshStandardMaterial({
    color: srgb(0xc8eef4),
    roughness: 0.28,
    metalness: 0.32,
    vertexColors: true,
  });
  patchUnderwater(fishMat, shared, { caustics: true });

  const kooshA = makeKoosh(720, 1.15, { rad: 0.032, len0: 0.28, len1: 0.72, inner: 0.14, coreR: 0.18 });
  const kooshB = makeKoosh(680, 4.8, { rad: 0.034, len0: 0.26, len1: 0.68, inner: 0.13, coreR: 0.17 });
  const heroKoosh = makeKoosh(980, 2.2, { rad: 0.03, len0: 0.32, len1: 0.82, inner: 0.15, sides: 5, coreR: 0.2 });
  const stemGeo = makeStem();
  const beadGeo = new THREE.SphereGeometry(1, 8, 6);

  const specs = [
    { x: camXZ(15, -6.4)[0], z: camXZ(15, -6.4)[1], sc: 2.85, hero: true },
    { x: camXZ(20, -11.2)[0], z: camXZ(20, -11.2)[1], sc: 2.55, hero: true },
    { x: camXZ(21, -1.2)[0], z: camXZ(21, -1.2)[1], sc: 3.3, hero: true },
    { x: camXZ(24, 4.4)[0], z: camXZ(24, 4.4)[1], sc: 2.6, hero: true },
    { x: camXZ(28, -6.0)[0], z: camXZ(28, -6.0)[1], sc: 2.95, hero: true },
    { x: camXZ(32, 2.4)[0], z: camXZ(32, 2.4)[1], sc: 3.45, hero: true },
    { x: camXZ(34, -10.2)[0], z: camXZ(34, -10.2)[1], sc: 2.25, hero: true },
    { x: camXZ(36, 6.4)[0], z: camXZ(36, 6.4)[1], sc: 2.35, hero: true },
    { x: camXZ(41, -2.2)[0], z: camXZ(41, -2.2)[1], sc: 3.05, hero: true },
    { x: camXZ(45, 3.8)[0], z: camXZ(45, 3.8)[1], sc: 2.2, hero: true },
  ];
  const far = [
    [50, -6, 1.15],
    [52, 2.4, 1.05],
    [54, 8, 0.95],
    [48, -12, 1.2],
    [58, -2, 0.88],
    [56, 5.5, 0.92],
    [62, -8, 0.8],
    [60, 1, 0.78],
    [64, 6, 0.72],
    [46, 10, 0.85],
  ];
  for (const [along, right, sc] of far) {
    const [x, z] = camXZ(along, right);
    if (!nearPillar(x, z) && !tooClose(specs, x, z, sc)) specs.push({ x, z, sc, hero: false });
  }
  const clusters = [
    [52, -4, 10, 5],
    [58, 4, 9, 4],
    [64, -6, 11, 4],
    [48, 8, 8, 3],
  ];
  for (const [along, right, rad, n] of clusters) {
    const [cx, cz] = camXZ(along, right);
    for (let k = 0; k < n && specs.length < 34; k++) {
      const a = rng() * Math.PI * 2;
      const rr = Math.sqrt(rng()) * rad;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      const sc = 0.7 + rng() * 0.55;
      if (nearPillar(x, z) || tooClose(specs, x, z, sc)) continue;
      specs.push({ x, z, sc, hero: false });
    }
  }

  const dummy = new THREE.Object3D();
  const regular = specs.filter((s) => !s.hero);
  const meshA = new THREE.InstancedMesh(kooshA, kooshMat, Math.max(regular.length, 1));
  const meshB = new THREE.InstancedMesh(kooshB, kooshMat, Math.max(regular.length, 1));
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, Math.max(regular.length, 1));
  meshA.frustumCulled = meshB.frustumCulled = stems.frustumCulled = false;
  meshA.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(regular.length, 1) * 3), 3);
  meshB.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(regular.length, 1) * 3), 3);
  const icol = new THREE.Color();
  let ia = 0;
  let ib = 0;
  const beadSpecs = [];
  const BUSH_Y = 0.42;

  function placeBead(x, y, z, sc, count) {
    for (let b = 0; b < count; b++) {
      const [dx, dy, dz] = fibDir(b * 2 + Math.floor(rng() * 7), count * 2);
      const reach = (0.56 + rng() * 0.1) * sc;
      beadSpecs.push({
        x: x + dx * reach,
        y: y + dy * reach,
        z: z + dz * reach,
        s: (0.055 + rng() * 0.045) * sc,
      });
    }
  }

  for (let i = 0; i < regular.length; i++) {
    const { x, z, sc } = regular[i];
    const y = plantY(x, z, -0.06);
    const leanX = (rng() - 0.5) * 0.12;
    const leanZ = (rng() - 0.5) * 0.09;
    const yaw = rng() * Math.PI * 2;
    dummy.position.set(x, y - 0.12 * sc, z);
    dummy.rotation.set(leanX, yaw, leanZ);
    dummy.scale.set(sc * 0.72, sc * 0.55, sc * 0.72);
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + BUSH_Y * sc, z);
    dummy.scale.set(sc, sc * (0.94 + rng() * 0.06), sc);
    dummy.updateMatrix();
    icol.setRGB(0.82, 0.34 + rng() * 0.1, 1, THREE.SRGBColorSpace);
    if (i & 1) {
      meshA.setMatrixAt(ia, dummy.matrix);
      meshA.instanceColor.setXYZ(ia, icol.r, icol.g, icol.b);
      ia++;
    } else {
      meshB.setMatrixAt(ib, dummy.matrix);
      meshB.instanceColor.setXYZ(ib, icol.r, icol.g, icol.b);
      ib++;
    }
    placeBead(x, y + BUSH_Y * sc, z, sc, 8 + Math.floor(sc * 3));
  }
  meshA.count = ia;
  meshB.count = ib;
  stems.count = regular.length;
  meshA.castShadow = meshB.castShadow = stems.castShadow = false;
  group.add(stems, meshA, meshB);

  const heroes = specs.filter((s) => s.hero);
  const heroGeos = [heroKoosh, kooshA, kooshB];
  for (let i = 0; i < heroes.length; i++) {
    const { x, z, sc } = heroes[i];
    const y = plantY(x, z, -0.08);
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.set(x, y - 0.1 * sc, z);
    stem.scale.set(sc * 0.7, sc * 0.52, sc * 0.7);
    stem.rotation.y = rng() * 6.28;
    stem.rotation.x = (rng() - 0.5) * 0.1;
    stem.castShadow = true;
    group.add(stem);
    const bush = new THREE.Mesh(heroGeos[i % 3], kooshMat);
    bush.position.set(x, y + BUSH_Y * sc, z);
    bush.scale.set(sc, sc * 0.96, sc);
    bush.castShadow = true;
    group.add(bush);
    placeBead(x, y + BUSH_Y * sc, z, sc, 16 + Math.floor(sc * 4));
  }

  const beads = new THREE.InstancedMesh(beadGeo, beadMat, Math.max(beadSpecs.length, 1));
  beads.frustumCulled = false;
  beads.castShadow = false;
  for (let i = 0; i < beadSpecs.length; i++) {
    const b = beadSpecs[i];
    dummy.position.set(b.x, b.y, b.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(b.s);
    dummy.updateMatrix();
    beads.setMatrixAt(i, dummy.matrix);
  }
  beads.count = beadSpecs.length;
  group.add(beads);

  const rockSpecs = [
    [-161.2, -6.2, 157.8, 16.4, 7.4, 12.4, 2.4],
    [-170.2, -6.8, 151.6, 11.6, 8.8, 10.2, 3.7],
    [-151.8, -7.4, 164.4, 10.6, 6.8, 9.6, 4.2],
    [-170.4, -5.0, 168.2, 13.2, 8.0, 11.0, 5.0],
    [-166.2, -7.8, 148.8, 8.8, 8.2, 7.8, 8.0],
    [-164.8, -5.6, 163.6, 10.4, 6.6, 9.4, 6.4],
    [-174.2, -10.6, 150.6, 8.8, 10.0, 8.6, 3.1],
    [-148.6, -8.4, 158.8, 7.6, 6.0, 7.2, 4.8],
    [-156.8, -6.4, 150.8, 9.2, 5.4, 7.6, 1.4],
  ];
  const rockGeos = [];
  for (const [x, y, z, rx, ry, rz, seed] of rockSpecs) {
    const g = makeDarkRock(rx, ry, rz, seed);
    g.translate(x, y, z);
    rockGeos.push(g);
  }

  const pillars = [
    [-168.5, 146.5, 7.6, 17.8, 8.2, 6.2],
    [-169.6, 145.2, 8.4, 8.0, 8.8, 7.1],
    [-172.4, 148.8, 7.0, 12.6, 6.8, 5.5],
    [-152.5, 174.0, 5.4, 14.8, 5.8, 8.8],
    [-151.4, 175.2, 6.0, 6.6, 6.4, 9.4],
  ];
  for (const [x, z, rx, ry, rz, seed] of pillars) {
    const fy = plantY(x, z, 0);
    const g = makeDarkRock(rx, ry, rz, seed);
    g.translate(x, fy + ry * 0.42, z);
    rockGeos.push(g);
  }

  const lookPt = new THREE.Vector3(CAM[0], CAM[1] - 1.4, CAM[2]);
  const ostiumA = makeOstium(1, 0.4);
  const ostiumB = makeOstium(1, 1.8);
  const ostiumC = makeOstium(1, 3.1);
  const ostGeos = [ostiumA, ostiumB, ostiumC];
  const craters = [];
  const nearOstia = [
    [12.4, 0.4, -12.4, 2.15, 0],
    [13.2, -3.4, -12.6, 1.85, 1],
    [13.6, 3.4, -12.55, 1.75, 2],
    [11.4, -2.2, -12.9, 1.62, 0],
    [11.8, 2.8, -12.85, 1.52, 1],
    [14.6, -5.4, -12.75, 1.48, 2],
    [15.0, 5.2, -12.7, 1.42, 0],
    [15.6, 0.8, -12.85, 1.72, 1],
    [10.8, 0.2, -13.1, 1.55, 2],
    [14.2, -1.6, -12.5, 1.35, 0],
    [16.4, -3.0, -12.95, 1.28, 1],
    [16.0, 3.6, -12.9, 1.22, 2],
  ];
  for (const [along, right, y, sc, kind] of nearOstia) {
    const [x, z] = camXZ(along, right);
    let nx = lookPt.x - x;
    let ny = lookPt.y - y;
    let nz = lookPt.z - z;
    const nl = Math.hypot(nx, ny, nz) || 1;
    craters.push({ x, y, z, r: sc * 1.1, depth: sc * 0.7, nx: nx / nl, ny: ny / nl, nz: nz / nl });
    const m = new THREE.Mesh(ostGeos[kind], fleshMat);
    m.position.set(x, y, z);
    m.scale.setScalar(sc);
    m.lookAt(lookPt);
    m.rotateZ((rng() - 0.5) * 0.8);
    group.add(m);
  }

  const archGeo = mergeGeos(rockGeos);
  carveCraters(archGeo, craters);
  const arch = new THREE.Mesh(archGeo, rockMat);
  arch.castShadow = true;
  arch.receiveShadow = true;
  group.add(arch);

  const FISH_N = 36;
  const school = new THREE.InstancedMesh(makeFish(), fishMat, FISH_N);
  school.frustumCulled = false;
  school.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FISH_N * 3), 3);
  const fishInfo = [];
  for (let i = 0; i < FISH_N; i++) {
    const near = i < 16;
    const [fx, fz] = near ? camXZ(14 + rng() * 12, -8 + rng() * 14) : camXZ(24 + rng() * 36, -16 + rng() * 28);
    const fy = plantY(fx, fz, (near ? 1.6 : 3.4) + rng() * (near ? 4.2 : 7));
    fishInfo.push({
      cx: fx,
      cy: fy,
      cz: fz,
      rx: 1.8 + rng() * 4.5,
      rz: 1.6 + rng() * 4.2,
      spd: 0.55 + rng() * 1.35,
      ph: rng() * 6.28,
      sc: 0.55 + rng() * 0.75,
    });
    icol.setRGB(0.62 + rng() * 0.3, 0.82 + rng() * 0.16, 0.88 + rng() * 0.12, THREE.SRGBColorSpace);
    school.instanceColor.setXYZ(i, icol.r, icol.g, icol.b);
    dummy.position.set(fx, fy, fz);
    dummy.scale.setScalar(fishInfo[i].sc);
    dummy.rotation.set(0, rng() * 6.28, 0);
    dummy.updateMatrix();
    school.setMatrixAt(i, dummy.matrix);
  }
  group.add(school);

  const h0 = heroes[5] || heroes[0];
  const lamp0 = new THREE.PointLight(0xb048e0, 2.6, 24, 1.5);
  lamp0.position.set(h0.x, plantY(h0.x, h0.z, BUSH_Y * h0.sc), h0.z);
  group.add(lamp0);
  const h1 = heroes[0];
  const lamp1 = new THREE.PointLight(0x8040d0, 2.1, 18, 1.55);
  lamp1.position.set(h1.x, plantY(h1.x, h1.z, BUSH_Y * h1.sc), h1.z);
  group.add(lamp1);
  const caveLamp = new THREE.PointLight(0xe87090, 2.4, 22, 1.4);
  caveLamp.position.set(-160.5, -13.4, 156.5);
  group.add(caveLamp);

  group.userData.update = (t) => {
    for (let i = 0; i < FISH_N; i++) {
      const f = fishInfo[i];
      const ang = t * f.spd + f.ph;
      const dart = Math.sin(t * f.spd * 2.8 + f.ph * 1.4);
      const kick = dart * dart * dart;
      const x = f.cx + Math.sin(ang) * f.rx + kick * 0.7 * Math.cos(ang);
      const z = f.cz + Math.cos(ang * 0.84) * f.rz;
      const y = f.cy + Math.sin(ang * 1.55) * 0.55;
      dummy.position.set(x, y, z);
      dummy.scale.setScalar(f.sc);
      dummy.rotation.set(Math.sin(ang * 1.8) * 0.18, Math.atan2(Math.cos(ang) * f.rx, -Math.sin(ang * 0.84) * f.rz), Math.sin(ang * 2.1) * 0.16);
      dummy.updateMatrix();
      school.setMatrixAt(i, dummy.matrix);
    }
    school.instanceMatrix.needsUpdate = true;
  };

  scene.add(group);
  return group;
}
