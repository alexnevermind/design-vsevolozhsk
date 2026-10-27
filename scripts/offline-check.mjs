// Проверка автономных поставок после отключения сети: распаковка ZIP, открытие file://…html, контроль
// внешних запросов и ошибок консоли, основные действия, реальный PNG, SHA-256 HTML из ZIP.
// Участок (Vsevolozhsk-local.zip): фасад, разрез «Внутри», прогулка, кадр, ссылка. Дом базы
// (VSEMDOM-local.zip): отделка, прогулка, кадр, ссылка.
// Запуск: npm run offline:check [-- --target site|base]
import { launchChromium } from './browser-launch.mjs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
const SHOTS = join(ROOT, 'artifacts', 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const sums = JSON.parse(readFileSync(join(ROOT, 'artifacts', 'offline-checksums.json'), 'utf8'));
const results = [];
let target = '';
const rec = (name, ok, note = '') => { results.push({ target, name, ok: !!ok, note }); console.log(`${ok ? '✔' : '✘'} ${name}${note ? ` — ${note}` : ''}`); };

// Страница без сети: всё, кроме file:, data: и blob:, блокируется и записывается.
async function offlinePage(browser, zipName, htmlName, diag) {
  const dir = mkdtempSync(join(tmpdir(), 'offline-'));
  execFileSync('unzip', ['-q', join(ROOT, 'artifacts', zipName), '-d', dir]);
  const html = join(dir, htmlName);
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
  // Программный WebGL рисует кадр секунды: действия ждут дольше стандартных 30 с.
  page.setDefaultTimeout(180000);
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push(e.message));
  const t0 = Date.now();
  await page.goto(`file://${html}?quality=low`, { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.waitForFunction((d) => window[d]?.ready?.(), diag, { timeout: 240000 });
  rec('Автономный HTML загрузился без сети (file://)', true, `${Math.round((Date.now() - t0) / 1000)} с`);
  await page.waitForFunction((d) => window[d].texturesPending() === 0, diag, { timeout: 120000 }).catch(() => {});
  rec('Все карты и модель загружены из встроенных data URI', (await page.evaluate((d) => window[d].texturesPending(), diag)) === 0);
  return { ctx, page, html, external, errors };
}

async function savePNG(page, file) {
  const dl = page.waitForEvent('download', { timeout: 240000 });
  dl.catch(() => {});
  await page.locator('#btn-png').click();
  const d = await dl;
  const out = join(SHOTS, file);
  await d.saveAs(out);
  const buf = readFileSync(out);
  rec('Реальный PNG из автономной версии', buf.readUInt32BE(16) === 1800 && buf.readUInt32BE(20) === 1120, `${buf.readUInt32BE(16)}×${buf.readUInt32BE(20)}`);
}

async function finish(o, prefix, key) {
  await o.page.locator('#btn-link').click();
  await o.page.waitForTimeout(500);
  const link = await o.page.locator('#link-text').inputValue();
  rec('Ссылка автономного файла — локальный путь с состоянием', link.startsWith('file://') && link.includes(prefix), link.slice(0, 60) + '…');
  rec('Внешние обязательные запросы отсутствуют', o.external.length === 0, o.external.join(', '));
  rec('Ошибок консоли нет', o.errors.length === 0, o.errors.join(' | '));
  await o.ctx.close();
  const hash = createHash('sha256').update(readFileSync(o.html)).digest('hex');
  rec('HTML из ZIP совпадает с проверенным файлом (SHA-256)', hash === sums[key].html.sha256, hash);
}

async function checkSite(browser) {
  target = 'site';
  console.log('— Участок (Vsevolozhsk-local.zip)');
  const o = await offlinePage(browser, 'Vsevolozhsk-local.zip', 'Vsevolozhsk.html', '__site');
  const { page } = o;
  await page.evaluate(() => window.__site.pauseAnimation(true));
  await page.locator('[data-facade="plaster"]').click();
  await page.waitForTimeout(800);
  rec('Фасад «Штукатурка и кирпич» без сети', (await page.evaluate(() => window.__site.facade())) === 'plaster');
  await page.locator('.modes [data-mode="interior"]').click();
  await page.waitForFunction(() => window.__site.interior().cut === 'guest', null, { timeout: 30000 }).catch(() => {});
  const inn = await page.evaluate(() => window.__site.interior());
  rec('Режим «Внутри»: разрез гостевого дома', inn.cut === 'guest' && inn.caps > 0);
  await page.waitForFunction(() => window.__site.idle(), null, { timeout: 30000 }).catch(() => {});
  await page.screenshot({ path: join(SHOTS, 'offline-site-interior.png'), timeout: 180000 });
  await page.locator('.modes [data-mode="walk"]').click();
  await page.waitForTimeout(1500);
  const w0 = await page.evaluate(() => window.__site.walk());
  await page.locator('#scene').focus();
  await page.keyboard.down('KeyW');
  await page.waitForFunction((p) => { const w = window.__site.walk(); return Math.hypot(w.x - p.x, w.z - p.z) > 0.5; }, w0, { timeout: 30000 }).catch(() => {});
  await page.keyboard.up('KeyW');
  const w1 = await page.evaluate(() => window.__site.walk());
  rec('Прогулка работает без сети', Math.hypot(w1.x - w0.x, w1.z - w0.z) > 0.5, `${Math.hypot(w1.x - w0.x, w1.z - w0.z).toFixed(2)} м`);
  await page.screenshot({ path: join(SHOTS, 'offline-site-walk.png'), timeout: 180000 });
  await page.locator('#walk-exit').click();
  await page.waitForTimeout(1500);
  await savePNG(page, 'offline-site-export-1800x1120.png');
  await finish(o, '#s=1.', 'site');
}

async function checkBase(browser) {
  target = 'base';
  console.log('— Дом базы (VSEMDOM-local.zip)');
  const o = await offlinePage(browser, 'VSEMDOM-local.zip', 'VSEMDOM.html', '__vsemdom');
  const { page } = o;
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
  await page.screenshot({ path: join(SHOTS, 'offline-walk.png'), timeout: 180000 });
  await page.locator('#walk-exit').click();
  await page.waitForTimeout(1500);
  await savePNG(page, 'offline-export-1800x1120.png');
  await finish(o, '#r=1.', 'base');
}

const browser = await launchChromium();
try {
  if (!args.target || args.target === 'site') await checkSite(browser);
  if (!args.target || args.target === 'base') await checkBase(browser);
} catch (e) {
  rec(`Исключение: ${e.message.split('\n')[0]}`, false);
} finally {
  await browser.close();
}
writeFileSync(join(ROOT, 'artifacts', 'offline-check.json'), JSON.stringify({
  date: new Date().toISOString(),
  environment: `Chromium ${browser.version()} headless, сеть отключена (context.setOffline + блокировка http/https), программный WebGL`,
  results,
}, null, 2) + '\n');
process.exit(results.every((r) => r.ok) ? 0 : 1);
