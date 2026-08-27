import * as THREE from "three";
import { mulberry32, noise3 } from "../math.js";
import { patchUnderwater } from "../shaders.js";
import { srgb } from "./util.js";

// SHOT [16,-168,88] -> [118,-182,8]

export const FLOOR_Y = -188.2;
export const CAVE = { x: 72, y: -180, z: 54, rx: 110, ry: 50, rz: 104 };

/** Swim floor inside the chamber. Null means use the seafloor / well. */
export function jellySwimFloor(x, y, z) {
  const dx = (x - CAVE.x) / CAVE.rx;
  const dz = (z - CAVE.z) / CAVE.rz;
  if (dx * dx + dz * dz > 0.92) return null;
  const sink = Math.hypot(x - 70, z - 52);
  if (sink < 20 && y > -125) return null;
  if (y > -105) return null;
  return FLOOR_Y;
}

function makeJellyCap(radius, seed) {
  const pts = [
    [0.0, 0.58],
    [0.18, 0.56],
    [0.38, 0.46],
    [0.58, 0.28],
    [0.76, 0.06],
    [0.9, -0.16],
    [0.98, -0.34],
    [0.92, -0.42],
    [0.72, -0.28],
    [0.44, -0.12],
    [0.18, -0.04],
    [0.0, -0.015],
  ].map(([u, v]) => new THREE.Vector2(u * radius, v * radius));
  const geo = new THREE.LatheGeometry(pts, 48);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const rim = Math.hypot(x, z) / Math.max(radius, 0.01);
    const n = noise3(x * 0.2 + seed, y * 0.48, z * 0.2);
    const n2 = noise3(x * 0.62 + seed * 0.55, y * 1.15, z * 0.62);
    const k = 1 + n * 0.035 + n2 * 0.016;
    pos.setXYZ(i, x * k, y + n2 * 0.03 * radius * (1 - rim * 0.45), z * k);
    const core = 1 - rim * 0.5;
    const lip = Math.max(0, 1 - Math.abs(rim - 0.9) * 7);
    col[i * 3] = 0.88 + core * 0.1 + lip * 0.08 + n * 0.03;
    col[i * 3 + 1] = 0.66 + core * 0.2 + n2 * 0.04;
    col[i * 3 + 2] = 0.9 + core * 0.08 + lip * 0.06;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeInnerCap(radius) {
  const pts = [
    [0.0, 0.18],
    [0.36, 0.19],
    [0.68, 0.12],
    [0.9, 0.02],
    [1.0, -0.06],
    [0.78, -0.07],
    [0.4, -0.03],
    [0.0, -0.01],
  ].map(([u, v]) => new THREE.Vector2(u * radius * 0.62, v * radius * 0.68));
  const geo = new THREE.LatheGeometry(pts, 28);
  geo.computeVertexNormals();
  return geo;
}

function makeStalk(h, rBot, rTop, seed) {
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, 16, 14);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = noise3(x * 1.05 + seed, y * 0.24, z * 1.05);
    const n2 = noise3(x * 2.2 + seed * 0.7, y * 0.62, z * 2.2);
    const n3 = noise3(x * 3.8 + seed, y * 1.4, z * 3.8);
    const t = (y + h * 0.5) / h;
    const bulge = Math.sin(t * Math.PI) * 0.12;
    const lean = t * t * 0.22;
    const k = 1 + n * 0.28 + n2 * 0.12 + n3 * 0.05 + bulge;
    pos.setXYZ(i, x * k + lean, y, z * k + n * 0.16);
    const shade = 0.55 + n * 0.22 + n2 * 0.08;
    col[i * 3] = 0.07 * shade;
    col[i * 3 + 1] = 0.035 * shade;
    col[i * 3 + 2] = 0.065 * shade;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeShelfRing(radius, tube, seed) {
  const geo = new THREE.TorusGeometry(radius, tube, 12, 40);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = noise3(x * 0.38 + seed, y * 0.8, z * 0.38);
    const n2 = noise3(x * 0.9 + 3, y * 1.5, z * 0.9);
    pos.setXYZ(i, x * (1 + n * 0.12 + n2 * 0.05), y * 0.48 + n * 0.22, z * (1 + n * 0.12 + n2 * 0.05));
  }
  geo.computeVertexNormals();
  return geo;
}

function makeShelfPlate(r, seed) {
  const geo = new THREE.SphereGeometry(r, 14, 10);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = noise3(x * 0.85 + seed, y * 1.1, z * 0.85);
    const n2 = noise3(x * 1.8, y * 2.2 + seed, z * 1.8);
    pos.setXYZ(i, x * (1 + n * 0.16), y * (0.18 + n * 0.1) + n2 * 0.04, z * (1 + n * 0.16));
  }
  geo.computeVertexNormals();
  return geo;
}

function makeDripTissue() {
  const pts = [
    [0.0, 0.0],
    [0.12, 0.08],
    [0.2, 0.22],
    [0.24, 0.42],
    [0.2, 0.64],
    [0.13, 0.82],
    [0.05, 0.96],
    [0.0, 1.0],
  ].map(([u, v]) => new THREE.Vector2(u, v));
  const geo = new THREE.LatheGeometry(pts, 8);
  geo.computeVertexNormals();
  return geo;
}

function makeRock(r, seed) {
  const geo = new THREE.SphereGeometry(r, 20, 16);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = noise3(x * 0.2 + seed, y * 0.18, z * 0.2);
    const n2 = noise3(x * 0.52 + 4, y * 0.46, z * 0.52);
    const n3 = noise3(x * 1.1 + seed, y * 0.9, z * 1.1);
    pos.setXYZ(i, x * (1 + n * 0.24 + n3 * 0.06), y * (0.62 + n * 0.18), z * (1 + n * 0.24 + n3 * 0.06));
    const shade = 0.72 + n * 0.22 + n2 * 0.1;
    col[i * 3] = 0.32 * shade;
    col[i * 3 + 1] = 0.11 * shade;
    col[i * 3 + 2] = 0.44 * shade;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeCaveShell(rx, ry, rz, seed) {
  const geo = new THREE.SphereGeometry(1, 56, 40);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const n = noise3(x * 1.45 + seed, y * 1.6, z * 1.45);
    const n2 = noise3(x * 3.1 + seed * 2, y * 2.8, z * 3.0);
    const n3 = noise3(x * 6.2, y * 5.4 + seed, z * 5.9);
    const pit = Math.max(0, n2 - 0.56) * 0.07 + Math.max(0, n3 - 0.64) * 0.03;
    const s = 1 + n * 0.055 + n2 * 0.022 - pit;
    let y2 = y;
    if (y < -0.12) y2 = -0.12 + (y + 0.12) * 0.28;
    pos.setXYZ(i, x * rx * s, y2 * ry * s, z * rz * s);
    const shade = 0.64 + n * 0.26 + n2 * 0.1 - pit * 3.4;
    col[i * 3] = 0.4 * shade;
    col[i * 3 + 1] = 0.11 * shade;
    col[i * 3 + 2] = 0.56 * shade;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

function ceilingY(x, z) {
  const dx = (x - CAVE.x) / CAVE.rx;
  const dz = (z - CAVE.z) / CAVE.rz;
  const h2 = 1 - dx * dx - dz * dz;
  if (h2 <= 0.12) return null;
  return CAVE.y + CAVE.ry * Math.sqrt(h2) - 0.4;
}

function nearHero(x, z, heroes) {
  for (const h of heroes) {
    if (Math.hypot(x - h.x, z - h.z) < h.r + 7.2) return true;
  }
  return false;
}

export function createJellyshroomCave(scene, shared) {
  const group = new THREE.Group();
  group.name = "jellyshroom-cave";
  const rng = mulberry32(2208);
  const dummy = new THREE.Object3D();

  const caveMat = new THREE.MeshStandardMaterial({
    color: srgb(0x2a1038),
    roughness: 0.96,
    metalness: 0,
    side: THREE.BackSide,
    vertexColors: true,
    emissive: srgb(0x2c0e42),
    emissiveIntensity: 0.58,
    fog: false,
    depthWrite: true,
  });
  patchUnderwater(caveMat, shared, { caustics: false, absorb: false, detail: "coral" });

  const linerMat = new THREE.MeshStandardMaterial({
    color: srgb(0x321244),
    roughness: 0.95,
    metalness: 0,
    side: THREE.BackSide,
    vertexColors: true,
    emissive: srgb(0x341050),
    emissiveIntensity: 0.62,
    fog: false,
    depthWrite: true,
  });
  patchUnderwater(linerMat, shared, { caustics: false, absorb: false, detail: "coral" });

  const chamber = new THREE.Mesh(makeCaveShell(CAVE.rx, CAVE.ry, CAVE.rz, 1.2), caveMat);
  chamber.position.set(CAVE.x, CAVE.y, CAVE.z);
  chamber.frustumCulled = false;
  group.add(chamber);

  const liner = new THREE.Mesh(makeCaveShell(CAVE.rx * 0.96, CAVE.ry * 0.97, CAVE.rz * 0.96, 4.6), linerMat);
  liner.position.set(CAVE.x, CAVE.y, CAVE.z);
  liner.frustumCulled = false;
  group.add(liner);

  const rockMat = new THREE.MeshStandardMaterial({
    color: srgb(0x241028),
    roughness: 0.94,
    vertexColors: true,
    emissive: srgb(0x1c0a30),
    emissiveIntensity: 0.34,
    fog: false,
  });
  patchUnderwater(rockMat, shared, { caustics: false, absorb: false, detail: "coral" });

  const wallRocks = [
    [88, 60, 9.6, 1.1, 1.65],
    [90, 46, 8.8, 2.4, 1.5],
    [84, 70, 8.4, 3.1, 1.48],
    [72, 76, 9.0, 4.2, 1.55],
    [58, 74, 8.0, 5.0, 1.42],
    [46, 62, 8.2, 6.1, 1.55],
    [92, 36, 7.2, 8.0, 1.28],
    [80, 78, 7.0, 8.8, 1.26],
    [64, 78, 6.8, 9.4, 1.22],
    [44, 54, 7.6, 10.2, 1.4],
    [86, 54, 6.6, 12.0, 1.2],
    [78, 30, 6.2, 12.8, 1.16],
    [94, 64, 6.8, 14.2, 1.3],
    [118, 70, 11.2, 15.1, 1.5],
    [110, 28, 10.4, 16.0, 1.42],
    [32, 78, 10.8, 17.2, 1.48],
    [26, 40, 9.6, 18.0, 1.36],
    [128, 48, 9.2, 19.1, 1.3],
    [98, 96, 10.0, 20.2, 1.4],
    [148, 62, 12.4, 21.4, 1.55],
    [138, 18, 11.6, 22.2, 1.48],
    [12, 88, 12.0, 23.0, 1.52],
    [8, 22, 11.0, 24.1, 1.4],
    [160, 90, 13.2, 25.0, 1.58],
    [40, 140, 12.6, 26.2, 1.46],
    [120, 140, 11.8, 27.0, 1.5],
    [-8, 54, 10.4, 28.1, 1.38],
    [72, -28, 11.4, 29.0, 1.44],
  ];
  for (const [x, z, r, seed, sy] of wallRocks) {
    const rock = new THREE.Mesh(makeRock(r, seed), rockMat);
    rock.position.set(x, FLOOR_Y + r * 0.16, z);
    rock.scale.y = sy;
    rock.rotation.y = seed;
    group.add(rock);
  }

  const floorGeo = new THREE.CircleGeometry(98, 64);
  floorGeo.rotateX(-Math.PI / 2);
  const fp = floorGeo.attributes.position;
  const fcol = new Float32Array(fp.count * 3);
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i);
    const z = fp.getZ(i);
    const n = noise3(x * 0.1 + 2, 0.4, z * 0.1);
    const n2 = noise3(x * 0.26, 1.2, z * 0.26);
    fp.setY(i, n * 0.4 + n2 * 0.16);
    const shade = 0.8 + n * 0.18;
    fcol[i * 3] = 0.28 * shade;
    fcol[i * 3 + 1] = 0.09 * shade;
    fcol[i * 3 + 2] = 0.38 * shade;
  }
  floorGeo.setAttribute("color", new THREE.Float32BufferAttribute(fcol, 3));
  floorGeo.computeVertexNormals();
  const floorMat = new THREE.MeshStandardMaterial({
    color: srgb(0x221028),
    roughness: 0.96,
    vertexColors: true,
    emissive: srgb(0x200c30),
    emissiveIntensity: 0.46,
    fog: false,
    side: THREE.DoubleSide,
    depthWrite: true,
  });
  patchUnderwater(floorMat, shared, { caustics: false, absorb: false, detail: "coral" });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.set(CAVE.x, FLOOR_Y, CAVE.z);
  floor.frustumCulled = false;
  group.add(floor);

  const capMat = new THREE.MeshStandardMaterial({
    color: srgb(0xe8b0e6),
    emissive: srgb(0xc058c8),
    emissiveIntensity: 1.08,
    roughness: 0.18,
    metalness: 0.03,
    transparent: true,
    opacity: 0.72,
    vertexColors: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    fog: false,
  });

  const innerMat = new THREE.MeshStandardMaterial({
    color: srgb(0xffc8f6),
    emissive: srgb(0xe078e8),
    emissiveIntensity: 1.5,
    roughness: 0.14,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    fog: false,
  });

  const bandMat = new THREE.MeshStandardMaterial({
    color: srgb(0xffdcff),
    emissive: srgb(0xf098f6),
    emissiveIntensity: 1.4,
    roughness: 0.16,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
    fog: false,
  });

  const stalkMat = new THREE.MeshStandardMaterial({
    color: srgb(0x2a1238),
    roughness: 0.72,
    metalness: 0.02,
    vertexColors: true,
    emissive: srgb(0x4a1868),
    emissiveIntensity: 0.42,
  });
  patchUnderwater(stalkMat, shared, { caustics: false, absorb: false });

  const shelfMat = new THREE.MeshStandardMaterial({
    color: srgb(0x30145a),
    roughness: 0.52,
    emissive: srgb(0x2a0c58),
    emissiveIntensity: 0.48,
  });
  patchUnderwater(shelfMat, shared, { caustics: false, absorb: false, detail: "coral" });

  const plateMat = new THREE.MeshStandardMaterial({
    color: srgb(0x281050),
    roughness: 0.55,
    emissive: srgb(0x240a4c),
    emissiveIntensity: 0.4,
  });
  patchUnderwater(plateMat, shared, { caustics: false, absorb: false, detail: "coral" });

  const dotMat = new THREE.MeshStandardMaterial({
    color: srgb(0xffb8f0),
    emissive: srgb(0xff78e8),
    emissiveIntensity: 1.4,
    roughness: 0.24,
    fog: false,
  });

  const heroes = [
    { x: 32, z: 16, r: 10.4, h: 16.2, layers: 6, lamp: true },
    { x: 72, z: 68, r: 12.2, h: 18.6, layers: 6, lamp: true },
    { x: 112, z: 42, r: 10.8, h: 16.8, layers: 6, lamp: true },
    { x: 52, z: 92, r: 9.6, h: 14.8, layers: 5 },
    { x: 96, z: 14, r: 9.8, h: 14.6, layers: 5, lamp: true },
    { x: 24, z: 58, r: 8.8, h: 13.4, layers: 5 },
    { x: 128, z: 78, r: 9.4, h: 14.2, layers: 5, lamp: true },
    { x: 68, z: -18, r: 9.2, h: 13.8, layers: 5 },
  ];

  const lamps = [];

  const DOT_MAX = 720;
  const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6), dotMat, DOT_MAX);
  dots.frustumCulled = false;
  let dotN = 0;

  const PLATE_MAX = 260;
  const plates = new THREE.InstancedMesh(makeShelfPlate(1, 1.7), plateMat, PLATE_MAX);
  plates.frustumCulled = false;
  let plateN = 0;

  for (let hi = 0; hi < heroes.length; hi++) {
    const { x, z, r, h, layers, lamp: wantLamp } = heroes[hi];
    const base = FLOOR_Y;
    const stalk = new THREE.Mesh(makeStalk(h, r * 0.28, r * 0.16, hi * 2.3), stalkMat);
    stalk.position.set(x, base + h * 0.5, z);
    group.add(stalk);

    const cap = new THREE.Mesh(makeJellyCap(r, hi * 1.7), capMat);
    cap.position.set(x, base + h + r * 0.02, z);
    cap.renderOrder = 2;
    group.add(cap);

    const inner = new THREE.Mesh(makeInnerCap(r), innerMat);
    inner.position.set(x, base + h + r * 0.015, z);
    inner.renderOrder = 3;
    group.add(inner);

    const band = new THREE.Mesh(new THREE.TorusGeometry(r * 0.88, r * 0.028, 8, 28), bandMat);
    band.rotation.x = Math.PI / 2;
    band.position.set(x, base + h - r * 0.28, z);
    band.renderOrder = 4;
    group.add(band);

    if (wantLamp) {
      const lamp = new THREE.PointLight(0xd050ff, 4.6, 30, 1.3);
      lamp.position.set(0, 0.18, 0);
      lamp.userData.base = 4.2;
      cap.add(lamp);
      lamps.push(lamp);
    }

    for (let k = 0; k < layers; k++) {
      const rad = r * (0.34 + k * 0.175);
      const tube = 0.42 + k * 0.07;
      const shelf = new THREE.Mesh(makeShelfRing(rad, tube, hi * 5 + k), shelfMat);
      shelf.rotation.x = Math.PI / 2;
      shelf.rotation.z = (rng() - 0.5) * 0.1;
      shelf.position.set(x, base + 0.16 + k * 0.32, z);
      group.add(shelf);

      const nPlates = 3 + (k % 2);
      for (let p = 0; p < nPlates && plateN < PLATE_MAX; p++) {
        const a = (p / nPlates) * Math.PI * 2 + rng() * 0.5 + hi;
        dummy.position.set(
          x + Math.cos(a) * rad * (0.86 + rng() * 0.22),
          base + 0.1 + k * 0.3 + rng() * 0.08,
          z + Math.sin(a) * rad * (0.86 + rng() * 0.22),
        );
        const sc = 0.55 + rng() * 0.45 + k * 0.06;
        dummy.scale.set(sc, sc * 0.85, sc);
        dummy.rotation.set((rng() - 0.5) * 0.2, rng() * 6.28, (rng() - 0.5) * 0.15);
        dummy.updateMatrix();
        plates.setMatrixAt(plateN++, dummy.matrix);
      }

      const nDots = 5 + k;
      for (let d = 0; d < nDots && dotN < DOT_MAX; d++) {
        const a = (d / nDots) * Math.PI * 2 + rng() * 0.4 + hi;
        dummy.position.set(
          x + Math.cos(a) * rad,
          base + 0.4 + k * 0.32 + (rng() - 0.5) * 0.06,
          z + Math.sin(a) * rad,
        );
        dummy.scale.setScalar(0.45 + rng() * 0.7);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        dots.setMatrixAt(dotN++, dummy.matrix);
      }
    }
  }
  plates.count = plateN;
  group.add(plates);
  dots.count = dotN;
  group.add(dots);

  const midField = [];
  for (let i = 0; i < 28 && midField.length < 12; i++) {
    const a = rng() * Math.PI * 2;
    const rad = 14 + rng() * 78;
    const x = CAVE.x + Math.cos(a) * rad;
    const z = CAVE.z + Math.sin(a) * rad;
    if (nearHero(x, z, heroes)) continue;
    const dx = (x - CAVE.x) / CAVE.rx;
    const dz = (z - CAVE.z) / CAVE.rz;
    if (dx * dx + dz * dz > 0.78) continue;
    let tooClose = false;
    for (const m of midField) {
      if (Math.hypot(x - m.x, z - m.z) < 14.5) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;
    midField.push({
      x,
      z,
      r: 2.1 + rng() * 3.4,
      h: 3.6 + rng() * 5.8,
    });
  }
  for (let i = 0; i < midField.length; i++) {
    const m = midField[i];
    const stalk = new THREE.Mesh(makeStalk(m.h, m.r * 0.28, m.r * 0.16, 20 + i), stalkMat);
    stalk.position.set(m.x, FLOOR_Y + m.h * 0.5, m.z);
    group.add(stalk);
    const cap = new THREE.Mesh(makeJellyCap(m.r, 12 + i), capMat);
    cap.position.set(m.x, FLOOR_Y + m.h, m.z);
    cap.renderOrder = 2;
    group.add(cap);
    if (i % 8 === 0 && lamps.length < 8) {
      const lamp = new THREE.PointLight(0xd050ff, 1.6, 16, 1.5);
      lamp.position.set(0, 0.12, 0);
      lamp.userData.base = 1.5;
      cap.add(lamp);
      lamps.push(lamp);
    }
  }

  const pebbles = [
    [59.8, 43.6, 0.55],
    [72.8, 45.2, 0.42],
    [70.2, 59.4, 0.5],
    [80.4, 47.8, 0.38],
  ];
  const pebbleMat = new THREE.MeshStandardMaterial({
    color: srgb(0x3a1428),
    roughness: 0.82,
    emissive: srgb(0x180810),
    emissiveIntensity: 0.14,
  });
  patchUnderwater(pebbleMat, shared, { caustics: false, absorb: false });
  for (const [x, z, r] of pebbles) {
    const p = new THREE.Mesh(makeRock(r, x * 0.1), pebbleMat);
    p.position.set(x, FLOOR_Y + r * 0.14, z);
    group.add(p);
  }

  const dripMat = new THREE.MeshStandardMaterial({
    color: srgb(0x7a2898),
    emissive: srgb(0x8818c0),
    emissiveIntensity: 0.78,
    roughness: 0.4,
    fog: false,
  });
  patchUnderwater(dripMat, shared, { caustics: false, absorb: false });
  const DRIP_N = 560;
  const drips = new THREE.InstancedMesh(makeDripTissue(), dripMat, DRIP_N);
  drips.frustumCulled = false;
  let dripN = 0;

  const clusters = [
    [58, 52, 42],
    [56, 56, 36],
    [54, 50, 32],
    [60, 54, 28],
    [52, 54, 24],
    [62, 58, 20],
    [50, 48, 18],
    [64, 50, 16],
    [48, 56, 14],
    [70, 40, 12],
    [80, 46, 10],
    [84, 60, 10],
    [96, 72, 16],
    [40, 80, 14],
    [110, 40, 14],
    [28, 36, 12],
    [88, 110, 12],
    [130, 70, 10],
  ];
  for (const [cx, cz, count] of clusters) {
    for (let i = 0; i < count && dripN < DRIP_N; i++) {
      const a = rng() * Math.PI * 2;
      const rad = rng() * 4.8;
      const x = cx + Math.cos(a) * rad;
      const z = cz + Math.sin(a) * rad;
      if (nearHero(x, z, heroes)) continue;
      const cy = ceilingY(x, z);
      if (cy == null || cy < -172) continue;
      const len = 1.4 + rng() * 2.6;
      dummy.position.set(x, cy - len * 0.48, z);
      dummy.rotation.set((rng() - 0.5) * 0.16, rng() * 6.28, (rng() - 0.5) * 0.14);
      dummy.scale.set(0.95 + rng() * 1.15, len, 0.95 + rng() * 1.15);
      dummy.updateMatrix();
      drips.setMatrixAt(dripN++, dummy.matrix);
    }
  }
  let guard = 0;
  while (dripN < DRIP_N && guard++ < 4000) {
    const a = rng() * Math.PI * 2;
    const rad = 10 + rng() * 78;
    const x = CAVE.x + Math.cos(a) * rad;
    const z = CAVE.z + Math.sin(a) * rad;
    if (nearHero(x, z, heroes)) continue;
    const cy = ceilingY(x, z);
    if (cy == null || cy < -172) continue;
    const len = 0.7 + rng() * 1.4;
    dummy.position.set(x, cy - len * 0.48, z);
    dummy.rotation.set((rng() - 0.5) * 0.08, rng() * 6.28, (rng() - 0.5) * 0.08);
    dummy.scale.set(0.5 + rng() * 0.65, len, 0.5 + rng() * 0.65);
    dummy.updateMatrix();
    drips.setMatrixAt(dripN++, dummy.matrix);
  }
  drips.count = dripN;
  group.add(drips);

  const ceilRocks = [
    [56, 52, 2.6, 21],
    [54, 56, 2.9, 22],
    [60, 50, 2.2, 23],
    [52, 50, 2.4, 24],
    [58, 58, 2.0, 25],
  ];
  for (const [x, z, r, seed] of ceilRocks) {
    const cy = ceilingY(x, z);
    if (cy == null) continue;
    const rock = new THREE.Mesh(makeRock(r, seed), rockMat);
    rock.position.set(x, cy - r * 0.22, z);
    rock.scale.y = 1.35;
    rock.rotation.x = Math.PI;
    rock.frustumCulled = false;
    group.add(rock);
  }

  const moteGeo = new THREE.BufferGeometry();
  const motePos = new Float32Array(160 * 3);
  for (let i = 0; i < 160; i++) {
    const a = rng() * Math.PI * 2;
    const rad = rng() * 72;
    motePos[i * 3] = CAVE.x + Math.cos(a) * rad;
    motePos[i * 3 + 1] = FLOOR_Y + 0.6 + rng() * 22;
    motePos[i * 3 + 2] = CAVE.z + Math.sin(a) * rad;
  }
  moteGeo.setAttribute("position", new THREE.BufferAttribute(motePos, 3));
  group.add(
    new THREE.Points(
      moteGeo,
      new THREE.PointsMaterial({
        color: 0xd070e8,
        size: 0.07,
        transparent: true,
        opacity: 0.34,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
      }),
    ),
  );

  group.userData.update = (t) => {
    const pulse = 0.92 + 0.1 * Math.sin(t * 0.58);
    capMat.emissiveIntensity = 1.08 * pulse;
    innerMat.emissiveIntensity = 1.5 * pulse;
    bandMat.emissiveIntensity = 1.4 * pulse;
    for (const lamp of lamps) lamp.intensity = lamp.userData.base * pulse;
  };

  scene.add(group);
  return group;
}
