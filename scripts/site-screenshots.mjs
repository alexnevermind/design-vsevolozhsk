// Кадры участка для отчёта этапа: общий вид, постройки, точки интереса, вечер с костром, вид сверху,
// прогулка, телефон. Кадры — реальная отрисовка приложения (dist/index.html) в Chromium.
// Запуск: npm run site:shots [-- --only site,guest --out docs/img]
import { launchChromium } from './browser-launch.mjs';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
const OUT = join(ROOT, args.out || 'docs/img');
const ONLY = args.only ? args.only.split(',') : null;
const PORT = 8773;
mkdirSync(OUT, { recursive: true });
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', join(ROOT, 'dist')], { stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }

// name, действие (в странице), скрыть интерфейс
const SHOTS = [
  ['site', 'app.focusOn("site")', true],
  ['guest', 'app.focusOn("guest")', true],
  ['grill', 'app.focusOn("grill")', true],
  ['garage', 'app.focusOn("garage")', true],
  ['entry', 'app.showSpot("entry")', true],
  ['pond', 'app.showSpot("pond")', true],
  ['dining', 'app.showSpot("dining")', true],
  ['fire-evening', 'app.showSpot("fire"); app.store.commit((s) => { s.hour = 22.3; }, "вечер")', true],
  ['guest-evening', 'app.focusOn("guest"); app.store.commit((s) => { s.hour = 22.6; }, "вечер")', true],
  ['top', 'app.store.commit((s) => { s.hour = 13; }, "день"); app.topView()', true],
  ['ui', 'app.focusOn("site")', false],
  ['walk', 'app.setMode("walk")', false],
];

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
ctx.setDefaultNavigationTimeout(240000);
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${BASE}blank.html`).catch(() => {});
await page.evaluate(() => { try { localStorage.clear(); } catch { /* нет доступа */ } });
await page.goto(`${BASE}index.html?still=1`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__site?.ready?.() && window.__site.texturesPending() === 0, null, { timeout: 300000 });
await page.waitForTimeout(1500);
for (const [name, action, hide] of SHOTS) {
  if (ONLY && !ONLY.includes(name)) continue;
  await page.evaluate(({ action, hide }) => {
    const app = window.__site.app;
    if (app.mode === 'walk') app.setMode('site');
    if (app.hidden !== hide) app.toggleUI();
    new Function('app', action)(app);
  }, { action, hide });
  await page.waitForTimeout(400);
  await page.waitForFunction(() => window.__site.idle(), null, { timeout: 60000 }).catch(() => {});
  // Окружение и тени пересчитываются после остановки камеры.
  await page.waitForTimeout(1200);
  await page.evaluate(() => new Promise((r) => { window.__site.app.invalidate(); requestAnimationFrame(() => requestAnimationFrame(r)); }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, `stage2-${name}.png`), timeout: 300000 });
  console.log(`✔ stage2-${name}.png`);
}
await page.evaluate(() => { const app = window.__site.app; if (app.mode === 'walk') app.setMode('site'); if (app.hidden) app.toggleUI(); });
// Телефон.
if (!ONLY || ONLY.includes('mobile')) {
  const m = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
  m.setDefaultNavigationTimeout(240000);
  const mp = await m.newPage();
  await mp.goto(`${BASE}index.html?still=1&quality=low`, { waitUntil: 'domcontentloaded' });
  await mp.waitForFunction(() => window.__site?.ready?.(), null, { timeout: 300000 });
  await mp.waitForTimeout(2500);
  await mp.screenshot({ path: join(OUT, 'stage2-mobile.png'), timeout: 300000 });
  console.log('✔ stage2-mobile.png');
  await m.close();
}
await browser.close();
server.kill();
if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
