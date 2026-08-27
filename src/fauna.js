import * as THREE from "three";
import { patchUnderwater } from "./shaders.js";
import { terrainHeight, GROTTO_ORIGIN, GROTTO_WINDOW, grottoWorldY } from "./terrain.js";

function merge(geos) {
  const out = new THREE.BufferGeometry();
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  let base = 0;
  for (const g of geos) {
    g.computeVertexNormals();
    const p = g.attributes.position;
    const n = g.attributes.normal;
    const c = g.attributes.color;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nrm.push(n ? n.getX(i) : 0, n ? n.getY(i) : 1, n ? n.getZ(i) : 0);
      if (c) col.push(c.getX(i), c.getY(i), c.getZ(i));
      else col.push(1, 1, 1);
    }
    const index = g.index;
    if (index) {
      for (let i = 0; i < index.count; i++) idx.push(index.getX(i) + base);
    } else {
      for (let i = 0; i < p.count; i++) idx.push(base + i);
    }
    base += p.count;
    g.dispose();
  }
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

function tint(geo, r, g, b) {
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

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
    if (y < 0) y *= 1.14;
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

function makeSmallFish() {
  const body = taperBody(0.5, 0.155, 0.08, 14, 10);
  const tailUp = new THREE.ConeGeometry(0.085, 0.26, 5);
  tailUp.rotateZ(Math.PI / 2);
  tailUp.scale(1, 1.7, 0.15);
  tailUp.rotateZ(0.52);
  tailUp.translate(-0.34, 0.09, 0);
  tint(tailUp, 0.82, 0.82, 0.82);
  const tailDn = new THREE.ConeGeometry(0.072, 0.22, 5);
  tailDn.rotateZ(Math.PI / 2);
  tailDn.scale(1, 1.45, 0.15);
  tailDn.rotateZ(-0.46);
  tailDn.translate(-0.32, -0.07, 0);
  tint(tailDn, 0.8, 0.8, 0.8);
  const dorsal = new THREE.ConeGeometry(0.065, 0.16, 4);
  dorsal.scale(1.2, 1, 0.16);
  dorsal.translate(0.02, 0.175, 0);
  tint(dorsal, 0.72, 0.72, 0.72);
  const anal = new THREE.ConeGeometry(0.04, 0.09, 4);
  anal.scale(1.1, 1, 0.16);
  anal.rotateZ(Math.PI);
  anal.translate(-0.07, -0.13, 0);
  tint(anal, 0.78, 0.78, 0.78);
  const pecL = new THREE.ConeGeometry(0.04, 0.11, 4);
  pecL.rotateX(1.15);
  pecL.rotateZ(-0.55);
  pecL.scale(1, 1, 0.22);
  pecL.translate(0.06, -0.01, 0.07);
  tint(pecL, 0.76, 0.76, 0.76);
  const pecR = pecL.clone();
  pecR.rotateX(-2.3);
  pecR.translate(0, 0, -0.14);
  return shadeHeight(merge([body, tailUp, tailDn, dorsal, anal, pecL, pecR]), 0.55, 1.16);
}

function makePeeper() {
  const body = new THREE.SphereGeometry(0.26, 14, 12);
  body.scale(1.25, 1.02, 0.88);
  const pos = body.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const back = Math.max(0, y * 0.6 + 0.2);
    col[i * 3] = 0.92 - back * 0.45;
    col[i * 3 + 1] = 0.88 - back * 0.25;
    col[i * 3 + 2] = 0.72 + back * 0.05;
    if (z > 0.18) {
      col[i * 3] = 0.95;
      col[i * 3 + 1] = 0.94;
      col[i * 3 + 2] = 0.88;
    }
  }
  body.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  const tail = new THREE.ConeGeometry(0.12, 0.26, 6);
  tail.rotateZ(Math.PI / 2);
  tail.translate(-0.36, 0, 0);
  tint(tail, 0.55, 0.62, 0.48);
  const eyeL = new THREE.SphereGeometry(0.11, 12, 10);
  eyeL.translate(0.14, 0.08, 0.2);
  tint(eyeL, 0.08, 0.12, 0.18);
  const eyeR = new THREE.SphereGeometry(0.11, 12, 10);
  eyeR.translate(0.14, 0.08, -0.2);
  tint(eyeR, 0.08, 0.12, 0.18);
  const rimL = new THREE.TorusGeometry(0.115, 0.018, 6, 12);
  rimL.translate(0.14, 0.08, 0.2);
  tint(rimL, 0.25, 0.55, 0.75);
  const rimR = new THREE.TorusGeometry(0.115, 0.018, 6, 12);
  rimR.translate(0.14, 0.08, -0.2);
  tint(rimR, 0.25, 0.55, 0.75);
  const fin = new THREE.PlaneGeometry(0.18, 0.12);
  fin.rotateZ(0.4);
  fin.translate(-0.02, 0.16, 0);
  tint(fin, 0.45, 0.55, 0.42);
  return merge([body, tail, eyeL, eyeR, rimL, rimR, fin]);
}

function makeHoverfish() {
  const body = taperBody(0.62, 0.18, 0.22, 12, 10);
  tint(body, 0.9, 0.94, 0.95);
  const tailUp = new THREE.ConeGeometry(0.07, 0.2, 5);
  tailUp.rotateZ(Math.PI / 2);
  tailUp.scale(1, 1.3, 0.2);
  tailUp.rotateZ(0.4);
  tailUp.translate(-0.38, 0.06, 0);
  tint(tailUp, 0.75, 0.82, 0.85);
  const tailDn = new THREE.ConeGeometry(0.06, 0.16, 5);
  tailDn.rotateZ(Math.PI / 2);
  tailDn.scale(1, 1.15, 0.2);
  tailDn.rotateZ(-0.35);
  tailDn.translate(-0.36, -0.05, 0);
  tint(tailDn, 0.72, 0.8, 0.84);
  const dorsal = new THREE.ConeGeometry(0.05, 0.1, 4);
  dorsal.scale(1.1, 1, 0.2);
  dorsal.translate(0.02, 0.16, 0);
  tint(dorsal, 0.7, 0.8, 0.84);
  const eye = new THREE.SphereGeometry(0.045, 8, 6);
  eye.translate(0.2, 0.05, 0.12);
  tint(eye, 0.08, 0.1, 0.12);
  const eye2 = new THREE.SphereGeometry(0.045, 8, 6);
  eye2.translate(0.2, 0.05, -0.12);
  tint(eye2, 0.08, 0.1, 0.12);
  return merge([body, tailUp, tailDn, dorsal, eye, eye2]);
}

function stalkerTaper(len, ht, wd) {
  const g = new THREE.SphereGeometry(1, 36, 28);
  g.rotateZ(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getX(i) + 1) * 0.5;
    let s;
    if (t < 0.09) s = 0.09 + (t / 0.09) * 0.28;
    else if (t < 0.3) s = 0.37 + ((t - 0.09) / 0.21) * 0.4;
    else if (t < 0.54) s = 0.77 + Math.sin(((t - 0.3) / 0.24) * Math.PI) * 0.23;
    else if (t < 0.66) s = 0.77 - ((t - 0.54) / 0.12) * 0.18;
    else s = 0.59 * (1 - Math.pow((t - 0.66) / 0.34, 1.05) * 0.66);
    let y = p.getY(i) * s * ht;
    let z = p.getZ(i) * s * wd;
    if (t > 0.55 && t < 0.72) z *= 1 + Math.sin(((t - 0.55) / 0.17) * Math.PI) * 0.2;
    if (t > 0.66) {
      const u = (t - 0.66) / 0.34;
      y *= 0.48 + 0.52 * (1 - u);
      z *= 1.05 - u * 0.22;
    }
    if (y < 0 && t > 0.12 && t < 0.64) y *= 1.1;
    if (t > 0.68 && y < 0) {
      const u = Math.min(1, (t - 0.68) / 0.2);
      y *= 0.22 + (1 - u) * 0.45;
    }
    let x = (t - 0.44) * len;
    if (t > 0.8) y += Math.pow((t - 0.8) / 0.2, 2) * 0.06;
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function stalkerJaw() {
  const g = new THREE.SphereGeometry(1, 22, 12);
  g.rotateZ(Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = (p.getX(i) + 1) * 0.5;
    const s = t < 0.12 ? 0.42 + t * 2.1 : 0.67 * (1 - Math.pow((t - 0.12) / 0.88, 1.12) * 0.7);
    let y = p.getY(i) * s * 0.082;
    const z = p.getZ(i) * s * 0.138;
    if (y > 0) y *= 0.36;
    else y *= 1.16;
    if (t > 0.72) y += (t - 0.72) * 0.065;
    p.setXYZ(i, t * 1.08, y, z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function stalkerMembrane(len, span, thick, segs, seed, kind) {
  const g = new THREE.BoxGeometry(len, span, thick, segs, 6, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i);
    let y = p.getY(i);
    let z = p.getZ(i);
    const u = (x + len * 0.5) / len;
    const v = (y + span * 0.5) / span;
    const env = Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
    if (kind === "sail") {
      y = (y + span * 0.5) * Math.pow(env, 0.55) * (0.42 + 0.58 * u);
      x += v * v * 0.22 * len;
      if (v > 0.6) {
        y += (Math.sin(u * 19 + seed) * 0.04 + Math.sin(u * 41 + seed * 1.8) * 0.02) * (v - 0.6) * 2.6 * span;
      }
      z *= 0.28 + 0.72 * (1 - v) * (0.35 + 0.65 * env);
    } else if (kind === "pec") {
      y = (y + span * 0.5) * (0.2 + 0.8 * env) * (1 - v * 0.12);
      x -= v * v * 0.55 * len;
      if (u < 0.38) {
        x -= (Math.sin(v * 17 + seed) * 0.035 + Math.sin(v * 37 + seed) * 0.016) * (0.38 - u) * 2.2 * len;
      }
      y *= 1 - Math.max(0, v - 0.75) * 1.6;
      z *= 0.3 + 0.7 * (1 - v);
    } else {
      y = (y + span * 0.5) * (0.15 + 0.85 * Math.pow(env, 0.7)) * (1 - v * 0.08);
      x -= v * 0.2 * len;
      if (v > 0.55) {
        y += (Math.sin(u * 23 + seed) * 0.038 + Math.sin(u * 51 + seed) * 0.016) * (v - 0.55) * 2.4 * span;
      }
      z *= 0.25 + 0.75 * (1 - v) * env;
    }
    p.setXYZ(i, x, y, z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function paintStalker(geo) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const dark = [0.048, 0.055, 0.042];
  const gold = [0.93, 0.74, 0.09];
  const bellyC = [0.17, 0.18, 0.1];
  const rings = [
    [-1.02, 0.1],
    [-0.62, 0.07],
    [-0.22, 0.11],
    [0.16, 0.08],
    [0.48, 0.1],
    [0.78, 0.06],
  ];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const belly = Math.max(0, Math.min(1, -y * 2.8));
    const spine = Math.max(0, y * 1.8);
    const ang = Math.atan2(y, z);
    const slant = y * 0.14 + z * 0.04;
    let band = 0;
    let cx0 = 0;
    for (let k = 0; k < rings.length; k++) {
      const cx = rings[k][0];
      const half = rings[k][1] * 0.5 + Math.sin(ang * 2 + cx * 3.1) * 0.012;
      if (Math.abs(x - cx - slant) < half) {
        band = 1;
        cx0 = cx;
        break;
      }
    }
    let r;
    let g;
    let b;
    if (band) {
      const flick = 0.88 + 0.12 * Math.sin(ang * 5 + cx0);
      r = gold[0] * flick * (1 - belly * 0.18);
      g = gold[1] * flick * (1 - belly * 0.12);
      b = gold[2] * flick;
    } else {
      r = dark[0] * (1 - belly * 0.65) + bellyC[0] * belly * 0.65;
      g = dark[1] * (1 - belly * 0.65) + bellyC[1] * belly * 0.65;
      b = dark[2] * (1 - belly * 0.65) + bellyC[2] * belly * 0.65;
      r *= 1 - spine * 0.18;
      g *= 1 - spine * 0.12;
    }
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function paintJaw(geo) {
  const p = geo.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const gape = Math.max(0, Math.min(1, y * 14));
    const belly = Math.max(0, Math.min(1, -y * 8));
    let r = 0.05 + belly * 0.08;
    let g = 0.048 + belly * 0.07;
    let b = 0.038 + belly * 0.03;
    r = r * (1 - gape) + 0.02 * gape;
    g = g * (1 - gape) + 0.015 * gape;
    b = b * (1 - gape) + 0.012 * gape;
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function paintMembrane(geo) {
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
    const k = 0.22 + ((p.getY(i) - minY) / span) * 0.78;
    col[i * 3] = 0.04 + k * 0.045;
    col[i * 3 + 1] = 0.048 + k * 0.055;
    col[i * 3 + 2] = 0.036 + k * 0.03;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function makeStalker() {
  const body = paintStalker(stalkerTaper(3.42, 0.34, 0.41));
  const jaw = paintJaw(stalkerJaw());
  jaw.rotateZ(-0.16);
  jaw.translate(0.76, -0.102, 0);
  const cavity = new THREE.SphereGeometry(1, 10, 8);
  cavity.scale(0.46, 0.034, 0.088);
  cavity.translate(1.22, -0.052, 0);
  tint(cavity, 0.022, 0.016, 0.012);
  const dorsal = paintMembrane(stalkerMembrane(1.16, 0.54, 0.028, 12, 1.2, "sail"));
  dorsal.translate(0.12, 0.2, 0);
  const second = paintMembrane(stalkerMembrane(0.46, 0.26, 0.022, 8, 3.4, "sail"));
  second.translate(-0.68, 0.14, 0);
  const pecL = paintMembrane(stalkerMembrane(0.64, 0.5, 0.024, 11, 1.3, "pec"));
  pecL.rotateX(1.18);
  pecL.rotateZ(-0.48);
  pecL.translate(0.3, -0.03, 0.16);
  const pecR = paintMembrane(stalkerMembrane(0.64, 0.5, 0.024, 11, 2.1, "pec"));
  pecR.rotateX(-1.18);
  pecR.rotateZ(-0.48);
  pecR.translate(0.3, -0.03, -0.16);
  const pelvicL = paintMembrane(stalkerMembrane(0.32, 0.22, 0.02, 7, 4.0, "pec"));
  pelvicL.rotateX(1.05);
  pelvicL.rotateZ(0.32);
  pelvicL.translate(-0.42, -0.1, 0.08);
  const pelvicR = paintMembrane(stalkerMembrane(0.32, 0.22, 0.02, 7, 4.8, "pec"));
  pelvicR.rotateX(-1.05);
  pelvicR.rotateZ(0.32);
  pelvicR.translate(-0.42, -0.1, -0.08);
  const tailUp = paintMembrane(stalkerMembrane(0.5, 0.4, 0.022, 10, 5.2, "fluke"));
  tailUp.rotateZ(0.38);
  tailUp.translate(-1.44, 0.04, 0);
  const tailDn = paintMembrane(stalkerMembrane(0.42, 0.3, 0.02, 9, 6.1, "fluke"));
  tailDn.rotateZ(Math.PI - 0.34);
  tailDn.translate(-1.4, -0.02, 0);
  const parts = [body, jaw, cavity, dorsal, second, pecL, pecR, pelvicL, pelvicR, tailUp, tailDn];
  for (let i = 0; i < 4; i++) {
    const t = i / 3;
    const x = 0.98 + t * 0.68;
    const zw = 0.052 - t * 0.016;
    for (const s of [-1, 1]) {
      const up = new THREE.BoxGeometry(0.028, 0.038, 0.014);
      up.translate(x, -0.026, s * zw);
      tint(up, 0.4, 0.38, 0.3);
      parts.push(up);
      const dn = new THREE.BoxGeometry(0.026, 0.032, 0.012);
      dn.translate(x + 0.028, -0.084, s * zw * 0.9);
      tint(dn, 0.36, 0.34, 0.26);
      parts.push(dn);
    }
  }
  const flesh = merge(parts);
  const eyeL = new THREE.SphereGeometry(0.036, 8, 6);
  eyeL.translate(0.82, 0.055, 0.175);
  tint(eyeL, 0.03, 0.03, 0.028);
  const eyeR = new THREE.SphereGeometry(0.036, 8, 6);
  eyeR.translate(0.82, 0.055, -0.175);
  tint(eyeR, 0.03, 0.03, 0.028);
  return merge([flesh, eyeL, eyeR]);
}

export function createFauna(scene, shared) {
  const group = new THREE.Group();
  group.name = "fauna";

  const smallGeo = makeSmallFish();
  const smallMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.34,
    metalness: 0.12,
    vertexColors: true,
  });
  patchUnderwater(smallMat, shared, { caustics: true });
  const school = new THREE.InstancedMesh(smallGeo, smallMat, 180);
  school.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(180 * 3), 3);
  const col = new THREE.Color();
  const palette = [0xe8b46a, 0xd47a3a, 0xf0d8a0, 0x8ab0c8, 0xc45a6a, 0x6aa87a, 0x3a6aaa, 0xf0a040];
  for (let i = 0; i < 180; i++) {
    col.setHex(palette[i % palette.length], THREE.SRGBColorSpace);
    school.instanceColor.setXYZ(i, col.r, col.g, col.b);
  }
  const nearTint = [0xf0a040, 0xe07090, 0xf0d060, 0xd45868, 0x3a88c8, 0xe8b46a];
  for (let i = 0; i < nearTint.length; i++) {
    col.setHex(nearTint[i], THREE.SRGBColorSpace);
    school.instanceColor.setXYZ(22 + i, col.r, col.g, col.b);
  }
  school.instanceColor.needsUpdate = true;
  school.castShadow = true;
  group.add(school);

  const dummy = new THREE.Object3D();
  const fish = [];
  function spawnOrbit(cx, cy, cz, n) {
    for (let i = 0; i < n; i++) {
      fish.push({
        id: fish.length,
        kind: "orbit",
        phase: Math.random() * Math.PI * 2,
        speed: 1.3 + Math.random() * 1.1,
        radius: 4 + Math.random() * 6,
        origin: new THREE.Vector3(cx, cy, cz),
        scale: 0.7 + Math.random() * 0.5,
      });
    }
  }
  function spawnPatrol(cx, cy, cz, n, xAmp, zAmp, yAmp, scale0, scale1) {
    for (let i = 0; i < n; i++) {
      fish.push({
        id: fish.length,
        kind: "patrol",
        phase: (i / n) * Math.PI * 2 + Math.random() * 0.35,
        speed: 0.55 + Math.random() * 0.45,
        origin: new THREE.Vector3(
          cx + (Math.random() - 0.5) * 0.8,
          cy + (Math.random() - 0.5) * 0.6,
          cz + (Math.random() - 0.5) * 0.8
        ),
        xAmp,
        zAmp,
        yAmp,
        scale: scale0 + Math.random() * (scale1 - scale0),
      });
    }
  }
  const gy = grottoWorldY();
  const wx = GROTTO_ORIGIN.x + GROTTO_WINDOW.x;
  const wy = gy + GROTTO_WINDOW.y;
  const wz = GROTTO_ORIGIN.z;
  spawnPatrol(wx - 3.4, wy + 3.1, wz - 4.2, 10, 1.6, 0.7, 0.45, 0.58, 0.88);
  spawnPatrol(wx + 3.6, wy + 2.4, wz - 4.4, 8, 1.4, 0.65, 0.4, 0.55, 0.82);
  spawnPatrol(-4.4, -14.5, 6.4, 7, 1.8, 1.2, 0.38, 1.1, 1.5);
  spawnPatrol(-1.4, -15.2, 9.6, 4, 1.3, 0.85, 0.28, 1.3, 1.75);
  spawnPatrol(3.4, -14.6, 2.6, 5, 1.5, 1.0, 0.32, 0.9, 1.25);
  spawnPatrol(6.4, -9.2, 12.6, 24, 6.8, 5.4, 1.5, 0.88, 1.38);
  spawnPatrol(3.8, -11.0, 8.2, 16, 4.4, 3.6, 1.0, 0.78, 1.18);
  spawnPatrol(9.2, -7.4, 15.4, 10, 3.2, 2.6, 0.8, 0.7, 1.05);
  spawnOrbit(-18, -14.2, 10, 16);
  spawnOrbit(18, -12, -16, 16);
  spawnOrbit(170, -42, -8, 34);

  const peeperGeo = makePeeper();
  const peeperMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.3,
    metalness: 0.08,
    vertexColors: true,
  });
  patchUnderwater(peeperMat, shared, { caustics: true });
  const peepers = [];
  const peeperOrbits = [
    { c: new THREE.Vector3(-3.5, -14.2, 2.5), r: 5.5, s: 0.7, y: 0.6, sc: 1.15, ph: 4.1 },
    { c: new THREE.Vector3(wx + 0.4, wy - 1.6, wz + 0.4), r: 2.4, s: 0.55, y: 0.35, sc: 1.05, ph: 1.2 },
    { c: new THREE.Vector3(-12, -15, -10), r: 3.5, s: 1.1, y: 0.5, sc: 0.95, ph: 2.4 },
    { c: new THREE.Vector3(-7.2, -15.4, 12.4), r: 2.6, s: 0.8, y: 0.35, sc: 1.05, ph: 0.6 },
    { c: new THREE.Vector3(7.2, -8.4, 14.2), r: 3.4, s: 0.62, y: 0.75, sc: 1.22, ph: 0.25 },
    { c: new THREE.Vector3(3.6, -10.4, 10.4), r: 2.8, s: 0.7, y: 0.52, sc: 1.12, ph: 2.7 },
    { c: new THREE.Vector3(172, -44, 4), r: 6, s: 0.6, y: 0.8, sc: 1.0, ph: 3.1 },
  ];
  for (const o of peeperOrbits) {
    const m = new THREE.Mesh(peeperGeo, peeperMat);
    m.castShadow = true;
    m.scale.setScalar(o.sc || 1);
    m.userData.orbit = o;
    m.userData.phase = o.ph;
    group.add(m);
    peepers.push(m);
  }

  const stalkerGeo = makeStalker();
  const stalkerMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.02,
    vertexColors: true,
    emissive: 0x2a2806,
    emissiveIntensity: 0.08,
  });
  patchUnderwater(stalkerMat, shared, { caustics: true });
  const stalker = new THREE.Mesh(stalkerGeo, stalkerMat);
  stalker.castShadow = true;
  stalker.scale.set(1.92, 1.38, 1.42);
  group.add(stalker);

  const hoverGeo = makeHoverfish();
  const hoverMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.28,
    metalness: 0.1,
    vertexColors: true,
  });
  patchUnderwater(hoverMat, shared, { caustics: true });
  const hover = new THREE.Mesh(hoverGeo, hoverMat);
  hover.scale.set(1.25, 1.1, 1.2);
  hover.castShadow = true;
  group.add(hover);

  const hover2 = new THREE.Mesh(hoverGeo, hoverMat);
  hover2.scale.set(1.05, 0.95, 1.0);
  hover2.castShadow = true;
  group.add(hover2);

  const hover3 = new THREE.Mesh(hoverGeo, hoverMat);
  hover3.scale.set(1.4, 1.2, 1.35);
  hover3.castShadow = true;
  group.add(hover3);

  scene.add(group);

  return {
    group,
    update(t) {
      for (const f of fish) {
        let px;
        let py;
        let pz;
        let dx;
        let dz;
        if (f.kind === "patrol") {
          const a = t * f.speed * 0.55 + f.phase;
          px = f.origin.x + Math.sin(a) * f.xAmp;
          pz = f.origin.z + Math.cos(a * 0.65) * f.zAmp;
          py = f.origin.y + Math.sin(a * 1.55 + f.phase) * f.yAmp;
          dx = Math.cos(a) * f.xAmp;
          dz = -Math.sin(a * 0.65) * f.zAmp;
        } else {
          const a = t * f.speed * 0.25 + f.phase;
          px = f.origin.x + Math.cos(a) * f.radius;
          pz = f.origin.z + Math.sin(a * 0.85) * f.radius * 0.7;
          py = f.origin.y + Math.sin(a * 1.7) * 0.55;
          dx = -Math.sin(a) * f.radius;
          dz = Math.cos(a * 0.85) * f.radius * 0.7;
        }
        dummy.position.set(px, py, pz);
        dummy.lookAt(px + dx, py, pz + dz);
        dummy.rotateY(Math.PI / 2);
        dummy.scale.setScalar(f.scale);
        dummy.updateMatrix();
        if (f.id < 180) school.setMatrixAt(f.id, dummy.matrix);
      }
      school.count = Math.min(fish.length, 180);
      school.instanceMatrix.needsUpdate = true;

      for (const m of peepers) {
        const o = m.userData.orbit;
        const a = t * o.s + m.userData.phase;
        m.position.set(o.c.x + Math.cos(a) * o.r, o.c.y + Math.sin(a * 2) * o.y, o.c.z + Math.sin(a) * o.r);
        m.lookAt(o.c.x + Math.cos(a + 0.2) * o.r, m.position.y, o.c.z + Math.sin(a + 0.2) * o.r);
        m.rotateY(Math.PI / 2);
      }

      const sa = t * 0.32 + 0.35;
      // Wide pass in front of the hill. z stays between the opening camera
      // and the rock so the body never enters the mesh; by the closeup the
      // camera has moved past it.
      const sx = 0.2 + Math.sin(sa) * 8.4;
      const sz = 16.6 + Math.cos(sa * 0.55) * 2.1;
      const sy = -12.6 + Math.sin(sa * 1.2) * 0.55;
      const sdx = Math.cos(sa) * 8.4;
      const sdz = -Math.sin(sa * 0.55) * 2.1;
      stalker.position.set(sx, sy, sz);
      stalker.lookAt(sx + sdx, sy + Math.cos(sa * 1.35) * 0.25, sz + sdz);
      stalker.rotateY(Math.PI / 2);
      stalker.rotateZ(Math.sin(sa * 1.8) * 0.08);

      const ha = t * 0.45 + 1.2;
      hover.position.set(-5.2 + Math.cos(ha) * 2.4, -15.4, 8.4 + Math.sin(ha) * 1.6);
      hover.lookAt(-5.2 + Math.cos(ha + 0.3) * 2.4, -15.4, 8.4 + Math.sin(ha + 0.3) * 1.6);
      hover.rotateY(Math.PI / 2);

      const hb = t * 0.38 + 3.4;
      hover2.position.set(-8.4 + Math.cos(hb) * 2.2, -15.2, 10.2 + Math.sin(hb) * 1.4);
      hover2.lookAt(-8.4 + Math.cos(hb + 0.25) * 2.2, -15.2, 10.2 + Math.sin(hb + 0.25) * 1.4);
      hover2.rotateY(Math.PI / 2);

      const hc = t * 0.32 + 0.4;
      hover3.position.set(16.4 + Math.cos(hc) * 2.4, -10.6 + Math.sin(hc * 1.6) * 0.5, 6.2 + Math.sin(hc) * 1.7);
      hover3.lookAt(16.4 + Math.cos(hc + 0.28) * 2.4, hover3.position.y, 6.2 + Math.sin(hc + 0.28) * 1.7);
      hover3.rotateY(Math.PI / 2);
    },
  };
}
