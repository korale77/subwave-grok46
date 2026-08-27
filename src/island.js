import * as THREE from "three";
import { fbm, noise2, noise3, smoothstep } from "./math.js";
import { patchUnderwater } from "./shaders.js";
import {
  ISLAND,
  islandHeight,
  islandPitAmount,
  islandSandAmount,
  islandVesicleAmount,
} from "./terrain.js";

function srgb(hex) {
  return new THREE.Color().setHex(hex, THREE.SRGBColorSpace);
}

function makeIslandSurface() {
  const n = 200;
  const size = 120;
  const geo = new THREE.PlaneGeometry(size, size, n, n);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const ys = new Float32Array(pos.count);
  const xs = new Float32Array(pos.count);
  const zs = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + ISLAND.x;
    const z = pos.getZ(i) + ISLAND.z;
    const y = islandHeight(x, z);
    const elev = y == null ? -22 : y;
    pos.setXYZ(i, x, elev, z);
    xs[i] = x;
    zs[i] = z;
    ys[i] = elev;
  }

  const stride = n + 1;
  for (let i = 0; i < pos.count; i++) {
    const x = xs[i];
    const z = zs[i];
    const y = ys[i];
    const pit = islandPitAmount(x, z);
    const ves = islandVesicleAmount(x, z);
    const nse = fbm(x * 0.05, z * 0.05);
    const n2 = noise3(x * 0.18, y * 0.15, z * 0.18);
    const n3 = noise2(x * 0.36, z * 0.36);

    const ix = i % stride;
    const iz = (i / stride) | 0;
    let nb = y;
    let nc = 1;
    if (ix > 0) {
      nb += ys[i - 1];
      nc++;
    }
    if (ix < n) {
      nb += ys[i + 1];
      nc++;
    }
    if (iz > 0) {
      nb += ys[i - stride];
      nc++;
    }
    if (iz < n) {
      nb += ys[i + stride];
      nc++;
    }
    const dip = Math.max(0, nb / nc - y);
    const rise = Math.max(0, y - nb / nc);

    const wet = smoothstep(3.2, -0.25, y);
    const sand = islandSandAmount(x, z);
    const beach = y > -0.12 && y < 1.1 ? Math.max(0, sand) * smoothstep(1.05, 0.18, y) : 0;
    const ridge = smoothstep(8, 20, y) * (1 - Math.min(1, Math.max(0, pit) * 0.28));
    const rust = Math.max(0, noise2(x * 0.07 + 2.4, z * 0.065) - 0.54) * (1 - Math.min(1, Math.max(0, pit) * 0.3));
    const bleach = (ridge + Math.min(1, rise * 0.85)) * (0.4 + n2 * 0.35);

    let r, g, b;
    if (beach > 0.42) {
      r = 0.64 + nse * 0.07 - wet * 0.06;
      g = 0.5 + nse * 0.04 - wet * 0.04;
      b = 0.3 + nse * 0.02;
    } else {
      // Weathered mid-gray basalt; pits go near-black so bowls read at 64 m.
      r = 0.4 + nse * 0.06 + n2 * 0.035 + ridge * 0.12 - wet * 0.1;
      g = 0.35 + nse * 0.045 + n2 * 0.025 + ridge * 0.08 - wet * 0.06;
      b = 0.3 + nse * 0.03 + ridge * 0.05 - wet * 0.03;
      r += bleach * 0.14 + rust * 0.2;
      g += bleach * 0.11 + rust * 0.06;
      b += bleach * 0.07;
    }

    const hollow = Math.min(1, Math.max(0, pit) * 0.28 + ves * 0.22 + dip * 0.38);
    r -= hollow * 0.28 + Math.max(0, n3 - 0.56) * 0.08;
    g -= hollow * 0.24 + Math.max(0, n3 - 0.56) * 0.06;
    b -= hollow * 0.2;

    if (y < -0.25) {
      // Wet basalt, not a blue water sheet.
      r *= 0.78;
      g *= 0.7;
      b *= 0.58;
    }

    col[i * 3] = Math.max(0.035, r);
    col[i * 3 + 1] = Math.max(0.03, g);
    col[i * 3 + 2] = Math.max(0.028, b);
  }

  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

export function createIsland(scene, shared) {
  const group = new THREE.Group();
  group.name = "island";

  const landMat = new THREE.MeshStandardMaterial({
    color: srgb(0xffffff),
    roughness: 0.82,
    metalness: 0.02,
    vertexColors: true,
    flatShading: false,
  });
  patchUnderwater(landMat, shared, { caustics: false, detail: "none", absorb: false });

  const land = new THREE.Mesh(makeIslandSurface(), landMat);
  land.receiveShadow = true;
  land.castShadow = true;
  group.add(land);

  scene.add(group);
  return group;
}
