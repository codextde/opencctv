// Screenshots pages at 390px and 1440px. Usage: node tools/shoot.mjs [baseUrl] [path ...]
import { createRequire } from 'node:module';
const require = createRequire('/Users/danielehrhardt/projects/opencctv/store/node_modules/');
const { chromium } = require('playwright-core');
const root = new URL('..', import.meta.url).pathname;
const base = process.argv[2] || 'http://localhost:8788';
const paths = process.argv.slice(3).length ? process.argv.slice(3) : ['/'];
const exe = `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell`;
const browser = await chromium.launch({ executablePath: exe });
for (const p of paths) {
  for (const [w, h, dpr] of [[390, 844, 2], [1440, 900, 1]]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: dpr });
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('requestfailed', (r) => errors.push('failed ' + r.url()));
    const res = await page.goto(base + p, { waitUntil: 'networkidle' });
    await page.evaluate(async () => { await document.fonts.ready; for (let y = 0; y < document.body.scrollHeight; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } scrollTo(0, 0); });
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const name = (p === '/' ? 'home' : p.replace(/^\/|\/$/g, '').replace(/[\/.]/g, '-')) + `-${w}`;
    await page.screenshot({ path: `${root}screenshots/${name}.png`, fullPage: true });
    console.log(p, w, res.status(), overflow > 0 ? `HORIZONTAL OVERFLOW ${overflow}px` : 'no overflow', errors.join(' | '));
    await page.close();
  }
}
await browser.close();
