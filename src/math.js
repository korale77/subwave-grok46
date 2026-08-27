export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function hashInt(a, b = 0, c = 0, d = 0) {
  let n = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 1449058307 + (d | 0) * 1274126177;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = n ^ (n >>> 16);
  return n >>> 0;
}

export function mulberry32(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

export function noise2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return lerp(
    lerp(hash2(ix, iy), hash2(ix + 1, iy), ux),
    lerp(hash2(ix, iy + 1), hash2(ix + 1, iy + 1), ux),
    uy,
  );
}

export function fbm(x, y, oct = 5) {
  let v = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    v += a * noise2(x * f, y * f);
    f *= 2;
    a *= 0.5;
  }
  return v;
}

export function noise3(x, y, z) {
  const n = noise2(x + z * 0.37, y - z * 0.19);
  const m = noise2(y + 19.1, z + x * 0.23);
  return (n + m) * 0.5;
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function randRange(rng, a, b) {
  return a + (b - a) * rng();
}
