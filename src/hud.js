import { O2_MAX } from "./config.js";

const RING_R = 82;
const CIRC = 2 * Math.PI * RING_R;
const PX = 3.2;
const COMPASS_MID = 210;
const FONT = '"Segoe UI", ui-sans-serif, system-ui, sans-serif';

let helmetImg = null;
let helmetTried = false;
const pipImgs = { hp: null, food: null, h2o: null };

function svgToImage(el) {
  if (!el) return null;
  const clone = el.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  if (!clone.getAttribute("viewBox")) clone.setAttribute("viewBox", "0 0 24 24");
  const xml = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.onload = () => URL.revokeObjectURL(url);
  img.onerror = () => URL.revokeObjectURL(url);
  img.src = url;
  return img;
}

function loadHelmet() {
  if (helmetTried) return;
  helmetTried = true;
  const svg = document.querySelector("#helmet svg");
  helmetImg = svgToImage(svg);
  pipImgs.hp = svgToImage(document.querySelector(".pip-hp svg"));
  pipImgs.food = svgToImage(document.querySelector(".pip-food svg"));
  pipImgs.h2o = svgToImage(document.querySelector(".pip-h2o svg"));
}

export function snapshotHud(player) {
  const o2 = player.oxygen;
  return {
    heading: player.heading,
    depth: player.depth,
    o2,
    lowO2: o2 / O2_MAX < 0.28,
  };
}

function wrapHeading(deg, heading) {
  let d = deg - heading;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function paintPip(ctx, x, y, r, fill, empty, t, iconImg) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = empty;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * t, false);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.68, 0, Math.PI * 2);
  const core = ctx.createRadialGradient(x - r * 0.18, y - r * 0.22, r * 0.08, x, y, r * 0.68);
  core.addColorStop(0, "#243832");
  core.addColorStop(0.68, "#0a1412");
  core.addColorStop(1, "#040808");
  ctx.fillStyle = core;
  ctx.fill();
  const ir = r * 0.42;
  if (iconImg && iconImg.complete && iconImg.naturalWidth) {
    ctx.drawImage(iconImg, x - ir, y - ir, ir * 2, ir * 2);
  }
  ctx.restore();
}

export function paintHud(ctx, w, h, snap) {
  if (!snap) return;
  loadHelmet();
  ctx.save();

  const vig = ctx.createRadialGradient(w * 0.5, h * 0.48, w * 0.28, w * 0.5, h * 0.48, w * 0.72);
  vig.addColorStop(0, "rgba(0,0,0,0)");
  vig.addColorStop(0.62, "rgba(1,0,0,0)");
  vig.addColorStop(0.84, "rgba(1,0,0,0.14)");
  vig.addColorStop(1, "rgba(1,0,0,0.34)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);

  if (helmetImg && helmetImg.complete) ctx.drawImage(helmetImg, 0, 0, w, h);

  const heading = snap.heading || 0;
  const compassW = 420;
  const compassX = w * 0.5 - compassW * 0.5;
  const compassY = 10;
  ctx.save();
  ctx.beginPath();
  ctx.rect(compassX, compassY, compassW, 30);
  ctx.clip();
  ctx.fillStyle = "rgba(228,252,244,0.72)";
  ctx.font = `10px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let deg = 0; deg < 360; deg += 5) {
    const d = wrapHeading(deg, heading);
    const x = compassX + COMPASS_MID + d * PX;
    if (x < compassX - 20 || x > compassX + compassW + 20) continue;
    const cardinal = { 0: "N", 90: "E", 180: "S", 270: "W" }[deg];
    if (deg % 15 !== 0) {
      ctx.fillStyle = "rgba(230,255,248,0.38)";
      ctx.fillRect(x, compassY + 8, 1, 3);
    } else if (cardinal) {
      ctx.fillStyle = "#8ff5d4";
      ctx.fillRect(x, compassY + 6, 1, 8);
      ctx.fillStyle = "#f6fffc";
      ctx.font = `650 12px ${FONT}`;
      ctx.fillText(cardinal, x, compassY + 16);
      ctx.font = `10px ${FONT}`;
    } else {
      ctx.fillStyle = "rgba(230,255,248,0.68)";
      ctx.fillRect(x, compassY + 8, 1, 6);
      ctx.fillStyle = "rgba(228,252,244,0.72)";
      ctx.fillText(String(deg), x, compassY + 16);
    }
  }
  ctx.restore();
  ctx.beginPath();
  ctx.moveTo(w * 0.5, compassY + 1);
  ctx.lineTo(w * 0.5 - 4, compassY + 7);
  ctx.lineTo(w * 0.5 + 4, compassY + 7);
  ctx.closePath();
  ctx.fillStyle = "#7ef0c8";
  ctx.fill();

  const depth = Math.round(snap.depth || 0);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "#f2fffa";
  ctx.shadowColor = "rgba(70,220,200,0.4)";
  ctx.shadowBlur = 10;
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText(String(depth), w * 0.5 - 10, 34);
  ctx.font = `500 20px ${FONT}`;
  ctx.globalAlpha = 0.92;
  ctx.fillText(" m", w * 0.5 + String(depth).length * 8 + 4, 40);
  ctx.globalAlpha = 1;
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.strokeStyle = "#4ef3d0";
  ctx.lineWidth = 3.4;
  ctx.lineCap = "round";
  ctx.moveTo(w * 0.5 - 38, 68);
  ctx.quadraticCurveTo(w * 0.5, 52, w * 0.5 + 38, 68);
  ctx.stroke();

  const ox = 12 + 72 + 100;
  const oy = h - 16 - 42 - 100;
  const o2t = Math.max(0, Math.min(1, (snap.o2 || 0) / O2_MAX));
  const low = !!snap.lowO2;
  ctx.beginPath();
  ctx.arc(ox, oy, 98, 0, Math.PI * 2);
  ctx.fillStyle = "#121c1a";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ox, oy, 66, 0, Math.PI * 2);
  ctx.fillStyle = "#071210";
  ctx.fill();
  ctx.beginPath();
  ctx.lineWidth = 24;
  ctx.strokeStyle = "rgba(6,16,14,0.96)";
  ctx.arc(ox, oy, 82, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.strokeStyle = low ? "#ff6a5a" : "#3ee0b4";
  ctx.lineCap = "butt";
  ctx.arc(ox, oy, 82, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * o2t);
  ctx.stroke();
  ctx.beginPath();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = "rgba(170,235,215,0.22)";
  ctx.arc(ox, oy, 68, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = low ? "#ff8a7a" : "#c8f8e8";
  ctx.font = `15px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.letterSpacing = "0.2em";
  ctx.fillText("O₂", ox, oy - 18);
  ctx.letterSpacing = "0px";
  ctx.fillStyle = low ? "#ff8a7a" : "#f2fffa";
  ctx.font = `750 38px ${FONT}`;
  ctx.shadowColor = "rgba(80,255,210,0.42)";
  ctx.shadowBlur = 12;
  ctx.fillText(String(Math.ceil(snap.o2 || 0)), ox, oy + 14);
  ctx.shadowBlur = 0;

  paintPip(ctx, 12 + 44 + 32, h - 16 - 127 - 32, 32, "#ff5a32", "#2a1210", 0.82, pipImgs.hp);
  paintPip(ctx, 12 + 58 + 32, h - 16 - 53 - 32, 32, "#f0a020", "#2a1a08", 0.7, pipImgs.food);
  paintPip(ctx, 12 + 114 + 32, h - 16 - 11 - 32, 32, "#3ad4e8", "#082028", 0.64, pipImgs.h2o);

  ctx.beginPath();
  ctx.strokeStyle = "rgba(236,255,250,0.58)";
  ctx.lineWidth = 1.4;
  ctx.arc(w * 0.5, h * 0.5, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = "rgba(236,255,250,0.78)";
  ctx.arc(w * 0.5, h * 0.5, 1.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

export function paintTitles(ctx, w, h, overlay) {
  const a = overlay?.titleAlpha || 0;
  if (a < 0.02) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.shadowColor = "rgba(0,8,12,0.85)";
  ctx.shadowBlur = 16;
  const y0 = h * 0.18;
  if (overlay.kicker) {
    ctx.fillStyle = "#8ff5d4";
    ctx.font = `11px ${FONT}`;
    ctx.letterSpacing = "0.42em";
    ctx.fillText(String(overlay.kicker).toUpperCase(), w * 0.5, y0);
  }
  ctx.fillStyle = "#f4fffb";
  ctx.font = `600 42px ${FONT}`;
  ctx.letterSpacing = "0.14em";
  ctx.fillText(String(overlay.name || "").toUpperCase(), w * 0.5, y0 + 22);
  if (overlay.sub) {
    ctx.fillStyle = "rgba(232,252,246,0.78)";
    ctx.font = `15px ${FONT}`;
    ctx.letterSpacing = "0.08em";
    ctx.fillText(overlay.sub, w * 0.5, y0 + 76);
  }
  ctx.restore();
}

export function paintFade(ctx, w, h, fade) {
  const a = Math.max(0, Math.min(1, fade || 0));
  if (a < 0.01) return;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = "#02060c";
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

const CREDIT = "Grok 4.6";

export function paintCredit(ctx, w, h, alpha = 1) {
  const a = Math.max(0, Math.min(1, alpha ?? 1));
  if (a < 0.01) return;
  const size = Math.max(26, Math.round(h * 0.05));
  const x = w - Math.max(32, Math.round(w * 0.052));
  const y = h - Math.max(48, Math.round(h * 0.155));
  ctx.save();
  ctx.globalAlpha = a;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.font = `600 ${size}px ${FONT}`;
  ctx.letterSpacing = "0.08em";
  ctx.lineJoin = "round";
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(3.2, size * 0.18);
  ctx.strokeStyle = "rgba(2, 8, 14, 0.78)";
  ctx.fillStyle = "rgba(236, 255, 250, 0.84)";
  ctx.shadowColor = "rgba(0, 8, 12, 0.7)";
  ctx.shadowBlur = Math.max(8, size * 0.32);
  ctx.strokeText(CREDIT, x, y);
  ctx.shadowBlur = 0;
  ctx.fillText(CREDIT, x, y);
  ctx.restore();
}

export function createHud() {
  const track = document.getElementById("compass-track");
  const depthVal = document.getElementById("depth-val");
  const o2Val = document.getElementById("o2-val");
  const o2Ring = document.getElementById("o2-ring");
  const vignette = document.getElementById("vignette");
  const toast = document.getElementById("biome-toast");
  const interact = document.getElementById("interact-hint");
  let toastTimer = 0;

  o2Ring.style.strokeDasharray = String(CIRC);
  o2Ring.style.strokeDashoffset = "0";
  loadHelmet();

  const labels = [];
  for (let deg = 0; deg < 360; deg += 5) {
    const el = document.createElement("div");
    const cardinal = { 0: "N", 90: "E", 180: "S", 270: "W" }[deg];
    if (deg % 15 !== 0) {
      el.className = "tick minor";
    } else if (cardinal) {
      el.className = "tick cardinal";
      el.textContent = cardinal;
    } else {
      el.className = "tick";
      el.textContent = String(deg);
    }
    el.dataset.deg = String(deg);
    track.appendChild(el);
    labels.push(el);
  }

  return {
    announce(title) {
      if (!toast) return;
      toast.textContent = title;
      toast.classList.add("show");
      window.clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2200);
    },
    snapshot(player) {
      return snapshotHud(player);
    },
    paintFrame(ctx, w, h, overlay) {
      paintHud(ctx, w, h, overlay);
      paintTitles(ctx, w, h, overlay);
      paintFade(ctx, w, h, overlay.fade);
      paintCredit(ctx, w, h, overlay.creditAlpha);
    },
    update(player) {
      const heading = player.heading;
      for (const el of labels) {
        let d = Number(el.dataset.deg) - heading;
        if (d > 180) d -= 360;
        if (d < -180) d += 360;
        el.style.left = `${COMPASS_MID + d * PX}px`;
      }
      depthVal.textContent = String(Math.round(player.depth));
      const o2 = player.oxygen;
      o2Val.textContent = String(Math.ceil(o2));
      const t = o2 / O2_MAX;
      o2Ring.style.strokeDashoffset = String(CIRC * (1 - t));
      document.body.classList.toggle("low-o2", t < 0.28);
      const murk = Math.min(0.35, Math.max(0, (player.depth - 20) / 140));
      vignette.style.opacity = String(0.85 + murk);
      if (interact) {
        if (player.entryHint) {
          interact.textContent = player.entryHint;
          interact.classList.add("show");
        } else {
          interact.classList.remove("show");
        }
      }
    },
  };
}
