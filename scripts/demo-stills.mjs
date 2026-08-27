import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, "captures", "demo-walk");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: true,
  args: ["--use-gl=angle", "--use-angle=gl", "--enable-webgl", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto("http://127.0.0.1:5173/?demo=1", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForFunction(() => window.__SUBWAVE_READY === true, { timeout: 45000 });

const shots = [
  ["01-shallows", 6],
  ["02-base", 22],
  ["03-surface", 38],
  ["04-amber", 50],
  ["05-kelp", 61.2],
  ["06-mushroom", 73.2],
  ["07-bulb", 87.2],
  ["08-crimson", 101.2],
  ["09-jelly", 115.2],
  ["10-reef", 129.2],
  ["11-reaper", 138.2],
];

for (const [name, t] of shots) {
  const info = await page.evaluate(async (sec) => {
    window.__SUBWAVE_DEMO.seek(sec);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return window.__SUBWAVE_DEMO.info();
  }, t);
  await page.waitForTimeout(180);
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, type: "png" });
  console.log(name, info.beat, info.title || "", "->", file);
}

await browser.close();
