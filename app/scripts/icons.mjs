import sharp from 'sharp';

const ACCENT_A = '#2DD4BF';
const ACCENT_B = '#0F9F90';
const BG_TOP = '#151A20';
const BG_BOTTOM = '#07090B';

const C = 50;
const R = 30;
const r = 11.5;

function blades() {
  const v = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    v.push([C + r * Math.cos(a), C + r * Math.sin(a)]);
  }
  const lines = [];
  for (let i = 0; i < 6; i++) {
    const [x1, y1] = v[i];
    const [x2, y2] = v[(i + 1) % 6];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const ux = dx / len;
    const uy = dy / len;
    const fx = x1 - C;
    const fy = y1 - C;
    const b = 2 * (fx * ux + fy * uy);
    const cc = fx * fx + fy * fy - R * R;
    const t = (-b + Math.sqrt(b * b - 4 * cc)) / 2;
    lines.push([x1, y1, x1 + ux * t, y1 + uy * t]);
  }
  return lines;
}

const mark = ({ stroke = 'url(#accent)', dot = '#FF4D4F', showDot = false } = {}) => `
  <circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="${stroke}" stroke-width="6.5"/>
  ${blades()
    .map(([x1, y1, x2, y2]) => `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="5" stroke-linecap="round"/>`)
    .join('')}
  ${showDot ? `<circle cx="${C + R * 0.74}" cy="${C - R * 0.74}" r="6.2" fill="${dot}"/>` : ''}`;

const defs = `<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${BG_TOP}"/><stop offset="1" stop-color="${BG_BOTTOM}"/></linearGradient>
  <linearGradient id="accent" gradientUnits="userSpaceOnUse" x1="25" y1="20" x2="75" y2="82"><stop offset="0" stop-color="${ACCENT_A}"/><stop offset="1" stop-color="${ACCENT_B}"/></linearGradient>
  <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${ACCENT_A}" stop-opacity="0.22"/><stop offset="1" stop-color="${ACCENT_A}" stop-opacity="0"/></radialGradient>
</defs>`;

const svg = (size, inner, { bg = false, glow = false, scale = 1 } = {}) => {
  const offset = (100 - 100 * scale) / 2;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
    ${defs}
    ${bg ? `<rect width="100" height="100" fill="url(#bg)"/>` : ''}
    ${glow ? `<circle cx="50" cy="50" r="46" fill="url(#glow)"/>` : ''}
    <g transform="translate(${offset} ${offset}) scale(${scale})">${inner}</g>
  </svg>`);
};

const out = (name) => `assets/images/${name}`;

await sharp(svg(1024, mark(), { bg: true, glow: true, scale: 0.92 })).png().toFile(out('icon.png'));
await sharp(svg(1024, mark(), { scale: 0.62 })).png().toFile(out('android-icon-foreground.png'));
await sharp(svg(1024, '', { bg: true })).png().toFile(out('android-icon-background.png'));
await sharp(svg(1024, mark({ stroke: '#FFFFFF', dot: '#FFFFFF' }), { scale: 0.62 })).png().toFile(out('android-icon-monochrome.png'));
await sharp(svg(512, mark(), { scale: 1 })).png().toFile(out('splash-icon.png'));
await sharp(svg(96, mark(), { bg: true, scale: 0.95 })).png().toFile(out('favicon.png'));
await sharp(svg(96, mark({ stroke: '#FFFFFF', showDot: false }), { scale: 1 })).png().toFile(out('notification-icon.png'));
await sharp(svg(512, mark(), { bg: true, glow: true, scale: 0.92 })).png().toFile(out('store-icon-512.png'));
await sharp(svg(1024, mark(), { scale: 1 })).png().toFile(out('mark.png'));
console.log('icons written');
