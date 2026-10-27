// Растровая копия 2D-схемы участка: SITE_PLAN.svg → docs/img/site-plan.png (Chromium, масштаб 2).
// Запуск: npm run site:png
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChromium } from './browser-launch.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(ROOT, 'SITE_PLAN.svg'), 'utf8');
const [, w, h] = svg.match(/viewBox="0 0 (\d+) (\d+)"/).map(Number);
mkdirSync(join(ROOT, 'docs', 'img'), { recursive: true });
const browser = await launchChromium();
try {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2 });
  await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
  await page.screenshot({ path: join(ROOT, 'docs', 'img', 'site-plan.png'), clip: { x: 0, y: 0, width: w, height: h } });
  console.log(`docs/img/site-plan.png ${w * 2}×${h * 2}`);
} finally {
  await browser.close();
}
