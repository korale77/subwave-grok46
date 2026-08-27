import * as THREE from "three";
import { hash2, mulberry32, noise3 } from "../math.js";
import { patchUnderwater } from "../shaders.js";
import { mergeGeos, plantY, srgb } from "./util.js";

const CAM = { x: 198, y: -22, z: -148 };

const CAP_TEAL = { top: [0.09, 0.36, 0.32], mid: [0.08, 0.2, 0.17], under: [0.035, 0.05, 0.045], rim: [0.88, 0.24, 0.04] };
const CAP_RUST = { top: [0.16, 0.28, 0.18], mid: [0.12, 0.18, 0.12], under: [0.045, 0.05, 0.04], rim: [0.82, 0.22, 0.035] };
const CAP_ORANGE = { top: [0.22, 0.26, 0.12], mid: [0.14, 0.16, 0.08], under: [0.04, 0.045, 0.035], rim: [0.94, 0.26, 0.04] };

function cellPit(u, v) {
  const ix = Math.floor(u);
  const iy = Math.floor(v);
  const fx = u - ix;
  const fy = v - iy;
  let best = 8;
  let second = 8;
  let hid = 0;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const hx = hash2(ix + ox, iy + oy);
      const hy = hash2(ix + ox + 19.2, iy + oy + 7.8);
      const px = ox + hx - fx;
      const py = (oy + hy - fy) * 1.12;
      const d = px * px + py * py;
      if (d < best) {
        second = best;
        best = d;
        hid = hx;
      } else if (d < second) {
        second = d;
      }
    }
  }
  return { d: Math.sqrt(best), h: hid, d2: Math.sqrt(second) };
}

function buildPores(h, r, seed, faceAng, hero) {
  const pores = [];
  if (!hero || faceAng == null) return pores;
  const n = 26;
  for (let k = 0; k < n; k++) {
    const id = hash2(k + 1.2, seed + 0.4);
    const y = -h * 0.4 + (k + hash2(k, seed) * 0.42) * ((h * 0.8) / n);
    const ang = faceAng + (hash2(k + 3.1, seed) - 0.5) * 1.55;
    const rad = r * (0.05 + id * 0.045);
    pores.push({
      ang,
      y,
      rad,
      depth: rad * (0.72 + id * 0.22),
      id,
      rust: 0.48 + hash2(id, seed + 4) * 0.4,
      face: true,
    });
  }
  pores.sort((a, b) => b.rad - a.rad);
  return pores;
}

function porePunch(pores, ang, y, rr) {
  let punch = 0;
  let rim = 0;
  let rust = 0;
  let inside = 0;
  for (let p = 0; p < pores.length; p++) {
    const po = pores[p];
    let da = ang - po.ang;
    if (da > Math.PI) da -= Math.PI * 2;
    if (da < -Math.PI) da += Math.PI * 2;
    const d = Math.hypot(da * rr, y - po.y);
    if (d < po.rad) {
      const u = d / Math.max(po.rad, 1e-4);
      const bowl = Math.pow(Math.max(0, 1 - u * u), 0.42);
      const amt = po.depth * bowl;
      if (amt > punch) {
        punch = amt;
        inside = 1 - u;
        rust = po.rust;
      }
    } else if (d < po.rad * 1.28) {
      const t = (d - po.rad) / (po.rad * 0.28);
      const lip = (1 - t) * (1 - t);
      if (lip > rim) {
        rim = lip;
        rust = Math.max(rust, po.rust);
      }
    }
  }
  return { punch, rim, rust, inside };
}

function ostiaField(seed, x, y, z, r) {
  const ang = Math.atan2(z, x);
  const su = ang * r * 0.92 + seed * 2.4;
  const sv = y * 0.88 + seed * 1.1;
  const c1 = cellPit(su, sv);
  const c2 = cellPit(su * 1.85 + 7.4, sv * 1.85);
  const open = c1.h > 0.12;
  const size = 0.28 + c1.h * 0.22;
  const hole = open ? Math.max(0, 1 - c1.d / size) : 0;
  const hole2 = c2.h > 0.22 ? Math.max(0, 1 - c2.d / 0.22) : 0;
  const rimInner = size * 0.55;
  const rimOuter = size * 1.18;
  const rim = open && c1.d > rimInner && c1.d < rimOuter ? 1 - Math.abs(c1.d - size * 0.86) / (size * 0.5) : 0;
  const rim2 = hole2 > 0.12 && hole2 < 0.62 ? (1 - Math.abs(hole2 - 0.35) / 0.35) * 0.55 : 0;
  return {
    hole: Math.min(1, hole * hole * 0.95 + hole2 * hole2 * 0.42),
    rim: Math.max(rim, rim2),
    hid: c1.h,
    d: c1.d,
  };
}

function barkField(seed, x, y, z, h, r, pores, skipPunch) {
  const ang = Math.atan2(z, x);
  const ny = (y + h * 0.5) / Math.max(h, 0.01);
  const n1 = noise3(x * 0.14 + seed, y * 0.045, z * 0.14);
  const n2 = noise3(x * 0.42 + seed * 1.4, y * 0.2, z * 0.42);
  const n3 = noise3(x * 1.7 + seed, y * 0.78, z * 1.7);
  const n4 = noise3(x * 3.4 + seed * 2, y * 1.6, z * 3.4);
  const rr = Math.hypot(x, z) || r;
  const po = skipPunch ? { punch: 0, rim: 0, rust: 0, inside: 0 } : porePunch(pores, ang, y, rr);
  const ost = ostiaField(seed, x, y, z, r);
  const ridge = Math.sin(ang * 5.2 + n1 * 2.6 + y * 0.13) * 0.04 + Math.sin(ang * 9 + n2 * 1.8) * 0.018;
  const lobe = 1 + 0.1 * Math.sin(ang * 3 + seed * 2.4 + y * 0.04) + 0.045 * Math.sin(ang * 5.5 + n1);
  let k = lobe * (1 + n1 * 0.1 + n2 * 0.05 + ridge);
  k *= 1.08 - ny * 0.22 + Math.sin(ny * Math.PI) * 0.05;
  if (ny < 0.12) k *= 1 + (0.12 - ny) * 2.4;
  if (ny > 0.9) k *= 1 - (ny - 0.9) * 0.75;
  k += po.rim * 0.04 + ost.rim * 0.018;
  const indent = po.punch / Math.max(rr, 0.01);
  k *= 1 - Math.min(0.18, indent);
  k *= 1 - ost.hole * 0.07;
  k *= 1 - (n4 > 0.78 ? (n4 - 0.78) * 0.16 : 0);
  return { k, n1, n2, n3, n4, po, ost, ny, ang };
}

function paintBark(f) {
  let cr = 0.24 + f.n1 * 0.06;
  let cg = 0.26 + f.n2 * 0.05;
  let cb = 0.2 + f.n1 * 0.035;
  if (f.n3 > 0.64) {
    const w = (f.n3 - 0.64) * 1.4;
    cr *= 1 - w * 0.22;
    cg *= 1 - w * 0.18;
    cb *= 1 - w * 0.24;
  }
  if (f.n1 < 0.34 && f.n4 > 0.48 && f.ost.hole < 0.22) {
    const w = Math.min(0.48, (0.34 - f.n1) * 1.5);
    cr = cr * (1 - w) + 0.06 * w;
    cg = cg * (1 - w) + 0.32 * w;
    cb = cb * (1 - w) + 0.3 * w;
  }
  if (f.n2 > 0.62 && f.n3 > 0.48 && f.ost.hole < 0.18) {
    const w = Math.min(0.38, (f.n2 - 0.62) * 1.6);
    cr = cr * (1 - w) + 0.55 * w;
    cg = cg * (1 - w) + 0.2 * w;
    cb = cb * (1 - w) + 0.045 * w;
  }
  if (f.ost.hole > 0.1) {
    const w = Math.min(1, f.ost.hole * 1.25);
    cr = cr * (1 - w) + 0.025 * w;
    cg = cg * (1 - w) + 0.022 * w;
    cb = cb * (1 - w) + 0.016 * w;
  }
  if (f.ost.rim > 0.12 && f.ost.hole < 0.7) {
    const w = Math.min(0.85, f.ost.rim * (0.72 + f.ost.hid * 0.28));
    cr = cr * (1 - w) + 0.82 * w;
    cg = cg * (1 - w) + 0.28 * w;
    cb = cb * (1 - w) + 0.045 * w;
  }
  if (f.po.inside > 0.08) {
    const w = Math.min(1, f.po.inside * 1.35);
    cr = cr * (1 - w) + 0.02 * w;
    cg = cg * (1 - w) + 0.016 * w;
    cb = cb * (1 - w) + 0.012 * w;
  }
  return [cr, cg, cb];
}

function makeOstium(rad, depth, rust) {
  const lip = Math.max(rad * 0.08, 0.03);
  const pts = [
    new THREE.Vector2(0, -depth),
    new THREE.Vector2(rad * 0.28, -depth * 0.92),
    new THREE.Vector2(rad * 0.58, -depth * 0.62),
    new THREE.Vector2(rad * 0.84, -depth * 0.28),
    new THREE.Vector2(rad * 0.97, -depth * 0.06),
    new THREE.Vector2(rad * 1.0, 0),
    new THREE.Vector2(rad * 1.04, lip * 0.4),
    new THREE.Vector2(rad * 1.06, lip * 0.85),
    new THREE.Vector2(rad * 1.0, lip * 0.55),
    new THREE.Vector2(rad * 0.9, lip * 0.18),
  ];
  pts.reverse();
  const geo = new THREE.LatheGeometry(pts, 14);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const nse = noise3(x * 3.1, y * 3.4, z * 3.1);
    const n2 = noise3(x * 1.4 + rust, y * 1.6, z * 1.4);
    const k = 1 + 0.1 * Math.sin(ang * 3.2 + rust * 5) + 0.06 * Math.sin(ang * 5.5 + nse * 3) + n2 * 0.04;
    pos.setXYZ(i, x * k, y * (1 + nse * 0.03), z * k);
    const rr = Math.hypot(x * k, z * k);
    if (y > -depth * 0.1 && rr > rad * 0.9) {
      const glow = 0.72 + rust * 0.18 + nse * 0.06;
      col[i * 3] = 0.58 * glow;
      col[i * 3 + 1] = 0.2 + rust * 0.06;
      col[i * 3 + 2] = 0.03;
    } else {
      const u = Math.min(1, Math.max(0, -y / Math.max(depth, 1e-4)));
      const d = 0.01 + (1 - u) * 0.014 + nse * 0.004;
      col[i * 3] = d * 0.55;
      col[i * 3 + 1] = d * 0.42;
      col[i * 3 + 2] = d * 0.3;
    }
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function makeCrown(rTop, seed) {
  const h = Math.max(rTop * 0.95, 1.5);
  const pts = [
    [rTop * 1.04, 0],
    [rTop * 0.98, h * 0.22],
    [rTop * 0.84, h * 0.52],
    [rTop * 0.66, h * 0.88],
    [rTop * 0.52, h * 1.02],
    [rTop * 0.42, h * 0.72],
    [rTop * 0.38, h * 0.28],
  ].map(([u, v]) => new THREE.Vector2(u, v));
  const geo = new THREE.LatheGeometry(pts, 28);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const n = noise3(x * 0.55 + seed, y * 0.4, z * 0.55);
    const n2 = noise3(x * 1.4 + seed, y * 0.9, z * 1.4);
    const lobe = 1 + 0.14 * Math.sin(ang * 3 + seed) + 0.08 * Math.sin(ang * 5 + n * 2);
    const k = lobe * (1 + n * 0.12 + n2 * 0.06);
    pos.setXYZ(i, x * k, y * (1 + n * 0.18) + n2 * 0.12, z * k);
    const rust = n2 > 0.62 ? (n2 - 0.62) * 2.2 : 0;
    col[i * 3] = 0.16 * (0.85 + n * 0.2) + rust * 0.55;
    col[i * 3 + 1] = 0.2 * (0.85 + n * 0.2) + rust * 0.16;
    col[i * 3 + 2] = 0.15 * (0.85 + n * 0.2) + rust * 0.02;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function makeHeart(h, r) {
  const geo = new THREE.CylinderGeometry(r * 0.38, r * 0.62, h * 0.97, 8, 1, false);
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = 0.028;
    col[i * 3 + 1] = 0.026;
    col[i * 3 + 2] = 0.02;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function makeTrunk(h, r, seed, hero, faceAng) {
  const pores = buildPores(h, r, seed, faceAng, hero);
  const segs = hero ? 96 : 56;
  const stacks = hero ? 128 : 72;
  const rTop = r * 0.68;
  const rBot = r * 1.42;
  const geo = new THREE.CylinderGeometry(rTop, rBot, h, segs, stacks, true);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const f = barkField(seed, x, y, z, h, r, pores);
    pos.setXYZ(i, x * f.k, y, z * f.k);
    const [cr, cg, cb] = paintBark(f);
    col[i * 3] = cr;
    col[i * 3 + 1] = cg;
    col[i * 3 + 2] = cb;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));

  const crown = makeCrown(rTop, seed);
  crown.translate(0, h * 0.5, 0);
  const parts = [geo, makeHeart(h, r), crown];
  if (hero) {
    const outward = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const m = new THREE.Matrix4();
    const at = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const scale = new THREE.Vector3(1, 1, 1);
    const maxOst = 22;
    let marks = 0;
    for (let p = 0; p < pores.length && marks < maxOst; p++) {
      const po = pores[p];
      const ny = (po.y + h * 0.5) / Math.max(h, 0.01);
      const rr0 = rBot + (rTop - rBot) * ny;
      const f = barkField(seed, Math.cos(po.ang) * rr0, po.y, Math.sin(po.ang) * rr0, h, r, pores, true);
      const rr = rr0 * f.k * 0.99;
      const hole = makeOstium(po.rad, po.depth, po.rust);
      outward.set(Math.cos(po.ang), 0, Math.sin(po.ang));
      q.setFromUnitVectors(up, outward);
      at.set(outward.x * rr, po.y, outward.z * rr);
      m.compose(at, q, scale);
      hole.applyMatrix4(m);
      parts.push(hole);
      marks++;
    }
  }
  const merged = mergeGeos(parts);
  merged.computeVertexNormals();
  return { geo: merged, pores };
}

function barkRadius(h, r, seed, y, ang, pores) {
  const ny = (y + h * 0.5) / Math.max(h, 0.01);
  const rr = r * (1.42 + (0.68 - 1.42) * ny);
  const f = barkField(seed, Math.cos(ang) * rr, y, Math.sin(ang) * rr, h, r, pores);
  return rr * f.k;
}

function paintCapVertex(pal, kind, n, n2, n3, pit) {
  if (kind === "lip") {
    const glow = 0.78 + n * 0.22 + n2 * 0.12;
    const breakUp = n3 > 0.72 ? 0.45 : 1;
    return [pal.rim[0] * glow * breakUp, pal.rim[1] * (0.62 + n2 * 0.3) * breakUp, pal.rim[2] + n * 0.02];
  }
  if (kind === "under") {
    return [pal.under[0] + n * 0.02, pal.under[1] + n * 0.018 + n2 * 0.012, pal.under[2] + n2 * 0.016];
  }
  if (kind === "wall") {
    const t = 0.28 + n * 0.45;
    return [
      pal.mid[0] * (1 - t) + pal.rim[0] * 0.55 * t,
      pal.mid[1] * (1 - t) + pal.rim[1] * 0.42 * t,
      pal.mid[2] * (1 - t) + pal.rim[2] * t,
    ];
  }
  const w = 0.28 + n * 0.6;
  let cr = pal.top[0] * w + pal.mid[0] * (1 - w);
  let cg = pal.top[1] * w + pal.mid[1] * (1 - w);
  let cb = pal.top[2] * w + pal.mid[2] * (1 - w);
  if (n2 > 0.48) {
    const d = Math.min(1, (n2 - 0.48) * 1.7);
    cr = cr * (1 - d * 0.55) + 0.04 * d;
    cg = cg * (1 - d * 0.3) + 0.16 * d;
    cb = cb * (1 - d * 0.12) + 0.28 * d;
  }
  if (n < 0.4) {
    const d = (0.4 - n) * 1.25;
    cr += 0.03 * d;
    cg += 0.12 * d;
    cb += 0.05 * d;
  }
  if (n2 < 0.34 && n3 > 0.36) {
    const d = Math.min(0.7, (0.34 - n2) * 1.6);
    cr = cr * (1 - d) + 0.48 * d;
    cg = cg * (1 - d) + 0.18 * d;
    cb = cb * (1 - d) + 0.04 * d;
  }
  if (n3 > 0.62 && n > 0.4) {
    const d = Math.min(0.55, (n3 - 0.62) * 1.8);
    cr = cr * (1 - d) + 0.2 * d;
    cg = cg * (1 - d) + 0.11 * d;
    cb = cb * (1 - d) + 0.045 * d;
  }
  if (pit > 0.08) {
    const d = Math.min(1, pit);
    cr = cr * (1 - d) + 0.03 * d;
    cg = cg * (1 - d) + 0.07 * d;
    cb = cb * (1 - d) + 0.065 * d;
  }
  return [cr, cg, cb];
}

function capLobe(ang, seed, n, n2) {
  return (
    1 +
    0.16 * Math.sin(ang * 3 + seed * 1.8) +
    0.09 * Math.sin(ang * 5.2 + n * 1.9) +
    0.045 * Math.sin(ang * 8 + n2 + seed) +
    0.07 * Math.sin(ang * 2 + seed * 2.6)
  );
}

function makeCapPits(radius, seed, thick) {
  const pits = [];
  const n = 7 + Math.floor(hash2(seed, 2.4) * 5);
  for (let i = 0; i < n; i++) {
    const id = hash2(i * 3.7, seed + 1.1);
    const id2 = hash2(i + 8.2, seed * 1.4);
    const rad = radius * (0.04 + id * 0.055);
    const rr = radius * (0.16 + hash2(i, seed + 3) * 0.52);
    if (rr + rad > radius * 0.78) continue;
    const depth = Math.min(rad * (0.7 + hash2(i, seed + 7) * 0.4), thick * 0.22);
    pits.push({ ang: id2 * Math.PI * 2, rr, rad, depth });
  }
  return pits;
}

function capPitPunch(pits, x, z) {
  let best = 0;
  let inside = 0;
  for (let i = 0; i < pits.length; i++) {
    const p = pits[i];
    const px = Math.cos(p.ang) * p.rr;
    const pz = Math.sin(p.ang) * p.rr;
    const d = Math.hypot(x - px, z - pz);
    if (d < p.rad) {
      const u = d / Math.max(p.rad, 1e-4);
      const bowl = Math.sqrt(Math.max(0, 1 - u * u));
      const amt = bowl * p.depth;
      if (amt > best) {
        best = amt;
        inside = 1 - u;
      }
    }
  }
  return { amt: best, inside };
}

function makeLipGlow(radius, yOff, seed, pal) {
  const major = radius * 1.015;
  const tube = Math.max(radius * 0.028, 0.08);
  const geo = new THREE.TorusGeometry(major, tube, 10, 72);
  geo.rotateX(Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const ang = Math.atan2(z, x);
    const n = noise3(x * 0.22 + seed, y * 0.8, z * 0.22);
    const n2 = noise3(x * 0.7 + seed * 0.8, y * 1.4, z * 0.7);
    const n3 = noise3(x * 1.6 + seed, y * 2.2, z * 1.6);
    const lobe = capLobe(ang, seed, n, n2);
    const cx = Math.cos(ang) * major;
    const cz = Math.sin(ang) * major;
    const fat = 1 + n * 0.28 + n2 * 0.16 + Math.sin(ang * 7 + seed) * 0.12;
    const droop = Math.sin(ang * 3.6 + seed * 2 + n * 1.6) * tube * 1.15 + (n3 - 0.5) * tube * 0.8;
    pos.setXYZ(i, cx * lobe + (x - cx) * fat, y * fat + yOff + droop, cz * lobe + (z - cz) * fat);
    const rustAmt = n3 > 0.58 ? 0.18 : n < 0.28 ? 0.4 : 1;
    const glow = (0.62 + n * 0.22 + n2 * 0.12) * rustAmt;
    col[i * 3] = pal.rim[0] * glow;
    col[i * 3 + 1] = pal.rim[1] * (0.58 + n2 * 0.28) * rustAmt;
    col[i * 3 + 2] = pal.rim[2] + n * 0.014;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
}

function makeShelfBody(radius, thick, seed, pal) {
  const raw = [
    [0.0, 0.14],
    [0.16, 0.11],
    [0.34, 0.04],
    [0.52, -0.05],
    [0.7, -0.14],
    [0.84, -0.16],
    [0.94, -0.08],
    [1.0, 0.02],
    [1.03, 0.12],
    [1.04, 0.2],
    [1.02, 0.26],
    [0.97, 0.28],
    [0.88, 0.26],
    [0.72, 0.3],
    [0.56, 0.32],
    [0.4, 0.38],
    [0.24, 0.48],
    [0.1, 0.58],
    [0.0, 0.64],
  ];
  const nPts = raw.length;
  const pts = raw.map(([u, v]) => new THREE.Vector2(u * radius, v * thick));
  const geo = new THREE.LatheGeometry(pts, 96);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const pits = makeCapPits(radius, seed, thick);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const j = i % nPts;
    const isUnder = j <= 6;
    const isLip = j >= 7 && j <= 12;
    const isTop = j >= 13;
    const rr = Math.hypot(x, z);
    const rim = rr / Math.max(radius, 0.01);
    const ang = Math.atan2(z, x);
    const n = noise3(x * 0.18 + seed, y * 0.52, z * 0.18);
    const n2 = noise3(x * 0.58 + seed * 0.7, y * 1.15, z * 0.58);
    const n3 = noise3(x * 1.45 + seed, y * 2.2, z * 1.45);
    const n4 = noise3(x * 3.1 + seed * 1.3, y * 3.4, z * 3.1);
    const lobe = capLobe(ang, seed, n, n2);
    const wave = Math.sin(ang * 4 + seed * 2.4 + n * 1.6) * 0.055 + Math.sin(ang * 2.4 + n2 * 2) * 0.034;
    const wrinkle = isTop
      ? Math.sin(ang * 11 + n3 * 3.2) * 0.08 * Math.max(0, 0.92 - rim) + (n3 - 0.5) * 0.09 + (n4 - 0.5) * 0.06 + (n - 0.5) * 0.05
      : 0;
    const k = 1 + (lobe - 1) * (0.28 + rim * 0.9) + n * 0.06 + n2 * 0.04 + wave * rim * 0.48 + (n4 - 0.5) * 0.03;
    const pit = isTop && rim < 0.86 ? capPitPunch(pits, x, z) : { amt: 0, inside: 0 };
    const cell = cellPit(x * 1.15 + seed, z * 1.15);
    const cellB = cellPit(x * 2.35 + seed * 1.6, z * 2.35);
    const micro = isTop && rim < 0.86 ? Math.max(0, 1 - cell.d / 0.28) : 0;
    const grain = isTop && rim < 0.88 ? Math.max(0, 1 - cellB.d / 0.18) : 0;
    const gill = isUnder ? Math.abs(Math.sin(ang * 22 + n * 2.2)) * thick * 0.07 * Math.max(0, rim - 0.14) : 0;
    let y2 = y + wave * thick * (0.28 + rim * 0.7) + (n2 - 0.5) * thick * 0.16 + wrinkle * thick;
    y2 -= pit.amt * 0.95 + micro * thick * 0.11 + grain * thick * 0.055 + gill;
    if (isTop) y2 += (n4 - 0.48) * thick * 0.1 + (n - 0.5) * thick * 0.08;
    pos.setXYZ(i, x * k, y2, z * k);
    let kind = "top";
    if (isUnder) kind = "under";
    else if (isLip) kind = rim > 0.96 ? "lip" : "wall";
    let [cr, cg, cb] = paintCapVertex(pal, kind, n, n2, n3, Math.max(pit.inside * 0.7, micro * 0.85 + grain * 0.4));
    if (isTop && rim > 0.62) {
      const edge = (rim - 0.62) / 0.38;
      const rustBleed = edge * edge * (0.35 + n2 * 0.55) * (n3 > 0.38 ? 1 : 0.25);
      cr = cr * (1 - rustBleed) + pal.rim[0] * 0.85 * rustBleed;
      cg = cg * (1 - rustBleed) + pal.rim[1] * 0.7 * rustBleed;
      cb = cb * (1 - rustBleed) + pal.rim[2] * rustBleed;
    }
    col[i * 3] = cr;
    col[i * 3 + 1] = cg;
    col[i * 3 + 2] = cb;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return [geo, makeLipGlow(radius, thick * 0.22, seed, pal)];
}

function makeCap(radius, seed, pal) {
  const thick = Math.max(radius * 0.26, 1.05) * (0.94 + hash2(seed, 4.2) * 0.14);
  const parts = makeShelfBody(radius, thick, seed, pal);
  if (radius > 2.9) {
    const r2 = radius * (0.7 + hash2(seed, 9.1) * 0.1);
    const t2 = Math.max(r2 * 0.28, 0.82);
    const ox = (hash2(seed, 3.3) - 0.45) * radius * 0.2;
    const oz = (hash2(seed, 5.1) - 0.5) * radius * 0.18;
    const oy = -thick * 0.4;
    const sub = makeShelfBody(r2, t2, seed + 11.4, pal);
    for (let i = 0; i < sub.length; i++) sub[i].translate(ox, oy, oz);
    for (let i = 0; i < sub.length; i++) parts.push(sub[i]);
    if (radius > 5.2) {
      const r3 = radius * (0.46 + hash2(seed, 7.2) * 0.08);
      const t3 = Math.max(r3 * 0.3, 0.68);
      const sub3 = makeShelfBody(r3, t3, seed + 19, pal);
      for (let i = 0; i < sub3.length; i++) sub3[i].translate(-ox * 0.65, oy - t2 * 0.38, oz * 0.55);
      for (let i = 0; i < sub3.length; i++) parts.push(sub3[i]);
    }
  }
  const merged = mergeGeos(parts);
  merged.computeVertexNormals();
  return merged;
}

function taperTube(geo, tubular, radial) {
  const pos = geo.attributes.position;
  for (let j = 0; j <= tubular; j++) {
    const t = j / tubular;
    const taper = Math.max(0.08, 1.08 - t * 1.05);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    const ring = radial + 1;
    for (let i = 0; i < ring; i++) {
      const idx = j * ring + i;
      cx += pos.getX(idx);
      cy += pos.getY(idx);
      cz += pos.getZ(idx);
    }
    cx /= ring;
    cy /= ring;
    cz /= ring;
    for (let i = 0; i < ring; i++) {
      const idx = j * ring + i;
      pos.setXYZ(idx, cx + (pos.getX(idx) - cx) * taper, cy + (pos.getY(idx) - cy) * taper, cz + (pos.getZ(idx) - cz) * taper);
    }
  }
  geo.computeVertexNormals();
}

function makeTentacle(len, radius, lift, sweep, hang, seed) {
  const pts = [];
  const segs = 16;
  for (let k = 0; k <= segs; k++) {
    const t = k / segs;
    const s = t * t;
    pts.push(
      new THREE.Vector3(
        0.16 + t * len,
        lift * t - hang * s + Math.sin(t * Math.PI) * 0.42,
        sweep * t + Math.sin(t * 2.4 + seed) * 0.32 * (1 - t * 0.4),
      ),
    );
  }
  const tubular = 24;
  const radial = 12;
  const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), tubular, radius, radial, false);
  taperTube(geo, tubular, radial);
  return geo;
}

function makeCrabCore() {
  const geo = new THREE.SphereGeometry(1.46, 40, 32);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i);
    let y = pos.getY(i);
    let z = pos.getZ(i);
    const n1 = noise3(x * 1.05, y * 1.15, z * 1.05);
    const n2 = noise3(x * 2.35 + 3.1, y * 2.1, z * 2.2);
    const n3 = noise3(x * 0.48 + 8.2, y * 0.42, z * 0.5);
    const ang = Math.atan2(z, x);
    const fat = 1.2 + n3 * 0.28 + n1 * 0.18 + n2 * 0.08;
    const lobes = 1 + 0.22 * Math.sin(ang * 3 + n1 * 2.2) + 0.12 * Math.sin(y * 2.1 + n2 * 2.6);
    const ny = y / 1.46;
    const squash = 0.76 + 0.26 * (1 - ny * ny);
    x *= fat * lobes * 1.18;
    y *= fat * 0.72 * (1 + n2 * 0.14);
    z *= fat * lobes * 0.9 * squash;
    x += Math.sin(y * 2.1 + n3) * 0.16;
    y += Math.cos(ang * 2 + n1) * 0.1;
    pos.setXYZ(i, x, y, z);
    const w = 0.52 + n1 * 0.28;
    let cr = 0.38 * w + 0.16;
    let cg = 0.07 * w + 0.035;
    let cb = 0.3 * w + 0.1;
    if (n2 > 0.6) {
      cr *= 0.68;
      cg *= 0.62;
      cb *= 0.72;
    }
    if (n3 < 0.32) {
      cr += 0.08;
      cb += 0.05;
    }
    col[i * 3] = cr;
    col[i * 3 + 1] = cg;
    col[i * 3 + 2] = cb;
  }
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

function makeRayGeo() {
  const geo = new THREE.SphereGeometry(0.3, 10, 8);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    pos.setXYZ(i, x * 1.85, y * 0.16, z * 1.1 + Math.max(-z, 0) * 0.7);
  }
  geo.computeVertexNormals();
  return geo;
}

function patchCap(mat, shared) {
  patchUnderwater(mat, shared, { caustics: false, detail: "none" });
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    prev(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      "float depthFromSurface = max(uSurfaceY - vWorldPosition.y, 0.0);",
      `{
        vec3 wp = vWorldPosition;
        vec3 wn = normalize(vWorldNormal);
        float n = n2(wp.xz * 0.14 + wp.y * 0.12);
        float n2f = n2(wp.xy * 0.38 + wp.z * 0.3 + 3.1);
        float n3f = n2(wp.xz * 0.9 + wp.y * 0.7 + 8.4);
        float dA = sqrt(cellPit(wp * 1.15 + 5.2));
        float dB = sqrt(cellPit(wp * 2.2 + 14.0));
        float pit = 1.0 - smoothstep(0.025, 0.14, dA);
        float pit2 = 1.0 - smoothstep(0.012, 0.07, dB);
        float rustN = n2(wp.xz * 0.08 + wp.y * 0.06 + 2.6);
        float rustPatch = smoothstep(0.5, 0.76, rustN) * smoothstep(0.22, 0.5, n2f);
        float olive = smoothstep(0.36, 0.68, n);
        float blue = smoothstep(0.46, 0.76, n2f) * (1.0 - rustPatch);
        float vRust = smoothstep(0.16, 0.46, gl_FragColor.r - gl_FragColor.g);
        gl_FragColor.rgb *= 0.78 + n * 0.28 + n3f * 0.14;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.09, 0.28, 0.17), olive * 0.58 * (1.0 - vRust));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.035, 0.2, 0.34), blue * 0.52 * (1.0 - vRust));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.48, 0.16, 0.035), rustPatch * 0.58 * (1.0 - vRust));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.025, 0.055, 0.05), (pit * 0.62 + pit2 * 0.4) * (1.0 - vRust));
        gl_FragColor.rgb += vec3(0.78, 0.2, 0.03) * vRust * (0.16 + n * 0.08);
        float ndv = max(dot(wn, normalize(cameraPosition - wp)), 0.0);
        gl_FragColor.rgb += vec3(0.65, 0.15, 0.025) * vRust * pow(1.0 - ndv, 2.4) * 0.14;
      }
      float depthFromSurface = max(uSurfaceY - vWorldPosition.y, 0.0);`,
    );
  };
  mat.customProgramCacheKey = () => "uw10-cap-tissue-v9";
}

function patchTranslucent(mat, shared, opacity) {
  patchUnderwater(mat, shared, { caustics: false });
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    prev(shader);
    shader.fragmentShader = shader.fragmentShader.replace("gl_FragColor.a = 1.0;", `gl_FragColor.a = ${opacity.toFixed(3)};`);
  };
}

function patchBark(mat, shared) {
  patchUnderwater(mat, shared, { caustics: false, detail: "none" });
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    prev(shader);
    shader.fragmentShader = shader.fragmentShader.replace(
      "float depthFromSurface = max(uSurfaceY - vWorldPosition.y, 0.0);",
      `{
        vec3 wp = vWorldPosition;
        vec3 wn = normalize(vWorldNormal);
        float dA = sqrt(cellPit(wp * 0.95 + 3.4));
        float dB = sqrt(cellPit(wp * 1.85 + 12.6));
        float dC = sqrt(cellPit(wp * 3.4 + 21.0));
        float ost = 1.0 - smoothstep(0.03, 0.16, dA);
        float ostB = 1.0 - smoothstep(0.016, 0.085, dB);
        float ostC = 1.0 - smoothstep(0.01, 0.045, dC);
        float rim = smoothstep(0.06, 0.13, dA) * (1.0 - smoothstep(0.2, 0.34, dA));
        float rimB = smoothstep(0.03, 0.07, dB) * (1.0 - smoothstep(0.11, 0.2, dB));
        float rustN = n2(wp.xz * 0.09 + wp.y * 0.07 + 4.6);
        float rustN2 = n2(wp.xy * 0.2 + 7.2);
        float tealN = n2(wp.yz * 0.12 + wp.x * 0.08 + 1.8);
        float grain = n2(wp.xy * 3.4 + wp.z * 2.8);
        float vDark = smoothstep(0.12, 0.04, dot(gl_FragColor.rgb, vec3(0.33)));
        float vRust = smoothstep(0.14, 0.4, gl_FragColor.r - gl_FragColor.g);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.02, 0.018, 0.014), (ost * 0.78 + ostB * 0.45 + ostC * 0.22) * (1.0 - vRust));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.84, 0.28, 0.04), (rim * 0.85 + rimB * 0.45) * (1.0 - vDark));
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.58, 0.2, 0.035), vRust * 0.22 * (1.0 - vDark));
        float rust = smoothstep(0.58, 0.82, rustN) * smoothstep(0.38, 0.66, rustN2) * (1.0 - vDark) * (1.0 - ost);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.52, 0.2, 0.04), rust * 0.32);
        float teal = smoothstep(0.64, 0.88, tealN) * (1.0 - vDark) * (1.0 - vRust) * (1.0 - ost);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.05, 0.28, 0.26), teal * 0.3);
        gl_FragColor.rgb *= 0.9 + grain * 0.16;
        float ndv = max(dot(wn, normalize(cameraPosition - wp)), 0.0);
        gl_FragColor.rgb += vec3(0.03, 0.035, 0.03) * pow(1.0 - ndv, 2.6) * 0.12;
      }
      float depthFromSurface = max(uSurfaceY - vWorldPosition.y, 0.0);`,
    );
  };
  mat.customProgramCacheKey = () => "uw10-bark-ostia-v5";
}

export function createMushroomForest(scene, shared) {
  const group = new THREE.Group();
  group.name = "mushroom-forest";
  const rng = mulberry32(7721);

  const trunkMat = new THREE.MeshStandardMaterial({
    color: srgb(0xffffff),
    roughness: 0.96,
    vertexColors: true,
  });
  patchBark(trunkMat, shared);
  const capMat = new THREE.MeshStandardMaterial({
    color: srgb(0xffffff),
    roughness: 0.92,
    vertexColors: true,
    emissive: srgb(0x061210),
    emissiveIntensity: 0.03,
  });
  patchCap(capMat, shared);
  const glowMat = new THREE.MeshStandardMaterial({
    color: srgb(0x5ad8c8),
    emissive: srgb(0x1aa89a),
    emissiveIntensity: 0.95,
    roughness: 0.35,
  });
  patchUnderwater(glowMat, shared, { caustics: false });

  const trees = [
    [207, -166, 38, 3.55],
    [222, -180, 34, 3.05],
    [236, -192, 40, 3.35],
    [218, -154, 26, 2.45],
    [248, -176, 36, 3.15],
    [198, -178, 22, 2.15],
    [230, -208, 32, 2.85],
    [254, -198, 30, 2.7],
    [190, -158, 18, 1.95],
    [262, -164, 28, 2.55],
    [242, -156, 24, 2.3],
    [212, -198, 29, 2.65],
    [268, -186, 33, 2.95],
    [186, -196, 20, 2.05],
    [226, -168, 21, 2.2],
  ];

  const BEAD_MAX = 1600;
  const beadMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 6, 5), glowMat, BEAD_MAX);
  beadMesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const tmp = new THREE.Vector3();
  const origin = new THREE.Vector3();
  let beadN = 0;

  function toWorld(euler, ox, oy, oz, lx, ly, lz, out) {
    return out.set(lx, ly, lz).applyEuler(euler).add(origin.set(ox, oy, oz));
  }

  for (let t = 0; t < trees.length; t++) {
    const [x, z, h, r] = trees[t];
    const yBase = plantY(x, z, 0);
    const seed = t * 1.73 + 0.4;
    const hero = t < 2;
    const leanX = hero ? 0.035 * (t === 0 ? 1 : -0.6) : (rng() - 0.5) * 0.18;
    const leanZ = hero ? 0.03 * (t === 0 ? -1 : 0.4) : (rng() - 0.5) * 0.18;
    const toCamAng = Math.atan2(CAM.z - z, CAM.x - x);
    const yaw = hero ? toCamAng + Math.PI * 0.5 + t * 0.2 : rng() * Math.PI * 2;
    const euler = new THREE.Euler(leanX, yaw, leanZ, "XYZ");
    const ox = x;
    const oy = yBase + h * 0.5;
    const oz = z;
    const camLocalX = CAM.x - x;
    const camLocalZ = CAM.z - z;
    const faceA = Math.atan2(
      camLocalX * Math.sin(yaw) + camLocalZ * Math.cos(yaw),
      camLocalX * Math.cos(yaw) - camLocalZ * Math.sin(yaw),
    );

    const built = makeTrunk(h, r, seed, hero, faceA);
    const trunk = new THREE.Mesh(built.geo, trunkMat);
    trunk.position.set(ox, oy, oz);
    trunk.rotation.copy(euler);
    trunk.castShadow = true;
    group.add(trunk);

    const nCaps = t === 0 ? 4 : h > 28 ? 3 : 2;
    const alongs = nCaps === 4 ? [0.52, 0.24, 0.76, 0.9] : nCaps === 3 ? [0.3, 0.58, 0.86] : [0.4, 0.82];
    for (let c = 0; c < nCaps; c++) {
      const nearShot = t === 0 && c === 0;
      const pal = nearShot || hero || c === 0 ? CAP_TEAL : rng() > 0.35 ? CAP_TEAL : rng() > 0.5 ? CAP_ORANGE : CAP_RUST;
      const capR = r * (nearShot ? 1.95 : c === 0 ? 1.88 : c === 1 ? 1.55 : c === 2 ? 1.38 : 1.22) * (nearShot ? 1 : 0.9 + rng() * 0.16);
      const cap = new THREE.Mesh(makeCap(capR, seed + c * 2.1, pal), capMat);
      const along = alongs[c] + (nearShot ? 0 : (rng() - 0.5) * 0.03);
      const yC = -h * 0.5 + h * along;
      const attach = nearShot
        ? faceA
        : hero
          ? faceA + (c === 0 ? 0.2 : c === 1 ? 2.15 : c === 2 ? -2.05 : c * 1.4) + rng() * 0.12
          : rng() * Math.PI * 2;
      const off = nearShot ? capR * 0.2 : r * 0.3 + capR * (0.15 + rng() * 0.1);
      toWorld(euler, ox, oy, oz, Math.cos(attach) * off, yC, Math.sin(attach) * off, cap.position);
      if (nearShot) {
        cap.rotation.set(-0.12, rng() * Math.PI * 2, 0.07);
      } else {
        cap.rotation.set(leanX + (rng() - 0.5) * 0.14, rng() * Math.PI * 2, leanZ + (rng() - 0.5) * 0.14);
      }
      cap.castShadow = true;
      group.add(cap);
    }

    const trails = hero ? 2 : 1 + (rng() > 0.35 ? 1 : 0);
    for (let tr = 0; tr < trails; tr++) {
      const a0 = hero && tr === 0 ? faceA + 0.15 : rng() * Math.PI * 2;
      const turns = 1.25 + rng() * 0.85;
      const nBeads = 20 + Math.floor(rng() * 8);
      for (let i = 0; i < nBeads && beadN + 1 < BEAD_MAX; i++) {
        const u = i / (nBeads - 1);
        const yC = -h * 0.5 + 1.3 + u * (h - 2.6);
        const wob = noise3(u * 4.2, seed + tr, 2.4) * 0.4;
        const a = a0 + u * turns * Math.PI * 2 + wob;
        const rad = barkRadius(h, r, seed, yC, a, built.pores) + 0.1;
        toWorld(euler, ox, oy, oz, Math.cos(a) * rad, yC, Math.sin(a) * rad, tmp);
        dummy.position.copy(tmp);
        dummy.scale.setScalar(0.7 + rng() * 0.4);
        dummy.updateMatrix();
        beadMesh.setMatrixAt(beadN++, dummy.matrix);
      }
    }
  }
  beadMesh.count = beadN;
  group.add(beadMesh);

  const crab = new THREE.Group();
  const coreMat = new THREE.MeshStandardMaterial({
    color: srgb(0xffffff),
    emissive: srgb(0x581438),
    emissiveIntensity: 0.58,
    roughness: 0.56,
    metalness: 0.02,
    vertexColors: true,
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
  });
  patchTranslucent(coreMat, shared, 0.62);
  const core = new THREE.Mesh(makeCrabCore(), coreMat);
  core.scale.set(1.15, 0.62, 1.05);
  core.renderOrder = 2;
  crab.add(core);
  const innerMat = new THREE.MeshStandardMaterial({
    color: srgb(0x7a2458),
    emissive: srgb(0x701038),
    emissiveIntensity: 0.55,
    roughness: 0.32,
  });
  patchUnderwater(innerMat, shared, { caustics: false });
  const inner = new THREE.Mesh(makeCrabCore(), innerMat);
  inner.scale.set(0.52, 0.28, 0.48);
  inner.position.set(0.06, -0.12, 0.04);
  inner.renderOrder = 1;
  crab.add(inner);
  const spotMat = new THREE.MeshStandardMaterial({
    color: srgb(0x2a1020),
    emissive: srgb(0x180810),
    emissiveIntensity: 0.2,
    roughness: 0.55,
  });
  patchUnderwater(spotMat, shared, { caustics: false });
  for (const [sx, sy, sz, ss] of [
    [0.72, 0.28, 0.55, 0.22],
    [-0.18, 0.42, 0.82, 0.18],
    [0.4, -0.15, 0.9, 0.16],
  ]) {
    const spot = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), spotMat);
    spot.position.set(sx, sy, sz);
    spot.scale.set(ss * 1.2, ss * 0.7, ss * 0.55);
    crab.add(spot);
  }
  const armMat = new THREE.MeshStandardMaterial({
    color: srgb(0x148898),
    emissive: srgb(0x064860),
    emissiveIntensity: 0.28,
    roughness: 0.58,
    metalness: 0.04,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
  });
  patchUnderwater(armMat, shared, { caustics: false });
  const ringMat = new THREE.MeshStandardMaterial({
    color: srgb(0x7ae0ff),
    emissive: srgb(0x3ad0ff),
    emissiveIntensity: 1.4,
    roughness: 0.22,
  });
  patchUnderwater(ringMat, shared, { caustics: false });
  const oral = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.055, 8, 28), ringMat);
  oral.rotation.x = Math.PI / 2;
  oral.position.set(0.04, -0.42, 0.06);
  crab.add(oral);
  const tentPivots = [];
  const nTent = 12;
  const crabX = 209;
  const crabZ = -159;
  const crabY = -19.6;
  const toCamX = CAM.x - crabX;
  const toCamZ = CAM.z - crabZ;
  const crabYaw = Math.atan2(-toCamZ, toCamX);
  const worldReach = new THREE.Vector3(CAM.x - 3 - crabX, CAM.y - 7.5 - crabY, CAM.z - 3 - crabZ).normalize();
  const localReach = worldReach.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -crabYaw);
  for (let i = 0; i < nTent; i++) {
    const pivot = new THREE.Group();
    const a = (i / nTent) * Math.PI * 2;
    const reach = i === 0;
    pivot.position.set(Math.cos(a) * 0.78, reach ? -0.22 : -0.08, Math.sin(a) * 0.78);
    if (reach) {
      pivot.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), localReach);
    } else {
      pivot.rotation.y = -a + (rng() - 0.5) * 0.2;
    }
    const len = reach ? 5.4 : 3.6 + rng() * 1.8;
    const rad = reach ? 0.16 : 0.1 + rng() * 0.05;
    const mesh = new THREE.Mesh(
      makeTentacle(len, rad, reach ? -0.55 : (rng() - 0.4) * 1.8, (rng() - 0.5) * 1.3, reach ? 0.85 : 1.2 + rng() * 1.8, rng() * 8),
      armMat,
    );
    pivot.add(mesh);
    crab.add(pivot);
    tentPivots.push({
      pivot,
      phase: rng() * Math.PI * 2,
      amp: reach ? 0.16 : 0.22 + rng() * 0.12,
      gait: 1.15 + rng() * 0.55,
      base: pivot.quaternion.clone(),
    });
  }
  crab.position.set(crabX, crabY, crabZ);
  crab.scale.setScalar(2.05);
  crab.rotation.set(0.12, crabYaw, -0.05);
  group.add(crab);

  const RAY_N = 10;
  const rayMat = new THREE.MeshStandardMaterial({
    color: srgb(0x7ee8ff),
    emissive: srgb(0x2088c0),
    emissiveIntensity: 0.55,
    roughness: 0.35,
    transparent: true,
    opacity: 0.7,
  });
  patchUnderwater(rayMat, shared, { caustics: false });
  const rayMesh = new THREE.InstancedMesh(makeRayGeo(), rayMat, RAY_N);
  rayMesh.frustumCulled = false;
  rayMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(RAY_N * 3), 3);
  const rayBases = [];
  for (let i = 0; i < RAY_N; i++) {
    const rx = 198 + rng() * 72;
    const rz = -210 + rng() * 72;
    const ry = plantY(rx, rz, 10 + rng() * 22);
    rayBases.push({ x: rx, y: ry, z: rz, phase: rng() * 6.28, speed: 0.22 + rng() * 0.28, s: 0.7 + rng() * 0.8 });
    dummy.position.set(rx, ry, rz);
    dummy.rotation.set(0.15, rng() * 6, 0.1);
    dummy.scale.setScalar(rayBases[i].s);
    dummy.updateMatrix();
    rayMesh.setMatrixAt(i, dummy.matrix);
    rayMesh.instanceColor.setXYZ(i, 0.45 + rng() * 0.4, 0.75 + rng() * 0.2, 0.85 + rng() * 0.15);
  }
  group.add(rayMesh);

  const crabLamp = new THREE.PointLight(0x4aa8c0, 1.35, 18, 1.6);
  crabLamp.position.copy(crab.position);
  group.add(crabLamp);
  const beadLamp = new THREE.PointLight(0x2ce8d0, 1.45, 16, 1.5);
  beadLamp.position.set(207, plantY(207, -166, 16), -166);
  group.add(beadLamp);
  const canopyLamp = new THREE.PointLight(0x2a7868, 1.25, 24, 1.6);
  canopyLamp.position.set(236, plantY(236, -192, 22), -192);
  group.add(canopyLamp);

  group.userData.update = (t) => {
    for (const ten of tentPivots) {
      ten.pivot.quaternion.copy(ten.base);
      const w = t * ten.gait + ten.phase;
      ten.pivot.rotateZ(Math.sin(w) * ten.amp);
      ten.pivot.rotateX(Math.cos(w * 0.85 + 0.4) * ten.amp * 0.7);
      ten.pivot.rotateY(Math.sin(w * 0.55 + 1.1) * ten.amp * 0.45);
    }
    crab.position.y = crabY + Math.sin(t * 0.38) * 0.32;
    crab.rotation.y = crabYaw + Math.sin(t * 0.14) * 0.08;
    crab.rotation.z = -0.05 + Math.sin(t * 0.7) * 0.04;
    crab.rotation.x = 0.12 + Math.cos(t * 0.55) * 0.03;
    coreMat.emissiveIntensity = 0.58 + Math.sin(t * 1.2) * 0.1;
    crabLamp.position.copy(crab.position);
    for (let i = 0; i < RAY_N; i++) {
      const b = rayBases[i];
      dummy.position.set(
        b.x + Math.sin(t * b.speed + b.phase) * 3.4,
        b.y + Math.sin(t * b.speed * 0.7 + b.phase * 1.8) * 1.5,
        b.z + Math.cos(t * b.speed * 0.82 + b.phase) * 2.8,
      );
      dummy.rotation.set(0.18, t * 0.18 + b.phase, Math.sin(t * 0.45 + b.phase) * 0.28);
      dummy.scale.setScalar(b.s);
      dummy.updateMatrix();
      rayMesh.setMatrixAt(i, dummy.matrix);
    }
    rayMesh.instanceMatrix.needsUpdate = true;
  };

  scene.add(group);
  return group;
}
