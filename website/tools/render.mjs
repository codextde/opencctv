// Renders the HTML mockups in tools/mock to the placeholder PNGs in public/assets.
// Usage: node tools/render.mjs [name ...]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
const require = createRequire('/Users/danielehrhardt/projects/opencctv/store/node_modules/');
const { chromium } = require('playwright-core');
const sharp = require('sharp');
const root = new URL('..', import.meta.url).pathname;
const exe = process.env.CHROME || `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;

const jobs = [
  ['web-ui', 'assets/web-ui.png', 1600, 840, 1.25],
  ['phone-live-grid', 'assets/hero-app.png', 393, 852, 2],
  ['phone-camera', 'assets/screens/camera.png', 393, 852, 2],
  ['phone-timeline', 'assets/screens/timeline.png', 393, 852, 2],
  ['phone-events', 'assets/screens/events.png', 393, 852, 2],
  ['phone-storage', 'assets/screens/storage.png', 393, 852, 2],
  ['og', 'assets/og.png', 1200, 630, 1],
];
const only = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: exe });
for (const [name, out, w, h, dpr] of jobs) {
  if (only.length && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
  await page.goto('file://' + join(root, 'tools/mock', name + '.html'));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  const buf = await page.screenshot({ type: 'png' });
  const dest = join(root, 'public', out);
  mkdirSync(dirname(dest), { recursive: true });
  await sharp(buf).png({ palette: true, quality: 90, effort: 10, dither: 0.6 }).toFile(dest);
  console.log('wrote', out);
  await page.close();
}
await browser.close();
