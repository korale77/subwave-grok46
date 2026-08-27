import * as THREE from "three";
import { clamp, fbm, hash2, noise2 } from "./math.js";

function voronoi2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let best = 8;
  let second = 8;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const hx = hash2(ix + ox, iy + oy);
      const hy = hash2(ix + ox + 31.2, iy + oy + 17.8);
      const px = ox + hx - fx;
      const py = oy + hy - fy;
      const d = px * px + py * py;
      if (d < best) {
        second = best;
        best = d;
      } else if (d < second) {
        second = d;
      }
    }
  }
  return { d1: best, d2: second };
}

function makeDataTexture(size, fill, opts = {}) {
  const data = new Uint8Array(size * size * 4);
  fill(data, size);
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = opts.colorSpace ?? THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  tex.anisotropy = 8;
  return tex;
}

function sampleWrap(fn, x, y, size) {
  return fn(((x % size) + size) % size, ((y % size) + size) % size);
}

export function heightToNormal(height, size, strength = 2.4) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hL = sampleWrap(height, x - 1, y, size);
      const hR = sampleWrap(height, x + 1, y, size);
      const hD = sampleWrap(height, x, y - 1, size);
      const hU = sampleWrap(height, x, y + 1, size);
      let nx = (hL - hR) * strength;
      let ny = (hD - hU) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * size + x) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  tex.anisotropy = 8;
  return tex;
}

export function makeSandstoneMaps(size = 1024) {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbm(x * 0.0065, y * 0.0065, 5);
      const n2 = fbm(x * 0.018 + 9.1, y * 0.017, 4);
      const n3 = fbm(x * 0.042 + 2.4, y * 0.04, 3);
      const vL = voronoi2(x * 0.011 + n * 0.35, y * 0.01 + n2 * 0.3);
      const vM = voronoi2(x * 0.026 + 5.2, y * 0.024 + 3.1);
      const vS = voronoi2(x * 0.055 + 11.0, y * 0.052);
      const pit = noise2(x * 0.09, y * 0.088);
      const pit2 = noise2(x * 0.19 + 4, y * 0.18);
      const pit3 = noise2(x * 0.38 + 2, y * 0.36);
      const warpY = y + n * 18 + n2 * 8;
      const strata = 0.5 + 0.5 * Math.sin(warpY * 0.028 + n * 3.4 + x * 0.004);
      const worm = Math.abs(Math.sin((x + y * 0.35) * 0.042 + n2 * 6.1));
      let h = n * 0.38 + n2 * 0.14 + n3 * 0.08 + strata * 0.06;
      // Unique voronoi bowls — no regular grid of pits.
      h -= Math.max(0, 0.22 - vL.d1) * 4.6;
      h -= Math.max(0, 0.11 - vM.d1) * 2.8;
      h -= Math.max(0, 0.05 - vS.d1) * 1.4;
      const rim = Math.max(0, vL.d2 - vL.d1);
      if (rim < 0.045 && vL.d1 < 0.28) h += (0.045 - rim) * 1.6;
      if (pit > 0.62) h -= (pit - 0.62) * 3.4;
      if (pit2 > 0.7) h -= (pit2 - 0.7) * 2.2;
      if (pit3 > 0.78) h -= (pit3 - 0.78) * 1.2;
      if (worm < 0.055) h -= (0.055 - worm) * 2.4;
      height[y * size + x] = h;
    }
  }
  const albedo = makeDataTexture(
    size,
    (data) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          const h = height[i];
          const n = fbm(x * 0.012 + 3, y * 0.012, 4);
          const dust = fbm(x * 0.008 + 20, y * 0.008, 3);
          const speckle = noise2(x * 0.48, y * 0.48);
          // Warm peach-tan. Geometry + cavity shader carry the deep bowls.
          let r = 240 + h * 10 + n * 4;
          let g = 178 + h * 6 + n * 3;
          let b = 126 + h * 3 + n * 2;
          if (h < -0.22) {
            const p = Math.min(1, (-0.22 - h) * 0.72);
            r = 240 * (1 - p) + 162 * p;
            g = 178 * (1 - p) + 112 * p;
            b = 126 * (1 - p) + 72 * p;
          }
          if (dust > 0.8) {
            const a = (dust - 0.8) * 0.5;
            r = r * (1 - a) + 216 * a;
            g = g * (1 - a) + 160 * a;
            b = b * (1 - a) + 108 * a;
          }
          if (speckle > 0.93) {
            r -= 12;
            g -= 14;
            b -= 11;
          }
          const idx = i * 4;
          data[idx] = clamp(r, 0, 255);
          data[idx + 1] = clamp(g, 0, 255);
          data[idx + 2] = clamp(b, 0, 255);
          data[idx + 3] = 255;
        }
      }
    },
    { colorSpace: THREE.SRGBColorSpace },
  );
  const roughness = makeDataTexture(size, (data) => {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        const h = height[i];
        const grain = noise2(x * 0.48, y * 0.48);
        const v = 172 + (1 - h) * 46 + grain * 18;
        const idx = i * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = clamp(v, 140, 255);
        data[idx + 3] = 255;
      }
    }
  });
  const getH = (x, y) => height[y * size + x];
  const normal = heightToNormal(getH, size, 6.4);
  normal.generateMipmaps = true;
  normal.minFilter = THREE.LinearMipmapLinearFilter;
  albedo.repeat.set(1, 1);
  normal.repeat.set(1, 1);
  roughness.repeat.set(1, 1);
  return { albedo, normal, roughness, repeat: 1 };
}

export function makeSandMaps(size = 512) {
  const height = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ripple = Math.sin(x * 0.085 + fbm(x * 0.02, y * 0.02, 3) * 4.2);
      const ripple2 = Math.sin(y * 0.04 + x * 0.012) * 0.35;
      const grain = noise2(x * 0.55, y * 0.55);
      const dune = fbm(x * 0.008, y * 0.01, 4);
      height[y * size + x] = ripple * 0.55 + ripple2 + dune * 0.4 + grain * 0.12;
    }
  }
  const albedo = makeDataTexture(
    size,
    (data) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const i = y * size + x;
          const h = height[i];
          const n = fbm(x * 0.03, y * 0.03, 4);
          const wet = fbm(x * 0.012 + 8, y * 0.012, 3);
          const speck = noise2(x * 1.1, y * 1.1);
          let r = 198 + h * 18 + n * 16;
          let g = 168 + h * 12 + n * 10;
          let b = 112 + h * 6 + n * 6;
          if (wet < 0.38) {
            const w = (0.38 - wet) * 1.6;
            r *= 1 - w * 0.18;
            g *= 1 - w * 0.14;
            b *= 1 - w * 0.08;
          }
          if (speck > 0.88) {
            r -= 40;
            g -= 30;
            b -= 18;
          }
          const idx = i * 4;
          data[idx] = clamp(r, 0, 255);
          data[idx + 1] = clamp(g, 0, 255);
          data[idx + 2] = clamp(b, 0, 255);
          data[idx + 3] = 255;
        }
      }
    },
    { colorSpace: THREE.SRGBColorSpace },
  );
  const getH = (x, y) => height[y * size + x];
  const normal = heightToNormal(getH, size, 1.8);
  albedo.repeat.set(18, 13);
  normal.repeat.set(18, 13);
  return { albedo, normal };
}

export function makeSpongeMaps(size = 512) {
  const height = new Float32Array(size * size);
  const albedo = makeDataTexture(
    size,
    (data) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const n = fbm(x * 0.018, y * 0.018, 5);
          const pore = noise2(x * 0.07, y * 0.07);
          const pore2 = noise2(x * 0.13 + 3, y * 0.12);
          const pore3 = noise2(x * 0.22 + 8, y * 0.2);
          const streak = 0.5 + 0.5 * Math.sin(y * 0.035 + n * 2.2);
          let r = 240 + n * 12 + streak * 8;
          let g = 188 + n * 14;
          let b = 40 + n * 8;
          let h = n * 0.4 + streak * 0.1;
          if (pore > 0.62 && pore2 > 0.5) {
            const p = Math.min(1, (pore - 0.62) * 2.6);
            r = r * (1 - p) + 148 * p;
            g = g * (1 - p) + 92 * p;
            b = b * (1 - p) + 18 * p;
            h -= p * 0.7;
          }
          if (pore3 > 0.78) h -= (pore3 - 0.78) * 1.4;
          height[y * size + x] = h;
          const i = (y * size + x) * 4;
          data[i] = clamp(r, 0, 255);
          data[i + 1] = clamp(g, 0, 255);
          data[i + 2] = clamp(b, 0, 255);
          data[i + 3] = 255;
        }
      }
    },
    { colorSpace: THREE.SRGBColorSpace },
  );
  const getH = (x, y) => height[(((y % size) + size) % size) * size + (((x % size) + size) % size)];
  const normal = heightToNormal(getH, size, 3.1);
  albedo.repeat.set(1.8, 2.4);
  normal.repeat.set(1.8, 2.4);
  return { albedo, normal };
}

function mapsFromImage(img, strength = 3.1) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, size, size);
  const src = ctx.getImageData(0, 0, size, size).data;
  const height = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    height[i] = (src[i * 4] * 0.32 + src[i * 4 + 1] * 0.52 + src[i * 4 + 2] * 0.16) / 255;
  }
  const getH = (x, y) => {
    const xx = ((x % size) + size) % size;
    const yy = ((y % size) + size) % size;
    return height[yy * size + xx];
  };
  const normal = heightToNormal(getH, size, strength);
  const roughness = makeDataTexture(size, (data) => {
    for (let i = 0; i < size * size; i++) {
      const v = 150 + (1 - height[i]) * 85;
      const idx = i * 4;
      data[idx] = data[idx + 1] = data[idx + 2] = clamp(v, 125, 255);
      data[idx + 3] = 255;
    }
  });
  return { normal, roughness };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to load " + url));
    img.src = url;
  });
}

export async function loadShallowsPhotos() {
  const rockUrl = new URL("../assets/textures/rock_pitted.jpg", import.meta.url).href;
  const img = await loadImage(rockUrl);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#c4a070";
  ctx.fillRect(0, 0, 512, 512);
  ctx.drawImage(img, 0, 0, 512, 512);
  const pix = ctx.getImageData(0, 0, 512, 512);
  for (let i = 3; i < pix.data.length; i += 4) pix.data[i] = 255;
  ctx.putImageData(pix, 0, 0);
  const albedo = new THREE.CanvasTexture(canvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.RepeatWrapping;
  albedo.anisotropy = 8;
  albedo.generateMipmaps = true;
  albedo.minFilter = THREE.LinearMipmapLinearFilter;
  albedo.magFilter = THREE.LinearFilter;
  albedo.needsUpdate = true;
  albedo.repeat.set(2.15, 2.15);
  albedo.format = THREE.RGBAFormat;
  const { normal, roughness } = mapsFromImage(img, 4.2);
  normal.repeat.set(2.15, 2.15);
  roughness.repeat.set(2.15, 2.15);
  return { rock: { albedo, normal, roughness, repeat: 2.15 } };
}

export function makeCoralMaps(size = 256) {
  const albedo = makeDataTexture(
    size,
    (data) => {
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const n = fbm(x * 0.055, y * 0.055, 4);
          const polyp = noise2(x * 0.38, y * 0.38);
          const polyp2 = noise2(x * 0.7 + 3, y * 0.68);
          let v = 0.78 + n * 0.16;
          if (polyp > 0.62) v *= 0.78 + (1 - polyp) * 0.2;
          if (polyp2 > 0.78) v *= 0.86;
          const i = (y * size + x) * 4;
          data[i] = clamp(v * 255, 0, 255);
          data[i + 1] = clamp(v * 236, 0, 255);
          data[i + 2] = clamp(v * 205, 0, 255);
          data[i + 3] = 255;
        }
      }
    },
    { colorSpace: THREE.SRGBColorSpace },
  );
  albedo.repeat.set(1.6, 1.6);
  return { albedo };
}
