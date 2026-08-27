function pickMime() {
  const types = [
    "video/mp4;codecs=avc1.640028",
    "video/mp4;codecs=avc1.4D4028",
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=h264",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const t of types) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

function extFor(mime) {
  return String(mime).startsWith("video/mp4") ? "mp4" : "webm";
}

function stampVideoName(mime) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `subwave-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.${extFor(mime)}`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function even(n) {
  const x = Math.max(2, n | 0);
  return x - (x % 2);
}

export function createDemoRecorder(glCanvas, hud) {
  let rec = null;
  let chunks = [];
  let name = "";
  let dest = null;
  let ctx = null;
  let overlay = null;

  function ensureDest() {
    if (!dest) {
      dest = document.createElement("canvas");
      try {
        ctx = dest.getContext("2d", { alpha: false, colorSpace: "srgb" });
      } catch {
        ctx = dest.getContext("2d", { alpha: false });
      }
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
      }
    }
    const w = even(glCanvas.clientWidth || glCanvas.width || 2);
    const h = even(glCanvas.clientHeight || glCanvas.height || 2);
    if (dest.width !== w || dest.height !== h) {
      dest.width = w;
      dest.height = h;
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
      }
    }
    return ctx;
  }

  function paintOverlay(c) {
    if (!overlay) return;
    const w = dest.width;
    const h = dest.height;
    if (hud && typeof hud.paintFrame === "function") {
      hud.paintFrame(c, w, h, overlay);
      return;
    }
    if (typeof overlay.paint === "function") overlay.paint(c, w, h);
  }

  function pump() {
    if (!rec || rec.state === "inactive") return;
    const c = ensureDest();
    if (!c) return;
    c.drawImage(glCanvas, 0, 0, dest.width, dest.height);
    paintOverlay(c);
  }

  function start() {
    stop(false);
    if (typeof MediaRecorder === "undefined" || !HTMLCanvasElement.prototype.captureStream) {
      hud?.announce("Video record not supported");
      return false;
    }
    const mime = pickMime();
    if (!mime) {
      hud?.announce("No video encoder in this browser");
      return false;
    }
    const c = ensureDest();
    if (!c) {
      hud?.announce("Could not capture canvas");
      return false;
    }
    c.drawImage(glCanvas, 0, 0, dest.width, dest.height);
    paintOverlay(c);
    let stream;
    try {
      stream = dest.captureStream(30);
    } catch (err) {
      console.warn("captureStream failed", err);
      hud?.announce("Could not capture canvas");
      return false;
    }
    const track = stream.getVideoTracks()[0];
    if (track) track.contentHint = "detail";
    chunks = [];
    name = stampVideoName(mime);
    try {
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 16_000_000 });
    } catch (err) {
      rec = new MediaRecorder(stream, { mimeType: mime });
    }
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    rec.onerror = (e) => {
      console.warn("MediaRecorder error", e);
    };
    rec.start(1000);
    hud?.announce(`Recording  ·  ${name}`);
    return true;
  }

  function pause() {
    if (rec && rec.state === "recording") rec.pause();
  }

  function resume() {
    if (rec && rec.state === "paused") rec.resume();
  }

  function stop(save = true) {
    const recorder = rec;
    rec = null;
    if (!recorder || recorder.state === "inactive") return;
    const file = name;
    const parts = chunks;
    recorder.onstop = () => {
      if (!save || !parts.length) return;
      const blob = new Blob(parts, { type: recorder.mimeType || "video/webm" });
      downloadBlob(blob, file);
      hud?.announce(`Saved ${file}  ·  ~/Downloads`);
    };
    recorder.stop();
    recorder.stream.getTracks().forEach((t) => t.stop());
  }

  return {
    start,
    stop,
    pause,
    resume,
    pump,
    setOverlay(next) {
      overlay = next;
    },
    destToDataURL() {
      const c = ensureDest();
      if (!c) return "";
      c.drawImage(glCanvas, 0, 0, dest.width, dest.height);
      paintOverlay(c);
      return dest.toDataURL("image/png");
    },
  };
}
