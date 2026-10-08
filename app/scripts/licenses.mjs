import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const out = [];
for (const name of Object.keys(pkg.dependencies).sort()) {
  try {
    const p = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8'));
    const repo = typeof p.repository === 'string' ? p.repository : p.repository?.url;
    out.push({ name, version: p.version, license: p.license ?? 'see package', url: (repo ?? p.homepage ?? '').replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:/, 'https:') });
  } catch {}
}
out.push({ name: 'Inter (font)', version: '4', license: 'OFL-1.1', url: 'https://github.com/rsms/inter' });
out.push({ name: 'Material Symbols (font)', version: '', license: 'Apache-2.0', url: 'https://github.com/google/material-design-icons' });
out.push({ name: 'Demo footage (Pexels)', version: '', license: 'Pexels License', url: 'https://www.pexels.com/license/' });
writeFileSync('src/lib/licenses.json', JSON.stringify(out, null, 1) + '\n');
console.log(out.length, 'packages');
