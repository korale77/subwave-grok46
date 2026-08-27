import * as THREE from "three";
import { SHALLOWS_ABSORB, SHALLOWS_FOG, SURFACE_Y } from "./config.js";

const GLSL_COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uFogColor;
uniform vec3 uAbsorb;
uniform float uFogDensity;
uniform float uCausticGain;
uniform float uSurfaceY;
uniform float uBiomeMix;
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;

float hash11(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float n2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash11(i), hash11(i + vec2(1.0, 0.0)), u.x),
             mix(hash11(i + vec2(0.0, 1.0)), hash11(i + vec2(1.0, 1.0)), u.x), u.y);
}

float hash13(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

// Unique (non-tiling) cell distance — large irregular bowls.
float cellPit(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  float best = 8.0;
  for (int z = -1; z <= 1; z++) {
    for (int y = -1; y <= 1; y++) {
      for (int x = -1; x <= 1; x++) {
        vec3 g = vec3(float(x), float(y), float(z));
        vec3 id = i + g;
        vec3 o = vec3(hash13(id), hash13(id + 19.7), hash13(id + 47.3));
        vec3 r = g + o - f;
        best = min(best, dot(r, r));
      }
    }
  }
  return best;
}

vec3 rockWarp(vec3 p) {
  return p + 2.4 * vec3(
    n2(p.yz * 0.055 + 1.7),
    n2(p.xz * 0.048 + 4.2),
    n2(p.xy * 0.052 + 8.9)
  );
}

vec3 rockBlend(vec3 n) {
  vec3 w = pow(abs(n), vec3(5.0));
  return w / (w.x + w.y + w.z + 1e-5);
}

float causticPattern(vec2 p, float t) {
  vec2 q = p * 1.65;
  q += 0.18 * vec2(sin(p.y * 4.4 + t * 0.7), cos(p.x * 3.9 - t * 0.58));
  q += 0.09 * vec2(sin(p.y * 8.2 - t * 0.42 + 1.6), cos(p.x * 7.6 + t * 0.5));
  float a = sin(q.x * 11.2 + t * 0.74) * sin(q.y * 10.4 - t * 0.52);
  float b = sin((q.x * 0.78 + q.y) * 8.6 - t * 0.6);
  float c = sin(q.x * 17.0 - t * 0.34) * sin(q.y * 15.5 + t * 0.28);
  float d = sin((q.x - q.y) * 6.8 + t * 0.22);
  float w = a * 0.4 + b * 0.26 + c * 0.2 + d * 0.14;
  float web = pow(max(w * 0.62 + 0.18, 0.0), 3.4);
  float glow = pow(max(w * 0.28 + 0.1, 0.0), 1.7);
  return web * 1.35 + glow * 0.22;
}
`;

export function createUniformState() {
  return {
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(-0.32, 0.9, 0.28).normalize() },
    uFogColor: { value: new THREE.Color(SHALLOWS_FOG) },
    uAbsorb: { value: new THREE.Vector3(...SHALLOWS_ABSORB) },
    uFogDensity: { value: 0.009 },
    uCausticGain: { value: 1 },
    uSurfaceY: { value: SURFACE_Y },
    uBiomeMix: { value: 0 },
    uAboveWorld: { value: 0 },
  };
}

const SKY_GLSL = /* glsl */ `
vec3 alienSky(vec3 d) {
  d = normalize(d);
  float up = d.y;
  vec3 zenith = vec3(0.10, 0.08, 0.26);
  vec3 mid = vec3(0.20, 0.28, 0.50);
  vec3 horz = vec3(0.96, 0.52, 0.28);
  vec3 glow = vec3(1.0, 0.42, 0.22);
  vec3 col = mix(vec3(0.07, 0.10, 0.14), horz, smoothstep(-0.1, 0.05, up));
  col = mix(col, mix(horz, glow, 0.35), smoothstep(0.02, 0.16, up));
  col = mix(col, mid, smoothstep(0.12, 0.42, up));
  col = mix(col, zenith, smoothstep(0.32, 0.95, up));

  vec3 sunD = normalize(uSunDir);
  float nds = max(dot(d, sunD), 0.0);
  col += vec3(1.0, 0.55, 0.22) * pow(nds, 14.0) * 0.55;
  col += vec3(1.0, 0.78, 0.42) * pow(nds, 48.0) * 0.7;
  col += vec3(1.0, 0.94, 0.82) * pow(nds, 520.0) * 4.8;

  vec2 cuv = d.xz / max(abs(up) + 0.08, 0.12);
  float cl = n2(cuv * 0.38 + vec2(uTime * 0.006, 0.15));
  cl += n2(cuv * 0.9 + vec2(-uTime * 0.004, 1.7)) * 0.45;
  cl += n2(cuv * 2.1 + vec2(0.4, uTime * 0.008)) * 0.2;
  float cloud = smoothstep(0.52, 0.78, cl * 0.55 + 0.2) * smoothstep(0.06, 0.38, up);
  vec3 ccol = mix(vec3(0.72, 0.38, 0.42), vec3(1.0, 0.78, 0.62), smoothstep(0.1, 0.45, up));
  col = mix(col, ccol, cloud * 0.42);
  float veil = smoothstep(0.34, 0.7, n2(cuv * 0.18 + 3.1)) * smoothstep(0.04, 0.28, up);
  col = mix(col, vec3(0.55, 0.32, 0.48), veil * 0.16);

  // Huge banded gas giant with a thin ring, sitting over the island sky.
  vec3 gDir = normalize(vec3(-0.40, 0.33, -0.85));
  float gRad = 0.195;
  float gAng = acos(clamp(dot(d, gDir), -1.0, 1.0));
  vec3 gEast = normalize(cross(vec3(0.22, 0.97, 0.08), gDir));
  vec3 gUp = normalize(cross(gDir, gEast));
  vec3 gOff = d - gDir * dot(d, gDir);
  float gLat = dot(gOff, gUp) / max(gRad, 0.001);
  float gLimb = sqrt(max(0.0, 1.0 - clamp(gAng / gRad, 0.0, 1.0) * clamp(gAng / gRad, 0.0, 1.0)));
  float gDisk = smoothstep(gRad + 0.002, gRad - 0.006, gAng);
  float bands = 0.5 + 0.5 * sin(gLat * 16.0 + n2(vec2(gLat * 6.0, 2.2)) * 2.4);
  vec3 gCol = mix(vec3(0.22, 0.38, 0.48), vec3(0.92, 0.48, 0.22), bands);
  gCol = mix(gCol, vec3(0.12, 0.14, 0.2), smoothstep(0.55, 0.95, abs(gLat)));
  gCol *= 0.32 + 0.48 * gLimb;
  col = mix(col, gCol, gDisk);
  float gHalo = smoothstep(gRad + 0.034, gRad + 0.002, gAng) * (1.0 - gDisk);
  col += vec3(0.62, 0.55, 0.72) * gHalo * 0.16;
  // Ring omitted: previous ansae rendered as two squares on the sky postcard.

  // Close cratered moon.
  vec3 mDir = normalize(vec3(0.62, 0.46, -0.64));
  float mRad = 0.062;
  float mAng = acos(clamp(dot(d, mDir), -1.0, 1.0));
  float mDisk = smoothstep(mRad + 0.002, mRad - 0.003, mAng);
  float mT = clamp(mAng / mRad, 0.0, 1.0);
  float mLimb = sqrt(max(0.0, 1.0 - mT * mT));
  vec3 mOff = d - mDir * dot(d, mDir);
  float crater = n2(mOff.xy * 48.0 + 4.1);
  vec3 mCol = mix(vec3(0.62, 0.48, 0.42), vec3(0.28, 0.22, 0.24), smoothstep(0.55, 0.82, crater));
  mCol *= 0.4 + 0.6 * mLimb;
  col = mix(col, mCol, mDisk);
  col += vec3(0.9, 0.55, 0.4) * smoothstep(mRad + 0.016, mRad, mAng) * (1.0 - mDisk) * 0.35;

  // Distant small moon.
  vec3 sDir = normalize(vec3(-0.78, 0.18, -0.60));
  float sRad = 0.028;
  float sAng = acos(clamp(dot(d, sDir), -1.0, 1.0));
  float sDisk = smoothstep(sRad + 0.0015, sRad - 0.002, sAng);
  float sT = clamp(sAng / sRad, 0.0, 1.0);
  vec3 sCol = vec3(0.72, 0.58, 0.48) * (0.45 + 0.55 * sqrt(max(0.0, 1.0 - sT * sT)));
  col = mix(col, sCol, sDisk);

  return col;
}
`;

const DETAIL_GLSL = {
  none: "",
  sponge: `
    {
      vec3 wp = vWorldPosition;
      float pore = n2(wp.xy * 3.4 + wp.z * 3.0);
      float pore2 = n2(wp.xz * 5.1 + wp.y * 3.2 + 4.2);
      float pore3 = n2(wp.yz * 9.2 + 11.0);
      float micro = n2(wp.yz * 8.4 + 9.0);
      float holes = smoothstep(0.7, 0.9, pore) * smoothstep(0.62, 0.84, pore2);
      float crater = smoothstep(0.86, 0.96, pore3);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.3, 0.14, 0.04), holes * 0.58);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.16, 0.07, 0.02), crater * 0.55);
      gl_FragColor.rgb *= 0.88 + micro * 0.16;
      float mottle = n2(wp.xz * 0.85 + wp.y * 0.4);
      gl_FragColor.rgb *= 0.88 + mottle * 0.2;
      float band = 0.5 + 0.5 * sin(wp.y * 2.8 + mottle * 2.2);
      gl_FragColor.rgb *= 0.92 + band * 0.1;
      vec3 view = normalize(cameraPosition - wp);
      float rim = pow(1.0 - max(dot(normalize(vWorldNormal), view), 0.0), 2.2);
      gl_FragColor.rgb += vec3(0.58, 0.34, 0.06) * rim * 0.2;
    }
  `,
  rock: `
    {
      vec3 wp = vWorldPosition;
      vec3 wn = normalize(vWorldNormal);
      // World-space only — UV albedo/normal are already triplanar; this adds unique bowls.
      float n = n2(wp.xz * 0.08 + wp.y * 0.06);
      float n2f = n2(wp.xy * 0.19 + wp.z * 0.12 + 3.1);
      float n3f = n2(wp.yz * 0.37 + wp.x * 0.16 + 8.4);
      float grain = n2(wp.xy * 2.1 + wp.z * 1.8);
      float micro = n2(wp.yz * 6.2 + wp.x * 5.4);
      float pit = smoothstep(0.5, 0.82, n2(wp.xz * 0.36 + wp.y * 0.32 + 1.7));
      float pit2 = smoothstep(0.56, 0.88, n2(wp.yz * 0.72 + 6.0));
      float pit3 = smoothstep(0.66, 0.93, n2(wp.xy * 1.45 + wp.z * 1.3 + 12.0));
      float cavity = smoothstep(0.54, 0.86, n2(wp.xy * 0.22 + wp.z * 0.2 + 4.2));
      float bowl = smoothstep(0.55, 0.9, n2(wp.xz * 0.12 + wp.y * 0.1 + 9.0));
      float cell = 1.0 - smoothstep(0.035, 0.32, cellPit(wp * 0.145 + 2.4));
      float cell2 = 1.0 - smoothstep(0.018, 0.16, cellPit(wp * 0.31 + 11.0));
      float cell3 = 1.0 - smoothstep(0.01, 0.08, cellPit(wp * 0.62 + 23.5));
      float strata = 0.5 + 0.5 * sin(wp.y * 0.62 + n * 4.4 + wp.x * 0.035 + n2f * 1.6);
      float worm = abs(sin(wp.y * 1.15 + wp.x * 0.21 + n2f * 4.6 + n3f * 1.3));
      // Wet tan sandstone. Do not inverse-beer or floor lum — that is the ice read.
      float cave = pit * 0.16 + pit2 * 0.1 + cavity * 0.14 + pit3 * 0.07
        + bowl * 0.2 + cell * 0.38 + cell2 * 0.18 + cell3 * 0.08;
      cave = clamp(cave, 0.0, 0.88);
      vec3 sand = vec3(0.52, 0.40, 0.28);
      vec3 pitCol = vec3(0.26, 0.20, 0.14);
      vec3 wanted = mix(sand, pitCol, cave);
      wanted *= 1.0 + n * 0.04 + strata * 0.018 + grain * 0.022;
      wanted *= 0.97 + micro * 0.05;
      if (worm < 0.065) wanted *= mix(vec3(0.62, 0.50, 0.36), vec3(1.0), worm / 0.065);
      float bleach = smoothstep(0.22, 0.92, wn.y) * (0.22 + n * 0.18);
      wanted = mix(wanted, wanted * vec3(1.03, 1.00, 0.92), bleach * 0.08);
      wanted = clamp(wanted, vec3(0.18, 0.14, 0.10), vec3(0.62, 0.50, 0.36));
      vec3 vert = gl_FragColor.rgb;
      float vLum = dot(vert, vec3(0.3, 0.54, 0.16));
      // Keep vertex pits/tan; only overlay the sandstone grain. Never lift below ~0.3.
      gl_FragColor.rgb = mix(vert * vec3(0.92, 0.78, 0.58), wanted, 0.42);
      gl_FragColor.rgb *= mix(0.78, 1.05, clamp(vLum, 0.0, 1.0));
      float wet = smoothstep(0.18, -0.22, wn.y);
      gl_FragColor.rgb *= 1.0 - wet * 0.08;
      vec3 view = normalize(cameraPosition - wp);
      float ndv = max(dot(wn, view), 0.0);
      float spec = pow(ndv, 28.0) * (0.014 + wet * 0.045 + cave * 0.035);
      gl_FragColor.rgb += vec3(0.58, 0.50, 0.36) * spec;
    }
  `,
  sand: `
    {
      vec3 wp = vWorldPosition;
      float grain = n2(wp.xz * 14.0);
      float grain2 = n2(wp.xz * 31.0 + 5.0);
      float ripple = 0.5 + 0.5 * sin(wp.x * 2.15 + n2(wp.xz * 0.22) * 5.0);
      float ripple2 = 0.5 + 0.5 * sin(wp.z * 1.55 + wp.x * 0.4);
      float wet = n2(wp.xz * 0.07);
      gl_FragColor.rgb *= 0.86 + ripple * 0.1 + ripple2 * 0.05 + grain * 0.07;
      gl_FragColor.rgb *= 1.0 - grain2 * 0.06;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * vec3(0.78, 0.8, 0.76), smoothstep(0.55, 0.28, wet) * 0.45);
      float speck = smoothstep(0.86, 0.94, n2(wp.xz * 6.5));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.42, 0.34, 0.22), speck * 0.55);
    }
  `,
  coral: `
    {
      vec3 wp = vWorldPosition;
      float polyp = n2(wp.xy * 6.2 + wp.z * 5.4);
      float polyp2 = n2(wp.xz * 10.5 + 3.0);
      float mottle = n2(wp.xz * 1.4 + wp.y * 1.1);
      float pits = smoothstep(0.66, 0.84, polyp) * smoothstep(0.5, 0.72, polyp2);
      gl_FragColor.rgb *= 0.8 + mottle * 0.32;
      gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 0.42, pits * 0.7);
      vec3 view = normalize(cameraPosition - wp);
      float rim = pow(1.0 - max(dot(normalize(vWorldNormal), view), 0.0), 2.4);
      gl_FragColor.rgb += gl_FragColor.rgb * rim * 0.18;
    }
  `,
};

const ROCK_TRIPLANAR_MAP = /* glsl */ `
#ifdef USE_MAP
  {
    vec3 wpT = rockWarp(vWorldPosition);
    vec3 bw = rockBlend(normalize(vWorldNormal));
    float s0 = 0.034;
    float s1 = 0.0155;
    vec4 c0 = texture2D(map, wpT.zy * s0) * bw.x
            + texture2D(map, wpT.xz * s0) * bw.y
            + texture2D(map, wpT.xy * s0) * bw.z;
    vec4 c1 = texture2D(map, wpT.zy * s1 + vec2(0.37, 0.11)) * bw.x
            + texture2D(map, wpT.xz * s1 + vec2(0.21, 0.63)) * bw.y
            + texture2D(map, wpT.xy * s1 + vec2(0.71, 0.14)) * bw.z;
    vec4 sampledDiffuseColor = mix(c0, c1, 0.48);
    diffuseColor *= sampledDiffuseColor;
  }
#endif
`;

const ROCK_TRIPLANAR_NORMAL = /* glsl */ `
#ifdef USE_NORMALMAP
  {
    vec3 wpn = rockWarp(vWorldPosition);
    vec3 wnn = normalize(vWorldNormal);
    vec3 blendN = rockBlend(wnn);
    vec3 axisSign = sign(wnn);
    axisSign = mix(vec3(1.0), axisSign, step(vec3(1e-4), abs(wnn)));
    float ns0 = 0.036;
    float ns1 = 0.016;
    vec3 tnx = mix(texture2D(normalMap, wpn.zy * ns0).xyz, texture2D(normalMap, wpn.zy * ns1 + 0.41).xyz, 0.42) * 2.0 - 1.0;
    vec3 tny = mix(texture2D(normalMap, wpn.xz * ns0).xyz, texture2D(normalMap, wpn.xz * ns1 + vec2(0.27, 0.58)).xyz, 0.42) * 2.0 - 1.0;
    vec3 tnz = mix(texture2D(normalMap, wpn.xy * ns0).xyz, texture2D(normalMap, wpn.xy * ns1 + vec2(0.66, 0.19)).xyz, 0.42) * 2.0 - 1.0;
    tnx.xy *= normalScale;
    tny.xy *= normalScale;
    tnz.xy *= normalScale;
    tnx.z *= axisSign.x;
    tny.z *= axisSign.y;
    tnz.z *= axisSign.z;
    tnx = vec3(tnx.xy + wnn.zy, wnn.x);
    tny = vec3(tny.xy + wnn.xz, wnn.y);
    tnz = vec3(tnz.xy + wnn.xy, wnn.z);
    vec3 worldN = normalize(tnx.zyx * blendN.x + tny.xzy * blendN.y + tnz.xyz * blendN.z);
    normal = normalize(mat3(viewMatrix) * worldN);
  }
#elif defined( USE_BUMPMAP )
  normal = perturbNormalArb( - vViewPosition, normal, dHdxy_fwd(), faceDirection );
#endif
`;

const ROCK_TRIPLANAR_ROUGH = /* glsl */ `
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  {
    vec3 wpR = rockWarp(vWorldPosition);
    vec3 bwR = rockBlend(normalize(vWorldNormal));
    float rs = 0.03;
    vec4 texelRoughness = texture2D(roughnessMap, wpR.zy * rs) * bwR.x
                        + texture2D(roughnessMap, wpR.xz * rs) * bwR.y
                        + texture2D(roughnessMap, wpR.xy * rs) * bwR.z;
    roughnessFactor *= texelRoughness.g;
  }
#endif
`;

export function patchUnderwater(material, shared, opts = {}) {
  const caustics = opts.caustics !== false;
  const absorb = opts.absorb === "soft" ? "soft" : opts.absorb !== false ? "full" : "off";
  const detail = opts.detail || "none";
  const extra = DETAIL_GLSL[detail] || "";
  const rockMaps = detail === "rock";
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         varying vec3 vWorldPosition;
         varying vec3 vWorldNormal;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
         vec4 wp = vec4(transformed, 1.0);
         #ifdef USE_BATCHING
         wp = batchingMatrix * wp;
         #endif
         #ifdef USE_INSTANCING
         wp = instanceMatrix * wp;
         #endif
         wp = modelMatrix * wp;
         vWorldPosition = wp.xyz;
         vec3 wn = objectNormal;
         #ifdef USE_INSTANCING
         wn = mat3(instanceMatrix) * wn;
         #endif
         vWorldNormal = normalize(mat3(modelMatrix) * wn);`,
      );

    let frag = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         ${GLSL_COMMON}`,
      )
      .replace("#include <fog_fragment>", "");
    if (rockMaps) {
      frag = frag
        .replace("#include <map_fragment>", ROCK_TRIPLANAR_MAP)
        .replace("#include <normal_fragment_maps>", ROCK_TRIPLANAR_NORMAL)
        .replace("#include <roughnessmap_fragment>", ROCK_TRIPLANAR_ROUGH);
    }
    shader.fragmentShader = frag.replace(
        "#include <dithering_fragment>",
        `#include <dithering_fragment>
         ${extra}
         float depthFromSurface = max(uSurfaceY - vWorldPosition.y, 0.0);
         ${
           caustics
             ? `
         vec3 wnC = normalize(vWorldNormal);
         float upF = max(wnC.y, 0.0);
         float sunF = max(dot(wnC, normalize(uSunDir)), 0.0);
         float facing = mix(0.12, 1.0, max(upF, sunF * 0.45));
         float causticFade = exp(-depthFromSurface * 0.02) * facing;
         float caz = causticPattern(vWorldPosition.xz * vec2(0.16, 0.24), uTime);
         float caz2 = causticPattern(vWorldPosition.xz * vec2(0.32, 0.22) + vec2(8.6, 3.1), uTime * 1.07 + 2.8);
         float caz3 = causticPattern(vWorldPosition.xz * 0.09 + 2.2, uTime * 0.72);
         float web = max(max(caz, caz2 * 0.82), caz3 * 0.7);
         float soft = 0.4 * (caz + caz2) + 0.2 * caz3;
         float floorAmt = smoothstep(0.25, 0.88, upF);
         gl_FragColor.rgb *= mix(0.9 + 0.12 * soft * facing, 0.66 + 0.42 * soft, floorAmt);
         gl_FragColor.rgb += vec3(1.02, 0.98, 0.74) * pow(web, 1.2) * mix(0.55, 1.65, floorAmt) * causticFade * uCausticGain;
         `
             : ""
         }
         ${
           absorb === "full"
             ? `
         float dist = length(vWorldPosition - cameraPosition);
         vec3 beer = exp(-uAbsorb * dist);
         gl_FragColor.rgb *= beer;
         vec3 viewW = normalize(vWorldPosition - cameraPosition);
         float lookUp = smoothstep(-0.22, 0.72, viewW.y);
         vec3 deepFog = uFogColor * mix(vec3(0.7, 0.86, 0.9), vec3(0.72, 0.9, 0.55), uBiomeMix);
         vec3 highFog = mix(uFogColor, mix(vec3(0.5, 0.82, 0.84), uFogColor * 1.05, uBiomeMix), 0.35) * mix(1.18, 0.92, uBiomeMix);
         vec3 fogCol = mix(deepFog, highFog, lookUp * (1.0 - uBiomeMix * 0.7));
         float depthMul = 1.0 + 0.28 * smoothstep(0.0, -20.0, vWorldPosition.y);
         float haze = exp(-uFogDensity * dist * depthMul);
         gl_FragColor.rgb = mix(fogCol, gl_FragColor.rgb, haze);
         float inscatter = pow(max(dot(viewW, normalize(uSunDir)), 0.0), 12.0);
         gl_FragColor.rgb += vec3(0.55, 0.78, 0.76) * inscatter * (1.0 - haze) * 0.22;
         `
             : absorb === "soft"
               ? `
         float dist = length(vWorldPosition - cameraPosition);
         vec3 viewW = normalize(vWorldPosition - cameraPosition);
         float lookUp = smoothstep(-0.22, 0.72, viewW.y);
         vec3 deepFog = uFogColor * mix(vec3(0.7, 0.86, 0.9), vec3(0.72, 0.9, 0.55), uBiomeMix);
         vec3 highFog = mix(uFogColor, mix(vec3(0.5, 0.82, 0.84), uFogColor * 1.05, uBiomeMix), 0.35) * mix(1.18, 0.92, uBiomeMix);
         vec3 fogCol = mix(deepFog, highFog, lookUp * (1.0 - uBiomeMix * 0.7));
         float fade = smoothstep(16.0, 54.0, dist);
         vec3 beer = exp(-uAbsorb * vec3(0.22, 0.38, 0.42) * max(dist - 14.0, 0.0));
         gl_FragColor.rgb *= mix(vec3(1.0), beer, fade);
         gl_FragColor.rgb = mix(gl_FragColor.rgb, fogCol, fade * 0.58);
         float inscatter = pow(max(dot(viewW, normalize(uSunDir)), 0.0), 12.0);
         gl_FragColor.rgb += vec3(0.55, 0.78, 0.76) * inscatter * fade * 0.12;
         `
               : ""
         }
         gl_FragColor.a = 1.0;
        `,
      );
  };
  material.customProgramCacheKey = () => `uw14-${caustics ? 1 : 0}-${absorb}-${detail}`;
  material.needsUpdate = true;
  return material;
}

export function createWaterMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uSky: { value: new THREE.Color(0xc8e8ff) },
      uDeep: { value: new THREE.Color(0x042428) },
      uEnv: { value: null },
      uHasEnv: { value: 0 },
      uViewProjInv: { value: new THREE.Matrix4() },
      uRes: { value: new THREE.Vector2(1, 1) },
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: true,
    depthTest: true,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSurfaceY;
      uniform mat4 uViewProjInv;
      varying vec3 vWorldPosition;
      varying vec3 vWorldNormal;

      const float TAU = 6.2831853;

      void gerstner(vec2 xz, float t, out vec3 pos, out vec3 nrm) {
        pos = vec3(xz.x, uSurfaceY, xz.y);
        float nx = 0.0;
        float ny = 1.0;
        float nz = 0.0;
        vec2 d;
        float A, L, spd, Q, k, qi, ph, s, c;

        d = normalize(vec2(1.0, 0.32)); A = 0.18; L = 34.0; spd = 0.72; Q = 0.38;
        k = TAU / L; qi = Q / (k * A * 6.0); ph = k * dot(d, xz) + t * spd; s = sin(ph); c = cos(ph);
        pos.x += qi * A * d.x * c; pos.z += qi * A * d.y * c; pos.y += A * s;
        nx += d.x * k * A * c; nz += d.y * k * A * c; ny -= qi * k * A * s;

        d = normalize(vec2(-0.74, 1.0)); A = 0.12; L = 19.0; spd = 0.98; Q = 0.42;
        k = TAU / L; qi = Q / (k * A * 6.0); ph = k * dot(d, xz) + t * spd; s = sin(ph); c = cos(ph);
        pos.x += qi * A * d.x * c; pos.z += qi * A * d.y * c; pos.y += A * s;
        nx += d.x * k * A * c; nz += d.y * k * A * c; ny -= qi * k * A * s;

        d = normalize(vec2(0.18, -1.0)); A = 0.07; L = 11.0; spd = 1.28; Q = 0.46;
        k = TAU / L; qi = Q / (k * A * 6.0); ph = k * dot(d, xz) + t * spd; s = sin(ph); c = cos(ph);
        pos.x += qi * A * d.x * c; pos.z += qi * A * d.y * c; pos.y += A * s;
        nx += d.x * k * A * c; nz += d.y * k * A * c; ny -= qi * k * A * s;

        d = normalize(vec2(-1.0, -0.38)); A = 0.055; L = 6.2; spd = 1.62; Q = 0.55;
        k = TAU / L; qi = Q / (k * A * 6.0); ph = k * dot(d, xz) + t * spd; s = sin(ph); c = cos(ph);
        pos.x += qi * A * d.x * c; pos.z += qi * A * d.y * c; pos.y += A * s;
        nx += d.x * k * A * c; nz += d.y * k * A * c; ny -= qi * k * A * s;

        d = normalize(vec2(0.62, 0.78)); A = 0.03; L = 3.4; spd = 2.05; Q = 0.5;
        k = TAU / L; qi = Q / (k * A * 6.0); ph = k * dot(d, xz) + t * spd; s = sin(ph); c = cos(ph);
        pos.x += qi * A * d.x * c; pos.z += qi * A * d.y * c; pos.y += A * s;
        nx += d.x * k * A * c; nz += d.y * k * A * c; ny -= qi * k * A * s;

        d = normalize(vec2(-0.28, 0.96)); A = 0.016; L = 1.9; spd = 2.55; Q = 0.45;
        k = TAU / L; qi = Q / (k * A * 6.0); ph = k * dot(d, xz) + t * spd; s = sin(ph); c = cos(ph);
        pos.x += qi * A * d.x * c; pos.z += qi * A * d.y * c; pos.y += A * s;
        nx += d.x * k * A * c; nz += d.y * k * A * c; ny -= qi * k * A * s;

        nrm = normalize(vec3(-nx, ny, -nz));
      }

      vec3 hitPlane(vec3 ori, vec3 dir) {
        float dy = dir.y;
        vec3 horiz = vec3(dir.x, 0.0, dir.z);
        float hl = length(horiz);
        if (hl < 1e-5) horiz = vec3(1.0, 0.0, 0.0);
        else horiz /= hl;
        if (abs(dy) < 1e-4) {
          return vec3(ori.x, uSurfaceY, ori.z) + horiz * 380.0;
        }
        float t = (uSurfaceY - ori.y) / dy;
        if (t < 0.04) {
          return vec3(ori.x, uSurfaceY, ori.z) + horiz * 380.0;
        }
        return ori + dir * min(t, 400.0);
      }

      void main() {
        vec4 p0 = uViewProjInv * vec4(position.xy, -1.0, 1.0);
        vec4 p1 = uViewProjInv * vec4(position.xy, 1.0, 1.0);
        p0 /= p0.w;
        p1 /= p1.w;
        vec3 ori = cameraPosition;
        vec3 dir = normalize(p1.xyz - p0.xyz);
        vec3 hit = hitPlane(ori, dir);
        vec3 wp;
        vec3 nrm;
        gerstner(hit.xz, uTime, wp, nrm);
        vWorldPosition = wp;
        vWorldNormal = nrm;
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      uniform vec3 uSky;
      uniform vec3 uDeep;
      uniform samplerCube uEnv;
      uniform float uHasEnv;
      uniform mat4 uViewProjInv;
      uniform vec2 uRes;

      vec3 chopNormal(vec3 n, vec2 xz, float t) {
        vec2 u1 = xz * 0.55 + vec2(t * 0.085, t * 0.046);
        vec2 u2 = xz * 1.25 + vec2(-t * 0.062, t * 0.09);
        vec2 u3 = xz * 2.8 + vec2(t * 0.13, -t * 0.07);
        float e = 0.07;
        float h  = n2(u1) * 0.5 + n2(u2) * 0.32 + n2(u3) * 0.18;
        float hx = n2(u1 + vec2(e, 0.0)) * 0.5 + n2(u2 + vec2(e, 0.0)) * 0.32 + n2(u3 + vec2(e, 0.0)) * 0.18;
        float hz = n2(u1 + vec2(0.0, e)) * 0.5 + n2(u2 + vec2(0.0, e)) * 0.32 + n2(u3 + vec2(0.0, e)) * 0.18;
        float k = 0.34;
        return normalize(n + vec3((h - hx) * k / e, 0.0, (h - hz) * k / e));
      }

      float fbm2(vec2 p) {
        return n2(p) * 0.52 + n2(p * 2.13) * 0.28 + n2(p * 4.27) * 0.14 + n2(p * 8.1) * 0.06;
      }

      ${SKY_GLSL}

      vec3 proceduralSky(vec3 d) {
        return alienSky(d);
      }

      vec3 sampleSkyEnv(vec3 d) {
        return proceduralSky(d);
      }

      vec3 sampleReflEnv(vec3 d) {
        vec3 proc = proceduralSky(d);
        if (uHasEnv < 0.5) return proc;
        vec3 env = textureCube(uEnv, d).rgb;
        float skyW = smoothstep(-0.04, 0.2, normalize(d).y);
        return mix(proc, mix(proc, env, 0.85), skyW);
      }

      vec3 tirUnderwater(vec3 R) {
        float up = R.y;
        vec3 deep = mix(uDeep, uFogColor * 0.22, 0.35);
        vec3 mid = uFogColor * mix(vec3(0.28, 0.42, 0.44), vec3(0.3, 0.46, 0.18), uBiomeMix);
        vec3 col = mix(deep, mid, smoothstep(-0.85, 0.05, up));
        float nds = max(dot(normalize(R), normalize(uSunDir)), 0.0);
        col += vec3(0.35, 0.55, 0.5) * pow(nds, 24.0) * 0.08;
        return col;
      }

      float fresnelSchlick(float cosTheta, float f0) {
        return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
      }

      void main() {
        vec2 ndc = vec2(gl_FragCoord.x / max(uRes.x, 1.0), gl_FragCoord.y / max(uRes.y, 1.0)) * 2.0 - 1.0;
        vec4 rp0 = uViewProjInv * vec4(ndc, -1.0, 1.0);
        vec4 rp1 = uViewProjInv * vec4(ndc, 1.0, 1.0);
        rp0 /= rp0.w;
        rp1 /= rp1.w;
        vec3 rdir = rp1.xyz - rp0.xyz;
        float rlen = length(rdir);
        rdir = rlen > 1e-6 ? rdir / rlen : vec3(0.0, 1.0, 0.0);
        float tHit = abs(rdir.y) > 1e-4 ? (uSurfaceY - cameraPosition.y) / rdir.y : -1.0;
        if (tHit < 0.02 || tHit > 400.0) discard;
        // Only reject close-range stretched triangles that paint water onto
        // nearby hills. Far-surface samples must stay intact or the horizon flickers.
        float vertDist = length(vWorldPosition - cameraPosition);
        if (vertDist < 42.0 && vertDist + 2.4 < tHit) discard;
        float horizon = smoothstep(0.01, 0.07, abs(rdir.y)) * smoothstep(400.0, 140.0, tHit);

        vec3 nGeo = normalize(vWorldNormal);
        if (nGeo.y < 0.0) nGeo = -nGeo;
        vec3 n = chopNormal(nGeo, vWorldPosition.xz, uTime);
        vec3 V = normalize(cameraPosition - vWorldPosition);
        float side = cameraPosition.y - vWorldPosition.y;
        float belowAmt = 1.0 - smoothstep(-0.08, 0.18, side);

        vec3 Nw = normalize(-n);
        float cosi = clamp(dot(V, Nw), 0.0, 1.0);
        float eta = 1.333;
        float cosCrit = sqrt(max(0.0, 1.0 - 1.0 / (eta * eta)));
        vec3 I = -V;
        vec3 T = refract(I, Nw, eta);
        vec3 Rtir = reflect(I, Nw);

        float win = smoothstep(cosCrit - 0.018, cosCrit + 0.01, cosi);
        vec3 skyLook = length(T) > 0.001 ? T : vec3(n.x * 0.2, 1.0, n.z * 0.2);
        vec3 through = sampleSkyEnv(normalize(skyLook));
        vec3 sunD = normalize(uSunDir);
        float sunAim = max(dot(normalize(skyLook), sunD), 0.0);
        through += vec3(1.0, 0.96, 0.82) * pow(sunAim, 900.0) * 6.5 * win;
        through += vec3(1.0, 0.88, 0.58) * pow(sunAim, 48.0) * 0.9 * win;

        vec3 tirCol = tirUnderwater(Rtir);
        vec3 belowCol = mix(tirCol, through, win);

        float dist = length(vWorldPosition - cameraPosition);
        float waterFog = mix(0.0014, uFogDensity * 0.7, uBiomeMix);
        float fogAmt = (1.0 - exp(-waterFog * dist)) * (1.0 - win * 0.85);
        belowCol = mix(belowCol, uFogColor * mix(0.55, 0.42, uBiomeMix), fogAmt);

        vec3 Rair = reflect(-V, n);
        vec3 aboveSky = sampleReflEnv(Rair);
        float ndv = max(dot(n, V), 0.0);
        float F = fresnelSchlick(ndv, 0.02);
        vec3 body = mix(uDeep * 1.35, uFogColor * 0.42, 0.45);
        float depthSee = exp(-max(0.0, -cameraPosition.y) * 0.035);
        body = mix(body, uFogColor * 0.28, 1.0 - depthSee);
        vec3 aboveCol = mix(body, aboveSky, mix(0.22, 0.97, F));
        float spec = pow(max(dot(normalize(Rair), sunD), 0.0), 280.0);
        float glitter = pow(max(dot(normalize(Rair), sunD), 0.0), 36.0);
        aboveCol += vec3(1.0, 0.96, 0.86) * spec * 2.8 * F;
        aboveCol += vec3(1.0, 0.93, 0.78) * glitter * 0.28 * F;

        vec3 col = mix(aboveCol, belowCol, belowAmt);
        col = mix(uFogColor * mix(0.5, 0.38, uBiomeMix), col, horizon);
        float alpha = mix(mix(0.78, 0.97, F), 1.0, belowAmt) * mix(0.55, 1.0, horizon);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export function createGodRayMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      uniform vec3 uFogColor;
      uniform float uBiomeMix;
      varying vec2 vUv;
      varying vec3 vWorldPosition;

      float hash11(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
      }
      float n2(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash11(i), hash11(i + vec2(1.0, 0.0)), u.x),
                   mix(hash11(i + vec2(0.0, 1.0)), hash11(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      void main() {
        float t = uTime;
        float x = vUv.x;
        float id = hash11(floor(vWorldPosition.xz * 0.07 + 2.4));
        float n = n2(vec2(x * 3.4 + id * 5.0, vUv.y * 0.28 + t * 0.03));
        float n2f = n2(vec2(x * 8.0 + 1.7, vUv.y * 0.7 - t * 0.02));
        float lobe = pow(max(sin(x * 3.14159 * (1.15 + id * 0.6) + id * 4.0), 0.0), 2.4);
        float shafts = smoothstep(0.64, 0.9, n) * (0.35 + 0.65 * n2f) * (0.18 + 0.82 * lobe);

        float edge = smoothstep(0.0, 0.16, x) * smoothstep(1.0, 0.84, x);
        float fall = pow(vUv.y, 0.55) * smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.05, 0.72, vUv.y);
        float a = shafts * edge * fall * 0.38;

        float dist = length(vWorldPosition - cameraPosition);
        a *= exp(-dist * 0.0036);
        float nearSurf = smoothstep(-24.0, -2.0, vWorldPosition.y);
        a *= 0.78 + 0.55 * nearSurf;

        vec3 col = mix(vec3(0.62, 0.88, 0.86), vec3(0.96, 0.99, 0.92), nearSurf * 0.7);
        col = mix(col, uFogColor * vec3(1.15, 1.35, 0.55), uBiomeMix);
        a *= 1.0 - uBiomeMix * 0.72;
        gl_FragColor = vec4(col * a * 2.2, a);
      }
    `,
  });
}

export function createCausticDecalMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec3 vWorldPosition;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}

      void main() {
        float c = causticPattern(vWorldPosition.xz * 0.38, uTime);
        float c2 = causticPattern(vWorldPosition.xz * 0.62 + vec2(4.2, 1.8), uTime * 1.08 + 2.2);
        float web = max(c, c2 * 0.88);
        float a = pow(web, 1.15) * 0.72 * uCausticGain;
        gl_FragColor = vec4(vec3(1.08, 1.02, 0.7) * a * 2.6, a);
      }
    `,
  });
}

export function createSurfaceGlowMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uSunDir;
      varying vec2 vUv;
      varying vec3 vWorldPosition;

      void main() {
        vec2 c = vUv * 2.0 - 1.0;
        float r = length(c);
        float rip = 0.07 * sin(r * 16.0 - uTime * 1.25 + c.x * 3.0);
        float win = smoothstep(1.02, 0.28, r + rip);
        float hot = pow(max(1.0 - r * 1.05, 0.0), 2.4);
        float spark = pow(max(sin(c.x * 14.0 + uTime * 0.8) * sin(c.y * 12.0 - uTime * 0.6), 0.0), 9.0);
        vec3 col = vec3(0.72, 0.96, 0.94) * win + vec3(1.0, 0.98, 0.84) * hot * 1.45;
        col += vec3(0.9, 1.0, 0.95) * spark * 0.7 * win;
        float sun = pow(max(dot(normalize(vec3(c.x, 0.65, c.y)), normalize(uSunDir)), 0.0), 16.0);
        col += vec3(1.0, 0.96, 0.8) * sun * 1.05 * win;
        float a = win * 0.3 + hot * 0.2;
        gl_FragColor = vec4(col * a * 2.2, a);
      }
    `,
  });
}

export function createVolumeDomeMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: true,
    transparent: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uFogColor;
      uniform vec3 uSunDir;
      uniform float uTime;
      uniform float uBiomeMix;
      uniform float uSurfaceY;
      uniform float uAboveWorld;
      varying vec3 vDir;

      void main() {
        vec3 d = normalize(vDir);
        float up = d.y;
        float k = uBiomeMix;
        vec3 deep = uFogColor * mix(vec3(0.55, 0.72, 0.76), vec3(0.58, 0.76, 0.4), k);
        vec3 mid = uFogColor * mix(vec3(0.95, 1.0, 1.0), vec3(0.84, 1.0, 0.5), k);
        vec3 highShallow = mix(uFogColor, vec3(0.62, 0.88, 0.9), 0.45) * 1.28;
        vec3 highKelp = uFogColor * vec3(0.78, 0.96, 0.38);
        vec3 high = mix(highShallow, highKelp, k);
        vec3 col = mix(deep, mid, smoothstep(-0.6, 0.08, up));
        col = mix(col, high, smoothstep(0.08, 0.78, up) * (1.0 - k * 0.62));
        float sun = pow(max(dot(d, normalize(uSunDir)), 0.0), 14.0);
        float sunHot = pow(max(dot(d, normalize(uSunDir)), 0.0), 80.0);
        col += vec3(0.94, 0.98, 0.9) * sun * 0.36 * smoothstep(0.02, 0.7, up) * (1.0 - k * 0.78);
        col += vec3(1.0, 0.96, 0.82) * sunHot * 0.55 * (1.0 - k * 0.85);
        float dist = length(vDir);
        float far = smoothstep(220.0, 500.0, dist);
        col = mix(col, uFogColor * 0.82, far * 0.62);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

export function createSkyDomeMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vDir = wp.xyz - cameraPosition;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      ${SKY_GLSL}
      varying vec3 vDir;
      void main() {
        gl_FragColor = vec4(alienSky(normalize(vDir)), 1.0);
      }
    `,
  });
}

export function createKelpMaterial(shared, color, emissive = 0x000000, emit = 0, role = "stalk") {
  const mat = new THREE.MeshStandardMaterial({
    color,
    roughness: role === "leaf" ? 0.72 : 0.84,
    metalness: 0.0,
    emissive,
    emissiveIntensity: emit,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const glow = emit > 0;
  const leaf = role === "leaf";
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        `#include <common>
         uniform float uTime;
         varying vec3 vWorldPosition;
         varying vec3 vWorldNormal;`,
      )
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
         vec4 iwp = instanceMatrix * vec4(transformed, 1.0);
         float hy = iwp.y;
         float h = max(hy + 64.0, 0.0);
         float sway = sin(uTime * 0.36 + hy * 0.09 + instanceMatrix[3].x * 0.17 + instanceMatrix[3].z * 0.13);
         float sway2 = cos(uTime * 0.25 + instanceMatrix[3].z * 0.2 + hy * 0.06);
         transformed.x += sway * h * 0.007;
         transformed.z += sway2 * h * 0.0045;`,
      )
      .replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
         vec4 wp = instanceMatrix * vec4(transformed, 1.0);
         wp = modelMatrix * wp;
         vWorldPosition = wp.xyz;
         vWorldNormal = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
         ${GLSL_COMMON}`,
      )
      .replace("#include <fog_fragment>", "")
      .replace(
        "#include <dithering_fragment>",
        glow
          ? `#include <dithering_fragment>
         vec3 Ns = normalize(vWorldNormal);
         vec3 Vs = normalize(cameraPosition - vWorldPosition);
         float ndv = max(dot(Ns, Vs), 0.0);
         float wrap = clamp(dot(Ns, normalize(uSunDir)) * 0.2 + 0.78, 0.52, 1.12);
         float sss = pow(clamp(1.0 - ndv, 0.0, 1.0), 1.4);
         float core = pow(ndv, 0.95);
         // Keep grape orbs: hot amber face, darker contact, no white blowout.
         gl_FragColor.rgb *= wrap * 0.92;
         gl_FragColor.rgb = mix(gl_FragColor.rgb * vec3(0.52, 0.14, 0.02), gl_FragColor.rgb * vec3(1.12, 0.46, 0.06), 0.3 + core * 0.7);
         gl_FragColor.rgb += vec3(1.62, 0.48, 0.04) * (0.4 + sss * 0.52 + core * 0.5);
         float dist = length(vWorldPosition - cameraPosition);
         vec3 beer = exp(-uAbsorb * dist * 0.055);
         gl_FragColor.rgb *= beer;
         float haze = exp(-uFogDensity * dist * 0.14);
         gl_FragColor.rgb = mix(uFogColor * vec3(2.15, 0.72, 0.07), gl_FragColor.rgb, haze);
         gl_FragColor.a = 1.0;
        `
          : leaf
            ? `#include <dithering_fragment>
         vec3 Nk = normalize(vWorldNormal);
         vec3 Vk = normalize(cameraPosition - vWorldPosition);
         float wrap = clamp(dot(Nk, normalize(uSunDir)) * 0.06 + 0.78, 0.66, 0.96);
         float ndv = max(abs(dot(Nk, Vk)), 0.0);
         float rim = pow(clamp(1.0 - ndv, 0.0, 1.0), 2.8);
         float sss = pow(clamp(1.0 - ndv, 0.0, 1.0), 1.35);
         float gold = max(vColor.r - vColor.g * 1.25, 0.0);
         float warmIn = max(gl_FragColor.r - gl_FragColor.g * 0.72, 0.0);
         float lum = dot(gl_FragColor.rgb, vec3(0.3, 0.54, 0.16));
         gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(lum * 1.02), 0.12);
         gl_FragColor.rgb *= wrap * vec3(0.3, 0.56, 0.11);
         gl_FragColor.rgb += sss * vec3(0.06, 0.09, 0.016);
         gl_FragColor.rgb += rim * vec3(0.016, 0.026, 0.005);
         float fiber = n2(vWorldPosition.xy * 2.2 + vWorldPosition.z * 1.6);
         gl_FragColor.rgb *= 0.92 + fiber * 0.05;
         float dist = length(vWorldPosition - cameraPosition);
         vec3 beer = exp(-uAbsorb * dist * 0.72);
         gl_FragColor.rgb *= beer;
         gl_FragColor.rgb += vec3(1.5, 0.95, 0.1) * gold * 1.85;
         gl_FragColor.rgb += vec3(0.7, 0.3, 0.04) * warmIn * 0.22;
         float haze = exp(-uFogDensity * dist);
         gl_FragColor.rgb = mix(uFogColor, gl_FragColor.rgb, haze);
         gl_FragColor.a = 1.0;
        `
            : `#include <dithering_fragment>
         vec3 Nk = normalize(vWorldNormal);
         vec3 Vk = normalize(cameraPosition - vWorldPosition);
         float wrap = clamp(dot(Nk, normalize(uSunDir)) * 0.42 + 0.36, 0.14, 1.02);
         float rim = pow(clamp(1.0 - max(dot(Nk, Vk), 0.0), 0.0, 1.0), 1.7);
         float warmIn = max(gl_FragColor.r - gl_FragColor.g * 0.7, 0.0);
         gl_FragColor.rgb *= wrap * 0.9;
         gl_FragColor.rgb += rim * vec3(0.04, 0.09, 0.022);
         float fiber = n2(vWorldPosition.xy * 6.2 + vWorldPosition.z * 5.1);
         float grain = n2(vWorldPosition.xz * 14.0 + vWorldPosition.y * 9.2 + 3.1);
         float stripe = 0.5 + 0.5 * sin(vWorldPosition.y * (6.4 + fiber * 5.5) + fiber * 7.0 + vWorldPosition.x * 3.2);
         gl_FragColor.rgb *= 0.72 + fiber * 0.18 + grain * 0.1;
         gl_FragColor.rgb *= mix(0.86, 1.03, stripe);
         gl_FragColor.rgb *= vec3(0.46, 0.56, 0.26);
         float dist = length(vWorldPosition - cameraPosition);
         vec3 beer = exp(-uAbsorb * dist);
         gl_FragColor.rgb *= beer;
         gl_FragColor.rgb += vec3(0.95, 0.36, 0.04) * warmIn * 0.72;
         float haze = exp(-uFogDensity * dist);
         gl_FragColor.rgb = mix(uFogColor, gl_FragColor.rgb, haze);
         gl_FragColor.a = 1.0;
        `,
      );
  };
  mat.customProgramCacheKey = () => (glow ? "kelp-seed-glow-14" : leaf ? "kelp-leaf-26" : "kelp-wave-12");
  return mat;
}

export function createMoteMaterial(shared, size = 10) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uSize: { value: size } },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uSize;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 0.35);
        gl_PointSize = uSize * (42.0 / dist);
      }
    `,
    fragmentShader: /* glsl */ `
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float core = pow(max(1.0 - r, 0.0), 3.2);
        float halo = pow(max(1.0 - r, 0.0), 1.6);
        vec3 col = vec3(0.82, 0.96, 0.94) * core + vec3(0.5, 0.78, 0.76) * halo * 0.28;
        float a = core * 0.42 + halo * 0.06;
        gl_FragColor = vec4(col * a * 1.15, a);
      }
    `,
  });
}

export function createBubbleMaterial(shared, size = 14) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared, uSize: { value: size } },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uSize;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        float dist = max(-mv.z, 0.35);
        gl_PointSize = uSize * (36.0 / dist);
      }
    `,
    fragmentShader: /* glsl */ `
      void main() {
        vec2 p = gl_PointCoord * 2.0 - 1.0;
        float r = length(p);
        if (r > 1.0) discard;
        float rim = smoothstep(0.52, 0.82, r) * smoothstep(1.0, 0.86, r);
        float fill = pow(max(1.0 - r, 0.0), 2.4) * 0.16;
        float spec = pow(max(1.0 - length(p - vec2(-0.28, -0.32)), 0.0), 6.0);
        vec3 col = vec3(0.78, 0.96, 0.98) * (rim + fill) + vec3(1.0) * spec * 0.55;
        float a = rim * 0.48 + fill * 0.28 + spec * 0.18;
        gl_FragColor = vec4(col * a * 1.35, a);
      }
    `,
  });
}

export function createVolumeShaftMaterial(shared) {
  return new THREE.ShaderMaterial({
    uniforms: { ...shared },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPosition;
      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPosition = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      ${GLSL_COMMON}
      varying vec2 vUv;

      void main() {
        float around = abs(vUv.x - 0.5) * 2.0;
        float along = vUv.y;
        float n = n2(vec2(vUv.x * 5.5, along * 0.7 + uTime * 0.045));
        float n2f = n2(vec2(vUv.x * 11.0 + 2.1, along * 1.4 - uTime * 0.03));
        float shaft = pow(max(1.0 - around, 0.0), 1.8) * pow(along, 0.28) * smoothstep(1.05, 0.62, along);
        shaft *= 0.5 + 0.5 * n;
        shaft *= 0.7 + 0.3 * n2f;
        float dist = length(vWorldPosition - cameraPosition);
        float a = shaft * 0.1 * exp(-dist * 0.0075);
        a *= 1.0 - uBiomeMix * 0.7;
        vec3 col = mix(vec3(0.7, 0.92, 0.9), vec3(0.96, 0.98, 0.88), along);
        gl_FragColor = vec4(col * a * 1.8, a);
      }
    `,
  });
}

export const UNDERWATER_GRADE = {
  name: "UnderwaterGrade",
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uRes: { value: new THREE.Vector2(1, 1) },
    uLookUp: { value: 0 },
    uBiome: { value: 0 },
    uDepth: { value: 8 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform vec2 uRes;
    uniform float uLookUp;
    uniform float uBiome;
    uniform float uDepth;
    varying vec2 vUv;

    void main() {
      vec2 uv = vUv;
      vec2 dir = uv - 0.5;
      float ca = 0.0012 + uLookUp * 0.001;
      float r = texture2D(tDiffuse, uv + dir * ca).r;
      float g = texture2D(tDiffuse, uv).g;
      float b = texture2D(tDiffuse, uv - dir * ca * 0.85).b;
      vec3 col = vec3(r, g, b);

      float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = mix(vec3(0.88, 1.03, 1.08), vec3(0.84, 1.05, 0.78), uBiome);
      vec3 highTint = mix(vec3(1.04, 1.01, 0.96), vec3(1.0, 1.04, 0.82), uBiome);
      col *= mix(shadowTint, highTint, smoothstep(0.16, 0.74, lum));

      col = max(col, vec3(0.0));
      col = pow(col, vec3(0.97));
      col *= 1.02;

      float depthLift = smoothstep(22.0, 4.0, uDepth);
      col += vec3(0.02, 0.045, 0.05) * depthLift * uLookUp * 0.35;

      float vig = 1.0 - dot(dir, dir) * mix(0.42, 0.62, smoothstep(6.0, 28.0, uDepth));
      col *= mix(0.82, 1.0, clamp(vig, 0.0, 1.0));

      float n = fract(sin(dot(uv * uRes + floor(uTime * 24.0), vec2(12.9898, 78.233))) * 43758.5453);
      col += (n - 0.5) * 0.016;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
