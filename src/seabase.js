import * as THREE from "three";
import { terrainHeight } from "./terrain.js";
import { patchUnderwater } from "./shaders.js";
import { mergeGeos, tint } from "./regions/util.js";

// Requested pin (46, 38) is inside the jelly shaft (terrain −198).
// Sit on Shallows sand due south, same X, east of the grotto.
export const SEABASE = { x: 46, z: 2 };

export const ROOM_R = 3.42;
export const DOME_R = 7.44;
export const CORR_LEN = 8.15;
export const CORR_R = 1.06;
export const FLOOR_Y = -17.82;

const BX = SEABASE.x;
const BZ = SEABASE.z;
const DOME_X = BX + ROOM_R + CORR_LEN + DOME_R - 0.12;
const DOME_Z = BZ;
const CORR_Y = FLOOR_Y + 1.58;
const DOME_Y = FLOOR_Y + 2.35;
const ROOM_TOP = FLOOR_Y + 5.15;
const MOON_R = 0.8;
const CORR_X0 = BX + ROOM_R - 0.18;
const CORR_X1 = DOME_X - DOME_R + 0.18;

export const SEABASE_ENTRY = {
  position: [BX, FLOOR_Y - 2.15, BZ + 0.05],
  target: [BX, FLOOR_Y + 1.2, BZ - 0.4],
};

export const SEABASE_INSIDE = {
  position: [BX + 0.15, FLOOR_Y + 1.55, BZ + 0.2],
  target: [DOME_X, FLOOR_Y + 1.45, DOME_Z],
};

function wrapAng(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function inHatchOpening(x, y, z) {
  const hx = x - BX;
  const hy = y - (FLOOR_Y + 0.62);
  const hz = z - (BZ + ROOM_R - 0.1);
  return hx * hx + hy * hy < 0.78 * 0.78 && hz > -0.35 && hz < 1.45;
}

function inCorrOpening(x, y, z) {
  return x > BX + ROOM_R - 0.85 && x < CORR_X1 + 0.35 && Math.abs(z - BZ) < CORR_R - 0.08 && y > FLOOR_Y - 0.05 && y < CORR_Y + CORR_R - 0.08;
}

export function nearestBaseEntry(x, y, z) {
  if (isInsideBase(x, y, z) && !inMoonpoolXZ(x, z) && y > FLOOR_Y + 0.4) return null;
  const hatch = Math.hypot(x - BX, y - (FLOOR_Y + 0.55), z - (BZ + ROOM_R + 0.55));
  const well = Math.hypot(x - BX, y - (FLOOR_Y - 1.45), z - BZ);
  if (hatch < 2.7 && z > BZ + 1.4) return { kind: "hatch", label: "E   Enter hatch" };
  if ((inMoonpoolXZ(x, z) && y < FLOOR_Y - 0.2 && y > FLOOR_Y - 3.4) || (well < 2.5 && y < FLOOR_Y - 0.4)) {
    return { kind: "moonpool", label: "E   Enter moonpool" };
  }
  return null;
}

export function resolveSeabaseCollision(pos) {
  const x = pos.x;
  const y = pos.y;
  const z = pos.z;
  const dx = x - BX;
  const dz = z - BZ;
  const d = Math.hypot(dx, dz) || 1e-4;
  const ang = Math.atan2(dz, dx);
  const hatch = inHatchOpening(x, y, z);
  const corr = inCorrOpening(x, y, z);
  const moon = inMoonpoolXZ(x, z) && y < FLOOR_Y + 0.35;

  if (d > ROOM_R - 0.26 && d < ROOM_R + 0.32 && y > FLOOR_Y - 0.45 && y < ROOM_TOP - 0.15) {
    if (!hatch && !corr && !moon) {
      const inside = d < ROOM_R;
      const nd = inside ? ROOM_R - 0.3 : ROOM_R + 0.34;
      pos.x = BX + (dx / d) * nd;
      pos.z = BZ + (dz / d) * nd;
    }
  }

  if (x > CORR_X0 - 0.05 && x < CORR_X1 + 0.05 && y > CORR_Y - CORR_R - 0.05 && y < CORR_Y + CORR_R + 0.05) {
    const cy = y - CORR_Y;
    const cz = z - BZ;
    const cr = Math.hypot(cy, cz) || 1e-4;
    if (cr > CORR_R - 0.2 && cr < CORR_R + 0.28) {
      const nd = CORR_R - 0.24;
      pos.y = CORR_Y + (cy / cr) * nd;
      pos.z = BZ + (cz / cr) * nd;
    }
  }

  const ddx = x - DOME_X;
  const ddz = z - DOME_Z;
  const ddr = Math.hypot(ddx, ddz) || 1e-4;
  const ddy = y - DOME_Y;
  const d3 = Math.hypot(ddx, ddy, ddz) || 1e-4;
  if (d3 > DOME_R - 0.22 && d3 < DOME_R + 0.28 && y > FLOOR_Y + 0.2) {
    const inFromCorr = x < DOME_X - DOME_R + 1.8 && Math.abs(z - BZ) < CORR_R + 0.15 && y < CORR_Y + CORR_R + 0.2;
    if (!inFromCorr) {
      const nd = d3 < DOME_R ? DOME_R - 0.26 : DOME_R + 0.3;
      pos.x = DOME_X + (ddx / d3) * nd;
      pos.y = DOME_Y + (ddy / d3) * nd;
      pos.z = DOME_Z + (ddz / d3) * nd;
    }
  }
  void ang;
  void ddr;
}

function srgb(hex) {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

function taperBody(len, ht, wd, segs = 14, rings = 10) {
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

// Same construction as the shallows school: tapered body, forked tail, fins.
function makeDomeFish() {
  const body = taperBody(0.5, 0.155, 0.08, 14, 10);
  const tailUp = new THREE.ConeGeometry(0.082, 0.25, 5);
  tailUp.rotateZ(Math.PI / 2);
  tailUp.scale(1, 1.68, 0.15);
  tailUp.rotateZ(0.52);
  tailUp.translate(-0.34, 0.09, 0);
  tint(tailUp, 0.84, 0.84, 0.84);
  const tailDn = new THREE.ConeGeometry(0.07, 0.21, 5);
  tailDn.rotateZ(Math.PI / 2);
  tailDn.scale(1, 1.42, 0.15);
  tailDn.rotateZ(-0.46);
  tailDn.translate(-0.32, -0.07, 0);
  tint(tailDn, 0.82, 0.82, 0.82);
  const dorsal = new THREE.ConeGeometry(0.06, 0.155, 4);
  dorsal.scale(1.18, 1, 0.16);
  dorsal.translate(0.02, 0.17, 0);
  tint(dorsal, 0.74, 0.74, 0.74);
  const pecL = new THREE.ConeGeometry(0.038, 0.105, 4);
  pecL.rotateX(1.14);
  pecL.rotateZ(-0.54);
  pecL.scale(1, 1, 0.2);
  pecL.translate(0.055, 0, 0.068);
  tint(pecL, 0.78, 0.78, 0.78);
  const pecR = pecL.clone();
  pecR.rotateX(-2.28);
  pecR.translate(0, 0, -0.136);
  return shadeHeight(mergeGeos([body, tailUp, tailDn, dorsal, pecL, pecR]), 0.55, 1.16);
}

function makeDomeGrazer() {
  const body = taperBody(0.72, 0.2, 0.12, 16, 12);
  const tailUp = new THREE.ConeGeometry(0.1, 0.3, 5);
  tailUp.rotateZ(Math.PI / 2);
  tailUp.scale(1, 1.7, 0.16);
  tailUp.rotateZ(0.48);
  tailUp.translate(-0.48, 0.11, 0);
  tint(tailUp, 0.78, 0.88, 0.86);
  const tailDn = new THREE.ConeGeometry(0.085, 0.25, 5);
  tailDn.rotateZ(Math.PI / 2);
  tailDn.scale(1, 1.45, 0.16);
  tailDn.rotateZ(-0.42);
  tailDn.translate(-0.45, -0.08, 0);
  tint(tailDn, 0.74, 0.86, 0.84);
  const dorsal = new THREE.ConeGeometry(0.075, 0.18, 4);
  dorsal.scale(1.2, 1, 0.18);
  dorsal.translate(0.04, 0.21, 0);
  tint(dorsal, 0.62, 0.82, 0.8);
  const eyeL = new THREE.SphereGeometry(0.042, 8, 6);
  eyeL.translate(0.22, 0.05, 0.075);
  tint(eyeL, 0.07, 0.09, 0.11);
  const eyeR = new THREE.SphereGeometry(0.042, 8, 6);
  eyeR.translate(0.22, 0.05, -0.075);
  tint(eyeR, 0.07, 0.09, 0.11);
  return shadeHeight(mergeGeos([body, tailUp, tailDn, dorsal, eyeL, eyeR]), 0.62, 1.12);
}

function makeCanvasTex(size, paint) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  paint(c.getContext("2d"), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function makeHullTex() {
  return makeCanvasTex(512, (ctx, s) => {
    ctx.fillStyle = "#efe4cc";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const x = (i * 97) % s;
      const y = (i * 53) % s;
      ctx.fillStyle = `rgba(90,70,40,${0.03 + (i % 5) * 0.012})`;
      ctx.fillRect(x, y, 40 + (i % 30), 18);
    }
    ctx.strokeStyle = "rgba(48,40,28,0.38)";
    ctx.lineWidth = 3;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo((i / 8) * s, 0);
      ctx.lineTo((i / 8) * s, s);
      ctx.stroke();
    }
    ctx.lineWidth = 2;
    for (let j = 0; j <= 5; j++) {
      ctx.beginPath();
      ctx.moveTo(0, (j / 5) * s);
      ctx.lineTo(s, (j / 5) * s);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(52,46,36,0.55)";
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 5; j++) {
        ctx.beginPath();
        ctx.arc((i / 8) * s + 7, (j / 5) * s + 6, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc((i / 8) * s + 7, (j / 5) * s + s / 5 - 6, 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.fillStyle = "rgba(70,90,40,0.08)";
    ctx.fillRect(0, s * 0.72, s, s * 0.28);
  });
}

function makeMetalTex() {
  return makeCanvasTex(256, (ctx, s) => {
    ctx.fillStyle = "#8f969c";
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) {
      ctx.fillStyle = `rgba(255,255,255,${0.02 + (y % 7) * 0.008})`;
      ctx.fillRect(0, y, s, 1);
    }
    ctx.strokeStyle = "rgba(20,22,24,0.28)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo((i / 6) * s, 0);
      ctx.lineTo((i / 6) * s, s);
      ctx.stroke();
    }
  });
}

function makeFloorTex() {
  return makeCanvasTex(256, (ctx, s) => {
    ctx.fillStyle = "#5c584e";
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(20,18,14,0.45)";
    ctx.lineWidth = 2;
    for (let i = 0; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo((i / 8) * s, 0);
      ctx.lineTo((i / 8) * s, s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, (i / 8) * s);
      ctx.lineTo(s, (i / 8) * s);
      ctx.stroke();
    }
    ctx.fillStyle = "rgba(180,160,80,0.08)";
    ctx.fillRect(0, 0, s, s);
  });
}

function inMoonpoolXZ(x, z) {
  const dx = x - BX;
  const dz = z - BZ;
  return dx * dx + dz * dz < MOON_R * MOON_R;
}

function inRoomXZ(x, z, r = ROOM_R - 0.2) {
  const dx = x - BX;
  const dz = z - BZ;
  return dx * dx + dz * dz < r * r;
}

function inCorrXZ(x, z, pad = 0.12) {
  return x > CORR_X0 - 0.2 && x < CORR_X1 + 0.2 && Math.abs(z - BZ) < CORR_R - pad;
}

function inDomeXZ(x, z, r = DOME_R - 0.16) {
  const dx = x - DOME_X;
  const dz = z - DOME_Z;
  return dx * dx + dz * dz < r * r;
}

export function isInsideBase(x, y, z) {
  if (y < FLOOR_Y - 2.35 || y > ROOM_TOP + 0.35) return false;
  if (inRoomXZ(x, z, ROOM_R - 0.16) && y < ROOM_TOP && y > FLOOR_Y - 2.2) return true;
  if (inMoonpoolXZ(x, z) && y > FLOOR_Y - 2.35 && y < FLOOR_Y + 1.2) return true;
  if (x > CORR_X0 - 0.25 && x < CORR_X1 + 0.25) {
    const cy = y - CORR_Y;
    const cz = z - BZ;
    if (cy * cy + cz * cz < (CORR_R - 0.08) * (CORR_R - 0.08) && y > FLOOR_Y - 0.15) return true;
  }
  const dx = x - DOME_X;
  const dy = y - DOME_Y;
  const dz = z - DOME_Z;
  if (dx * dx + dy * dy + dz * dz < (DOME_R - 0.1) * (DOME_R - 0.1) && y > FLOOR_Y - 0.2) return true;
  // side hatch tunnel
  const hx = x - BX;
  const hz = z - (BZ + ROOM_R - 0.15);
  if (hx * hx + (y - (FLOOR_Y + 0.62)) * (y - (FLOOR_Y + 0.62)) < 0.72 * 0.72 && hz > -0.4 && hz < 1.35) {
    return true;
  }
  return false;
}

export function interiorFloorAt(x, z) {
  if (inMoonpoolXZ(x, z)) return null;
  if (inRoomXZ(x, z, ROOM_R - 0.22)) return FLOOR_Y;
  if (inCorrXZ(x, z, 0.18)) return FLOOR_Y + 0.04;
  if (inDomeXZ(x, z, DOME_R - 0.22)) return FLOOR_Y + 0.06;
  return null;
}

export function interiorCeilingAt(x, z) {
  if (inMoonpoolXZ(x, z) && !inRoomXZ(x, z, ROOM_R - 0.5)) return null;
  if (inRoomXZ(x, z, ROOM_R - 0.18)) return FLOOR_Y + 4.72;
  if (inCorrXZ(x, z, 0.1)) return CORR_Y + CORR_R - 0.18;
  if (inDomeXZ(x, z, DOME_R - 0.14)) {
    const dx = x - DOME_X;
    const dz = z - DOME_Z;
    const h = Math.sqrt(Math.max(0.2, (DOME_R - 0.18) * (DOME_R - 0.18) - dx * dx - dz * dz));
    return DOME_Y + h;
  }
  return null;
}

function addEdgeCage(srcGeo, radius, mat, parent) {
  const pos = srcGeo.attributes.position;
  const idx = srcGeo.index;
  const seen = new Set();
  const pairs = [];
  const qkey = (i) => {
    const x = Math.round(pos.getX(i) * 80);
    const y = Math.round(pos.getY(i) * 80);
    const z = Math.round(pos.getZ(i) * 80);
    return `${x},${y},${z}`;
  };
  const triCount = idx ? idx.count : pos.count;
  const triAt = (i) => (idx ? idx.getX(i) : i);
  for (let i = 0; i < triCount; i += 3) {
    const v = [triAt(i), triAt(i + 1), triAt(i + 2)];
    for (let e = 0; e < 3; e++) {
      const a = v[e];
      const b = v[(e + 1) % 3];
      const ka = qkey(a);
      const kb = qkey(b);
      const key = ka < kb ? ka + "|" + kb : kb + "|" + ka;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(a, b);
    }
  }
  const dummy = new THREE.Object3D();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  const mid = new THREE.Vector3();
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const n = pairs.length / 2;
  const mesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(radius, radius, 1, 6, 1), mat, n);
  mesh.castShadow = true;
  for (let i = 0; i < n; i++) {
    pa.fromBufferAttribute(pos, pairs[i * 2]);
    pb.fromBufferAttribute(pos, pairs[i * 2 + 1]);
    const len = pa.distanceTo(pb);
    mid.addVectors(pa, pb).multiplyScalar(0.5);
    dir.subVectors(pb, pa).normalize();
    dummy.position.copy(mid);
    dummy.quaternion.setFromUnitVectors(yAxis, dir);
    dummy.scale.set(1, len, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  parent.add(mesh);
  return mesh;
}

function plantLeg(group, x, z, topY, mats) {
  const foot = terrainHeight(x, z) + 0.05;
  const h = Math.max(0.55, topY - foot);
  const mid = foot + h * 0.5;
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, h, 8), mats.leg);
  post.position.set(x, mid, z);
  post.castShadow = true;
  group.add(post);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.12, 10), mats.dark);
  pad.position.set(x, foot + 0.05, z);
  pad.castShadow = true;
  group.add(pad);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.15, 0.12, 8), mats.dark);
  cap.position.set(x, topY - 0.04, z);
  group.add(cap);
}

export function createSeabase(scene, shared) {
  const group = new THREE.Group();
  group.name = "seabase";

  const hullMap = makeHullTex();
  hullMap.repeat.set(3, 2);
  const metalMap = makeMetalTex();
  metalMap.repeat.set(2, 1);
  const floorMap = makeFloorTex();
  floorMap.repeat.set(4, 4);

  const mats = {
    hull: new THREE.MeshStandardMaterial({
      color: srgb(0xf4e6c8),
      map: hullMap,
      roughness: 0.52,
      metalness: 0.18,
    }),
    cap: new THREE.MeshStandardMaterial({
      color: srgb(0xf0e2c2),
      roughness: 0.48,
      metalness: 0.2,
    }),
    dark: new THREE.MeshStandardMaterial({
      color: srgb(0x1a1c1f),
      roughness: 0.42,
      metalness: 0.62,
    }),
    metal: new THREE.MeshStandardMaterial({
      color: srgb(0xcdd3d8),
      map: metalMap,
      roughness: 0.32,
      metalness: 0.68,
    }),
    leg: new THREE.MeshStandardMaterial({
      color: srgb(0x3a4048),
      roughness: 0.46,
      metalness: 0.52,
    }),
    yellow: new THREE.MeshStandardMaterial({
      color: srgb(0xd4a214),
      roughness: 0.4,
      metalness: 0.35,
      emissive: srgb(0x3a2800),
      emissiveIntensity: 0.35,
    }),
    floor: new THREE.MeshStandardMaterial({
      color: srgb(0x6e6a60),
      map: floorMap,
      roughness: 0.82,
      metalness: 0.08,
    }),
    inner: new THREE.MeshStandardMaterial({
      color: srgb(0xe8d8b4),
      roughness: 0.64,
      metalness: 0.1,
      side: THREE.BackSide,
    }),
    lamp: new THREE.MeshStandardMaterial({
      color: srgb(0xfff0c8),
      emissive: srgb(0xffd89a),
      emissiveIntensity: 1.4,
      roughness: 0.35,
    }),
  };

  const glass = new THREE.MeshPhysicalMaterial({
    color: srgb(0xc5eaf4),
    metalness: 0.04,
    roughness: 0.06,
    transmission: 0.42,
    thickness: 0.35,
    ior: 1.4,
    transparent: true,
    opacity: 0.3,
    side: THREE.DoubleSide,
    depthWrite: false,
    envMapIntensity: 1.15,
    specularIntensity: 1,
    specularColor: srgb(0xffffff),
  });
  const glassMats = [glass];

  for (const m of Object.values(mats)) {
    patchUnderwater(m, shared, { caustics: true, detail: "none" });
  }

  function mesh(geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) {
    const o = new THREE.Mesh(geo, mat);
    o.position.set(x, y, z);
    o.rotation.set(rx, ry, rz);
    o.castShadow = true;
    o.receiveShadow = true;
    group.add(o);
    return o;
  }

  function openArcs(gaps) {
    const two = Math.PI * 2;
    const blocked = (a) => {
      for (const g of gaps) {
        if (Math.abs(wrapAng(a - g.c)) < g.w * 0.5) return true;
      }
      return false;
    };
    const segs = [];
    let start = null;
    const n = 72;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * two;
      const ok = !blocked(a);
      if (ok && start == null) start = a;
      if ((!ok || i === n) && start != null) {
        const end = ok && i === n ? two : a;
        if (end - start > 0.1) segs.push({ t0: start, len: end - start });
        start = null;
      }
    }
    return segs;
  }

  function addOpenCyl(rOut, rIn, h, y, outMat, inMat, gaps) {
    for (const s of openArcs(gaps)) {
      const segs = Math.max(10, Math.ceil((s.len / (Math.PI * 2)) * 40));
      mesh(new THREE.CylinderGeometry(rOut, rOut, h, segs, 1, true, s.t0, s.len), outMat, BX, y, BZ);
      if (inMat) {
        mesh(new THREE.CylinderGeometry(rIn, rIn, h - 0.08, segs, 1, true, s.t0, s.len), inMat, BX, y, BZ);
      }
    }
  }

  // —— foundation decks ——
  const platY = FLOOR_Y - 0.28;
  mesh(new THREE.BoxGeometry(8.6, 0.32, 7.8), mats.metal, BX + 0.15, platY - 0.04, BZ);
  mesh(new THREE.BoxGeometry(8.95, 0.1, 8.15), mats.dark, BX + 0.15, platY - 0.22, BZ);
  mesh(new THREE.CylinderGeometry(DOME_R * 0.92, DOME_R * 0.96, 0.28, 28), mats.metal, DOME_X, platY + 0.02, DOME_Z);
  mesh(new THREE.BoxGeometry(CORR_LEN * 0.72, 0.2, 2.35), mats.metal, BX + ROOM_R + CORR_LEN * 0.42, platY - 0.02, BZ);

  const mainLegs = [
    [-3.4, -3.1],
    [-3.4, 0],
    [-3.4, 3.1],
    [-1.1, -3.2],
    [-1.1, 3.2],
    [1.2, -3.2],
    [1.2, 3.2],
    [3.5, -3.0],
    [3.5, 0],
    [3.5, 3.0],
  ];
  for (const [ox, oz] of mainLegs) {
    plantLeg(group, BX + ox, BZ + oz, platY - 0.08, mats);
  }
  for (const ox of [CORR_LEN * 0.28, CORR_LEN * 0.62]) {
    plantLeg(group, BX + ROOM_R + ox, BZ - 0.85, platY - 0.08, mats);
    plantLeg(group, BX + ROOM_R + ox, BZ + 0.85, platY - 0.08, mats);
  }
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    plantLeg(group, DOME_X + Math.cos(a) * DOME_R * 0.72, DOME_Z + Math.sin(a) * DOME_R * 0.72, platY - 0.06, mats);
  }
  plantLeg(group, DOME_X, DOME_Z, platY - 0.06, mats);

  // —— multipurpose room ——
  const lowerH = 1.18;
  const winH = 1.52;
  const midH = 0.52;
  const upperH = 0.92;
  const y0 = FLOOR_Y;
  const yLow = y0 + lowerH;
  const yWin = yLow + winH;
  const yMid = yWin + midH;
  const yUp = yMid + upperH;

  // floor ring (moonpool hole)
  mesh(new THREE.RingGeometry(MOON_R + 0.04, ROOM_R - 0.06, 40), mats.floor, BX, y0 + 0.02, BZ, -Math.PI / 2);
  mesh(new THREE.CylinderGeometry(ROOM_R - 0.04, ROOM_R - 0.04, 0.1, 36), mats.hull, BX, y0 - 0.02, BZ);

  // moonpool well + rim
  const well = mesh(new THREE.CylinderGeometry(MOON_R + 0.08, MOON_R + 0.1, 1.55, 24, 1, true), mats.dark, BX, y0 - 0.78, BZ);
  well.material = mats.dark;
  mesh(new THREE.TorusGeometry(MOON_R + 0.06, 0.055, 10, 28), mats.yellow, BX, y0 + 0.05, BZ, Math.PI / 2);
  mesh(new THREE.TorusGeometry(MOON_R + 0.07, 0.04, 8, 24), mats.yellow, BX, y0 - 1.52, BZ, Math.PI / 2);

  // lower hull — gaps at +Z hatch and +X corridor so the hallway is actually open
  const hatchGap = { c: Math.PI / 2, w: 0.98 };
  const corrGap = { c: 0, w: 0.78 };
  addOpenCyl(ROOM_R, ROOM_R - 0.08, lowerH, y0 + lowerH * 0.5, mats.hull, mats.inner, [hatchGap, corrGap]);

  // dark bands — leave the corridor mouth clear
  addOpenCyl(ROOM_R + 0.05, 0, 0.16, yLow + 0.02, mats.dark, null, [corrGap, hatchGap]);
  addOpenCyl(ROOM_R + 0.05, 0, 0.16, yWin + 0.02, mats.dark, null, [corrGap]);
  mesh(new THREE.CylinderGeometry(ROOM_R + 0.04, ROOM_R + 0.04, midH, 40), mats.dark, BX, yWin + midH * 0.5, BZ);
  mesh(new THREE.CylinderGeometry(ROOM_R + 0.05, ROOM_R + 0.05, 0.14, 40), mats.dark, BX, yUp - 0.02, BZ);

  // window band — glass, cut at the corridor
  for (const s of openArcs([corrGap])) {
    const segs = Math.max(12, Math.ceil((s.len / (Math.PI * 2)) * 48));
    const winGlass = mesh(
      new THREE.CylinderGeometry(ROOM_R - 0.02, ROOM_R - 0.02, winH - 0.08, segs, 1, true, s.t0, s.len),
      glass,
      BX,
      yLow + winH * 0.5,
      BZ,
    );
    winGlass.renderOrder = 3;
    winGlass.castShadow = false;
  }

  // window sills + mullions
  mesh(new THREE.TorusGeometry(ROOM_R + 0.01, 0.045, 8, 40), mats.metal, BX, yLow + 0.08, BZ, Math.PI / 2);
  mesh(new THREE.TorusGeometry(ROOM_R + 0.01, 0.045, 8, 40), mats.metal, BX, yWin - 0.08, BZ, Math.PI / 2);
  const mullionGeo = new THREE.BoxGeometry(0.07, winH - 0.12, 0.09);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    if (Math.abs(wrapAng(a)) < 0.42) continue;
    if (Math.abs(wrapAng(a - Math.PI / 2)) < 0.42) continue;
    mesh(mullionGeo, mats.dark, BX + Math.cos(a) * ROOM_R, yLow + winH * 0.5, BZ + Math.sin(a) * ROOM_R, 0, -a, 0);
  }

  // upper hull + cap
  mesh(new THREE.CylinderGeometry(ROOM_R * 0.98, ROOM_R, upperH, 40, 1, true), mats.hull, BX, yMid + upperH * 0.5, BZ);
  mesh(new THREE.CylinderGeometry(ROOM_R * 0.96, ROOM_R * 0.96, upperH - 0.1, 28, 1, true), mats.inner, BX, yMid + upperH * 0.5, BZ);
  const cap = mesh(new THREE.SphereGeometry(ROOM_R * 0.99, 48, 22, 0, Math.PI * 2, 0, Math.PI * 0.54), mats.cap, BX, yUp - 0.08, BZ);
  cap.scale.set(1, 0.62, 1);
  mesh(new THREE.CylinderGeometry(1.15, 1.35, 0.22, 20), mats.dark, BX, yUp + 0.95, BZ);
  mesh(new THREE.SphereGeometry(0.72, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mats.cap, BX, yUp + 1.05, BZ);
  // roof lights
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 8), mats.lamp, BX + Math.cos(a) * 1.55, yUp + 0.82, BZ + Math.sin(a) * 1.55);
  }

  // interior ceiling disc
  mesh(new THREE.CircleGeometry(ROOM_R - 0.2, 28), mats.inner, BX, FLOOR_Y + 4.68, BZ, Math.PI / 2);

  // side hatch — same glass as the habitat windows (open cylinder, no disc,
  // no capped metal plug). Looking through it must show the room.
  const hatchZ = BZ + ROOM_R - 0.05;
  const hatchY = y0 + 0.62;
  mesh(new THREE.CylinderGeometry(0.72, 0.72, 0.55, 24, 1, true), mats.inner, BX, hatchY, hatchZ + 0.08).rotation.x = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.16, 24, 1, true), mats.metal, BX, hatchY, hatchZ + 0.42).rotation.x = Math.PI / 2;
  const portGlass = mesh(
    new THREE.CylinderGeometry(0.66, 0.66, 0.1, 32, 1, true),
    glass,
    BX,
    hatchY,
    hatchZ + 0.54,
  );
  portGlass.rotation.x = Math.PI / 2;
  portGlass.renderOrder = 3;
  portGlass.castShadow = false;
  mesh(new THREE.TorusGeometry(0.78, 0.08, 12, 28), mats.yellow, BX, hatchY, hatchZ + 0.58);
  mesh(new THREE.TorusGeometry(0.66, 0.03, 8, 24), mats.metal, BX, hatchY, hatchZ + 0.62);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.2;
    mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.09, 8),
      mats.yellow,
      BX + Math.cos(a) * 0.78,
      hatchY + Math.sin(a) * 0.78,
      hatchZ + 0.62,
    ).rotation.x = Math.PI / 2;
  }

  // small equipment stub on −X (silhouette, like the ref)
  mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.15, 16), mats.dark, BX - ROOM_R + 0.1, y0 + 1.55, BZ).rotation.z = Math.PI / 2;
  mesh(new THREE.SphereGeometry(0.62, 12, 10), mats.dark, BX - ROOM_R - 0.48, y0 + 1.55, BZ);

  // locker / bench so the window looks into a room
  mesh(new THREE.BoxGeometry(0.55, 1.15, 1.4), mats.metal, BX - 2.15, y0 + 0.62, BZ - 0.2);
  mesh(new THREE.BoxGeometry(1.5, 0.12, 0.42), mats.dark, BX + 0.9, y0 + 0.42, BZ - 2.15);
  mesh(new THREE.BoxGeometry(0.18, 0.4, 0.18), mats.dark, BX + 0.35, y0 + 0.22, BZ - 2.15);
  mesh(new THREE.BoxGeometry(0.18, 0.4, 0.18), mats.dark, BX + 1.45, y0 + 0.22, BZ - 2.15);
  mesh(new THREE.BoxGeometry(0.35, 0.08, 0.35), mats.lamp, BX, FLOOR_Y + 4.55, BZ);

  // —— corridor ——
  const metalLen = CORR_LEN * 0.52;
  const glassLen = CORR_LEN - metalLen - 0.35;
  const corrXMetal = CORR_X0 + metalLen * 0.5;
  const corrXGlass = CORR_X0 + metalLen + 0.18 + glassLen * 0.5;

  mesh(new THREE.CylinderGeometry(CORR_R + 0.04, CORR_R + 0.04, metalLen, 24, 1, true), mats.metal, corrXMetal, CORR_Y, BZ).rotation.z =
    Math.PI / 2;
  mesh(new THREE.CylinderGeometry(CORR_R - 0.06, CORR_R - 0.06, metalLen, 18, 1, true), mats.inner, corrXMetal, CORR_Y, BZ).rotation.z =
    Math.PI / 2;

  const glassTube = mesh(
    new THREE.CylinderGeometry(CORR_R - 0.01, CORR_R - 0.01, glassLen, 32, 1, true),
    glass,
    corrXGlass,
    CORR_Y,
    BZ,
  );
  glassTube.rotation.z = Math.PI / 2;
  glassTube.renderOrder = 3;
  glassTube.castShadow = false;

  // flanges + ribs
  const flangeGeo = new THREE.TorusGeometry(CORR_R + 0.05, 0.07, 8, 22);
  for (const x of [CORR_X0 + 0.08, CORR_X0 + metalLen, CORR_X1 - 0.06]) {
    mesh(flangeGeo, mats.dark, x, CORR_Y, BZ).rotation.y = Math.PI / 2;
  }
  const ribGeo = new THREE.TorusGeometry(CORR_R + 0.03, 0.04, 7, 18);
  for (let i = 1; i < 5; i++) {
    mesh(ribGeo, mats.dark, CORR_X0 + (metalLen * i) / 5, CORR_Y, BZ).rotation.y = Math.PI / 2;
  }
  for (let i = 1; i < 4; i++) {
    mesh(ribGeo, mats.metal, CORR_X0 + metalLen + 0.2 + (glassLen * i) / 4, CORR_Y, BZ).rotation.y = Math.PI / 2;
  }

  // corridor walkway
  mesh(new THREE.BoxGeometry(CORR_LEN - 0.3, 0.07, 1.05), mats.floor, (CORR_X0 + CORR_X1) * 0.5, FLOOR_Y + 0.05, BZ);
  mesh(new THREE.BoxGeometry(CORR_LEN - 0.3, 0.04, 0.05), mats.yellow, (CORR_X0 + CORR_X1) * 0.5, FLOOR_Y + 0.1, BZ - 0.5);
  mesh(new THREE.BoxGeometry(CORR_LEN - 0.3, 0.04, 0.05), mats.yellow, (CORR_X0 + CORR_X1) * 0.5, FLOOR_Y + 0.1, BZ + 0.5);

  // —— observatory dome ——
  const ico = new THREE.IcosahedronGeometry(DOME_R, 2);
  ico.translate(DOME_X, DOME_Y, DOME_Z);
  addEdgeCage(ico, 0.055, mats.metal, group);
  const glassDome = mesh(new THREE.IcosahedronGeometry(DOME_R - 0.1, 2), glass, DOME_X, DOME_Y, DOME_Z);
  glassDome.renderOrder = 3;
  glassDome.castShadow = false;
  mesh(new THREE.TorusGeometry(DOME_R * 0.82, 0.08, 8, 36), mats.dark, DOME_X, FLOOR_Y + 0.22, DOME_Z, Math.PI / 2);
  mesh(new THREE.CylinderGeometry(DOME_R * 0.82, DOME_R * 0.86, 0.26, 32), mats.hull, DOME_X, FLOOR_Y + 0.08, DOME_Z);
  mesh(new THREE.CircleGeometry(DOME_R * 0.8, 36), mats.floor, DOME_X, FLOOR_Y + 0.08, DOME_Z, -Math.PI / 2);
  mesh(new THREE.SphereGeometry(0.22, 10, 8), mats.lamp, DOME_X, DOME_Y + DOME_R - 0.18, DOME_Z);
  mesh(new THREE.BoxGeometry(1.85, 0.08, 0.48), mats.dark, DOME_X + 1.6, FLOOR_Y + 0.44, DOME_Z - 3.15);
  mesh(new THREE.BoxGeometry(1.72, 0.05, 0.12), mats.metal, DOME_X + 1.6, FLOOR_Y + 0.5, DOME_Z - 3.15);
  mesh(new THREE.BoxGeometry(0.08, 0.38, 0.08), mats.metal, DOME_X + 0.86, FLOOR_Y + 0.22, DOME_Z - 3.28);
  mesh(new THREE.BoxGeometry(0.08, 0.38, 0.08), mats.metal, DOME_X + 2.34, FLOOR_Y + 0.22, DOME_Z - 3.28);
  mesh(new THREE.BoxGeometry(0.08, 0.38, 0.08), mats.metal, DOME_X + 0.86, FLOOR_Y + 0.22, DOME_Z - 3.02);
  mesh(new THREE.BoxGeometry(0.08, 0.38, 0.08), mats.metal, DOME_X + 2.34, FLOOR_Y + 0.22, DOME_Z - 3.02);
  mesh(new THREE.BoxGeometry(0.62, 1.38, 0.4), mats.metal, DOME_X + 3.55, FLOOR_Y + 0.74, DOME_Z + 1.85);
  mesh(new THREE.BoxGeometry(0.56, 0.04, 0.36), mats.dark, DOME_X + 3.55, FLOOR_Y + 1.18, DOME_Z + 1.85);
  mesh(new THREE.BoxGeometry(0.56, 0.04, 0.36), mats.dark, DOME_X + 3.55, FLOOR_Y + 0.72, DOME_Z + 1.85);
  mesh(new THREE.BoxGeometry(0.08, 0.12, 0.04), mats.yellow, DOME_X + 3.22, FLOOR_Y + 1.05, DOME_Z + 1.85);
  mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.15, 8), mats.metal, DOME_X + 1.6, FLOOR_Y + 3.55, DOME_Z - 3.15);
  mesh(new THREE.SphereGeometry(0.14, 10, 8), mats.lamp, DOME_X + 1.6, FLOOR_Y + 2.92, DOME_Z - 3.15);

  const fishGeo = makeDomeFish();
  const fishMat = new THREE.MeshStandardMaterial({
    color: srgb(0xffffff),
    roughness: 0.32,
    metalness: 0.1,
    vertexColors: true,
  });
  patchUnderwater(fishMat, shared, { caustics: true });
  const FISH_N = 42;
  const school = new THREE.InstancedMesh(fishGeo, fishMat, FISH_N);
  school.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(FISH_N * 3), 3);
  school.frustumCulled = false;
  school.castShadow = true;
  const fishDummy = new THREE.Object3D();
  const fishCol = new THREE.Color();
  const palette = [0xe8b46a, 0xd47a3a, 0xf0d8a0, 0x8ab0c8, 0xc45a6a, 0x6aa87a, 0x3a6aaa, 0xf0a040, 0xd8e8f0];
  const fishMeta = [];
  for (let i = 0; i < FISH_N; i++) {
    fishCol.setHex(palette[i % palette.length], THREE.SRGBColorSpace);
    school.instanceColor.setXYZ(i, fishCol.r, fishCol.g, fishCol.b);
    fishMeta.push({
      cx: 74 + (i % 7) * 1.7 + (i * 0.17) % 1.2,
      cy: FLOOR_Y + 1.1 + (i % 5) * 0.85,
      cz: -1.4 + ((i * 3) % 11) * 1.15,
      rx: 1.6 + (i % 4) * 0.55,
      rz: 1.3 + (i % 3) * 0.5,
      spd: 0.55 + (i % 6) * 0.18,
      ph: i * 0.41,
      sc: 0.7 + (i % 5) * 0.16,
    });
  }
  group.add(school);

  const bigGeo = makeDomeGrazer();
  const bigMat = new THREE.MeshStandardMaterial({
    color: srgb(0x6ec8c4),
    roughness: 0.38,
    metalness: 0.08,
    vertexColors: true,
    emissive: srgb(0x163838),
    emissiveIntensity: 0.18,
  });
  patchUnderwater(bigMat, shared, { caustics: true });
  const grazers = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Mesh(bigGeo, bigMat);
    g.scale.setScalar(1.35 + i * 0.18);
    group.add(g);
    grazers.push({
      mesh: g,
      cx: 80 + i * 2.4,
      cy: FLOOR_Y + 2.2 + i * 0.4,
      cz: 6 + i * 2.2,
      ph: i * 2.1,
    });
  }

  group.userData.update = (t) => {
    for (let i = 0; i < FISH_N; i++) {
      const f = fishMeta[i];
      const a = t * f.spd + f.ph;
      const x = f.cx + Math.sin(a) * f.rx;
      const z = f.cz + Math.cos(a * 0.82) * f.rz;
      const y = f.cy + Math.sin(a * 1.45) * 0.35;
      fishDummy.position.set(x, y, z);
      fishDummy.lookAt(x + Math.cos(a) * f.rx, y, z - Math.sin(a * 0.82) * f.rz);
      fishDummy.rotateY(Math.PI / 2);
      fishDummy.rotateZ(Math.sin(a) * 0.14);
      fishDummy.scale.setScalar(f.sc);
      fishDummy.updateMatrix();
      school.setMatrixAt(i, fishDummy.matrix);
    }
    school.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < grazers.length; i++) {
      const g = grazers[i];
      const a = t * 0.28 + g.ph;
      const gx = g.cx + Math.sin(a) * 3.2;
      const gy = g.cy + Math.sin(a * 1.2) * 0.4;
      const gz = g.cz + Math.cos(a * 0.7) * 2.4;
      g.mesh.position.set(gx, gy, gz);
      g.mesh.lookAt(gx + Math.cos(a), gy, gz - Math.sin(a));
      g.mesh.rotateY(Math.PI / 2);
    }
  };

  // interior lights
  const roomLite = new THREE.PointLight(0xffe8c4, 4.2, 11, 1.2);
  roomLite.position.set(BX, FLOOR_Y + 2.55, BZ);
  group.add(roomLite);
  const winLite = new THREE.PointLight(0xfff2d8, 1.8, 8, 1.6);
  winLite.position.set(BX + 1.2, FLOOR_Y + 1.85, BZ + 2.4);
  group.add(winLite);
  const hatchLite = new THREE.PointLight(0xffc040, 0.85, 5, 1.8);
  hatchLite.position.set(BX, FLOOR_Y + 0.6, BZ + ROOM_R + 0.2);
  group.add(hatchLite);
  const domeLite = new THREE.PointLight(0xc8f4ff, 5.2, 24, 1.15);
  domeLite.position.set(DOME_X, FLOOR_Y + 4.6, DOME_Z);
  group.add(domeLite);
  const domeFill = new THREE.PointLight(0xd8f0ff, 2.2, 18, 1.35);
  domeFill.position.set(DOME_X - 2.4, FLOOR_Y + 2.4, DOME_Z + 2.8);
  group.add(domeFill);
  const wellLite = new THREE.PointLight(0xffd060, 0.7, 4.5, 2);
  wellLite.position.set(BX, FLOOR_Y - 0.6, BZ);
  group.add(wellLite);

  group.userData.glass = glassMats;
  group.userData.setEnvMap = (env) => {
    for (const m of glassMats) {
      m.envMap = env;
      m.envMapIntensity = 1.2;
      m.needsUpdate = true;
    }
  };

  scene.add(group);
  return group;
}
