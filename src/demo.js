import * as THREE from "three";
import { FLOOR_Y, ROOM_R, SEABASE } from "./seabase.js";
import { terrainHeight } from "./terrain.js";
import { jellySwimFloor } from "./regions/jelly.js";
import { createDemoRecorder } from "./demo-record.js";

const BX = SEABASE.x;
const BZ = SEABASE.z;
const EYE_Y = FLOOR_Y + 1.55;
const HATCH_Y = FLOOR_Y + 0.62;
const HATCH_Z = BZ + ROOM_R;
const DOME_X = BX + ROOM_R + 8.15 + 7.44 - 0.12;

const FADE_COLOR = "#02060c";
const CREDIT_HOLD = 10;
const CREDIT_FADE = 1;

// Ease only the first/last `pad` of a beat; cruise the rest at constant speed.
const EASE_PAD = 0.1;
const LOOK_LEAD = 0.05;

function easeCruise(t, pad = EASE_PAD) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  const e = THREE.MathUtils.clamp(pad, 1e-4, 0.49);
  const v = 1 / (1 - e);
  if (x < e) return (v / (2 * e)) * x * x;
  if (x > 1 - e) {
    const d = 1 - x;
    return 1 - (v / (2 * e)) * d * d;
  }
  return (e * v) / 2 + v * (x - e);
}

function v3(a) {
  return new THREE.Vector3(a[0], a[1], a[2]);
}

function compile(beats) {
  for (const b of beats) {
    b.keys = b.path.map((k, i, arr) => ({
      t: k.t != null ? k.t : arr.length < 2 ? 0 : i / (arr.length - 1),
      pos: v3(k.pos),
      look: v3(k.look),
      fov: k.fov ?? b.fov ?? 68,
    }));
    if (b.keys.length > 1) {
      // Centripetal spline: heading and look change together through corners.
      b.posCurve = new THREE.CatmullRomCurve3(
        b.keys.map((k) => k.pos),
        false,
        "centripetal",
        0.5
      );
      b.lookCurve = new THREE.CatmullRomCurve3(
        b.keys.map((k) => k.look),
        false,
        "centripetal",
        0.5
      );
    }
    if (!b.fadeIn) b.fadeIn = b.cut ? 0.85 : 0;
    if (b.fadeOut == null) b.fadeOut = b.cut ? 0.7 : 0;
  }
  return beats;
}

// Narrative: light and life → a home in the water → the surface →
// each biome's identity → the deep cave → the reef, then the hunter.
const BEATS = compile([
  {
    id: "shallows-arrive",
    title: "Shallows",
    kicker: "0 1",
    sub: "Where the light still reaches",
    duration: 14,
    cut: true,
    fadeIn: 0.7,
    fadeOut: 0.4,
    path: [
      { pos: [18, -9.2, 34], look: [0.4, -13.4, -6.6], fov: 68 },
      { pos: [12, -13.2, 24], look: [0.4, -13.5, -6.8], fov: 70 },
      { pos: [8.2, -15.4, 16.5], look: [0.3, -13.4, -7.2], fov: 70 },
      { pos: [6.4, -13.8, 10.4], look: [0.5, -13.6, -7.6], fov: 66 },
      { pos: [5.6, -13.6, 8.2], look: [0.8, -13.6, -7.2], fov: 64 },
    ],
  },
  {
    id: "seabase",
    title: "Habitat Omega",
    kicker: "outpost",
    sub: "A glass lung on the sand",
    duration: 16,
    cut: true,
    fadeOut: 0.7,
    path: [
      { pos: [78, -8.4, 28], look: [58, -16.2, 2.2], fov: 68 },
      { pos: [58, -13.4, 16.5], look: [47, -16.9, 6.4], fov: 66 },
      { pos: [49.2, -16.2, 10.4], look: [46.1, HATCH_Y, HATCH_Z], fov: 64 },
      { pos: [46.08, HATCH_Y + 0.04, HATCH_Z + 1.85], look: [46.0, HATCH_Y, HATCH_Z - 1.6], fov: 62 },
      { pos: [46.04, HATCH_Y, HATCH_Z + 0.22], look: [46.4, EYE_Y, BZ], fov: 62 },
      { pos: [46.2, EYE_Y, 3.55], look: [56.5, EYE_Y, 2.05], fov: 64 },
      { pos: [54.1, EYE_Y + 0.02, BZ + 0.06], look: [DOME_X, EYE_Y, BZ], fov: 66 },
      { pos: [61.4, FLOOR_Y + 2.42, BZ + 0.12], look: [78, FLOOR_Y + 1.6, 8], fov: 68 },
      { pos: [61.8, FLOOR_Y + 2.5, BZ + 0.4], look: [84, FLOOR_Y + 2.1, 14], fov: 66 },
    ],
  },
  {
    id: "surface-break",
    title: "The Surface",
    kicker: "0 0",
    sub: "Leave the water. Keep the sky.",
    duration: 14,
    cut: true,
    path: [
      { t: 0, pos: [6.2, -5.4, 15.2], look: [5.4, 3.2, 1.6], fov: 70 },
      { t: 0.2, pos: [5.6, 1.15, 12.4], look: [2.0, 8.4, -18], fov: 72 },
      { t: 0.38, pos: [-20, 2.6, -24], look: [-70, 14, -90], fov: 68 },
      { t: 0.58, pos: [-48, 3.05, -58], look: [-102, 18, -132], fov: 66 },
      { t: 1, pos: [-52, 3.2, -64], look: [-104, 18, -134], fov: 64 },
    ],
  },
  {
    id: "amber",
    title: "Amber Flats",
    kicker: "south",
    sub: "A living carpet. Nowhere to hide.",
    duration: 11.2,
    cut: true,
    path: [
      { t: 0, pos: [74, -10.2, 148], look: [92, -16, 186], fov: 72 },
      { t: 0.45, pos: [78, -11.0, 152], look: [94, -16, 188], fov: 70 },
      { t: 0.68, pos: [77.2, -11.0, 153], look: [78, -16.5, 178], fov: 66 },
      { t: 1, pos: [76, -11.0, 154], look: [64, -17.0, 174], fov: 64 },
    ],
  },
  {
    id: "kelp",
    title: "Kelp Forest",
    kicker: "east",
    sub: "Green beer. Hanging gold.",
    duration: 12,
    cut: true,
    path: [
      { t: 0, pos: [154, -31.2, 26], look: [176, -31.0, 6], fov: 68 },
      { t: 0.28, pos: [166, -31.3, 16], look: [188, -30.6, -2], fov: 68 },
      { t: 0.55, pos: [178, -31.0, 6], look: [200, -26.0, -8], fov: 68 },
      { t: 0.78, pos: [188, -30.2, -2], look: [208, -20.0, -12], fov: 66 },
      { t: 1, pos: [196, -29.4, -8], look: [210, -20.0, -12], fov: 66 },
    ],
  },
  {
    id: "mushroom",
    title: "Mushroom Forest",
    kicker: "northeast",
    sub: "A cathedral of living caps",
    duration: 16,
    cut: true,
    path: [
      { pos: [198, -22, -148], look: [222, -16, -176], fov: 70 },
      { pos: [196, -22, -156], look: [214, -18, -174], fov: 68 },
      { pos: [194, -24, -164], look: [210, -26, -180], fov: 66 },
      { pos: [198, -30, -172], look: [216, -32, -190], fov: 66 },
      { pos: [204, -36, -180], look: [222, -34, -198], fov: 68 },
    ],
  },
  {
    id: "bulb",
    title: "Bulb Garden",
    kicker: "southwest",
    sub: "Glass beads in clear water",
    duration: 12,
    cut: true,
    path: [
      { pos: [-146, -16.4, 140], look: [-156, -28.5, 154], fov: 70 },
      { pos: [-152, -20, 148], look: [-160, -32, 158], fov: 66 },
      { pos: [-156, -25, 154], look: [-160.4, -33.2, 158.8], fov: 62 },
      { pos: [-158.4, -30.2, 157.2], look: [-160.6, -34.4, 159.0], fov: 56 },
    ],
  },
  {
    id: "crimson",
    title: "Crimson Meadows",
    kicker: "north",
    sub: "A red sea. Scale and hush.",
    duration: 14,
    cut: true,
    path: [
      { pos: [6, -32, -168], look: [10, -42, -214], fov: 72 },
      { pos: [24, -34, -174], look: [6, -48, -232], fov: 70 },
      { pos: [42, -35, -182], look: [8, -50, -248], fov: 70 },
      { pos: [54, -34, -190], look: [-10, -52, -260], fov: 68 },
    ],
  },
  {
    id: "jelly",
    title: "Glow Cave",
    kicker: "−180 m",
    sub: "No sun. Only the lamps.",
    duration: 15,
    cut: true,
    fadeIn: 1.05,
    path: [
      { pos: [18, -152, 108], look: [86, -176, 42], fov: 70 },
      { pos: [28, -156, 96], look: [92, -176, 40], fov: 68 },
      { pos: [38, -160, 86], look: [98, -176, 38], fov: 66 },
      { pos: [46, -162, 78], look: [104, -176, 40], fov: 64 },
    ],
  },
  {
    id: "reef",
    title: "Grand Reef",
    kicker: "west",
    sub: "The drop-off. It sees you.",
    duration: 22,
    cut: true,
    fadeIn: 0.9,
    fadeOut: 2.1,
    path: [
      { pos: [-156, -60, 16], look: [-200, -61, -32], fov: 70 },
      { pos: [-156, -60, 16], look: [-198, -60, -28], fov: 66 },
      { pos: [-155.5, -60, 16.4], look: [-190, -60, -16], fov: 56 },
      { pos: [-155.2, -60, 16.6], look: [-178, -60, -6], fov: 44 },
    ],
  },
]);

const TOTAL = BEATS.reduce((s, b) => s + b.duration, 0);

function keySegment(keys, t) {
  const x = THREE.MathUtils.clamp(t, 0, 1);
  const n = keys.length;
  let i = 0;
  while (i < n - 2 && keys[i + 1].t < x) i += 1;
  const a = keys[i];
  const b = keys[i + 1];
  const s = THREE.MathUtils.clamp((x - a.t) / Math.max(1e-5, b.t - a.t), 0, 1);
  return { i, s, u: (i + s) / (n - 1), a, b };
}

function sampleBeat(beat, u, pos, look) {
  const keys = beat.keys;
  if (keys.length === 1) {
    pos.copy(keys[0].pos);
    look.copy(keys[0].look);
    return keys[0].fov;
  }
  const at = keySegment(keys, u);
  if (beat.posCurve) beat.posCurve.getPoint(at.u, pos);
  else pos.lerpVectors(at.a.pos, at.b.pos, at.s);
  // Look slightly ahead so the camera yaws while still moving.
  const lookAt = keySegment(keys, u + LOOK_LEAD);
  if (beat.lookCurve) beat.lookCurve.getPoint(lookAt.u, look);
  else look.lerpVectors(lookAt.a.look, lookAt.b.look, lookAt.s);
  return THREE.MathUtils.lerp(at.a.fov, at.b.fov, at.s);
}

function ensureOverlay() {
  let fade = document.getElementById("demo-fade");
  if (!fade) {
    fade = document.createElement("div");
    fade.id = "demo-fade";
    fade.setAttribute("aria-hidden", "true");
    document.body.appendChild(fade);
  }
  let title = document.getElementById("demo-title");
  if (!title) {
    title = document.createElement("div");
    title.id = "demo-title";
    title.setAttribute("aria-live", "polite");
    title.innerHTML = '<div id="demo-kicker"></div><div id="demo-name"></div><div id="demo-sub"></div>';
    document.body.appendChild(title);
  }
  let badge = document.getElementById("demo-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "demo-badge";
    badge.textContent = "DEMO  ·  G or ESC to exit";
    document.body.appendChild(badge);
  }
  let credit = document.getElementById("demo-credit");
  if (!credit) {
    credit = document.createElement("div");
    credit.id = "demo-credit";
    credit.setAttribute("aria-hidden", "true");
    credit.textContent = "Grok 4.6";
    document.body.appendChild(credit);
  }
  return {
    fade,
    title,
    kicker: document.getElementById("demo-kicker"),
    name: document.getElementById("demo-name"),
    sub: document.getElementById("demo-sub"),
    badge,
    credit,
  };
}

function smoothstep(a, b, x) {
  const t = THREE.MathUtils.clamp((x - a) / Math.max(1e-5, b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

export function createDemo({ camera, player, hud, scene, canvas }) {
  const ui = ensureOverlay();
  const recorder = createDemoRecorder(canvas || document.getElementById("c"), hud);
  const pos = new THREE.Vector3();
  const look = new THREE.Vector3();

  let active = false;
  let origin = 0;
  let hold = 0;
  let pauseAt = 0;
  let paused = false;
  let shownTitle = "";
  let shownBeat = "";
  let titleUntil = 0;
  let titleShownAt = 0;
  let titleHiddenAt = 0;
  let ending = false;
  let recording = false;

  function reaper() {
    return scene ? scene.getObjectByName("reaper-leviathan") : null;
  }

  function driveHunt(beat, local) {
    const r = reaper();
    if (!r || !r.userData.setHunt) return;
    if (beat.id !== "reef") {
      r.userData.setHunt(0, 0, -1);
      return;
    }
    const charge = smoothstep(7.4, 14.2, local);
    const bite = smoothstep(8.8, 13.6, local);
    r.userData.setHunt(charge, bite, local);
  }

  function setFade(a) {
    ui.fade.style.opacity = String(THREE.MathUtils.clamp(a, 0, 1));
  }

  function creditAlpha(elapsed) {
    if (elapsed <= CREDIT_HOLD) return 1;
    return 1 - smoothstep(CREDIT_HOLD, CREDIT_HOLD + CREDIT_FADE, elapsed);
  }

  function setCredit(a) {
    ui.credit.style.opacity = String(THREE.MathUtils.clamp(a, 0, 1));
  }

  function hideTitle() {
    if (ui.title.classList.contains("show")) titleHiddenAt = performance.now();
    ui.title.classList.remove("show");
    shownTitle = "";
  }

  function showTitle(beat, now) {
    if (!beat.title || shownTitle === beat.id) return;
    shownTitle = beat.id;
    ui.kicker.textContent = beat.kicker || "";
    ui.name.textContent = beat.title;
    ui.sub.textContent = beat.sub || "";
    ui.title.classList.add("show");
    titleShownAt = now;
    titleHiddenAt = 0;
    titleUntil = now + 2600;
  }

  function titleAlpha(now) {
    if (ui.title.classList.contains("show")) {
      return Math.min(1, Math.max(0, (now - titleShownAt) / 550));
    }
    if (titleHiddenAt) return Math.max(0, 1 - (now - titleHiddenAt) / 550);
    return 0;
  }

  function pushOverlay(now, fade, creditA) {
    const snap = hud && hud.snapshot ? hud.snapshot(player) : {};
    recorder.setOverlay({
      ...snap,
      fade,
      titleAlpha: titleAlpha(now),
      creditAlpha: creditA ?? 0,
      kicker: ui.kicker.textContent,
      name: ui.name.textContent,
      sub: ui.sub.textContent,
    });
  }

  function at(nowMs) {
    const elapsed = Math.max(0, (nowMs - origin) / 1000);
    const t = Math.min(elapsed, TOTAL - 1e-4);
    let acc = 0;
    for (let i = 0; i < BEATS.length; i++) {
      const b = BEATS[i];
      if (t < acc + b.duration) {
        return { beat: b, index: i, local: t - acc, loopT: t, elapsed };
      }
      acc += b.duration;
    }
    const last = BEATS[BEATS.length - 1];
    return { beat: last, index: BEATS.length - 1, local: last.duration, loopT: TOTAL, elapsed };
  }

  function apply(nowMs) {
    const elapsed = Math.max(0, (nowMs - origin) / 1000);
    if (elapsed >= TOTAL) {
      if (!ending) {
        ending = true;
        const r = reaper();
        if (r && r.userData.setHunt) r.userData.setHunt(1, 1);
        setFade(1);
        setCredit(0);
        pushOverlay(nowMs, 1, 0);
        stop();
      }
      return;
    }
    const { beat, local } = at(nowMs);
    const u = easeCruise(local / beat.duration);
    const fov = sampleBeat(beat, u, pos, look);

    const breathe = nowMs * 0.001;
    pos.x += Math.sin(breathe * 0.41) * 0.045;
    pos.y += Math.sin(breathe * 0.67) * 0.06;
    pos.z += Math.cos(breathe * 0.33) * 0.04;
    const cave = jellySwimFloor(pos.x, pos.y, pos.z);
    const floor = (cave != null ? cave : terrainHeight(pos.x, pos.z)) + 1.6;
    if (pos.y < floor) pos.y = floor;

    camera.position.copy(pos);
    camera.lookAt(look);
    camera.rotation.z += Math.sin(breathe * 0.29) * 0.007;
    if (Math.abs(camera.fov - fov) > 0.04) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    player.syncFromCamera();
    driveHunt(beat, local);

    let fade = 0;
    if (beat.fadeIn && local < beat.fadeIn) fade = Math.max(fade, 1 - local / beat.fadeIn);
    if (beat.fadeOut && local > beat.duration - beat.fadeOut) {
      fade = Math.max(fade, (local - (beat.duration - beat.fadeOut)) / beat.fadeOut);
    }
    setFade(fade);
    const creditA = creditAlpha(elapsed);
    setCredit(creditA);

    if (beat.id !== shownBeat) {
      shownBeat = beat.id;
      hideTitle();
    }
    if (beat.title && local < 3.2 && fade < 0.42 && shownTitle !== beat.id) {
      showTitle(beat, nowMs);
    } else if (fade > 0.62 || local > 3.2 || (shownTitle && nowMs > titleUntil)) {
      hideTitle();
    }
    pushOverlay(nowMs, fade, creditA);
  }

  function demoBadge() {
    return recording ? "DEMO  ·  recording" : "DEMO  ·  G or ESC to exit";
  }

  function pause() {
    if (!active || paused) return;
    paused = true;
    pauseAt = performance.now();
    if (recording) recorder.pause();
    ui.badge.textContent = "DEMO PAUSED  ·  screenshot";
  }

  function resume() {
    if (!paused) return;
    hold += performance.now() - pauseAt;
    paused = false;
    if (recording) recorder.resume();
    ui.badge.textContent = demoBadge();
  }

  function start(opts) {
    if (active) return;
    active = true;
    origin = performance.now();
    hold = 0;
    pauseAt = 0;
    paused = false;
    shownTitle = "";
    shownBeat = "";
    titleUntil = 0;
    titleShownAt = 0;
    titleHiddenAt = 0;
    ending = false;
    recording = !!(opts && opts.record);
    player.setGuided(true);
    document.body.classList.add("demo");
    document.body.style.cursor = "default";
    ui.fade.style.background = FADE_COLOR;
    setFade(1);
    apply(origin);
    if (recording) recording = !!recorder.start();
    ui.badge.textContent = demoBadge();
  }

  function stop() {
    if (!active) return;
    if (paused) resume();
    active = false;
    const r = reaper();
    if (r && r.userData.setHunt) r.userData.setHunt(0, 0);
    player.setGuided(false);
    document.body.classList.remove("demo");
    document.body.style.cursor = "";
    setFade(0);
    setCredit(0);
    hideTitle();
    if (Math.abs(camera.fov - 66) > 0.2) {
      camera.fov = 66;
      camera.updateProjectionMatrix();
    }
    if (recording) {
      recorder.stop(true);
      if (hud) hud.announce("Demo ended  ·  saving video");
    } else if (hud) {
      hud.announce("Demo ended");
    }
    recording = false;
  }

  function toggle() {
    if (active) stop();
    else start();
  }

  return {
    get active() {
      return active;
    },
    isActive() {
      return active;
    },
    start,
    stop,
    toggle,
    seek(seconds) {
      if (!active) start();
      shownTitle = "";
      shownBeat = "";
      hideTitle();
      origin = performance.now() - Math.max(0, seconds) * 1000;
      apply(performance.now());
    },
    duration: TOTAL,
    pause,
    resume,
    isPaused() {
      return paused;
    },
    pumpRecord() {
      recorder.pump();
    },
    update() {
      if (!active || paused) return;
      apply(performance.now() - hold);
    },
    info() {
      if (!active) return { active: false };
      const s = at(performance.now() - hold);
      return { active: true, beat: s.beat.id, title: s.beat.title || "", t: s.loopT, total: TOTAL, paused };
    },
    destFrame() {
      return recorder.destToDataURL();
    },
  };
}

export { BEATS, TOTAL as DEMO_DURATION };
