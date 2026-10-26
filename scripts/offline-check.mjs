// Проверка автономной поставки после отключения сети: распаковка ZIP, открытие file://VSEMDOM.html,
// контроль внешних запросов и ошибок консоли, изменение отделки, прогулка, реальный PNG.
import { launchChromium } from './browser-launch.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const zip = join(ROOT, 'artifacts', 'VSEMDOM-local.zip');
const dir = mkdtempSync(join(tmpdir(), 'vsemdom-offline-'));
execFileSync('unzip', ['-q', zip, '-d', dir]);
const html = join(dir, 'VSEMDOM.html');
const results = [];
const rec = (name, ok, note = '') => { results.push({ name, ok: !!ok, note }); console.log(`${ok ? '✔' : '✘'} ${name}${note ? ` — ${note}` : ''}`); };

const browser = await launchChromium();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
await ctx.setOffline(true);
const external = [];
const errors = [];
await ctx.route('**/*', (route) => {
  const u = route.request().url();
  if (u.startsWith('file:') || u.startsWith('data:') || u.startsWith('blob:')) return route.continue();
  external.push(u);
  return route.abort();
});
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errors.push(e.message));
const t0 = Date.now();
await page.goto(`file://${html}?quality=low`, { timeout: 180000 });
await page.waitForFunction(() => window.__vsemdom?.ready?.(), null, { timeout: 240000 });
rec('Автономный HTML загрузился без сети (file://)', true, `${Math.round((Date.now() - t0) / 1000)} с`);
rec('Все карты и модель загружены из встроенных data URI', (await page.evaluate(() => window.__vsemdom.texturesPending())) === 0);
await page.locator('#dock-strip .swatch', { hasText: 'Охра' }).click();
await page.waitForTimeout(800);
rec('Изменение отделки без сети', (await page.evaluate(() => window.__vsemdom.state().mats['facade:east'])) === 'ext-D105');
await page.locator('.modes button', { hasText: 'Прогулка' }).click();
await page.waitForTimeout(1500);
const w0 = await page.evaluate(() => window.__vsemdom.walk());
await page.locator('#scene').focus();
await page.keyboard.down('KeyW');
await page.waitForFunction((p) => { const w = window.__vsemdom.walk(); return Math.hypot(w.x - p.x, w.z - p.z) > 0.5; }, w0, { timeout: 20000 }).catch(() => {});
await page.keyboard.up('KeyW');
const w1 = await page.evaluate(() => window.__vsemdom.walk());
rec('Прогулка работает без сети', Math.hypot(w1.x - w0.x, w1.z - w0.z) > 0.5);
// Кадр программного WebGL рисуется секунды — снимок ждёт его дольше стандартных 30 с.
await page.screenshot({ path: join(ROOT, 'artifacts', 'screenshots', 'offline-walk.png'), timeout: 180000 });
await page.locator('#walk-exit').click();
await page.waitForTimeout(1500);
const dl = page.waitForEvent('download', { timeout: 240000 });
await page.locator('#btn-png').click();
const d = await dl;
const out = join(ROOT, 'artifacts', 'screenshots', 'offline-export-1800x1120.png');
await d.saveAs(out);
const buf = readFileSync(out);
rec('Реальный PNG из автономной версии', buf.readUInt32BE(16) === 1800 && buf.readUInt32BE(20) === 1120, `${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}`);
await page.locator('#btn-link').click();
await page.waitForTimeout(500);
const link = await page.locator('#link-text').inputValue();
rec('Ссылка автономного файла — локальный путь с конфигурацией', link.startsWith('file://') && link.includes('#r=1.'));
rec('Внешние обязательные запросы отсутствуют', external.length === 0, external.join(', '));
rec('Ошибок консоли нет', errors.length === 0, errors.join(' | '));
await browser.close();
const htmlHash = createHash('sha256').update(readFileSync(html)).digest('hex');
const expected = JSON.parse(readFileSync(join(ROOT, 'artifacts', 'offline-checksums.json'), 'utf8')).html.sha256;
rec('HTML из ZIP совпадает с проверенным файлом (SHA-256)', htmlHash === expected, htmlHash);
mkdirSync(join(ROOT, 'artifacts'), { recursive: true });
writeFileSync(join(ROOT, 'artifacts', 'offline-check.json'), JSON.stringify({
  date: new Date().toISOString(),
  environment: `Chromium ${browser.version()} headless, сеть отключена (context.setOffline + блокировка http/https), программный WebGL`,
  results,
}, null, 2) + '\n');
process.exit(results.every((r) => r.ok) ? 0 : 1);
