import * as THREE from "three";
import { mulberry32, noise2, noise3 } from "../math.js";
import { patchUnderwater } from "../shaders.js";
import { mergeGeos, plantY, srgb } from "./util.js";

function makeBlade(h, rBase, bend, flatten, seed) {
  const pts = [];
  const steps = 8;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const swell = Math.sin(t * Math.PI) * 0.18;
    const tip = t > 0.8 ? Math.max(0.1, 1 - (t - 0.8) / 0.2) : 1;
    const r = rBase * (1 - t * 0.72) * (1 + swell) * tip;
    pts.push(new THREE.Vector2(i === steps ? 0.004 : r, t * h));
  }
  const geo = new THREE.LatheGeometry(pts, 5);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = h > 1e-4 ? y / h : 0;
    const ang = Math.atan2(pos.getZ(i), pos.getX(i));
    const ridge = 1 + Math.sin(ang * 3.0 + seed) * 0.08 * (1 - t);
    pos.setX(i, pos.getX(i) * ridge + bend * t * t);
    pos.setZ(i, pos.getZ(i) * ridge * flatten);
    const g0 = 0.5 + t * 0.5;
    col[i * 3] = g0;
    col[i * 3 + 1] = g0;
    col[i * 3 + 2] = g0;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function makeTuft(seed, blades, hMul) {
  const rng = mulberry32(seed);
  const geos = [];
  for (let i = 0; i < blades; i++) {
    const ht = (0.55 + rng() * 0.8) * hMul;
    const blade = makeBlade(
      ht,
      0.028 + rng() * 0.022,
      0.04 + rng() * 0.12,
      0.72 + rng() * 0.22,
      seed + i * 1.7,
    );
    const a = (i / blades) * Math.PI * 2 + (rng() - 0.5) * 0.5;
    const rad = 0.05 + rng() * 0.12;
    blade.rotateZ(0.08 + rng() * 0.32);
    blade.rotateX((rng() - 0.5) * 0.2);
    blade.rotateY(a);
    blade.translate(Math.cos(a) * rad, 0, Math.sin(a) * rad);
    geos.push(blade);
  }
  return mergeGeos(geos);
}

function sampleKeys(t, keys) {
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const u = (t - keys[i - 1][0]) / (keys[i][0] - keys[i - 1][0]);
      return keys[i - 1][1] + (keys[i][1] - keys[i - 1][1]) * u;
    }
  }
  return keys[keys.length - 1][1];
}

function hoodooRad(t, kind) {
  if (kind === 0) {
    return sampleKeys(t, [
      [0, 0.96],
      [0.1, 0.9],
      [0.26, 0.84],
      [0.42, 0.8],
      [0.54, 0.7],
      [0.63, 0.4],
      [0.71, 0.26],
      [0.78, 0.34],
      [0.84, 0.98],
      [0.9, 1.22],
      [0.95, 1.08],
      [1, 0.14],
    ]);
  }
  if (kind === 1) {
    return sampleKeys(t, [
      [0, 1.06],
      [0.16, 0.98],
      [0.34, 0.9],
      [0.52, 0.82],
      [0.66, 0.52],
      [0.74, 0.44],
      [0.82, 0.98],
      [0.9, 1.1],
      [0.96, 0.82],
      [1, 0.16],
    ]);
  }
  if (kind === 2) {
    return sampleKeys(t, [
      [0, 0.68],
      [0.14, 0.6],
      [0.36, 0.54],
      [0.58, 0.48],
      [0.72, 0.3],
      [0.8, 0.34],
      [0.87, 0.72],
      [0.93, 0.78],
      [1, 0.12],
    ]);
  }
  if (kind === 3) {
    return sampleKeys(t, [
      [0, 1.0],
      [0.16, 0.92],
      [0.32, 0.66],
      [0.46, 0.34],
      [0.6, 0.16],
      [0.72, 0.16],
      [0.8, 0.56],
      [0.87, 0.98],
      [0.94, 0.9],
      [1, 0.1],
    ]);
  }
  if (kind === 4) {
    return sampleKeys(t, [
      [0, 1.08],
      [0.12, 1.12],
      [0.28, 1.06],
      [0.5, 1.0],
      [0.68, 0.96],
      [0.82, 0.9],
      [0.9, 0.78],
      [0.96, 0.42],
      [1, 0.04],
    ]);
  }
  if (kind === 5) {
    return sampleKeys(t, [
      [0, 0.84],
      [0.12, 0.96],
      [0.3, 0.9],
      [0.48, 0.66],
      [0.64, 0.5],
      [0.76, 0.58],
      [0.85, 0.8],
      [0.92, 0.7],
      [1, 0.16],
    ]);
  }
  if (kind === 6) {
    return sampleKeys(t, [
      [0, 1.04],
      [0.14, 0.98],
      [0.3, 0.9],
      [0.46, 0.86],
      [0.6, 0.64],
      [0.7, 0.54],
      [0.78, 1.02],
      [0.86, 1.24],
      [0.93, 1.04],
      [1, 0.2],
    ]);
  }
  return sampleKeys(t, [
    [0, 0.76],
    [0.18, 0.7],
    [0.42, 0.64],
    [0.6, 0.54],
    [0.72, 0.36],
    [0.8, 0.4],
    [0.87, 0.82],
    [0.93, 0.86],
    [1, 0.12],
  ]);
}

const NECK_T = [
  [0.6, 0.78],
  [0.64, 0.78],
  [0.68, 0.82],
  [0.46, 0.76],
  [1.2, 1.2],
  [0.54, 0.74],
  [0.58, 0.74],
  [0.68, 0.82],
];
const CAP_T = [0.8, 0.8, 0.84, 0.8, 0.9, 0.82, 0.76, 0.84];

function makeHoodoo(h, r, seed, kind) {
  const pts = [];
  const steps = 52;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push(new THREE.Vector2(Math.max(0.02, hoodooRad(t, kind) * r), t * h));
  }
  const geo = new THREE.LatheGeometry(pts, 44);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const [neck0, neck1] = NECK_T[kind] || NECK_T[7];
  const cap0 = CAP_T[kind] ?? 0.84;
  const erodeA = seed * 1.7 + 0.4;
  const capOffA = seed * 0.9 + kind;
  const capOff = kind === 4 ? 0.05 : 0.14 + (seed % 1) * 0.08;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const t = Math.max(0, Math.min(1, y / h));
    const ang = Math.atan2(z, x);
    const n = noise3(x * 0.15 + seed, y * 0.05, z * 0.15);
    const n2 = noise3(x * 0.46 + seed * 1.3, y * 0.13, z * 0.46);
    const n3 = noise3(x * 1.1, y * 0.68 + seed, z * 1.1);
    const layer = Math.floor(y * 0.72 + seed * 0.4 + n * 0.55);
    const shelf = 1 + Math.sin(y * 0.85 + n * 2.2 + seed) * 0.035 + (n2 - 0.5) * 0.04;
    let wobble =
      1 +
      0.24 * Math.sin(ang * 2 + seed) +
      0.14 * Math.cos(ang * 3 - seed * 1.35) +
      0.09 * Math.sin(ang * 5 + seed * 2.1 + y * 0.09) +
      0.05 * Math.cos(ang + y * 0.18 + seed);
    if (kind === 0) wobble += 0.1 * Math.sin(ang * 1.4 + 1.2) * (t > 0.5 ? 1 : 0.35);
    if (kind === 3) wobble += 0.12 * Math.sin(ang * 2.4 + seed);
    if (kind === 5) wobble += 0.16 * Math.cos(ang - 0.6) * t;
    if (kind === 6) wobble += 0.11 * Math.sin(ang * 1.2 + 2.4) * (t > 0.72 ? 1.5 : 0.45);
    if (kind === 4) wobble = 1 + 0.1 * Math.sin(ang * 2.2 + seed) + 0.06 * n + 0.04 * Math.cos(ang * 3.1);
    const facing = Math.cos(ang - erodeA);
    if (t > neck0 - 0.06 && t < neck1 + 0.04) {
      wobble *= 1 - Math.max(0, facing) * (kind === 3 ? 0.42 : 0.28);
    }
    let mul = wobble * shelf * (1 + n * 0.1 + n2 * 0.05 + n3 * 0.022);
    if (t > cap0) {
      const u = (t - cap0) / Math.max(0.02, 1 - cap0);
      const chip = noise3(x * 0.22 + seed, 4.2, z * 0.22);
      if (chip > 0.48) mul *= 1 - (chip - 0.48) * 0.72 * u;
      const notch = noise3(ang * 0.8, seed + 3.1, t * 2.2);
      if (notch > 0.62) mul *= 1 - (notch - 0.62) * 0.85 * u;
      x += Math.cos(capOffA) * r * capOff * u;
      z += Math.sin(capOffA * 1.3) * r * capOff * 0.75 * u;
      y += n2 * r * 0.05 * u;
    }
    x *= mul;
    z *= mul;
    y += n * 0.06 + Math.sin(y * 1.1 + seed) * 0.03;
    pos.setXYZ(i, x, y, z);

    const neck = t > neck0 && t < neck1 ? 1 : t > neck0 - 0.05 && t < neck1 + 0.05 ? 0.35 : 0;
    const cap = t > cap0 ? Math.min(1, (t - cap0) / 0.06) : 0;
    let cr;
    let cg;
    let cb;
    if (cap > 0) {
      cr = 0.91 + n * 0.035 + cap * 0.03;
      cg = 0.85 + n * 0.025 + cap * 0.02;
      cb = 0.72 + n * 0.02;
    } else if (neck > 0) {
      cr = (0.2 + n * 0.03) * (1 - neck * 0.32);
      cg = (0.19 + n * 0.02) * (1 - neck * 0.32);
      cb = (0.18 + n * 0.02) * (1 - neck * 0.26);
    } else {
      const band = ((layer % 5) + 5) % 5;
      if (band === 0) {
        cr = 0.93 + n * 0.02;
        cg = 0.86 + n * 0.018;
        cb = 0.72 + n * 0.012;
      } else if (band === 1) {
        cr = 0.74 + n * 0.02;
        cg = 0.64 + n * 0.018;
        cb = 0.48 + n * 0.012;
      } else if (band === 2) {
        cr = 0.62 + n * 0.02;
        cg = 0.6 + n * 0.018;
        cb = 0.58 + n * 0.012;
      } else if (band === 3) {
        cr = 0.88 + n * 0.02;
        cg = 0.8 + n * 0.018;
        cb = 0.64 + n * 0.012;
      } else {
        cr = 0.52 + n * 0.02;
        cg = 0.48 + n * 0.018;
        cb = 0.44 + n * 0.012;
      }
    }
    col[i * 3] = cr;
    col[i * 3 + 1] = cg;
    col[i * 3 + 2] = cb;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function paintGrass(col, rng, x, z) {
  const patch = noise2(x * 0.14 + 2.4, z * 0.14);
  const speck = rng();
  if (patch < 0.28 || speck < 0.1) {
    col.setRGB(0.52 + rng() * 0.16, 0.0 + rng() * 0.015, 0.32 + rng() * 0.16, THREE.SRGBColorSpace);
  } else if (patch > 0.78 || speck > 0.9) {
    col.setRGB(0.84 + rng() * 0.1, 0.03 + rng() * 0.03, 0.3 + rng() * 0.12, THREE.SRGBColorSpace);
  } else {
    col.setRGB(0.72 + rng() * 0.16, 0.0 + rng() * 0.012, 0.16 + rng() * 0.08, THREE.SRGBColorSpace);
  }
}

function tintEmissiveByInstance(mat) {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = (shader) => {
    prev(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      "vec3 totalEmissiveRadiance = emissive;",
      "vec3 totalEmissiveRadiance = emissive * vColor;",
    );
  };
  mat.customProgramCacheKey = () => `${prevKey()}-emivc`;
}

export function createCrimsonMeadows(scene, shared) {
  const group = new THREE.Group();
  group.name = "crimson-meadows";
  const rng = mulberry32(3304);

  const grassMat = new THREE.MeshStandardMaterial({
    color: srgb(0xffeef2),
    roughness: 0.86,
    metalness: 0,
    side: THREE.DoubleSide,
    vertexColors: true,
    emissive: srgb(0xff2868),
    emissiveIntensity: 2.05,
  });
  patchUnderwater(grassMat, shared, { caustics: true, absorb: false });
  tintEmissiveByInstance(grassMat);

  const tuftA = makeTuft(441, 11, 1.05);
  const tuftB = makeTuft(778, 14, 0.68);
  const tuftC = makeTuft(219, 8, 1.38);
  const NA = 2800;
  const NB = 2400;
  const NC = 1600;
  const grassA = new THREE.InstancedMesh(tuftA, grassMat, NA);
  const grassB = new THREE.InstancedMesh(tuftB, grassMat, NB);
  const grassC = new THREE.InstancedMesh(tuftC, grassMat, NC);
  grassA.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NA * 3), 3);
  grassB.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NB * 3), 3);
  grassC.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(NC * 3), 3);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  const hoodoos = [
    [10, -208, 19.2, 5.6, 0],
    [-28, -216, 12.2, 6.4, 1],
    [34, -222, 17.6, 3.2, 2],
    [-18, -228, 9.4, 5.0, 4],
    [-46, -238, 13.0, 4.1, 3],
    [20, -246, 11.4, 3.6, 5],
    [-8, -258, 16.4, 4.6, 6],
    [48, -252, 15.0, 3.7, 7],
    [-52, -270, 17.8, 4.3, 2],
    [30, -276, 14.8, 4.0, 1],
  ];

  const rockMat = new THREE.MeshStandardMaterial({
    color: srgb(0xf4e8cc),
    roughness: 0.93,
    metalness: 0,
    vertexColors: true,
  });
  patchUnderwater(rockMat, shared, { caustics: true, absorb: false });
  const placed = [];
  for (let i = 0; i < hoodoos.length; i++) {
    const [x, z, h, r, kind] = hoodoos[i];
    const m = new THREE.Mesh(makeHoodoo(h, r, i * 2.17 + 1.1, kind), rockMat);
    const baseY = plantY(x, z, -0.55);
    m.position.set(x, baseY, z);
    const leanX = (rng() - 0.5) * 0.1 + (kind === 5 ? 0.2 : 0);
    const leanZ = (rng() - 0.5) * 0.1 + (kind === 5 ? -0.14 : kind === 0 ? 0.06 : 0);
    m.rotation.set(leanX, kind === 0 ? 0.9 : rng() * 6.28, leanZ);
    const sx = 0.9 + rng() * 0.18;
    const sz = kind === 4 ? 0.68 + rng() * 0.1 : 0.55 + rng() * 0.3;
    m.scale.set(sx, 1, sz);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    const capR = r * hoodooRad(Math.min(0.92, (CAP_T[kind] ?? 0.84) + 0.06), kind);
    placed.push({ x, z, y: baseY, h, r, kind, capR });
  }

  const nearHoodoo = (x, z) => {
    for (const hdoo of placed) {
      if (Math.hypot(x - hdoo.x, z - hdoo.z) < hdoo.r * 0.95) return true;
    }
    return false;
  };

  const plantOne = (mesh, n, x, z) => {
    const y = plantY(x, z, 0.02);
    if (y > -28) return false;
    if (nearHoodoo(x, z)) return false;
    const patchH = 0.55 + noise2(x * 0.05, z * 0.05) * 1.35;
    dummy.position.set(x, y, z);
    dummy.rotation.set((rng() - 0.5) * 0.18, rng() * 6.28, (rng() - 0.5) * 0.18);
    const scY = (0.7 + rng() * 2.15) * patchH;
    const scX = 1.45 + rng() * 0.85;
    dummy.scale.set(scX, scY, scX * (0.88 + rng() * 0.22));
    dummy.updateMatrix();
    mesh.setMatrixAt(n, dummy.matrix);
    paintGrass(col, rng, x, z);
    mesh.instanceColor.setXYZ(n, col.r, col.g, col.b);
    return true;
  };

  let ia = 0;
  let ib = 0;
  let ic = 0;
  const cols = 96;
  const rows = 78;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const x = -78 + ((i + (j % 2) * 0.5 + rng() * 0.4) / cols) * 168;
      const z = -162 - ((j + rng() * 0.45) / rows) * 148;
      const slot = (i + j * 3) % 7;
      if (slot < 3 && ia < NA) {
        if (plantOne(grassA, ia, x, z)) ia++;
      } else if (slot < 6 && ib < NB) {
        if (plantOne(grassB, ib, x, z)) ib++;
      } else if (ic < NC) {
        if (plantOne(grassC, ic, x, z)) ic++;
      } else if (ia < NA && plantOne(grassA, ia, x, z)) ia++;
    }
  }

  for (const hdoo of placed) {
    if (hdoo.z < -262) continue;
    const tufts = hdoo.kind === 4 ? 8 : hdoo.z > -214 ? 16 : 7;
    const capR = Math.max(0.55, hdoo.capR * (hdoo.kind === 4 ? 0.38 : 0.52));
    const capY = hdoo.y + hdoo.h * (hdoo.kind === 4 ? 0.92 : 0.97);
    for (let k = 0; k < tufts; k++) {
      const a = rng() * Math.PI * 2;
      const rr = Math.sqrt(rng()) * capR;
      const x = hdoo.x + Math.cos(a) * rr;
      const z = hdoo.z + Math.sin(a) * rr;
      dummy.position.set(x, capY + rng() * 0.1, z);
      dummy.rotation.set((rng() - 0.5) * 0.35, rng() * 6.28, (rng() - 0.5) * 0.35);
      const sc = (hdoo.z > -212 ? 0.95 : 0.6) + rng() * 0.4;
      dummy.scale.set(sc * 1.1, sc * 0.72, sc * 1.1);
      dummy.updateMatrix();
      paintGrass(col, rng, x, z);
      if (ia < NA) {
        grassA.setMatrixAt(ia, dummy.matrix);
        grassA.instanceColor.setXYZ(ia, col.r, col.g, col.b);
        ia++;
      } else if (ib < NB) {
        grassB.setMatrixAt(ib, dummy.matrix);
        grassB.instanceColor.setXYZ(ib, col.r, col.g, col.b);
        ib++;
      }
    }
  }

  const fillRest = (mesh, start, cap) => {
    let n = start;
    let guard = 0;
    while (n < cap && guard < cap * 8) {
      guard++;
      const x = -78 + rng() * 168;
      const z = -162 - rng() * 148;
      if (plantOne(mesh, n, x, z)) n++;
    }
    return n;
  };
  ia = fillRest(grassA, ia, NA);
  ib = fillRest(grassB, ib, NB);
  ic = fillRest(grassC, ic, NC);

  for (const g of [grassA, grassB, grassC]) {
    g.instanceColor.needsUpdate = true;
    g.instanceMatrix.needsUpdate = true;
    g.castShadow = false;
    g.receiveShadow = false;
    g.frustumCulled = false;
    group.add(g);
  }
  grassA.count = ia;
  grassB.count = ib;
  grassC.count = ic;

  const FISH_N = 8;
  const fishGeo = new THREE.SphereGeometry(0.2, 6, 4);
  fishGeo.scale(1.7, 0.62, 0.48);
  const fishMat = new THREE.MeshStandardMaterial({
    color: srgb(0x141c24),
    roughness: 0.88,
    metalness: 0,
  });
  patchUnderwater(fishMat, shared, { caustics: false });
  const fish = new THREE.InstancedMesh(fishGeo, fishMat, FISH_N);
  const fishBase = [];
  for (let i = 0; i < FISH_N; i++) {
    const b = {
      x: 22 + rng() * 48,
      y: -28 + rng() * 10,
      z: -248 - rng() * 40,
      s: 0.45 + rng() * 0.4,
      yaw: rng() * 6.28,
      p: rng() * 6.28,
    };
    fishBase.push(b);
    dummy.position.set(b.x, b.y, b.z);
    dummy.rotation.set(0, b.yaw, 0);
    dummy.scale.setScalar(b.s);
    dummy.updateMatrix();
    fish.setMatrixAt(i, dummy.matrix);
  }
  fish.castShadow = false;
  group.add(fish);

  group.userData.update = (t) => {
    for (let i = 0; i < FISH_N; i++) {
      const b = fishBase[i];
      dummy.position.set(
        b.x + Math.sin(t * 0.16 + b.p) * 2.2,
        b.y + Math.sin(t * 0.2 + b.p * 1.4) * 0.55,
        b.z + Math.cos(t * 0.13 + b.p) * 1.6,
      );
      dummy.rotation.set(0, b.yaw + Math.sin(t * 0.16 + b.p) * 0.35, 0);
      dummy.scale.setScalar(b.s);
      dummy.updateMatrix();
      fish.setMatrixAt(i, dummy.matrix);
    }
    fish.instanceMatrix.needsUpdate = true;
  };

  scene.add(group);
  return group;
}
