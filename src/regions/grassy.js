import * as THREE from "three";
import { mulberry32 } from "../math.js";
import { patchUnderwater } from "../shaders.js";
import { mergeGeos, plantY, srgb } from "./util.js";

const CAM = { x: 82, y: -11.5, z: 152 };
const HERO = { x: 85.6, y: -12.15, z: 164.4 };

// Wide terrace so short fingers fill the lower half of
// [82, -11.5, 152] → [92, -18, 182] without a visible side-ramp.
function duneLift(x, z) {
  const along = Math.max(0, Math.min(1, (z - 150) / 58));
  const alongLift = Math.pow(1 - along, 1.28) * 19.2;
  const side = Math.max(0, (Math.abs(x - 88) - 38) / 16);
  const sideFade = Math.max(0, 1 - side * side);
  const roll = Math.sin(x * 0.13) * Math.sin(z * 0.1) * 0.28;
  return Math.max(0, alongLift * sideFade + roll);
}

function carpetY(x, z) {
  return plantY(x, z, duneLift(x, z));
}

function makeFinger(h, rBase, rTip, bend, flatten) {
  const pts = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const belly = Math.sin(t * Math.PI) * 0.16;
    const tip = t > 0.78 ? Math.cos(((t - 0.78) / 0.22) * Math.PI * 0.5) : 1;
    const r = (rBase * (1 - t * 0.35) + rTip * t * 0.5) * (1 + belly) * Math.max(0.1, tip);
    pts.push(new THREE.Vector2(i === steps ? 0.004 : r, t * h));
  }
  const geo = new THREE.LatheGeometry(pts, 5);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = h > 1e-4 ? y / h : 0;
    const ang = Math.atan2(pos.getZ(i), pos.getX(i));
    const ridge = 1 + Math.sin(ang * 3.4) * 0.045 * (1 - t);
    pos.setX(i, pos.getX(i) * ridge + bend * t * t);
    pos.setZ(i, pos.getZ(i) * ridge * flatten);
  }
  return geo;
}

function paintGold(geo, h) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.max(0, Math.min(1, pos.getY(i) / Math.max(h, 0.01)));
    col[i * 3] = 0.88 + t * 0.12;
    col[i * 3 + 1] = 0.42 + t * 0.22;
    col[i * 3 + 2] = 0.05 + t * 0.06;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function makeClump(seed, blades, spread, hMul) {
  const rng = mulberry32(seed);
  const geos = [];
  let maxH = 0;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + (rng() - 0.5) * 0.42;
    const h = (0.42 + rng() * 0.34) * hMul;
    maxH = Math.max(maxH, h);
    const finger = makeFinger(
      h,
      0.032 + rng() * 0.014,
      0.016 + rng() * 0.01,
      0.03 + rng() * 0.08,
      0.84 + rng() * 0.14,
    );
    const rad = 0.018 + rng() * spread;
    finger.rotateZ(0.1 + rng() * 0.32);
    finger.rotateX((rng() - 0.5) * 0.18);
    finger.rotateY(a);
    finger.translate(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    geos.push(finger);
  }
  return paintGold(mergeGeos(geos), maxH);
}

function makeBed() {
  const geo = new THREE.PlaneGeometry(72, 62, 40, 36);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = 86 + pos.getX(i);
    const z = 176 + pos.getZ(i);
    const y = carpetY(x, z) - 0.05;
    pos.setXYZ(i, x, y, z);
    const n = Math.sin(x * 0.28 + z * 0.24) * 0.03;
    col[i * 3] = 0.86 + n;
    col[i * 3 + 1] = 0.44 + n * 0.35;
    col[i * 3 + 2] = 0.07 + n * 0.12;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function makePetalGeo() {
  const shape = new THREE.Shape();
  const L = 1.32;
  const W = 0.34;
  shape.moveTo(0, 0.02);
  shape.bezierCurveTo(W * 0.72, 0.04, W * 1.08, 0.2, W * 1.02, 0.46);
  shape.bezierCurveTo(W * 0.96, 0.78, W * 0.62, 1.1, W * 0.22, L);
  shape.lineTo(-W * 0.22, L);
  shape.bezierCurveTo(-W * 0.62, 1.1, -W * 0.96, 0.78, -W * 1.02, 0.46);
  shape.bezierCurveTo(-W * 1.08, 0.2, -W * 0.72, 0.04, 0, 0.02);
  for (let row = 0; row < 8; row++) {
    const y = 0.22 + row * 0.13;
    const hr = 0.04 - row * 0.002;
    const xOff = 0.078 + (row % 2) * 0.012;
    for (const hx of [-xOff, xOff]) {
      const hole = new THREE.Path();
      hole.absellipse(hx, y, hr * 0.85, hr * 1.55, 0, Math.PI * 2, true);
      shape.holes.push(hole);
    }
  }
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 0.09,
    bevelEnabled: true,
    bevelThickness: 0.028,
    bevelSize: 0.022,
    bevelSegments: 3,
    curveSegments: 12,
    steps: 2,
  });
  geo.translate(0, 0, -0.045);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const edge = Math.min(1, Math.abs(x) / 0.18 + (y > 1.08 ? (y - 1.08) * 5.5 : 0) + (y < 0.14 ? 0.6 : 0));
    col[i * 3] = 0.62 + edge * 0.38;
    col[i * 3 + 1] = 0.06 + edge * 0.58;
    col[i * 3 + 2] = 0.04 + edge * 0.06;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function paintTeal(geo) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = Math.sin(x * 6.4 + y * 5.1) * Math.cos(z * 5.6 + y * 3.2);
    const cool = Math.max(0, -n);
    col[i * 3] = 0.1 + Math.max(0, n) * 0.12 + cool * 0.08;
    col[i * 3 + 1] = 0.58 + n * 0.1;
    col[i * 3 + 2] = 0.62 + n * 0.08 + cool * 0.12;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function lumpSphere(r, sx, sy, sz, tx, ty, tz, seed) {
  const geo = new THREE.SphereGeometry(r, 16, 12);
  geo.scale(sx, sy, sz);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const n = 1 + 0.07 * Math.sin(pos.getX(i) * 7.1 + seed) * Math.cos(pos.getY(i) * 6.2 + pos.getZ(i) * 5.4);
    pos.setXYZ(i, pos.getX(i) * n + tx, pos.getY(i) * n + ty, pos.getZ(i) * n + tz);
  }
  return geo;
}

function makeFleshBody() {
  const parts = [
    lumpSphere(0.48, 1.05, 0.82, 1.45, 0, 0.0, -0.12, 1.2),
    lumpSphere(0.22, 1.05, 0.82, 1.15, -0.32, -0.04, 0.22, 2.4),
    lumpSphere(0.2, 1.0, 0.8, 1.1, 0.3, 0.0, 0.24, 3.1),
    lumpSphere(0.16, 1.4, 0.48, 0.95, 0.04, 0.26, 0.34, 4.0),
    lumpSphere(0.16, 1.15, 0.62, 1.05, 0.02, -0.26, 0.28, 5.2),
  ];
  const geo = mergeGeos(parts);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    if (z > 0.12) z = 0.12 + (z - 0.12) * 0.62;
    const mx = x - 0.04;
    const my = y + 0.12;
    const mz = z - 0.36;
    const mouth = Math.exp(-(mx * mx) / 0.042 - (my * my) / 0.024 - (mz * mz) / 0.04);
    z -= mouth * 0.2;
    y -= mouth * 0.06;
    pos.setXYZ(i, x, y, z);
  }
  geo.computeVertexNormals();
  return paintTeal(geo);
}

function makeSchoolFish() {
  const body = new THREE.SphereGeometry(0.15, 10, 8);
  body.scale(0.52, 0.68, 1.7);
  const pos = body.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const taper = z > 0 ? 1 - z * 0.38 : 1 + z * 0.06;
    pos.setX(i, pos.getX(i) * taper);
    pos.setY(i, pos.getY(i) * taper);
  }
  const tail = new THREE.ConeGeometry(0.095, 0.2, 5);
  tail.rotateX(Math.PI / 2);
  tail.scale(0.26, 1.55, 1);
  tail.translate(0, 0, 0.3);
  const dorsal = new THREE.ConeGeometry(0.048, 0.1, 4);
  dorsal.scale(0.2, 1, 1.05);
  dorsal.translate(0, 0.12, -0.02);
  return mergeGeos([body, tail, dorsal]);
}

function stamp(mesh, dummy, n, x, y, z, rx, ry, rz, sx, sy, sz, rgb) {
  dummy.position.set(x, y, z);
  dummy.rotation.set(rx, ry, rz);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  mesh.setMatrixAt(n, dummy.matrix);
  mesh.instanceColor.setXYZ(n, rgb[0], rgb[1], rgb[2]);
}

function amberRGB(r) {
  const pick = r();
  if (pick < 0.4) return [1.0, 0.58 + r() * 0.12, 0.08 + r() * 0.04];
  if (pick < 0.75) return [0.94 + r() * 0.06, 0.48 + r() * 0.12, 0.06 + r() * 0.03];
  return [1.0, 0.64 + r() * 0.12, 0.1 + r() * 0.04];
}

// Amber Flats — gold finger-coral carpet, buried lanterns, wheel-petaled hero.
export function createAmberFlats(scene, shared) {
  const group = new THREE.Group();
  group.name = "amber-flats";
  const rng = mulberry32(9101);

  const grassMat = new THREE.MeshStandardMaterial({
    color: srgb(0xffb84a),
    roughness: 0.44,
    metalness: 0,
    emissive: srgb(0xb85a00),
    emissiveIntensity: 0.72,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  patchUnderwater(grassMat, shared, { caustics: true, absorb: false });

  const bedMat = new THREE.MeshStandardMaterial({
    color: srgb(0xe89820),
    roughness: 0.5,
    metalness: 0,
    emissive: srgb(0xa05000),
    emissiveIntensity: 0.48,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  patchUnderwater(bedMat, shared, { caustics: true, absorb: false });
  const bed = new THREE.Mesh(makeBed(), bedMat);
  bed.castShadow = false;
  bed.receiveShadow = true;
  bed.frustumCulled = false;
  group.add(bed);

  const clumpA = makeClump(441, 20, 0.16, 1);
  const clumpB = makeClump(778, 24, 0.2, 0.88);
  const clumpC = makeClump(219, 16, 0.13, 1.1);
  const NA = 1800;
  const NB = 1600;
  const NC = 1200;
  const grassA = new THREE.InstancedMesh(clumpA, grassMat, NA);
  const grassB = new THREE.InstancedMesh(clumpB, grassMat, NB);
  const grassC = new THREE.InstancedMesh(clumpC, grassMat, NC);
  grassA.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NA * 3), 3);
  grassB.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NB * 3), 3);
  grassC.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NC * 3), 3);

  const dummy = new THREE.Object3D();

  const plantOne = (mesh, n, x, z) => {
    const lean = (rng() - 0.5) * 0.12;
    const dist = Math.hypot(x - CAM.x, z - CAM.z);
    const near = Math.max(0, 1 - dist / 16);
    const sy = 0.78 + rng() * 0.38 + (1 - near) * 0.18;
    const sx = 1.12 + rng() * 0.4 + (1 - near) * 0.22;
    stamp(
      mesh,
      dummy,
      n,
      x,
      carpetY(x, z) - 0.02,
      z,
      lean,
      rng() * Math.PI * 2,
      (rng() - 0.5) * 0.1,
      sx,
      sy,
      sx * (0.9 + rng() * 0.18),
      amberRGB(rng),
    );
  };

  let ia = 0;
  let ib = 0;
  let ic = 0;
  const cols = 72;
  const rows = 52;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = 54 + ((i + rng() * 0.78) / cols) * 72;
      const z = 153 + ((j + rng() * 0.78) / rows) * 48;
      const slot = (i + j * 3) % 5;
      if (slot < 2 && ia < NA) plantOne(grassA, ia++, x, z);
      else if (slot < 4 && ib < NB) plantOne(grassB, ib++, x, z);
      else if (ic < NC) plantOne(grassC, ic++, x, z);
      else if (ia < NA) plantOne(grassA, ia++, x, z);
      else if (ib < NB) plantOne(grassB, ib++, x, z);
    }
  }

  for (let k = 0; k < 520; k++) {
    const x = 60 + rng() * 42;
    const z = 154 + rng() * 22;
    const slot = k % 3;
    if (slot === 0 && ia < NA) plantOne(grassA, ia++, x, z);
    else if (slot === 1 && ib < NB) plantOne(grassB, ib++, x, z);
    else if (ic < NC) plantOne(grassC, ic++, x, z);
    else if (ia < NA) plantOne(grassA, ia++, x, z);
  }

  const fillRest = (mesh, start, cap) => {
    let n = start;
    let guard = 0;
    while (n < cap && guard < cap * 6) {
      guard++;
      const a = rng() * Math.PI * 2;
      const rad = 22 + rng() * 58;
      const x = 88 + Math.cos(a) * rad;
      const z = 188 + Math.sin(a) * rad;
      if (x >= 58 && x <= 122 && z >= 153 && z <= 205) continue;
      plantOne(mesh, n++, x, z);
    }
    return n;
  };
  ia = fillRest(grassA, ia, NA);
  ib = fillRest(grassB, ib, NB);
  ic = fillRest(grassC, ic, NC);

  grassA.count = ia;
  grassB.count = ib;
  grassC.count = ic;
  for (const g of [grassA, grassB, grassC]) {
    g.castShadow = false;
    g.frustumCulled = false;
    group.add(g);
  }

  const orbGeo = new THREE.SphereGeometry(0.28, 14, 12);
  orbGeo.scale(1, 0.86, 1);
  const orbMat = new THREE.MeshStandardMaterial({
    color: srgb(0xffd030),
    emissive: srgb(0xff9a08),
    emissiveIntensity: 2.2,
    roughness: 0.22,
  });
  patchUnderwater(orbMat, shared, { caustics: false, absorb: false });
  const forcedOrbs = [
    [80.4, 161.8],
    [90.6, 170.4],
    [75.8, 174.2],
    [96.8, 178.6],
    [86.2, 184.8],
    [102.2, 172.4],
    [92.4, 190.8],
  ];
  const ORB_N = forcedOrbs.length;
  const orbs = new THREE.InstancedMesh(orbGeo, orbMat, ORB_N);
  for (let i = 0; i < ORB_N; i++) {
    const [x, z] = forcedOrbs[i];
    const sc = 1.15 + rng() * 0.55;
    dummy.position.set(x, carpetY(x, z) + 0.28, z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(sc);
    dummy.updateMatrix();
    orbs.setMatrixAt(i, dummy.matrix);
  }
  orbs.castShadow = false;
  orbs.frustumCulled = false;
  group.add(orbs);

  const heroAnchor = new THREE.Group();
  const hero = new THREE.Group();
  heroAnchor.add(hero);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: srgb(0x2cc4c8),
    roughness: 0.58,
    metalness: 0.02,
    emissive: srgb(0x0c5860),
    emissiveIntensity: 0.22,
    vertexColors: true,
  });
  patchUnderwater(bodyMat, shared, { caustics: true, absorb: false });
  const body = new THREE.Mesh(makeFleshBody(), bodyMat);
  body.scale.setScalar(1.32);
  body.position.set(0.02, -0.02, 0.08);
  hero.add(body);

  const petalMat = new THREE.MeshStandardMaterial({
    color: srgb(0xd42820),
    roughness: 0.62,
    metalness: 0.02,
    emissive: srgb(0x681008),
    emissiveIntensity: 0.22,
    side: THREE.DoubleSide,
    vertexColors: true,
  });
  patchUnderwater(petalMat, shared, { caustics: true, absorb: false });
  const rimMat = new THREE.MeshStandardMaterial({
    color: srgb(0xf0b020),
    roughness: 0.34,
    metalness: 0.28,
    emissive: srgb(0xa05800),
    emissiveIntensity: 0.52,
  });
  patchUnderwater(rimMat, shared, { caustics: true, absorb: false });
  const petalGeo = makePetalGeo();
  const petalPivots = [];
  const N_PETALS = 9;
  for (let i = 0; i < N_PETALS; i++) {
    const a = (i / N_PETALS) * Math.PI * 2 + 0.12 + (i % 2) * 0.07;
    const pivot = new THREE.Group();
    const rad = 0.58 + (i % 3) * 0.025;
    pivot.position.set(Math.cos(a) * rad, Math.sin(a) * rad, (i % 2) * 0.06 - 0.02);
    pivot.rotation.z = a - Math.PI / 2;
    pivot.rotation.y = (i % 2 === 0 ? -1 : 1) * 0.12;
    const petal = new THREE.Mesh(petalGeo, petalMat);
    petal.rotation.x = -0.32 - (i % 3) * 0.05;
    petal.scale.set(1.02 + (i % 3) * 0.05, 0.9 + (i % 4) * 0.06, 1);
    const gilt = new THREE.Mesh(petalGeo, rimMat);
    gilt.rotation.x = petal.rotation.x;
    gilt.scale.set(petal.scale.x * 1.08, petal.scale.y * 1.05, 0.45);
    gilt.position.z = -0.016;
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 5, 12), rimMat);
    collar.rotation.x = Math.PI / 2;
    collar.position.y = 0.05;
    pivot.add(gilt);
    pivot.add(petal);
    pivot.add(collar);
    hero.add(pivot);
    petalPivots.push(pivot);
  }

  const hub = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.055, 8, 28), rimMat);
  hub.position.z = 0.1;
  hero.add(hub);

  const eyeMat = new THREE.MeshStandardMaterial({
    color: srgb(0xffd020),
    emissive: srgb(0xd49800),
    emissiveIntensity: 0.85,
    roughness: 0.18,
  });
  patchUnderwater(eyeMat, shared, { caustics: true, absorb: false });
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 14), eyeMat);
  eye.position.set(0.18, 0.1, 0.58);
  hero.add(eye);
  const pupilMat = new THREE.MeshStandardMaterial({ color: srgb(0x080808), roughness: 0.42 });
  patchUnderwater(pupilMat, shared, { caustics: false, absorb: false });
  const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), pupilMat);
  pupil.position.set(0.2, 0.1, 0.68);
  hero.add(pupil);
  const lid = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 16), bodyMat);
  lid.position.set(0.18, 0.1, 0.62);
  hero.add(lid);

  const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), pupilMat);
  mouth.scale.set(1.15, 0.42, 0.55);
  mouth.position.set(0.04, -0.14, 0.52);
  hero.add(mouth);
  const lips = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.022, 6, 18), bodyMat);
  lips.scale.set(1.15, 0.55, 1);
  lips.position.set(0.04, -0.14, 0.58);
  hero.add(lips);

  for (let i = 0; i < 4; i++) {
    const s = i < 2 ? -1 : 1;
    const k = i % 2;
    const feeler = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.26 + k * 0.08, 3, 6), bodyMat);
    feeler.position.set(s * (0.18 + k * 0.08), -0.22 - k * 0.04, 0.32);
    feeler.rotation.z = s * (0.7 + k * 0.25);
    feeler.rotation.x = -0.5 - k * 0.15;
    hero.add(feeler);
  }

  heroAnchor.position.set(HERO.x, HERO.y, HERO.z);
  heroAnchor.lookAt(CAM.x - 2.2, CAM.y + 0.35, CAM.z);
  heroAnchor.rotateY(-0.2);
  heroAnchor.rotateX(0.08);
  heroAnchor.scale.setScalar(2.55);
  group.add(heroAnchor);

  const lamps = [];
  const heroLamp = new THREE.PointLight(0xffc040, 1.9, 14, 1.6);
  heroLamp.position.set(HERO.x + 0.6, HERO.y + 0.4, HERO.z + 1.2);
  group.add(heroLamp);
  lamps.push(heroLamp);
  const lampSpots = [
    [80.4, 161.8],
    [90.6, 170.4],
  ];
  for (let i = 0; i < 2; i++) {
    const [x, z] = lampSpots[i];
    const lamp = new THREE.PointLight(0xffb018, 1.5, 10, 1.5);
    lamp.position.set(x, carpetY(x, z) + 0.8, z);
    group.add(lamp);
    lamps.push(lamp);
  }

  const schoolMat = new THREE.MeshStandardMaterial({
    color: srgb(0xc838b8),
    roughness: 0.34,
    emissive: srgb(0x681048),
    emissiveIntensity: 0.32,
    vertexColors: true,
  });
  patchUnderwater(schoolMat, shared, { caustics: true, absorb: false });
  const SCHOOL_N = 28;
  const school = new THREE.InstancedMesh(makeSchoolFish(), schoolMat, SCHOOL_N);
  school.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(SCHOOL_N * 3), 3);
  school.castShadow = false;
  school.frustumCulled = false;
  const schoolCol = new THREE.Color();
  const schoolMeta = [];
  for (let i = 0; i < SCHOOL_N; i++) {
    const right = i >= 8;
    const hx = right ? 56 + rng() * 22 : 72 + rng() * 10;
    const hz = right ? 166 + rng() * 20 : 162 + rng() * 14;
    schoolMeta.push({
      hx,
      hz,
      y: carpetY(hx, hz) + 1.4 + rng() * 2.4,
      phase: rng() * Math.PI * 2,
      speed: 0.48 + rng() * 0.55,
      orbit: 1.4 + rng() * 2.4,
      sc: 0.78 + rng() * 0.55,
    });
    schoolCol.setRGB(0.62 + rng() * 0.35, 0.12 + rng() * 0.18, 0.55 + rng() * 0.35, THREE.SRGBColorSpace);
    school.instanceColor.setXYZ(i, schoolCol.r, schoolCol.g, schoolCol.b);
  }
  group.add(school);

  const fishDummy = new THREE.Object3D();
  group.userData.update = (t) => {
    heroAnchor.position.y = HERO.y + Math.sin(t * 0.65) * 0.16;
    hero.rotation.z = Math.sin(t * 0.4) * 0.045;
    hero.rotation.x = Math.sin(t * 0.3) * 0.03;
    for (let i = 0; i < petalPivots.length; i++) {
      const pulse = 1 + Math.sin(t * 1.4 + i * 0.7) * 0.028;
      petalPivots[i].scale.setScalar(pulse);
    }
    lamps[0].intensity = 1.7 + Math.sin(t * 1.5) * 0.22;
    lamps[1].intensity = 1.35 + Math.sin(t * 1.7 + 2.1) * 0.24;
    lamps[2].intensity = 1.35 + Math.sin(t * 1.7 + 4.2) * 0.24;
    for (let i = 0; i < SCHOOL_N; i++) {
      const d = schoolMeta[i];
      const ang = d.phase + t * d.speed;
      const x = d.hx + Math.cos(ang) * d.orbit;
      const z = d.hz + Math.sin(ang) * d.orbit * 0.72;
      const y = d.y + Math.sin(t * 1.35 + d.phase) * 0.2;
      const vx = -Math.sin(ang) * d.orbit;
      const vz = Math.cos(ang) * d.orbit * 0.72;
      fishDummy.position.set(x, y, z);
      fishDummy.lookAt(x + vx, y, z + vz);
      fishDummy.scale.setScalar(d.sc);
      fishDummy.updateMatrix();
      school.setMatrixAt(i, fishDummy.matrix);
    }
    school.instanceMatrix.needsUpdate = true;
  };

  scene.add(group);
  return group;
}
