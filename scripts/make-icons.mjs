#!/usr/bin/env node
// Renders the TaazaStream logo mark to the PNG icons used by the PWA manifest.
// Uses Playwright's Chromium (already a dev dependency for E2E tests).
//   node scripts/make-icons.mjs
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'apps', 'web', 'package.json'));
const { chromium } = require('@playwright/test');

const mark = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ff8a4c"/><stop offset="0.55" stop-color="#ff6b35"/><stop offset="1" stop-color="#ff3d7f"/>
    </linearGradient>
    <radialGradient id="bg" cx="0.3" cy="0.2" r="0.9">
      <stop offset="0" stop-color="#1d1622"/><stop offset="1" stop-color="#08080d"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="${pad ? 0 : 112}" fill="url(#bg)"/>
  <g transform="translate(256 256) scale(${pad ? 0.62 : 0.8}) translate(-256 -256)">
    <path d="M148 116c0-21 22.4-34 40.8-22.4l209.6 127.2c17.6 11.2 17.6 36.8 0 48L188.8 396c-18.4 11.6-40.8-1.6-40.8-22.4Z" fill="url(#g)"/>
    <path d="M148 252c56-64 140-83 224-61" stroke="#08080d" stroke-width="27" fill="none" stroke-linecap="round"/>
  </g>
</svg>`;

const out = path.join(root, 'apps', 'web', 'public');
mkdirSync(path.join(out, 'icons'), { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
const targets = [
  ['icons/icon-512.png', 512, false],
  ['icons/icon-192.png', 192, false],
  ['icons/icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
];
for (const [file, size, maskable] of targets) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${mark(maskable).replace('width="512" height="512"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: path.join(out, file), omitBackground: !maskable, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('  wrote', file);
}
await browser.close();
