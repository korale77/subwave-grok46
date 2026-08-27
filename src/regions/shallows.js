import * as THREE from "three";
import { mulberry32 } from "../math.js";
import { patchUnderwater } from "../shaders.js";
import { mergeGeos, plantY, srgb, tint } from "./util.js";

// Extra life around the existing grotto. Crust / vases stay in flora.js.

const GROTTO = { x: -0.35, z: -6.6, winX: 0.55, winY: 8.15 };

function taperBody(len, ht, wd, segs = 16, rings = 12) {
  const g = new THREE.SphereGeometry(1, segs, rings);
  g.rotateZ(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getX(i) + 1) * 0.5;
    const mid = Math.exp(-((t - 0.5) * (t - 0.5)) / 0.125);
    let s = 0.16 + 0.84 * mid;
    if (t < 0.16) s *= 0.32 + t * 4.25;
    if (t > 0.84) s *= Math.max(0.16, 1 - (t - 0.84) * 3.9);
    let y = p.getY(i) * s * ht;
    const z = p.getZ(i) * s * wd;
    if (y < 0) y *= 1.12;
    p.setXYZ(i, (t - 0.48) * len, y, z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function shadeHeight(geo, dark = 0.58, light = 1.14) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const span = maxY - minY || 1;
  for (let i = 0; i < p.count; i++) {
    const u = (p.getY(i) - minY) / span;
    const v = light + (dark - light) * u * u;
    col[i * 3] = v;
    col[i * 3 + 1] = v;
    col[i * 3 + 2] = v;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function paintStripes(geo, dark, light, freq = 7.2) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const stripe = 0.5 + 0.5 * Math.sin(x * freq + y * 0.8);
    const band = stripe > 0.58 ? 1 : stripe > 0.46 ? (stripe - 0.46) / 0.12 : 0;
    const belly = Math.max(0, -y * 2.1);
    col[i * 3] = dark[0] + band * (light[0] - dark[0]) + belly * 0.16;
    col[i * 3 + 1] = dark[1] + band * (light[1] - dark[1]) + belly * 0.14;
    col[i * 3 + 2] = dark[2] + band * (light[2] - dark[2]) + belly * 0.08;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function makeSchoolFish() {
  const body = taperBody(0.48, 0.15, 0.078, 12, 9);
  const tailUp = new THREE.ConeGeometry(0.078, 0.24, 5);
  tailUp.rotateZ(Math.PI / 2);
  tailUp.scale(1, 1.65, 0.14);
  tailUp.rotateZ(0.5);
  tailUp.translate(-0.32, 0.085, 0);
  tint(tailUp, 0.86, 0.86, 0.86);
  const tailDn = new THREE.ConeGeometry(0.066, 0.2, 5);
  tailDn.rotateZ(Math.PI / 2);
  tailDn.scale(1, 1.4, 0.14);
  tailDn.rotateZ(-0.44);
  tailDn.translate(-0.3, -0.065, 0);
  tint(tailDn, 0.84, 0.84, 0.84);
  const dorsal = new THREE.ConeGeometry(0.058, 0.15, 4);
  dorsal.scale(1.15, 1, 0.15);
  dorsal.translate(0.02, 0.165, 0);
  tint(dorsal, 0.74, 0.74, 0.74);
  const pecL = new THREE.ConeGeometry(0.036, 0.1, 4);
  pecL.rotateX(1.12);
  pecL.rotateZ(-0.52);
  pecL.scale(1, 1, 0.2);
  pecL.translate(0.055, 0, 0.065);
  tint(pecL, 0.78, 0.78, 0.78);
  const pecR = pecL.clone();
  pecR.rotateX(-2.24);
  pecR.translate(0, 0, -0.13);
  return shadeHeight(mergeGeos([body, tailUp, tailDn, dorsal, pecL, pecR]), 0.56, 1.18);
}

function makePeeper() {
  const body = new THREE.SphereGeometry(0.3, 16, 14);
  body.scale(1.28, 1.04, 0.9);
  const pos = body.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const back = Math.max(0, -pos.getX(i) * 0.55 + 0.12);
    col[i * 3] = 0.94 - back * 0.38 + Math.max(0, y) * 0.04;
    col[i * 3 + 1] = 0.9 - back * 0.22;
    col[i * 3 + 2] = 0.74 + back * 0.08;
    if (z > 0.2) {
      col[i * 3] = 0.96;
      col[i * 3 + 1] = 0.95;
      col[i * 3 + 2] = 0.9;
    }
  }
  body.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const tail = new THREE.ConeGeometry(0.13, 0.3, 7);
  tail.rotateZ(Math.PI / 2);
  tail.scale(1, 1.15, 0.22);
  tail.translate(-0.42, 0, 0);
  tint(tail, 0.52, 0.62, 0.5);
  const tailTip = new THREE.ConeGeometry(0.07, 0.16, 5);
  tailTip.rotateZ(Math.PI / 2);
  tailTip.scale(1, 1.4, 0.18);
  tailTip.translate(-0.56, 0.04, 0);
  tint(tailTip, 0.42, 0.52, 0.44);
  const eyeL = new THREE.SphereGeometry(0.125, 14, 12);
  eyeL.translate(0.16, 0.09, 0.22);
  tint(eyeL, 0.06, 0.1, 0.16);
  const eyeR = new THREE.SphereGeometry(0.125, 14, 12);
  eyeR.translate(0.16, 0.09, -0.22);
  tint(eyeR, 0.06, 0.1, 0.16);
  const rimL = new THREE.TorusGeometry(0.13, 0.022, 6, 14);
  rimL.translate(0.16, 0.09, 0.22);
  tint(rimL, 0.22, 0.62, 0.82);
  const rimR = new THREE.TorusGeometry(0.13, 0.022, 6, 14);
  rimR.translate(0.16, 0.09, -0.22);
  tint(rimR, 0.22, 0.62, 0.82);
  const glintL = new THREE.SphereGeometry(0.028, 6, 5);
  glintL.translate(0.22, 0.13, 0.28);
  tint(glintL, 0.85, 0.95, 1);
  const glintR = new THREE.SphereGeometry(0.028, 6, 5);
  glintR.translate(0.22, 0.13, -0.28);
  tint(glintR, 0.85, 0.95, 1);
  const fin = new THREE.ConeGeometry(0.07, 0.16, 5);
  fin.scale(1.2, 1, 0.18);
  fin.rotateZ(-0.2);
  fin.translate(-0.02, 0.22, 0);
  tint(fin, 0.48, 0.62, 0.52);
  return mergeGeos([body, tail, tailTip, eyeL, eyeR, rimL, rimR, glintL, glintR, fin]);
}

function makeStripeJack() {
  const body = taperBody(1.05, 0.26, 0.14, 18, 12);
  const tailUp = new THREE.ConeGeometry(0.1, 0.34, 6);
  tailUp.rotateZ(Math.PI / 2);
  tailUp.scale(1, 1.7, 0.16);
  tailUp.rotateZ(0.48);
  tailUp.translate(-0.66, 0.14, 0);
  tint(tailUp, 0.18, 0.2, 0.12);
  const tailDn = new THREE.ConeGeometry(0.08, 0.26, 6);
  tailDn.rotateZ(Math.PI / 2);
  tailDn.scale(1, 1.4, 0.16);
  tailDn.rotateZ(-0.42);
  tailDn.translate(-0.62, -0.1, 0);
  tint(tailDn, 0.16, 0.18, 0.1);
  const dorsal = new THREE.ConeGeometry(0.09, 0.28, 5);
  dorsal.scale(1.25, 1, 0.16);
  dorsal.rotateZ(-0.18);
  dorsal.translate(0.06, 0.28, 0);
  tint(dorsal, 0.14, 0.16, 0.1);
  const pecL = new THREE.ConeGeometry(0.055, 0.2, 5);
  pecL.rotateX(1.05);
  pecL.rotateZ(-0.6);
  pecL.scale(1, 1, 0.18);
  pecL.translate(0.14, -0.02, 0.12);
  tint(pecL, 0.2, 0.22, 0.12);
  const pecR = new THREE.ConeGeometry(0.055, 0.2, 5);
  pecR.rotateX(-1.05);
  pecR.rotateZ(-0.6);
  pecR.scale(1, 1, 0.18);
  pecR.translate(0.14, -0.02, -0.12);
  tint(pecR, 0.2, 0.22, 0.12);
  const eyeL = new THREE.SphereGeometry(0.045, 8, 6);
  eyeL.translate(0.38, 0.06, 0.1);
  tint(eyeL, 0.08, 0.08, 0.06);
  const eyeR = new THREE.SphereGeometry(0.045, 8, 6);
  eyeR.translate(0.38, 0.06, -0.1);
  tint(eyeR, 0.08, 0.08, 0.06);
  return paintStripes(mergeGeos([body, tailUp, tailDn, dorsal, pecL, pecR, eyeL, eyeR]), [0.12, 0.16, 0.08], [0.92, 0.78, 0.28], 8.4);
}

function makeWrasse() {
  const body = taperBody(0.82, 0.28, 0.16, 16, 12);
  const pos = body.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const t = (x + 0.4) / 0.82;
    const belly = Math.max(0, -y * 2.4);
    col[i * 3] = 0.12 + t * 0.55 + belly * 0.35;
    col[i * 3 + 1] = 0.42 + t * 0.22 + belly * 0.18;
    col[i * 3 + 2] = 0.52 - t * 0.18 + belly * 0.05;
    if (y > 0.08) {
      col[i * 3] += 0.08;
      col[i * 3 + 1] += 0.12;
    }
  }
  body.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const tailUp = new THREE.ConeGeometry(0.09, 0.28, 5);
  tailUp.rotateZ(Math.PI / 2);
  tailUp.scale(1, 1.55, 0.16);
  tailUp.rotateZ(0.46);
  tailUp.translate(-0.52, 0.11, 0);
  tint(tailUp, 0.88, 0.42, 0.55);
  const tailDn = new THREE.ConeGeometry(0.075, 0.22, 5);
  tailDn.rotateZ(Math.PI / 2);
  tailDn.scale(1, 1.3, 0.16);
  tailDn.rotateZ(-0.4);
  tailDn.translate(-0.48, -0.09, 0);
  tint(tailDn, 0.82, 0.36, 0.5);
  const dorsal = new THREE.ConeGeometry(0.08, 0.22, 5);
  dorsal.scale(1.35, 1, 0.16);
  dorsal.translate(0.02, 0.28, 0);
  tint(dorsal, 0.78, 0.32, 0.48);
  const pecL = new THREE.ConeGeometry(0.05, 0.16, 4);
  pecL.rotateX(1.1);
  pecL.rotateZ(-0.5);
  pecL.scale(1, 1, 0.2);
  pecL.translate(0.1, 0, 0.12);
  tint(pecL, 0.9, 0.5, 0.58);
  const pecR = new THREE.ConeGeometry(0.05, 0.16, 4);
  pecR.rotateX(-1.1);
  pecR.rotateZ(-0.5);
  pecR.scale(1, 1, 0.2);
  pecR.translate(0.1, 0, -0.12);
  tint(pecR, 0.9, 0.5, 0.58);
  const eyeL = new THREE.SphereGeometry(0.042, 8, 6);
  eyeL.translate(0.28, 0.07, 0.12);
  tint(eyeL, 0.07, 0.08, 0.1);
  const eyeR = new THREE.SphereGeometry(0.042, 8, 6);
  eyeR.translate(0.28, 0.07, -0.12);
  tint(eyeR, 0.07, 0.08, 0.1);
  const spot = new THREE.SphereGeometry(0.055, 8, 6);
  spot.scale(0.7, 0.7, 0.35);
  spot.translate(-0.18, 0.08, 0.12);
  tint(spot, 0.12, 0.1, 0.08);
  return mergeGeos([body, tailUp, tailDn, dorsal, pecL, pecR, eyeL, eyeR, spot]);
}

function makeFin(len, span, thick) {
  const g = new THREE.BoxGeometry(len, span, thick, 6, 4, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    const u = (x + len * 0.5) / len;
    const v = (y + span * 0.5) / span;
    const env = Math.sin(Math.PI * Math.min(1, Math.max(0.02, u)));
    y = (y + span * 0.5) * Math.pow(env, 0.55) * (0.35 + 0.65 * u);
    x += v * v * 0.12 * len;
    p.setXYZ(i, x, y, p.getZ(i) * (0.35 + 0.65 * (1 - v)));
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function makeFarStalker(mat) {
  const body = taperBody(3.15, 0.38, 0.32, 28, 16);
  const snout = new THREE.ConeGeometry(0.11, 0.34, 9);
  snout.scale(1, 0.64, 0.8);
  snout.rotateZ(-Math.PI / 2);
  snout.translate(1.62, 0.01, 0);
  tint(snout, 0.12, 0.18, 0.1);
  const jaw = new THREE.ConeGeometry(0.05, 0.16, 7);
  jaw.scale(1, 0.62, 0.74);
  jaw.rotateZ(-Math.PI / 2);
  jaw.translate(1.46, -0.07, 0);
  tint(jaw, 0.1, 0.14, 0.08);
  const dorsal = makeFin(0.78, 0.36, 0.04);
  dorsal.rotateZ(-0.1);
  dorsal.translate(0.16, 0.2, 0);
  const second = makeFin(0.3, 0.14, 0.03);
  second.rotateZ(-0.06);
  second.translate(-0.55, 0.14, 0);
  const pecL = makeFin(0.38, 0.24, 0.032);
  pecL.rotateX(1.12);
  pecL.rotateZ(-0.28);
  pecL.translate(0.26, -0.01, 0.13);
  const pecR = makeFin(0.38, 0.24, 0.032);
  pecR.rotateX(-1.12);
  pecR.rotateZ(-0.28);
  pecR.translate(0.26, -0.01, -0.13);
  const stem = new THREE.SphereGeometry(0.09, 8, 6);
  stem.scale(1.8, 0.7, 0.55);
  stem.translate(-1.38, 0.01, 0);
  tint(stem, 0.1, 0.14, 0.08);
  const tailUp = makeFin(0.4, 0.26, 0.03);
  tailUp.rotateZ(0.4);
  tailUp.translate(-1.48, 0.05, 0);
  const tailDn = makeFin(0.32, 0.18, 0.028);
  tailDn.rotateZ(Math.PI - 0.36);
  tailDn.translate(-1.46, -0.02, 0);
  const flesh = paintStripes(
    mergeGeos([body, snout, jaw, dorsal, second, pecL, pecR, stem, tailUp, tailDn]),
    [0.08, 0.12, 0.05],
    [0.78, 0.56, 0.1],
    5.4,
  );
  const mesh = new THREE.Mesh(flesh, mat);
  mesh.castShadow = true;
  return mesh;
}

function makeTablePlate(radius, thick, seed) {
  const r = radius;
  const h = thick;
  const pts = [
    new THREE.Vector2(0.002, -h * 0.42),
    new THREE.Vector2(r * 0.4, -h * 0.5),
    new THREE.Vector2(r * 0.8, -h * 0.3),
    new THREE.Vector2(r * 0.98, -h * 0.04),
    new THREE.Vector2(r * 1.05, h * 0.14),
    new THREE.Vector2(r * 0.9, h * 0.44),
    new THREE.Vector2(r * 0.5, h * 0.32),
    new THREE.Vector2(0.002, h * 0.2),
  ];
  const geo = new THREE.LatheGeometry(pts, 22);
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const rad = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    const n = Math.sin(a * 5 + seed) * 0.12 + Math.sin(a * 9 + seed * 1.7) * 0.06;
    if (rad > 0.02) {
      const k = 1 + n;
      p.setX(i, x * k);
      p.setZ(i, z * k);
    }
    const lip = rad > r * 0.82;
    const top = y > 0;
    let cr;
    let cg;
    let cb;
    if (lip) {
      cr = 0.78 + n * 0.06;
      cg = 0.52 + n * 0.05;
      cb = 0.1;
    } else if (top) {
      cr = 0.62 + n * 0.06;
      cg = 0.5 + n * 0.05;
      cb = 0.14;
    } else {
      cr = 0.36;
      cg = 0.3;
      cb = 0.08;
    }
    col[i * 3] = cr;
    col[i * 3 + 1] = cg;
    col[i * 3 + 2] = cb;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeTableColony() {
  const parts = [];
  const rads = [1.02, 0.78, 0.54];
  const thicks = [0.22, 0.18, 0.15];
  let y = 0.02;
  for (let i = 0; i < 3; i++) {
    const plate = makeTablePlate(rads[i], thicks[i], 1.4 + i * 2.15);
    plate.rotateY(i * 0.68);
    plate.rotateX((i - 1) * 0.05);
    plate.rotateZ((i % 2 ? 0.04 : -0.04));
    plate.translate((i - 1) * 0.08, y + thicks[i] * 0.32, (i - 1) * 0.05);
    parts.push(plate);
    y += thicks[i] * 0.58;
  }
  const foot = new THREE.SphereGeometry(0.26, 8, 6);
  foot.scale(1.55, 0.38, 1.4);
  foot.translate(0, 0.02, 0);
  tint(foot, 0.36, 0.32, 0.1);
  parts.push(foot);
  return mergeGeos(parts);
}

function makeSeagrassTuft() {
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const h = 0.38 + (i % 3) * 0.16;
    const blade = new THREE.PlaneGeometry(0.055 + (i % 2) * 0.02, h, 1, 5);
    const p = blade.attributes.position;
    const col = new Float32Array(p.count * 3);
    const yaw = (i / 6) * Math.PI * 2 + i * 0.18;
    const lean = ((i % 3) - 1) * 0.22;
    for (let k = 0; k < p.count; k++) {
      const y = p.getY(k) + h * 0.5;
      const u = y / h;
      p.setX(k, p.getX(k) * (1.08 - u * 0.85));
      p.setZ(k, Math.sin(u * 3.4 + i) * 0.055 * u);
      p.setY(k, y);
      col[k * 3] = 0.22 + u * 0.18;
      col[k * 3 + 1] = 0.32 + u * 0.28;
      col[k * 3 + 2] = 0.12 + u * 0.08;
    }
    blade.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    blade.rotateY(yaw);
    blade.rotateZ(lean);
    blade.translate(Math.cos(yaw) * 0.035, 0, Math.sin(yaw) * 0.035);
    parts.push(blade);
  }
  const nub = new THREE.SphereGeometry(0.055, 6, 5);
  nub.scale(1.4, 0.55, 1.4);
  nub.translate(0, 0.03, 0);
  tint(nub, 0.2, 0.28, 0.1);
  parts.push(nub);
  return mergeGeos(parts);
}

function onOpenSand(x, z) {
  if (x < -18 || x > 18 || z < -12 || z > 20) return false;
  if (Math.abs(x) < 12 && z > -4 && z < 8) return false;
  return z > 8 || x < -14;
}

function swimY(x, z, y) {
  const floor = plantY(x, z, 0.7);
  return Math.min(-8.15, Math.max(floor, y));
}

function faceAlong(obj, px, py, pz, dx, dz) {
  obj.position.set(px, py, pz);
  obj.lookAt(px + dx, py, pz + dz);
  obj.rotateY(Math.PI / 2);
}

export function createShallowsLife(scene, shared) {
  const group = new THREE.Group();
  group.name = "shallows-life";
  const rng = mulberry32(2601);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  const sand0 = plantY(GROTTO.x, GROTTO.z, 0);
  const winX = GROTTO.x + GROTTO.winX;
  const winY = Math.min(-8.4, sand0 + GROTTO.winY);
  const winZ = GROTTO.z;

  const tuftGeo = makeSeagrassTuft();
  const tuftMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.84,
    metalness: 0,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  patchUnderwater(tuftMat, shared, { caustics: true });
  const TUFT_N = 340;
  const tufts = new THREE.InstancedMesh(tuftGeo, tuftMat, TUFT_N);
  tufts.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TUFT_N * 3), 3);
  tufts.castShadow = false;
  tufts.receiveShadow = true;
  tufts.frustumCulled = true;

  const patches = [];
  for (let i = 0; i < 22; i++) {
    let x;
    let z;
    if (rng() < 0.72) {
      x = -17.5 + rng() * 35;
      z = 8.4 + rng() * 11.2;
    } else {
      x = -17.8 + rng() * 3.6;
      z = -11 + rng() * 30;
    }
    if (!onOpenSand(x, z)) continue;
    patches.push({ x, z, r: 1.1 + rng() * 1.8 });
  }
  let tn = 0;
  for (let i = 0; i < 900 && tn < TUFT_N; i++) {
    const p = patches[tn % Math.max(patches.length, 1)] || { x: -16, z: 12, r: 1.4 };
    const a = rng() * Math.PI * 2;
    const r = rng() * p.r;
    const x = p.x + Math.cos(a) * r;
    const z = p.z + Math.sin(a) * r;
    if (!onOpenSand(x, z)) continue;
    dummy.position.set(x, plantY(x, z, 0.02), z);
    dummy.rotation.set((rng() - 0.5) * 0.28, rng() * 6.28, (rng() - 0.5) * 0.22);
    const sc = 0.85 + rng() * 1.15;
    dummy.scale.set(0.75 + rng() * 0.45, sc, 0.75 + rng() * 0.45);
    dummy.updateMatrix();
    tufts.setMatrixAt(tn, dummy.matrix);
    const olive = rng() < 0.45;
    if (olive) col.setRGB(0.28 + rng() * 0.16, 0.34 + rng() * 0.16, 0.1 + rng() * 0.06, THREE.SRGBColorSpace);
    else col.setRGB(0.22 + rng() * 0.14, 0.4 + rng() * 0.18, 0.14 + rng() * 0.08, THREE.SRGBColorSpace);
    tufts.instanceColor.setXYZ(tn, col.r, col.g, col.b);
    tn++;
  }
  tufts.count = tn;
  tufts.instanceColor.needsUpdate = true;
  tufts.instanceMatrix.needsUpdate = true;
  group.add(tufts);

  const tableGeo = makeTableColony();
  const tableMat = new THREE.MeshStandardMaterial({
    color: srgb(0xc49428),
    roughness: 0.7,
    metalness: 0,
    vertexColors: true,
    emissive: srgb(0x5a3a08),
    emissiveIntensity: 0.2,
  });
  patchUnderwater(tableMat, shared, { caustics: true, absorb: "soft", detail: "coral" });
  const TABLE_N = 42;
  const tables = new THREE.InstancedMesh(tableGeo, tableMat, TABLE_N);
  tables.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TABLE_N * 3), 3);
  tables.castShadow = false;
  tables.receiveShadow = true;
  tables.frustumCulled = true;

  const spongePad = (x, z) => Math.hypot(x + 1.8, z - 10.4) < 2.5;
  const winFootX = winX;
  const winFootZ = winZ + 8.6;
  const clusters = [
    { x: winFootX - 6.4, z: winFootZ + 0.4, n: 4, r: 0.85, sc: 0.92 },
    { x: winFootX + 7.2, z: winFootZ + 1.6, n: 4, r: 0.9, sc: 0.94 },
    { x: winFootX - 8.6, z: winFootZ + 1.0, n: 4, r: 1.0, sc: 0.98 },
    { x: winFootX + 9.8, z: winFootZ + 2.6, n: 4, r: 1.05, sc: 0.96 },
    { x: winFootX - 5.2, z: winFootZ + 0.8, n: 3, r: 0.7, sc: 0.82 },
    { x: winFootX + 5.8, z: winFootZ + 1.4, n: 3, r: 0.7, sc: 0.8 },
  ];
  const pinned = [
    [winFootX - 6.2, winFootZ + 0.2, 0.98],
    [winFootX - 7.4, winFootZ + 0.8, 0.9],
    [winFootX + 7.0, winFootZ + 1.4, 0.96],
    [winFootX + 8.4, winFootZ + 2.2, 0.9],
    [winFootX - 9.2, winFootZ + 1.2, 0.88],
    [winFootX + 10.6, winFootZ + 2.8, 0.86],
    [winFootX - 5.0, winFootZ + 0.6, 0.8],
    [winFootX + 5.6, winFootZ + 1.2, 0.8],
  ];
  let kn = 0;
  function plantTable(x, z, sc0) {
    if (kn >= TABLE_N || spongePad(x, z) || z > 7.4 || z < winZ + 6.8) return;
    if (Math.abs(x - winX) < 4.2) return;
    dummy.position.set(x, plantY(x, z, -0.06), z);
    dummy.rotation.set(0.16 + rng() * 0.12, rng() * 6.28, (rng() - 0.5) * 0.08);
    const sc = sc0 * (0.72 + rng() * 0.14);
    dummy.scale.set(sc * (1.08 + rng() * 0.1), sc * (0.62 + rng() * 0.1), sc * (0.9 + rng() * 0.1));
    dummy.updateMatrix();
    tables.setMatrixAt(kn, dummy.matrix);
    if (rng() < 0.38) col.setRGB(0.48 + rng() * 0.08, 0.46 + rng() * 0.07, 0.14 + rng() * 0.03, THREE.SRGBColorSpace);
    else col.setRGB(0.72 + rng() * 0.08, 0.5 + rng() * 0.06, 0.13 + rng() * 0.03, THREE.SRGBColorSpace);
    tables.instanceColor.setXYZ(kn, col.r, col.g, col.b);
    kn++;
  }
  for (const [x, z, sc] of pinned) plantTable(x, z, sc);
  for (const c of clusters) {
    for (let i = 0; i < c.n && kn < TABLE_N; i++) {
      const a = rng() * Math.PI * 2;
      const rr = Math.sqrt(rng()) * c.r;
      plantTable(c.x + Math.cos(a) * rr, c.z + Math.sin(a) * rr, c.sc);
    }
  }
  tables.count = kn;
  tables.instanceColor.needsUpdate = true;
  tables.instanceMatrix.needsUpdate = true;
  group.add(tables);

  const coralLampL = new THREE.PointLight(0xffb060, 0.52, 6.4, 2);
  coralLampL.position.set(winFootX - 6.4, plantY(winFootX - 6.4, winFootZ + 0.4, 0.85), winFootZ + 0.4);
  group.add(coralLampL);
  const coralLampR = new THREE.PointLight(0xffc070, 0.46, 6.0, 2);
  coralLampR.position.set(winFootX + 7.2, plantY(winFootX + 7.2, winFootZ + 1.8, 0.8), winFootZ + 1.8);
  group.add(coralLampR);

  const SCHOOL_N = 42;
  const schoolGeo = makeSchoolFish();
  const schoolMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.32,
    metalness: 0.12,
    vertexColors: true,
  });
  patchUnderwater(schoolMat, shared, { caustics: true });
  const school = new THREE.InstancedMesh(schoolGeo, schoolMat, SCHOOL_N);
  school.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SCHOOL_N * 3), 3);
  school.castShadow = true;
  school.frustumCulled = true;
  const palette = [0xf08a28, 0xe85820, 0xffb040, 0x2aa8b0, 0x1e8894, 0x48c8c0, 0xe85888, 0xd04070, 0xff7898, 0xf0c050];
  const schoolFish = [];
  for (let i = 0; i < SCHOOL_N; i++) {
    col.setHex(palette[i % palette.length], THREE.SRGBColorSpace);
    school.instanceColor.setXYZ(i, col.r, col.g, col.b);
    const ring = i / SCHOOL_N;
    schoolFish.push({
      phase: ring * Math.PI * 2 + rng() * 0.4,
      spin: 0.55 + rng() * 0.7,
      ox: (rng() - 0.5) * 3.4,
      oy: (rng() - 0.5) * 1.5,
      oz: (rng() - 0.5) * 2.6,
      rx: 0.35 + rng() * 0.85,
      ry: 0.18 + rng() * 0.32,
      rz: 0.3 + rng() * 0.7,
      sc: 0.78 + rng() * 0.55,
    });
  }
  school.instanceColor.needsUpdate = true;
  group.add(school);

  const fishMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0.08,
    vertexColors: true,
  });
  patchUnderwater(fishMat, shared, { caustics: true });

  const peeper = new THREE.Mesh(makePeeper(), fishMat);
  peeper.castShadow = true;
  peeper.scale.setScalar(1.18);
  group.add(peeper);

  const jack = new THREE.Mesh(makeStripeJack(), fishMat);
  jack.castShadow = true;
  jack.scale.set(1.15, 1.05, 1.1);
  group.add(jack);

  const wrasse = new THREE.Mesh(makeWrasse(), fishMat);
  wrasse.castShadow = true;
  wrasse.scale.setScalar(1.08);
  group.add(wrasse);

  const stalkerMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.58,
    metalness: 0.02,
    vertexColors: true,
    emissive: srgb(0x2a2208),
    emissiveIntensity: 0.08,
  });
  patchUnderwater(stalkerMat, shared, { caustics: true });
  const farStalker = makeFarStalker(stalkerMat);
  farStalker.castShadow = true;
  farStalker.scale.set(2.05, 1.72, 1.82);
  group.add(farStalker);

  const peepLamp = new THREE.PointLight(0x48e0ff, 1.05, 4.6, 2);
  peepLamp.position.set(0.18, 0.06, 0);
  peeper.add(peepLamp);

  const fillLamp = new THREE.PointLight(0xffb060, 0.62, 7.5, 1.8);
  fillLamp.position.set(1.6, winY - 1.1, 4.8);
  group.add(fillLamp);

  group.userData.update = (t) => {
    const a = t * 0.38;
    const cx = winX + 0.8 + Math.sin(a) * 3.4;
    const cz = winZ + 9.2 + Math.cos(a * 0.72) * 3.1;
    const cy = winY - 1.4 + Math.sin(a * 1.25) * 0.7;
    const hx = Math.cos(a) * 3.4;
    const hz = -Math.sin(a * 0.72) * 3.1;

    for (let i = 0; i < SCHOOL_N; i++) {
      const f = schoolFish[i];
      const b = t * f.spin + f.phase;
      const px = cx + f.ox + Math.sin(b) * f.rx;
      const pz = cz + f.oz + Math.cos(b * 0.9) * f.rz;
      const py = swimY(px, pz, cy + f.oy + Math.sin(b * 1.7) * f.ry);
      dummy.scale.setScalar(f.sc);
      faceAlong(dummy, px, py, pz, hx + Math.cos(b) * f.rx, hz - Math.sin(b * 0.9) * f.rz);
      dummy.rotateZ(Math.sin(b) * 0.12);
      dummy.updateMatrix();
      school.setMatrixAt(i, dummy.matrix);
    }
    school.instanceMatrix.needsUpdate = true;

    const pa = t * 0.62 + 1.1;
    const px = -3.2 + Math.cos(pa) * 2.8;
    const pz = 7.4 + Math.sin(pa) * 1.9;
    const py = swimY(px, pz, -14.6 + Math.sin(pa * 1.8) * 0.35);
    faceAlong(peeper, px, py, pz, -Math.sin(pa) * 2.8, Math.cos(pa) * 1.9);

    const ja = t * 0.34 + 2.4;
    const jx = winX + Math.sin(ja) * 1.7;
    const jz = winZ + 1.9 + Math.cos(ja * 0.7) * 0.95;
    const jy = swimY(jx, jz, winY - 0.8 + Math.sin(ja * 1.4) * 0.35);
    faceAlong(jack, jx, jy, jz, Math.cos(ja) * 1.7, -Math.sin(ja * 0.7) * 0.95);

    const wa = t * 0.48 + 0.3;
    const wx = winX + Math.cos(wa) * 1.35;
    const wz = winZ + 1.7 + Math.sin(wa) * 1.05;
    const wy = swimY(wx, wz, winY - 0.55 + Math.sin(wa * 2.1) * 0.35);
    faceAlong(wrasse, wx, wy, wz, -Math.sin(wa) * 1.35, Math.cos(wa) * 1.05);

    const sa = t * 0.72 + 0.15;
    const sx = 9.2 + Math.sin(sa) * 4.0;
    const sz = -18.8 + Math.cos(sa * 0.7) * 2.2;
    const sy = swimY(sx, sz, -12.6 + Math.sin(sa * 1.7) * 0.9);
    faceAlong(farStalker, sx, sy, sz, Math.cos(sa) * 5.8, -Math.sin(sa * 0.7) * 3.6);
    farStalker.rotateZ(Math.sin(sa * 2.4) * 0.16);
  };

  scene.add(group);
  return group;
}
