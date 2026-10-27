// Браузерные проверки приложения участка (dist/index.html): загрузка без ошибок, постройки на местах и
// нужной высоты, выбор постройки и точки интереса через интерфейс, скрытие заслоняющих деревьев,
// солнце/костёр, прогулка с коллизиями и высотой глаз по рельефу, ссылка, кадр PNG, телефон.
// Состояние читается через window.__site (только чтение), действия — кнопками и клавиатурой.
// Запуск: npm run site:check [-- --url http://127.0.0.1:8772/ --out artifacts/site-check.json]
import { launchChromium } from './browser-launch.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import SITE from '../dist/data/site-spec.js';
import { pointInPolygon } from '../dist/geometry.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
const OUT = join(ROOT, args.out || 'artifacts/site-check.json');
const PORT = 8772;
let BASE = args.url;
let server;
const results = [];
const consoleErrors = [];
let scenario = '';
function record(name, ok, details = {}) {
  results.push({ scenario, name, ok: !!ok, ...details });
  console.log(`${ok ? '✔' : '✘'} ${name}${details.note ? ` — ${details.note}` : ''}`);
}

async function startServer() {
  if (BASE) return;
  server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', join(ROOT, 'dist')], { stdio: 'ignore' });
  BASE = `http://127.0.0.1:${PORT}/`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(BASE); return; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
}

async function openPage(browser, { width = 1280, height = 800, touch = false, query = 'quality=low', hash = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, acceptDownloads: true });
  ctx.setDefaultNavigationTimeout(240000);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${scenario}: ${m.text().slice(0, 300)}`); });
  page.on('pageerror', (e) => consoleErrors.push(`${scenario}: pageerror ${e.message}`));
  await page.goto(`${BASE}blank.html`).catch(() => {});
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* нет доступа */ } }).catch(() => {});
  const t0 = Date.now();
  await page.goto(`${BASE}index.html?${query}${hash}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__site?.ready?.(), null, { timeout: 240000 });
  await page.evaluate(() => window.__site.pauseAnimation(true));
  await page.waitForTimeout(600);
  return { ctx, page, loadMs: Date.now() - t0 };
}

const api = (page, fn, arg) => page.evaluate(fn, arg);
async function settle(page, ms = 400) {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => window.__site?.idle?.(), null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(ms);
}
async function holdUntil(page, key, fn, arg, timeout = 20000) {
  await page.keyboard.down(key);
  await page.waitForFunction(fn, arg, { timeout, polling: 200 }).catch(() => {});
  await page.keyboard.up(key);
  await page.waitForTimeout(300);
}

const insideAnyBuilding = (x, z) => SITE.buildings.some((b) => b.footprint.some((p) => pointInPolygon(x, z, p)));

await startServer();
const browser = await launchChromium();
try {
  // ---------- рабочий стол ----------
  scenario = 'desktop';
  const { ctx, page, loadMs } = await openPage(browser);
  record('Приложение участка загружено', true, { note: `${(loadMs / 1000).toFixed(0)} с на программном WebGL` });
  record('Стартовый режим — обзор участка', (await api(page, () => window.__site.mode())) === 'site');
  const B = await api(page, () => window.__site.buildings());
  const expectTop = { guest: SITE.sources.guest.heights.main.ridgeTop / 1000, grill: null, garage: null };
  for (const b of SITE.buildings) {
    const bb = B[b.id];
    // Пятно с обеденной площадкой (гриль-дом) и навесом (хоз.блок).
    const polys = [...b.footprint, ...(b.dining ? [b.dining] : []), ...(b.carport ? [b.carport.floor] : [])];
    const xs = polys.flat().map((p) => p[0]);
    const zs = polys.flat().map((p) => p[1]);
    const inX = bb.min[0] > Math.min(...xs) - 1.2 && bb.max[0] < Math.max(...xs) + 1.6;
    const inZ = bb.min[2] > Math.min(...zs) - 1.2 && bb.max[2] < Math.max(...zs) + 1.6;
    record(`${b.name}: габарит модели совпадает с пятном на плане (±свесы)`, inX && inZ, { note: `x ${bb.min[0].toFixed(2)}…${bb.max[0].toFixed(2)}, z ${bb.min[2].toFixed(2)}…${bb.max[2].toFixed(2)}` });
    const floor = SITE.levels[b.id].floor - SITE.datum;
    record(`${b.name}: пол на отметке ${SITE.levels[b.id].floor.toFixed(2)}`, Math.abs(bb.floorY - floor) < 1e-6);
    if (expectTop[b.id]) {
      const top = bb.max[1] - bb.floorY;
      record(`${b.name}: верх (конёк + труба) от пола`, top > expectTop[b.id] - 0.05 && top < expectTop[b.id] + 1.6, { note: `${top.toFixed(2)} м, конёк по листу ${expectTop[b.id].toFixed(3)} м` });
    }
  }
  const stats = await api(page, () => window.__site.stats());
  record('Сцена собрана (меши, треугольники)', stats.meshes > 50 && stats.tris > 2e5, { note: `${stats.meshes} мешей, ${(stats.tris / 1e6).toFixed(2)} млн треуг.` });

  // Выбор постройки кнопкой списка: камера перелетает к постройке, подпись меняется.
  for (const b of SITE.buildings) {
    await page.locator(`.bld[data-focus="${b.id}"]`).click();
    await settle(page, 600);
    const cam = await api(page, () => window.__site.camera());
    const bb = B[b.id];
    const tx = cam.target[0], tz = cam.target[2];
    const near = tx > bb.min[0] - 0.5 && tx < bb.max[0] + 0.5 && tz > bb.min[2] - 0.5 && tz < bb.max[2] + 0.5;
    const pressed = await page.locator(`.bld[data-focus="${b.id}"]`).getAttribute('aria-pressed');
    record(`Выбор «${b.name}»: камера нацелена на постройку`, near && pressed === 'true', { note: `цель ${tx.toFixed(1)}, ${tz.toFixed(1)}` });
    const hidden = await api(page, () => window.__site.hiddenTrees());
    record(`Вид «${b.name}»: заслоняющие деревья скрыты`, Array.isArray(hidden), { note: hidden.length ? `скрыто ${hidden.length}: ${hidden.join(', ')}` : 'заслоняющих нет' });
  }
  await page.locator('#clear-view').uncheck();
  await page.waitForFunction(() => window.__site.hiddenTrees().length === 0, null, { timeout: 15000 }).catch(() => {});
  record('Флажок «Не заслонять» выключен — все деревья видны', (await api(page, () => window.__site.hiddenTrees())).length === 0);
  await page.locator('#clear-view').check();
  // Клавиши 1–4 и точки интереса.
  await page.locator('#scene').focus();
  await page.keyboard.press('Digit1');
  await settle(page);
  record('Клавиша 1 — общий вид участка', (await api(page, () => window.__site.focus())) === 'site');
  await page.locator('.views [data-spot="fire"]').click();
  await settle(page);
  const fireCam = await api(page, () => window.__site.camera());
  const fp = SITE.features.firePit.center;
  record('Точка «Кострище»: цель у кострища', Math.hypot(fireCam.target[0] - fp[0], fireCam.target[2] - fp[1]) < 1.5);

  // Солнце: вечер — костёр («авто») и светильники; ручное выключение огня.
  await page.locator('#btn-sun').click();
  await page.waitForTimeout(500);
  await page.locator('#sun-time').evaluate((el) => { el.value = String(22 * 60 + 40); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(800);
  let st = await api(page, () => ({ s: window.__site.state(), fire: window.__site.fire(), pl: window.__site.pointLights(), sun: window.__site.sunInfo() }));
  const pit = st.fire.find((f) => f.name === 'fire-pit');
  record('Вечер 22:40: солнце под горизонтом, костёр горит (авто)', st.s.hour > 22.6 && st.sun.elevation < 0 && pit.k > 0.5 && pit.flames === true, { note: `высота солнца ${st.sun.elevation.toFixed(1)}°` });
  record('Вечер: точечные источники огня активны', st.pl > 0);
  await page.locator('#sun-fire').selectOption('off');
  await page.waitForTimeout(500);
  st = await api(page, () => ({ fire: window.__site.fire() }));
  record('Костёр «Погашен» — огня нет', st.fire.every((f) => f.k === 0));
  await page.locator('#sun-fire').selectOption('auto');
  await page.locator('#sun-time').evaluate((el) => { el.value = String(13 * 60); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(600);
  st = await api(page, () => ({ sun: window.__site.sunInfo() }));
  // Полдень 21 июня во Всеволожске: высота ≈ 53°, азимут ≈ 180° (+ поправка на долготу и UTC+3).
  record('13:00, 21 июня: солнце на юге, высота ≈ 53°', st.sun.elevation > 50 && st.sun.elevation < 55 && st.sun.azimuth > 150 && st.sun.azimuth < 200, { note: `азимут ${st.sun.azimuth.toFixed(0)}°, высота ${st.sun.elevation.toFixed(1)}°` });
  record('Свет падает с юга (Z+ — юг)', st.sun.lightDir[2] > 0.3);
  await page.locator('[data-close="sun-panel"]').click();

  // Прогулка: старт у калитки, движение на север, высота глаз по рельефу, стены построек непроходимы.
  await page.locator('.modes [data-mode="walk"]').click();
  await page.waitForTimeout(800);
  let w = await api(page, () => window.__site.walk());
  record('Прогулка: старт у калитки', w.active && Math.abs(w.z - 39.6) < 1.2, { note: `${w.x.toFixed(2)}, ${w.z.toFixed(2)} · ${w.place}` });
  record('Прогулка: глаза на 1,62 м над поверхностью', Math.abs(w.eyeY - w.floor - 1.62) < 0.05);
  const z0 = w.z;
  await holdUntil(page, 'KeyW', (z) => window.__site.walk().z < z - 2, z0);
  w = await api(page, () => window.__site.walk());
  record('Прогулка: W — движение на север по дорожке', w.z < z0 - 1.5, { note: `${z0.toFixed(2)} → ${w.z.toFixed(2)}` });
  // Упор в западную стену гостевого дома: поставить перед стеной лицом на восток и идти.
  const guest = SITE.buildings.find((b) => b.id === 'guest');
  const gx0 = Math.min(...guest.footprint[0].map((p) => p[0]));
  await api(page, (x) => { const wk = window.__site.app.walk; wk.pose.x = x - 1.6; wk.pose.z = 19.2; wk.pose.yaw = -Math.PI / 2; wk.app.invalidate(); }, gx0);
  await page.waitForTimeout(400);
  await holdUntil(page, 'KeyW', () => false, null, 10000);
  w = await api(page, () => window.__site.walk());
  record('Прогулка: стена постройки непроходима', !insideAnyBuilding(w.x, w.z) && w.x < gx0 - 0.2 && w.x > gx0 - 1.6, { note: `x ${w.x.toFixed(2)} при стене ${gx0.toFixed(2)}` });
  // Обеденная площадка: пол настила.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  record('Прогулка: Esc — пауза', (await api(page, () => window.__site.walk())).paused);
  await page.locator('#walk-exit').click();
  await page.waitForTimeout(600);
  record('Выход из прогулки — обзор участка', (await api(page, () => window.__site.mode())) === 'site');

  // Ссылка: состояние в адресе восстанавливается.
  await api(page, () => window.__site.app.store.commit((s) => { s.hour = 18.5; s.solar.date = '2026-09-01'; }, 'проверка'));
  const hash = await api(page, () => window.__site.encodeHash());
  const { ctx: ctx2, page: p2 } = await openPage(browser, { hash });
  const s2 = await api(p2, () => window.__site.state());
  record('Ссылка #s=1.… восстанавливает дату и время', s2.hour === 18.5 && s2.solar.date === '2026-09-01');
  await ctx2.close();

  // Кадр PNG.
  const size = await api(page, async () => (await window.__site.app.exportPNG(900, 560)).size);
  record('Кадр PNG сохраняется', size > 50000, { note: `${(size / 1024).toFixed(0)} КБ` });
  await ctx.close();

  // ---------- телефон ----------
  scenario = 'mobile';
  const m = await openPage(browser, { width: 390, height: 800, touch: true });
  const layout = await api(m.page, () => ({ sw: document.documentElement.scrollWidth, w: innerWidth, collapsed: document.getElementById('side-panel').classList.contains('collapsed') }));
  record('Телефон: без горизонтальной прокрутки', layout.sw <= layout.w);
  record('Телефон: список построек свёрнут', layout.collapsed);
  await m.page.locator('.modes [data-mode="walk"]').tap();
  await m.page.waitForTimeout(800);
  const joy = await m.page.locator('#joystick').isVisible();
  record('Телефон: в прогулке виден джойстик', joy);
  await m.ctx.close();
} catch (e) {
  record(`Исключение: ${e.message.split('\n')[0]}`, false);
} finally {
  await browser.close();
  server?.kill();
}

record('Ошибок в консоли нет', consoleErrors.length === 0, { note: consoleErrors.slice(0, 3).join(' | ') });
mkdirSync(dirname(OUT), { recursive: true });
const failed = results.filter((r) => !r.ok);
writeFileSync(OUT, JSON.stringify({ date: new Date().toISOString(), total: results.length, failed: failed.length, results, consoleErrors }, null, 2));
console.log(`\nПроверок: ${results.length}, не пройдено: ${failed.length} → ${OUT}`);
process.exit(failed.length ? 1 : 0);
