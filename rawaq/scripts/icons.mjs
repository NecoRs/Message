import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MARK = [
  'M12 8h24a6.5 6.5 0 0 1 6.5 6.5v13A6.5 6.5 0 0 1 36 34H23l-8.5 6.5V34H12a6.5 6.5 0 0 1-6.5-6.5v-13A6.5 6.5 0 0 1 12 8Z',
  'M24 14.5v13',
  'M17 18v6M31 18v6',
];

const svgFor = (size, { bg = '#000', fg = '#fff', pad = 0.18, radius = 0.22, full = false } = {}) => {
  const inner = size * (1 - pad * 2);
  const scale = inner / 48;
  const off = size * pad;
  const rect = full ? `<rect width="${size}" height="${size}" fill="${bg}"/>` : `<rect width="${size}" height="${size}" rx="${size * radius}" fill="${bg}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${rect}<g transform="translate(${off} ${off}) scale(${scale})" fill="none" stroke="${fg}" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round">${MARK.map((d) => `<path d="${d}"/>`).join('')}</g></svg>`;
};

const targets = [
  ['icons/icon-192.png', 192, {}],
  ['icons/icon-512.png', 512, {}],
  ['icons/maskable-512.png', 512, { full: true, pad: 0.27 }],
  ['icons/apple-touch-icon.png', 180, { full: true, pad: 0.2 }],
];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [file, size, opts] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svgFor(size, opts)}</body></html>`);
  await page.locator('svg').screenshot({ path: path.join(root, file), omitBackground: !opts.full });
  console.log('wrote', file);
}
await browser.close();
fs.writeFileSync(path.join(root, 'icons', 'mark.svg'), svgFor(512, {}));
