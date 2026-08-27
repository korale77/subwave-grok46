import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, "captures");
const PORT = Number(process.env.CAPTURE_PORT || 5173);

function portOpen(port) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    sock.setTimeout(400);
    sock.once("connect", () => {
      sock.destroy();
      resolve(true);
    });
    sock.once("timeout", () => {
      sock.destroy();
      resolve(false);
    });
    sock.once("error", () => {
      sock.destroy();
      resolve(false);
    });
    sock.connect(port, "127.0.0.1");
  });
}

async function waitUntilListening(port, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await portOpen(port)) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Vite did not start on ${port}`);
}

await mkdir(outDir, { recursive: true });

let server = null;
let started = false;
if (!(await portOpen(PORT))) {
  server = spawn("npx", ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BROWSER: "none" },
  });
  started = true;
  server.stdout.on("data", (d) => process.stdout.write(d));
  server.stderr.on("data", (d) => process.stderr.write(d));
  await waitUntilListening(PORT);
  await new Promise((r) => setTimeout(r, 500));
}

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: [
    "--use-gl=angle",
    "--use-angle=gl",
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--disable-gpu-sandbox",
  ],
});

const allShots = [
  { name: "shallows", query: "shot=shallows&hideHud=1" },
  { name: "kelp", query: "shot=kelp" },
  { name: "surface", query: "shot=surface&hideHud=1" },
  { name: "sky", query: "shot=sky&hideHud=1" },
  { name: "demo", query: "shot=demo" },
  { name: "grassy", query: "shot=grassy&hideHud=1" },
  { name: "mushroom", query: "shot=mushroom&hideHud=1" },
  { name: "bulb", query: "shot=bulb&hideHud=1" },
  { name: "crimson", query: "shot=crimson&hideHud=1" },
  { name: "jelly", query: "shot=jelly&hideHud=1" },
  { name: "reef", query: "shot=reef&hideHud=1" },
  { name: "base", query: "shot=base&hideHud=1" },
  { name: "basein", query: "shot=basein&hideHud=1" },
];
const only = (process.env.SHOT || "").trim();
const shots = only ? allShots.filter((s) => s.name === only) : allShots;
if (only && shots.length === 0) {
  throw new Error(`Unknown SHOT=${only}. Use shallows, kelp, surface, sky, demo, grassy, mushroom, bulb, crimson, jelly, reef, base, or basein.`);
}

try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.on("pageerror", (err) => console.error("pageerror", err));
  page.on("console", (msg) => {
    if (msg.type() === "error") console.error("console", msg.text());
  });

  for (const s of shots) {
    const url = `http://127.0.0.1:${PORT}/?${s.query}`;
    console.log("capturing", url);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForFunction(() => window.__SUBWAVE_READY === true, { timeout: 30000 });
    await page.waitForTimeout(1800);
    const dest = path.join(outDir, `${s.name}.png`);
    await page.screenshot({ path: dest, type: "png" });
    console.log("wrote", dest);
  }
  await context.close();
} finally {
  await browser.close();
  // Leave Vite running so the live game and later captures share one server.
  process.exit(0);
}
