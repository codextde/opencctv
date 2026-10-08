// Generates the aperture mark (same geometry as app/scripts/icons.mjs) as SVG + PNG icons.
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire('/Users/danielehrhardt/projects/opencctv/store/node_modules/');
const sharp = require('sharp');
const OUT = new URL('../public/assets/', import.meta.url).pathname;

const C = 50, R = 30, r = 11.5;
function blades() {
  const v = [];
  for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i - Math.PI / 2; v.push([C + r * Math.cos(a), C + r * Math.sin(a)]); }
  return v.map(([x1, y1], i) => {
    const [x2, y2] = v[(i + 1) % 6];
    const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const fx = x1 - C, fy = y1 - C, b = 2 * (fx * ux + fy * uy), cc = fx * fx + fy * fy - R * R;
    const t = (-b + Math.sqrt(b * b - 4 * cc)) / 2;
    return [x1, y1, x1 + ux * t, y1 + uy * t];
  });
}
const f = (n) => n.toFixed(2);
const markPaths = (stroke) => `<circle cx="50" cy="50" r="${R}" fill="none" stroke="${stroke}" stroke-width="6.5"/>` +
  blades().map(([a, b, c, d]) => `<line x1="${f(a)}" y1="${f(b)}" x2="${f(c)}" y2="${f(d)}" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/>`).join('');
const grad = `<linearGradient id="a" gradientUnits="userSpaceOnUse" x1="25" y1="20" x2="75" y2="82"><stop offset="0" stop-color="#2DD4BF"/><stop offset="1" stop-color="#0F9F90"/></linearGradient>`;
const bg = `<linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#151A20"/><stop offset="1" stop-color="#07090B"/></linearGradient>`;

// favicon: dark rounded tile + mark
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs>${grad}${bg}</defs><rect width="100" height="100" rx="23" fill="url(#b)"/><g transform="translate(-4 -4) scale(1.08)">${markPaths('url(#a)')}</g></svg>`;
// bare mark for inline use
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="18 18 64 64"><defs>${grad}</defs>${markPaths('url(#a)')}</svg>`;
writeFileSync(OUT + 'favicon.svg', favicon);
writeFileSync(OUT + 'mark.svg', mark);
const tile = (size) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100"><defs>${grad}${bg}</defs><rect width="100" height="100" fill="url(#b)"/><g transform="translate(6 6) scale(.88)">${markPaths('url(#a)')}</g></svg>`);
await sharp(tile(180)).png().toFile(OUT + 'apple-touch-icon.png');
await sharp(tile(512)).png().toFile(OUT + 'icon-512.png');
await sharp(Buffer.from(favicon.replace('<svg ', '<svg width="48" height="48" '))).png().toFile(OUT + 'favicon-48.png');
console.log('ok');
