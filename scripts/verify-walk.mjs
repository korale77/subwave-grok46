import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "captures", "verify-walk");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-gl=angle", "--use-angle=gl", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://127.0.0.1:5173/?demo=1&hideHud=1", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__SUBWAVE_READY === true, { timeout: 60000 });
await page.waitForTimeout(800);

const shots = [
  ["01-shallows-grotto", 3.2],
  ["02-shallows-fish", 8.6],
  ["03-shallows-hold", 12.4],
  ["04-base", 20.2],
  ["05-surface", 38.5],
  ["06-amber-field", 48.0],
  ["07-amber-pan", 52.6],
  ["08-kelp", 61.2],
  ["09-mushroom", 71.2],
  ["10-bulb", 87.2],
  ["11-crimson", 101.2],
  ["12-jelly", 115.2],
  ["13-reef-cross", 128.7],
  ["14-reef-charge", 138.2],
];

for (const [name, t] of shots) {
  const info = await page.evaluate(async (sec) => {
    window.__SUBWAVE_DEMO.seek(sec);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__SUBWAVE_DEMO.info();
  }, t);
  await page.waitForTimeout(280);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, type: "png" });
  console.log(name, info.beat, "t=" + (info.t && info.t.toFixed ? info.t.toFixed(1) : info.t), "->", file);
}

await browser.close();
