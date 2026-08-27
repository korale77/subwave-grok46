import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { SMAAPass } from "three/examples/jsm/postprocessing/SMAAPass.js";
import { SHALLOWS_FOG, SHOTS, SUN_DIR, SURFACE_Y } from "./config.js";
import { BIOMES, biomeWeights, blendFogColor, dominantBiome } from "./biomes.js";
import { createUniformState, UNDERWATER_GRADE } from "./shaders.js";
import { createAtmosphere, createLights } from "./atmosphere.js";
import { createWorld } from "./world.js";
import { createPlayer } from "./player.js";
import { createHud } from "./hud.js";
import { loadShallowsPhotos } from "./textures.js";
import { nearestBaseEntry, SEABASE_ENTRY, SEABASE_INSIDE } from "./seabase.js";
import { createDemo } from "./demo.js";

const params = new URLSearchParams(location.search);
const shot = params.get("shot");
const hideHud = params.get("hideHud") === "1" || (shot && SHOTS[shot]?.hideHud);

const canvas = document.getElementById("c");
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: !shot,
  preserveDrawingBuffer: !!shot,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, shot ? 2 : 1.35));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(SHALLOWS_FOG, 1);

const scene = new THREE.Scene();
scene.background = new THREE.Color(SHALLOWS_FOG);
scene.fog = new THREE.FogExp2(SHALLOWS_FOG, 0.0064);

const camera = new THREE.PerspectiveCamera(shot ? 72 : 66, window.innerWidth / window.innerHeight, 0.12, 420);
camera.position.set(7.6, -19.05, 16.6);

const drawing = renderer.getDrawingBufferSize(new THREE.Vector2());
const composerRT = new THREE.WebGLRenderTarget(drawing.x, drawing.y, {
  type: THREE.HalfFloatType,
  format: THREE.RGBAFormat,
});
composerRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
const composer = new EffectComposer(renderer, composerRT);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new OutputPass());
const gradePass = new ShaderPass(UNDERWATER_GRADE);
composer.addPass(gradePass);
if (shot) composer.addPass(new SMAAPass(drawing.x, drawing.y));

const shared = createUniformState();
shared.uSunDir.value.set(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]).normalize();

const lights = createLights(scene);
const atmosphere = createAtmosphere(scene, shared);
let world = null;
let player = null;
let demo = null;
const hud = createHud();

if (hideHud) document.body.classList.add("hide-hud");
if (shot) document.body.classList.add("capture");

const lookDir = new THREE.Vector3();
const fogColor = new THREE.Color();
const hemiCol = new THREE.Color();
const hemiGround = new THREE.Color();
const absorbMix = new THREE.Vector3();
const tmpCol = new THREE.Color();

let frames = 0;
let readyAt = 0;
const clock = new THREE.Clock();
let hiddenTimer = 0;
let lastTickAt = 0;

function applyBiome(pos) {
  const w = biomeWeights(pos.x, pos.y, pos.z);
  blendFogColor(w, fogColor);
  scene.fog.color.copy(fogColor);
  scene.background.copy(fogColor);
  renderer.setClearColor(fogColor, 1);

  absorbMix.set(0, 0, 0);
  hemiCol.setRGB(0, 0, 0);
  hemiGround.setRGB(0, 0, 0);
  let density = 0;
  let caustic = 0;
  let sun = 0;
  let hemiI = 0;
  let exposure = 0;
  for (const b of BIOMES) {
    const k = w[b.id] || 0;
    if (k < 0.004) continue;
    absorbMix.x += b.absorb[0] * k;
    absorbMix.y += b.absorb[1] * k;
    absorbMix.z += b.absorb[2] * k;
    tmpCol.setHex(b.hemi, THREE.SRGBColorSpace);
    hemiCol.r += tmpCol.r * k;
    hemiCol.g += tmpCol.g * k;
    hemiCol.b += tmpCol.b * k;
    tmpCol.setHex(b.hemiGround, THREE.SRGBColorSpace);
    hemiGround.r += tmpCol.r * k;
    hemiGround.g += tmpCol.g * k;
    hemiGround.b += tmpCol.b * k;
    density += b.fogDensity * k;
    caustic += b.caustic * k;
    sun += b.sun * k;
    hemiI += b.hemiInt * k;
    exposure += b.exposure * k;
  }

  const above = pos.y > SURFACE_Y - 0.25;
  if (player && player.insideBase) {
    density *= 0.38;
  }
  if (above) {
    density *= 0.18;
    fogColor.lerp(new THREE.Color(0xc48a58), 0.28);
    scene.background.setRGB(0.18, 0.16, 0.28);
    renderer.setClearColor(scene.background, 1);
    sun = Math.max(sun, 2.55);
    exposure = Math.max(exposure, 1.2);
    hemiI = Math.max(hemiI, 0.62);
  }
  if (shared.uAboveWorld) shared.uAboveWorld.value = above ? 1 : 0;
  scene.fog.density = density;
  shared.uFogColor.value.copy(fogColor);
  shared.uAbsorb.value.copy(absorbMix);
  shared.uFogDensity.value = density;
  shared.uBiomeMix.value = (w.kelp || 0) + (w.grassy || 0) * 0.65;
  shared.uCausticGain.value = caustic;
  lights.hemi.color.copy(hemiCol);
  lights.hemi.groundColor.copy(hemiGround);
  lights.hemi.intensity = hemiI;
  lights.sun.intensity = sun;
  lights.fill.intensity = 0.28 - (w.kelp || 0) * 0.14 - (w.jelly || 0) * 0.18;
  lights.kelpFill.intensity = 1.2 + (w.kelp || 0) * 1.35;
  lights.heroWarm.intensity = 1.85 - (w.kelp || 0) * 1.0 - (w.reef || 0) * 0.6;
  lights.diveFill.intensity = 0.78 - (w.kelp || 0) * 0.22 + (w.jelly || 0) * 0.45;
  renderer.toneMappingExposure = exposure;
  gradePass.uniforms.uBiome.value = (w.kelp || 0) + (w.grassy || 0) * 0.5;
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  composer.setSize(w, h);
  const d = renderer.getDrawingBufferSize(new THREE.Vector2());
  gradePass.uniforms.uRes.value.set(d.x, d.y);
}
window.addEventListener("resize", onResize);

let tourIndex = 0;
function warpToBiome(i) {
  if (!player || shot || (demo && demo.isActive())) return;
  tourIndex = ((i % BIOMES.length) + BIOMES.length) % BIOMES.length;
  const b = BIOMES[tourIndex];
  player.warpTo(b.shot.position, b.shot.target);
  hud.announce(`${tourIndex + 1} / ${BIOMES.length}  ${b.name}`);
}

let pendingShot = false;

function stampName() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `subwave-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
}

let savePicker = null;

function resumeAfterSave() {
  if (demo && demo.isPaused()) demo.resume();
}

function waitForSaveDialog() {
  window.setTimeout(() => {
    if (document.hasFocus()) resumeAfterSave();
    else {
      const onFocus = () => {
        window.removeEventListener("focus", onFocus);
        resumeAfterSave();
      };
      window.addEventListener("focus", onFocus);
    }
  }, 180);
}

function saveScreenshot() {
  const canvasEl = renderer.domElement;
  canvasEl.toBlob(async (blob) => {
    if (!blob) {
      hud.announce("Screenshot failed");
      resumeAfterSave();
      return;
    }
    try {
      if (savePicker) {
        const handle = await savePicker;
        savePicker = null;
        if (!handle) {
          hud.announce("Screenshot cancelled");
          resumeAfterSave();
          return;
        }
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        hud.announce("Screenshot saved");
        resumeAfterSave();
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = stampName();
      a.click();
      URL.revokeObjectURL(url);
      hud.announce("Screenshot saved");
      waitForSaveDialog();
    } catch (err) {
      savePicker = null;
      hud.announce("Screenshot cancelled");
      resumeAfterSave();
    }
  }, "image/png");
}

function isDemoHotkey(e) {
  return e.code === "KeyG" || e.code === "F9";
}

window.addEventListener("keydown", (e) => {
  if (shot || !player) return;
  if (e.repeat) return;
  if (demo && demo.isActive()) {
    if (e.code === "Escape" || isDemoHotkey(e)) {
      e.preventDefault();
      e.stopPropagation();
      demo.stop();
      if (!document.hidden && document.hasFocus()) clearHiddenBackup();
      return;
    }
    if (e.code === "F8" || e.code === "KeyP") {
      e.preventDefault();
      demo.pause();
      pendingShot = true;
      if (window.showSaveFilePicker) {
        savePicker = window
          .showSaveFilePicker({
            suggestedName: stampName(),
            types: [{ description: "PNG image", accept: { "image/png": [".png"] } }],
          })
          .catch(() => null);
      }
      return;
    }
    if (["Space", "Tab", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) e.preventDefault();
    return;
  }
  if (isDemoHotkey(e) && demo) {
    e.preventDefault();
    demo.start({ record: e.code === "KeyG" && e.shiftKey });
    keepDemoAlive();
    return;
  }
  if (e.code === "F8" || e.code === "KeyP") {
    e.preventDefault();
    pendingShot = true;
    return;
  }
  if (e.code === "KeyN") {
    e.preventDefault();
    player.warpTo(SEABASE_ENTRY.position, SEABASE_ENTRY.target);
    hud.announce("Seabase moonpool");
    return;
  }
  if (e.code === "KeyE") {
    e.preventDefault();
    const p = camera.position;
    const near = nearestBaseEntry(p.x, p.y, p.z);
    if (near) {
      player.warpTo(SEABASE_INSIDE.position, SEABASE_INSIDE.target);
      hud.announce("Entered seabase");
    }
    return;
  }
  if (e.code === "BracketRight" || e.code === "KeyB") {
    e.preventDefault();
    warpToBiome(tourIndex + 1);
  } else if (e.code === "BracketLeft") {
    e.preventDefault();
    warpToBiome(tourIndex - 1);
  } else if (e.code.startsWith("Digit")) {
    const n = Number(e.code.slice(5));
    if (n >= 1 && n <= BIOMES.length) {
      e.preventDefault();
      warpToBiome(n - 1);
    }
  }
});

function tick() {
  if (!world || !player) {
    requestAnimationFrame(tick);
    return;
  }
  const now = performance.now();
  if (now - lastTickAt < 8) {
    if (!document.hidden) requestAnimationFrame(tick);
    return;
  }
  lastTickAt = now;
  const demoOn = !!(demo && demo.isActive());
  const dtCap = demoOn && document.hidden ? 0.25 : 0.05;
  const dt = Math.min(clock.getDelta(), dtCap);
  const t = clock.elapsedTime;
  shared.uTime.value = t;

  if (demoOn) demo.update();
  player.update(dt);
  world.update(t, camera);
  atmosphere.update(dt, camera, renderer, scene, player);
  applyBiome(camera.position);
  if (!hideHud) hud.update(player);

  lights.sun.position.set(camera.position.x - 58, 88, camera.position.z + 44);
  lights.sun.target.position.set(camera.position.x * 0.35, camera.position.y - 4, camera.position.z * 0.35 - 8);
  lights.heroWarm.position.set(camera.position.x + 1.2, camera.position.y + 2.4, camera.position.z - 3.5);
  lights.diveFill.position.set(camera.position.x + 0.4, camera.position.y + 0.15, camera.position.z + 0.2);
  const wantShadow = camera.position.y > -48;
  if (lights.sun.castShadow !== wantShadow) lights.sun.castShadow = wantShadow;
  const kx = camera.position.x - 186;
  const kz = camera.position.z;
  lights.kelpFill.visible = kx * kx + kz * kz < 120 * 120;

  const lookY = camera.getWorldDirection(lookDir).y;
  gradePass.uniforms.uTime.value = t;
  gradePass.uniforms.uLookUp.value = THREE.MathUtils.clamp(lookY * 0.5 + 0.35, 0, 1);
  gradePass.uniforms.uDepth.value = Math.max(0, -camera.position.y);

  composer.render();
  if (demoOn) demo.pumpRecord();
  if (pendingShot) {
    pendingShot = false;
    saveScreenshot();
  }
  frames++;
  if (frames === 8) {
    readyAt = performance.now();
    window.__SUBWAVE_READY = true;
    window.__SUBWAVE_INFO = {
      frames,
      shot: shot || "live",
      pos: camera.position.toArray(),
      biome: dominantBiome(camera.position.x, camera.position.y, camera.position.z).biome.id,
    };
  }
  if (!document.hidden) requestAnimationFrame(tick);
}

function armHiddenBackup() {
  if (hiddenTimer) return;
  hiddenTimer = window.setInterval(() => {
    if (demo && demo.isActive()) tick();
  }, 50);
}

function keepDemoAlive() {
  if (demo && demo.isActive() && (document.hidden || !document.hasFocus())) {
    armHiddenBackup();
  }
}

function clearHiddenBackup() {
  if (!hiddenTimer) return;
  window.clearInterval(hiddenTimer);
  hiddenTimer = 0;
}

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    keepDemoAlive();
    return;
  }
  if (document.hasFocus()) clearHiddenBackup();
  clock.getDelta();
  requestAnimationFrame(tick);
});

window.addEventListener("blur", () => {
  keepDemoAlive();
});

window.addEventListener("focus", () => {
  if (!document.hidden) clearHiddenBackup();
});

window.__SUBWAVE_READY = false;

async function boot() {
  let photos = {};
  try {
    photos = await loadShallowsPhotos();
  } catch (err) {
    console.warn("shallows photo maps failed, using procedural stone", err);
  }
  world = createWorld(scene, shared, photos);
  player = createPlayer(camera, canvas, world.heightAt);
  demo = createDemo({ camera, player, hud, scene, canvas });
  window.__SUBWAVE_DEMO = demo;
  if (atmosphere.envMap) {
    if (world.grottoMesh) {
      world.grottoMesh.material.envMap = atmosphere.envMap;
      world.grottoMesh.material.envMapIntensity = 0.2;
      world.grottoMesh.material.needsUpdate = true;
    }
    if (world.sand) {
      world.sand.material.envMap = atmosphere.envMap;
      world.sand.material.envMapIntensity = 0.18;
      world.sand.material.needsUpdate = true;
    }
    if (world.seabase && world.seabase.userData.setEnvMap) {
      world.seabase.userData.setEnvMap(atmosphere.envMap);
    }
  }
  onResize();
  if (shot && SHOTS[shot]) {
    const s = SHOTS[shot];
    player.setCapturePose(s.position, s.target);
  } else {
    camera.position.set(8.0, -7.6, 16.4);
    camera.lookAt(1.8, -13.6, -2.4);
    player.syncFromCamera();
  }
  clock.getDelta();
  tick();
  if (!shot && (params.get("demo") === "1" || params.get("demo") === "true")) {
    demo.start();
    keepDemoAlive();
  }
}

boot();

export { scene, camera, renderer, readyAt };
