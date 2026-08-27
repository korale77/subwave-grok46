import * as THREE from "three";
import { terrainHeight } from "../terrain.js";

export function srgb(hex) {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

export function mergeGeos(geos) {
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
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

export function tint(geo, r, g, b) {
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

export function plantY(x, z, lift = 0) {
  return terrainHeight(x, z) + lift;
}
