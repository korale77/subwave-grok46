import { chromium } from "playwright";

const url = process.env.DEMO_URL || "http://127.0.0.1:5173/?demo=1";
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ["--use-gl=angle", "--use-angle=gl", "--enable-webgl", "--ignore-gpu-blocklist"],
});

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__SUBWAVE_READY === true, { timeout: 45000 });

const start = await page.evaluate(() => {
  const d = window.__SUBWAVE_DEMO;
  return {
    active: !!(d && d.isActive()),
    body: document.body.classList.contains("demo"),
    lock: document.pointerLockElement && document.pointerLockElement.id,
    badge: getComputedStyle(document.getElementById("demo-badge")).opacity,
    info: d.info(),
  };
});

await page.click("#c");
await page.keyboard.down("KeyW");
await page.keyboard.down("KeyA");
await page.waitForTimeout(200);

const afterInput = await page.evaluate(() => ({
  lock: document.pointerLockElement && document.pointerLockElement.id,
  active: window.__SUBWAVE_DEMO.isActive(),
  guided: true,
}));

const samples = [];
const seeks = [1, 20, 36, 48, 62, 78, 92, 106, 118, 132, 146, 160, 174];
for (const t of seeks) {
  const row = await page.evaluate((sec) => {
    window.__SUBWAVE_DEMO.seek(sec);
    const info = window.__SUBWAVE_DEMO.info();
    return {
      t: sec,
      beat: info.beat,
      title: info.title,
      pos: window.__SUBWAVE_INFO ? null : null,
      cam: [...window.__SUBWAVE_DEMO ? [] : []],
    };
  }, t);
  const cam = await page.evaluate(() => {
    const info = window.__SUBWAVE_DEMO.info();
    const c = document.querySelector("canvas");
    return { beat: info.beat, title: info.title, ready: window.__SUBWAVE_READY };
  });
  const pose = await page.evaluate(() => {
    const demo = window.__SUBWAVE_DEMO.info();
    return demo;
  });
  samples.push(pose);
}

const moved = await page.evaluate(() => {
  const a = window.__SUBWAVE_DEMO.info();
  window.__SUBWAVE_DEMO.seek(2);
  const p1 = performance.now();
  window.__SUBWAVE_DEMO.update();
  const i1 = { ...window.__SUBWAVE_DEMO.info() };
  window.__SUBWAVE_DEMO.seek(80);
  window.__SUBWAVE_DEMO.update();
  const i2 = { ...window.__SUBWAVE_DEMO.info() };
  return { a: i1, b: i2, same: i1.beat === i2.beat };
});

await page.keyboard.up("KeyW");
await page.keyboard.up("KeyA");
await page.keyboard.press("Escape");
await page.waitForTimeout(80);

const stopped = await page.evaluate(() => ({
  active: window.__SUBWAVE_DEMO.isActive(),
  body: document.body.classList.contains("demo"),
  lock: document.pointerLockElement && document.pointerLockElement.id,
}));

await page.keyboard.press("KeyG");
await page.waitForTimeout(80);

const restarted = await page.evaluate(() => ({
  active: window.__SUBWAVE_DEMO.isActive(),
  body: document.body.classList.contains("demo"),
}));

await page.keyboard.press("KeyG");
await page.waitForTimeout(80);

const toggledOff = await page.evaluate(() => window.__SUBWAVE_DEMO.isActive());

const otherKey = await page.evaluate(async () => {
  window.__SUBWAVE_DEMO.start();
  const before = window.__SUBWAVE_DEMO.info();
  document.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", key: "3", bubbles: true }));
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", key: "3", bubbles: true }));
  const after = window.__SUBWAVE_DEMO.info();
  return { stillOn: after.active, beat: after.beat, before: before.beat };
});

console.log(JSON.stringify({ start, afterInput, samples, moved, stopped, restarted, toggledOff, otherKey, errors }, null, 2));

const fail = [];
if (!start.active || !start.body) fail.push("demo did not auto-start");
if (start.lock) fail.push("pointer lock on start");
if (afterInput.lock) fail.push("pointer lock after click");
if (moved.same) fail.push("seek did not change beat");
if (stopped.active || stopped.body) fail.push("ESC did not stop demo");
if (stopped.lock) fail.push("pointer lock after stop");
if (!restarted.active) fail.push("T did not restart");
if (toggledOff) fail.push("T did not toggle off");
if (!otherKey.stillOn) fail.push("other key stopped demo");
if (errors.length) fail.push(`page errors: ${errors.join(" | ")}`);

await browser.close();

if (fail.length) {
  console.error("FAIL\n" + fail.join("\n"));
  process.exit(1);
}
console.log("OK");
