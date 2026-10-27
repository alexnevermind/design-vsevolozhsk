// Браузерные проверки пользовательских маршрутов: реальные кнопки, pointer/touch-события и клавиатура.
// Состояние читается через диагностический API window.__vsemdom (только чтение), изменения — через интерфейс.
// Запуск: npm run browser:check [-- --url http://127.0.0.1:8769/ --out artifacts/browser-check.json]
import { launchChromium } from './browser-launch.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, v, i, a) => (v.startsWith('--') ? [...acc, [v.slice(2), a[i + 1]]] : acc), []));
const OUT = join(ROOT, args.out || 'artifacts/browser-check.json');
const ONLY = args.only ? args.only.split(',') : null;
const PORT = 8771;
let BASE = args.url;
let server;

const results = [];
const consoleErrors = [];
let currentScenario = null;
function record(name, ok, details = {}) {
  results.push({ scenario: currentScenario, name, ok: !!ok, ...details });
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

const LAUNCH = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] };

async function openPage(browser, { width = 1100, height = 700, url = `${BASE}base-house.html?quality=low`, touch = false, clear = true, animate = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1, acceptDownloads: true });
  // Программный WebGL: сборка сцены при загрузке модуля может занять больше 30 с.
  ctx.setDefaultNavigationTimeout(180000);
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(`${m.text().slice(0, 300)}${m.location()?.url ? ` @ ${m.location().url}` : ''}`); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  if (clear) {
    await page.goto(`${BASE}blank.html`).catch(() => {});
    await page.evaluate(() => { try { localStorage.clear(); } catch { /* нет доступа */ } }).catch(() => {});
  }
  await page.goto(url);
  await page.waitForFunction(() => window.__vsemdom?.ready?.(), null, { timeout: 180000 });
  // Живой огонь на программном WebGL — кадр за секунды; вне сценария участка анимация на паузе.
  if (!animate) await page.evaluate(() => window.__vsemdom.pauseAnimation(true));
  await page.waitForTimeout(800);
  return { ctx, page };
}

const S = (page) => page.evaluate(() => window.__vsemdom.state());
const H = (page) => page.evaluate(() => window.__vsemdom.history());
// Удерживать клавишу, пока условие не выполнится (кадры программного WebGL медленные).
async function holdUntil(page, key, fn, arg, timeout = 15000) {
  await page.keyboard.down(key);
  await page.waitForFunction(fn, arg, { timeout, polling: 200 }).catch(() => {});
  await page.keyboard.up(key);
  await page.waitForTimeout(300);
}

// Ожидание завершения перелёта камеры и анимаций (программный WebGL рисует медленно).
async function settle(page, ms = 500) {
  await page.waitForTimeout(150);
  await page.waitForFunction(() => window.__vsemdom?.idle?.(), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function clickText(page, selector, text) {
  await page.locator(selector, { hasText: text }).first().click();
  await settle(page);
}

async function itemScreen(page, id) {
  return page.evaluate((i) => window.__vsemdom.itemScreen(i), id);
}

async function floorScreen(page, x, z, y = 0) {
  return page.evaluate(([a, b, c]) => window.__vsemdom.screenOf(a, c, b), [x, z, y]);
}

// Первая из точек пола, видимая на холсте (не под панелями интерфейса).
async function visibleFloor(page, candidates) {
  for (const [x, z] of candidates) {
    const p = await floorScreen(page, x, z);
    if (await page.evaluate(([sx, sy]) => window.__vsemdom.onCanvas(sx, sy), p)) return { p, x, z };
  }
  return null;
}

// Мышь: нажатие, движение по шагам, отпускание.
async function mouseDrag(page, from, to, { steps = 12, before = null, beforeUp = null } = {}) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
    if (i === 2 && before) await before();
  }
  await settle(page, 600);
  if (beforeUp) await beforeUp();
  await page.mouse.up();
  await settle(page, 900);
}

async function cdpTouch(page) {
  return page.context().newCDPSession(page);
}

async function touch(cdp, type, points) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], i) => ({ x, y, id: i + 1, radiusX: 4, radiusY: 4, force: 1 })) });
}

// ---------------- сценарии ----------------
const scenarios = {
  async startup(browser) {
    const { ctx, page } = await openPage(browser);
    const s = await S(page);
    record('Начальный проект: 23 предмета нового дома', s.items.length === 23, { note: `${s.items.length}` });
    const rooms = await page.evaluate(() => window.__vsemdom.rooms);
    record('Восемь зон с номерами и площадями', rooms.length === 8 && rooms.map((r) => r.id).join() === '001,002,003,004,005,006,007,008', { note: rooms.map((r) => `${r.id}:${r.area}`).join(' ') });
    const label = await page.locator('#room-label').innerText();
    record('Подпись площади дома и террасы', label.includes('72,0') && label.includes('20,0'), { note: label });
    const cam = await page.evaluate(() => window.__vsemdom.camera());
    record('Фасадный ракурс при старте (FOV 33°)', Math.abs(cam.fov - 33) < 0.01 && cam.position[1] > 3 && cam.position[1] < 6, { note: JSON.stringify(cam) });
    const settled = await page.evaluate(async () => { const a = window.__vsemdom.renderCount(); await new Promise((r) => setTimeout(r, 2500)); return window.__vsemdom.renderCount() - a; });
    record('Остановившаяся сцена не перерисовывается непрерывно', settled <= 3, { note: `кадров за 2,5 с: ${settled}` });
    await ctx.close();
  },

  async facade(browser) {
    const { ctx, page } = await openPage(browser);
    const h0 = await H(page);
    await clickText(page, '#side-body button', 'Весь дом одним цветом');
    await clickText(page, '#dock-strip .swatch', 'Винный');
    let s = await S(page);
    const all = ['north', 'east', 'south', 'west'].every((k) => s.mats[`facade:${k}`] === 'ext-D110') && s.cladding.loggia === 'ext-D110';
    const h1 = await H(page);
    record('«Весь дом одним цветом» — четыре фасада и навес одним действием', all && h1.index === h0.index + 1, { note: `history ${h0.index}→${h1.index}` });
    const meshes = await page.evaluate(() => ['facade:north', 'facade:east', 'facade:south', 'facade:west', 'loggia'].map((k) => window.__vsemdom.surfaceMaterials(k)[0]?.name));
    record('Материал реальных мешей фасада обновлён', meshes.every((n) => n && n.includes('#65413F')), { note: meshes.join(' | ') });
    await page.locator('#btn-undo').click();
    await settle(page);
    s = await S(page);
    record('Undo возвращает исходную схему фасада', s.mats['facade:east'] === 'ext-Q854' && s.mats['facade:north'] === 'ext-D129');
    await page.keyboard.press('Control+Shift+Z');
    await settle(page);
    s = await S(page);
    record('Redo (Ctrl+Shift+Z) повторяет окраску', s.mats['facade:west'] === 'ext-D110');
    // Каждый из семи оттенков на отдельной стороне.
    await clickText(page, '#side-body button', 'Северный');
    const swatches = await page.locator('#dock-strip .swatch').count();
    let ok = swatches === 7;
    for (let i = 0; i < swatches; i++) {
      await page.locator('#dock-strip .swatch').nth(i).click();
      await settle(page, 300);
      const id = (await S(page)).mats['facade:north'];
      const expected = await page.locator('#dock-strip .swatch').nth(i).getAttribute('data-mat');
      ok = ok && id === expected;
    }
    record('Семь фасадных оттенков применимы к стороне фасада', ok, { note: `${swatches} образцов` });
    // Терраса.
    await clickText(page, '#dock-tabs button', 'Терраса');
    await clickText(page, '#dock-strip .swatch', 'Светлый дуб');
    await clickText(page, '#dock-strip .swatch', 'Чёрный ясень');
    s = await S(page);
    const deck = await page.evaluate(() => window.__vsemdom.surfaceMaterials('floor:008').map((m) => m.name));
    record('Настил террасы и ступеней: светлый дуб → чёрный ясень', s.mats['floor:008'] === 'ash' && deck.every((n) => n === 'deck|ash'), { note: deck.join(',') });
    // Кровля.
    await clickText(page, '#side-body button', 'Металлочерепица');
    record('Тип кровли меняет геометрию покрытия (металлочерепица)', (await page.evaluate(() => window.__vsemdom.roofType())) === 'metalTile' && (await S(page)).roofType === 'metalTile');
    await clickText(page, '#side-body button', 'Кликфальц');
    record('Возврат к кликфальцу', (await page.evaluate(() => window.__vsemdom.roofType())) === 'standingSeam');
    // Превью по наведению не меняет состояние.
    await clickText(page, '#dock-tabs button', 'Фасад');
    const before = JSON.stringify(await S(page));
    const hb = await H(page);
    await page.locator('#dock-strip .swatch').nth(5).hover();
    await settle(page);
    const preview = await page.evaluate(() => window.__vsemdom.surfaceMaterials('facade:north')[0]?.name);
    await page.mouse.move(600, 200);
    await settle(page);
    const after = JSON.stringify(await S(page));
    record('Превью материала не меняет сохранённое состояние и историю', before === after && (await H(page)).index === hb.index, { note: `превью: ${preview}` });
    await ctx.close();
  },

  async interiorFinishes(browser) {
    const { ctx, page } = await openPage(browser);
    await clickText(page, '.modes button', 'Внутри');
    await clickText(page, '.room-list button', '005');
    record('Выбор помещения 005 и подпись', (await page.evaluate(() => window.__vsemdom.activeRoom())) === '005' && (await page.locator('#room-label').innerText()).includes('Кухня-гостиная'));
    for (const [label, id] of [['Горизонтальная', 'horizontal'], ['Гладкая', 'smooth'], ['Вертикальная', 'vertical']]) {
      await clickText(page, '#side-body button', label);
      record(`Облицовка стен: ${label.toLowerCase()}`, (await S(page)).wallLayout === id);
    }
    await clickText(page, '#dock-tabs button', 'Стены');
    const n = await page.locator('#dock-strip .swatch').count();
    await clickText(page, '#dock-strip .swatch', 'Sepal');
    let s = await S(page);
    const walls = Object.entries(s.mats).filter(([k]) => k.startsWith('wall:'));
    record('Единый цвет внутренних стен всех помещений', n === 7 && walls.length === 6 && walls.every(([, v]) => v === 'tk-L447'), { note: walls.map(([k, v]) => `${k}=${v}`).join(' ') });
    await clickText(page, '#dock-tabs button', 'Пол дома');
    await clickText(page, '#dock-strip .swatch', 'Светлый дуб');
    s = await S(page);
    const wood = ['001', '002', '003', '004', '005'].every((r) => s.mats[`floor:${r}`] === 'whiteoak');
    record('Общий пол дома одним выбором; санузел и терраса сохраняются', wood && s.mats['floor:006'] === 'terrazzo' && s.mats['floor:008'] === 'walnut');
    await clickText(page, '#dock-tabs button', 'Санузел');
    await clickText(page, '#dock-strip .swatch', 'Сланец');
    s = await S(page);
    record('Пол санузла и парной независим', s.mats['floor:006'] === 'slate' && s.mats['floor:007'] === 'slate' && s.mats['floor:005'] === 'whiteoak');
    // Двери и потолок.
    await page.locator('#btn-doors').click();
    await settle(page);
    await page.locator('#modal-body .swatch', { hasText: 'Серый' }).click();
    await settle(page);
    await page.locator('#modal-body button', { hasText: 'Матовый натяжной' }).click();
    await settle(page);
    await page.locator('#modal-body .swatch', { hasText: 'Bungalow' }).click();
    await settle(page);
    s = await S(page);
    record('Двери: серый; потолок: матовый натяжной, оттенок G500', s.mats.interiorDoors === 'door-grey' && s.ceilingType === 'stretch' && s.mats.ceiling === 'tk-G500');
    const doorMats = await page.evaluate(() => window.__vsemdom.surfaceMaterials('interiorDoors').length);
    await page.locator('#dc-inside').click();
    await page.waitForTimeout(2500);
    const w = await page.evaluate(() => window.__vsemdom.walk());
    record('«Посмотреть изнутри»: прогулка в комнате с взглядом к потолку', (await page.evaluate(() => window.__vsemdom.mode())) === 'walk' && w.pitch > 0.4 && w.room === '005' && Math.abs(w.eyeY - 1.6) < 0.01, { note: JSON.stringify({ room: w.room, pitch: w.pitch, eyeY: w.eyeY, doorMeshes: doorMats }) });
    await page.locator('#walk-exit').click();
    await settle(page, 1500);
    record('Возврат к обзору восстанавливает режим «Внутри» и помещение', (await page.evaluate(() => window.__vsemdom.mode())) === 'interior' && (await page.evaluate(() => window.__vsemdom.activeRoom())) === '005');
    await ctx.close();
  },

  async furniture(browser) {
    const { ctx, page } = await openPage(browser);
    await clickText(page, '.modes button', 'Внутри');
    await page.waitForTimeout(1500);
    const cards = await page.locator('#dock-strip .card').count();
    record('Каталог: шесть карточек', cards === 6);
    let s = await S(page);
    await page.locator('#dock-strip .card', { hasText: 'Шкаф' }).click();
    await settle(page, 1200);
    let s2 = await S(page);
    const added = s2.items.filter((i) => !s.items.some((q) => q.id === i.id));
    record('Клик по карточке добавляет ровно один шкаф с привязкой к стене', added.length === 1 && added[0].type === 'wardrobe' && !!added[0].anchor, { note: JSON.stringify(added[0]) });
    await page.locator('#dock-strip .card', { hasText: 'Стул' }).focus();
    await page.keyboard.press('Enter');
    await settle(page, 1200);
    const s3 = await S(page);
    record('Enter на карточке добавляет ровно один предмет', s3.items.length === s2.items.length + 1);
    // Перенос существующего стула с отменой Escape.
    await page.evaluate(() => { const a = window.__vsemdom.app; a.selectRoom('005'); });
    await settle(page, 1200);
    const chair = s3.items.find((i) => i.id === 18);
    const p0 = await itemScreen(page, 18);
    const hBefore = await H(page);
    let lift = null;
    let rotated = null;
    await mouseDrag(page, p0, [p0[0] - 60, p0[1] + 40], {
      beforeUp: async () => {
        const d = await page.evaluate(() => window.__vsemdom.drag());
        lift = d?.lifted;
        await page.mouse.wheel(0, 120);
        await settle(page, 600);
        rotated = (await page.evaluate(() => window.__vsemdom.drag()))?.ry;
        await page.keyboard.press('Escape');
        await settle(page, 400);
      },
    });
    s = await S(page);
    const c2 = s.items.find((i) => i.id === 18);
    record('Перенос: подъём ~14 см, колесо поворачивает на 45° без масштабирования камеры', lift > 0.05 && rotated !== null && Math.abs(Math.abs(rotated - chair.ry) - Math.PI / 4) < 1e-6, { note: `lift=${lift}, ry ${chair.ry}→${rotated}` });
    record('Escape отменяет перенос: предмет и история прежние', c2.x === chair.x && c2.z === chair.z && (await H(page)).index === hBefore.index);
    // Перенос с фиксацией и точкой захвата.
    const camBefore = await page.evaluate(() => window.__vsemdom.camera());
    await settle(page, 600);
    // Экранная точка стула заново: после первого переноса кадр мог сместиться.
    const p1 = await itemScreen(page, 18);
    const grabPt = [p1[0] + 4, p1[1] + 6];
    const grabFloor = await page.evaluate(([x, y]) => window.__vsemdom.floorAt(x, y), grabPt);
    const off = [chair.x - grabFloor[0], chair.z - grabFloor[1]];
    const tgt = await visibleFloor(page, [[2.6, 0.9], [2.0, 1.0], [1.4, 0.8], [3.0, 0.7]]);
    await mouseDrag(page, grabPt, tgt.p, { steps: 16 });
    s = await S(page);
    const c3 = s.items.find((i) => i.id === 18);
    const moved = Math.hypot(c3.x - chair.x, c3.z - chair.z);
    record('Перенос фиксируется после отпускания (одно действие)', moved > 0.3 && (await H(page)).index === hBefore.index + 1, { note: `(${chair.x},${chair.z})→(${c3.x},${c3.z})` });
    const expect = [tgt.x + off[0], tgt.z + off[1]];
    record('Точка захвата сохраняется (основание = точка пола + смещение захвата, ±0,25 м с учётом сетки/поиска)', Math.hypot(c3.x - expect[0], c3.z - expect[1]) < 0.25, { note: `ожидалось (${expect[0].toFixed(2)}, ${expect[1].toFixed(2)}), получено (${c3.x}, ${c3.z})` });
    const camAfter = await page.evaluate(() => window.__vsemdom.camera());
    record('Камера не вращалась во время переноса', JSON.stringify(camBefore.position.map((v) => v.toFixed(2))) === JSON.stringify(camAfter.position.map((v) => v.toFixed(2))));
    // Недопустимое место: шкаф в прихожую 004.
    const ward = s.items.find((i) => i.type === 'wardrobe' && i.id > 23);
    const wp = await itemScreen(page, ward.id);
    const hall = (await visibleFloor(page, [[5.2, -1.6], [5.0, -2.2], [5.4, -0.8]])).p;
    await mouseDrag(page, wp, hall, { steps: 14 });
    const s4 = await S(page);
    const w2 = s4.items.find((i) => i.id === ward.id);
    record('Недопустимый сброс (прихожая 004) сохраняет прежнее положение', w2.x === ward.x && w2.z === ward.z);
    // Удаление выносом за дом и возврат.
    const sp = await itemScreen(page, 16);
    const outside = (await visibleFloor(page, [[2.0, -4.4], [0, -4.6], [3.5, -4.3], [-1, 4.4], [10.2, 2]])).p;
    await mouseDrag(page, sp, outside, { steps: 18 });
    const s5 = await S(page);
    record('Вынос за контур дома удаляет предмет', !s5.items.some((i) => i.id === 16));
    await page.keyboard.press('Control+Z');
    await settle(page);
    record('Undo возвращает удалённый предмет', (await S(page)).items.some((i) => i.id === 16));
    // Поворот кнопкой и удаление кнопкой.
    const cp = await itemScreen(page, 17);
    await page.mouse.click(cp[0], cp[1]);
    await settle(page);
    const sel = await page.evaluate(() => window.__vsemdom.selected());
    const r0 = (await S(page)).items.find((i) => i.id === 17).ry;
    await page.locator('#btn-rot-left').click();
    await settle(page);
    const r1 = (await S(page)).items.find((i) => i.id === 17).ry;
    record('Выбор кликом и поворот кнопкой на 90°', sel === 17 && Math.abs(Math.abs(r1 - r0) - Math.PI / 2) < 1e-6, { note: `${r0}→${r1}` });
    await page.keyboard.press('Delete');
    await settle(page);
    record('Delete удаляет выбранный предмет', !(await S(page)).items.some((i) => i.id === 17));
    // Перенос из каталога: на сцену — добавляет, на интерфейс — нет.
    const n0 = (await S(page)).items.length;
    const card = await page.locator('#dock-strip .card', { hasText: 'Стул' }).boundingBox();
    const spot = (await visibleFloor(page, [[0.6, 1.0], [1.2, 0.9], [2.4, 1.0]])).p;
    await mouseDrag(page, [card.x + card.width / 2, card.y + 20], spot, { steps: 20 });
    const n1 = (await S(page)).items.length;
    record('Перенос карточки на пол помещения добавляет один предмет', n1 === n0 + 1);
    await mouseDrag(page, [card.x + card.width / 2, card.y + 20], [card.x + 200, card.y - 10], { steps: 10 });
    record('Сброс карточки над интерфейсом не добавляет предмет', (await S(page)).items.length === n1);
    await ctx.close();
  },

  async tv(browser) {
    const { ctx, page } = await openPage(browser);
    await clickText(page, '.modes button', 'Внутри');
    await clickText(page, '.room-list button', '005');
    await settle(page, 800);
    const cam0 = await page.evaluate(() => window.__vsemdom.camera());
    await page.locator('#dock-strip .card', { hasText: 'Телевизор' }).click();
    await settle(page, 800);
    let s = await S(page);
    const tv = s.items.find((i) => i.type === 'tv');
    const cam1 = await page.evaluate(() => window.__vsemdom.camera());
    record('Телевизор: место на стене помещения (wall, side, u, y) и показ камерой', !!tv && tv.wall && (tv.side === 1 || tv.side === -1) && Number.isFinite(tv.u) && Number.isFinite(tv.y) && JSON.stringify(cam0.position) !== JSON.stringify(cam1.position), { note: JSON.stringify(tv) });
    const p = await itemScreen(page, tv.id);
    // По стене (на +0,5 м по X, к свободной части) и чуть вверх.
    const q = await page.evaluate((id) => { const o = window.__vsemdom.app.house.itemObjects.get(id).position; return [window.__vsemdom.screenOf(o.x, o.y + 0.3, o.z), window.__vsemdom.screenOf(o.x + 0.5, o.y + 0.3, o.z)]; }, tv.id);
    await mouseDrag(page, p, [p[0] + (q[1][0] - q[0][0]), p[1] - 30], { steps: 12 });
    s = await S(page);
    const tv2 = s.items.find((i) => i.id === tv.id);
    record('Телевизор переносится по стене и по высоте', tv2.wall && (Math.abs(tv2.u - tv.u) > 0.05 || Math.abs(tv2.y - tv.y) > 0.05), { note: `u ${tv.u}→${tv2.u}, y ${tv.y}→${tv2.y}` });
    // Новый ТВ над полом (не на стене) не добавляется.
    const n0 = s.items.length;
    const card = await page.locator('#dock-strip .card', { hasText: 'Телевизор' }).boundingBox();
    await page.evaluate(() => { const a = window.__vsemdom.app; a.camera.position.set(1.5, 18, 0.01); a.controls.target.set(1.5, 0, 0); a.controls.update(); });
    await settle(page, 1200);
    const floor = await floorScreen(page, 1.0, 1.4);
    await mouseDrag(page, [card.x + card.width / 2, card.y + 20], floor, { steps: 12 });
    record('Новый телевизор, отпущенный над полом, не добавляется', (await S(page)).items.length === n0);
    await ctx.close();
  },

  async walk(browser) {
    const { ctx, page } = await openPage(browser);
    await clickText(page, '.modes button', 'Прогулка');
    await page.waitForTimeout(1500);
    let w = await page.evaluate(() => window.__vsemdom.walk());
    record('Прогулка начинается у свободной прихожей 004 на высоте глаз 1,60 м', w.room === '004' && Math.abs(w.eyeY - 1.6) < 1e-6 && w.fov === 68 && w.near === 0.06, { note: JSON.stringify({ room: w.room, eyeY: w.eyeY }) });
    await page.locator('#scene').focus();
    await holdUntil(page, 'KeyW', (p) => { const w = window.__vsemdom.walk(); return Math.hypot(w.x - p.x, w.z - p.z) > 1.2; }, w);
    await settle(page);
    const w2 = await page.evaluate(() => window.__vsemdom.walk());
    record('WASD перемещает человека (через открытую дверь в 005)', Math.hypot(w2.x - w.x, w2.z - w.z) > 0.6, { note: `(${w.x.toFixed(2)},${w.z.toFixed(2)})→(${w2.x.toFixed(2)},${w2.z.toFixed(2)}) ${w2.room}` });
    // Отойти назад в прихожую (S), смотреть на дверь 004 и закрыть её клавишей E.
    await holdUntil(page, 'KeyS', () => { const w = window.__vsemdom.walk(); return w.room === '004' && w.z < -0.75; });
    await settle(page);
    record('S возвращает в прихожую', (await page.evaluate(() => window.__vsemdom.walk())).room === '004');
    const d0 = (await page.evaluate(() => window.__vsemdom.walk())).doors['D-004'];
    await page.keyboard.press('KeyE');
    await page.waitForFunction((v) => Math.abs(window.__vsemdom.walk().doors['D-004'] - v) > 60, d0, { timeout: 15000, polling: 200 }).catch(() => {});
    const d1 = (await page.evaluate(() => window.__vsemdom.walk())).doors['D-004'];
    record('E закрывает/открывает дверь вокруг петли', Math.abs(d1 - d0) > 30, { note: `${d0}→${d1}` });
    // Движение в закрытую дверь — преграда.
    const w3 = await page.evaluate(() => window.__vsemdom.walk());
    await holdUntil(page, 'KeyW', () => window.__vsemdom.walk().room !== '004', null, 6000);
    const w4 = await page.evaluate(() => window.__vsemdom.walk());
    record('Через закрытую дверь пройти нельзя', w4.room === w3.room, { note: `${w3.room}→${w4.room}` });
    await page.keyboard.press('Escape');
    await settle(page);
    record('Escape ставит прогулку на паузу', (await page.evaluate(() => window.__vsemdom.walk())).paused === true && await page.locator('#walk-paused').isVisible());
    await page.locator('#walk-resume').click();
    await settle(page);
    record('«Продолжить» снимает паузу', (await page.evaluate(() => window.__vsemdom.walk())).paused === false);
    // Запасной взгляд перетаскиванием.
    const y0 = (await page.evaluate(() => window.__vsemdom.walk())).yaw;
    await page.mouse.move(500, 400);
    await page.mouse.down();
    await page.mouse.move(600, 400, { steps: 6 });
    await page.mouse.up();
    await settle(page);
    const y1 = (await page.evaluate(() => window.__vsemdom.walk())).yaw;
    record('Перетаскивание мыши поворачивает взгляд (без Pointer Lock)', Math.abs(y1 - y0) > 0.1, { note: `${y0}→${y1}` });
    await page.locator('#walk-exit').click();
    await settle(page, 1500);
    const cam = await page.evaluate(() => window.__vsemdom.camera());
    record('Возврат к обзору восстанавливает режим «Снаружи» и камеру', (await page.evaluate(() => window.__vsemdom.mode())) === 'exterior' && cam.fov === 33);
    await ctx.close();
  },

  async touchWalk(browser) {
    const { ctx, page } = await openPage(browser, { width: 390, height: 760, touch: true });
    await page.locator('.modes button', { hasText: 'Прогулка' }).tap();
    await page.waitForTimeout(1500);
    const cdp = await cdpTouch(page);
    const joy = await page.locator('#joystick').boundingBox();
    const w0 = await page.evaluate(() => window.__vsemdom.walk());
    const cx = joy.x + joy.width / 2;
    const cy = joy.y + joy.height / 2;
    await touch(cdp, 'touchStart', [[cx, cy]]);
    for (let i = 1; i <= 6; i++) { await touch(cdp, 'touchMove', [[cx, cy - i * 8]]); await page.waitForTimeout(120); }
    await page.waitForTimeout(1500);
    await touch(cdp, 'touchEnd', []);
    const w1 = await page.evaluate(() => window.__vsemdom.walk());
    record('Сенсорный джойстик перемещает человека', Math.hypot(w1.x - w0.x, w1.z - w0.z) > 0.3, { note: `${Math.hypot(w1.x - w0.x, w1.z - w0.z).toFixed(2)} м` });
    await touch(cdp, 'touchStart', [[250, 300]]);
    for (let i = 1; i <= 5; i++) await touch(cdp, 'touchMove', [[250 + i * 15, 300]]);
    await touch(cdp, 'touchEnd', []);
    await settle(page);
    const w2 = await page.evaluate(() => window.__vsemdom.walk());
    record('Сенсорное перетаскивание поворачивает взгляд', Math.abs(w2.yaw - w1.yaw) > 0.1);
    await ctx.close();
  },

  async touchEditor(browser) {
    const { ctx, page } = await openPage(browser, { width: 390, height: 760, touch: true });
    await page.locator('.modes button', { hasText: 'Внутри' }).tap();
    await page.waitForTimeout(1800);
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth > window.innerWidth + 1);
    record('390 px: нет горизонтального переполнения страницы', !overflow);
    const cdp = await cdpTouch(page);
    const strip = await page.locator('#dock-strip').boundingBox();
    const sl0 = await page.locator('#dock-strip').evaluate((e) => e.scrollLeft);
    const n0 = (await S(page)).items.length;
    // Горизонтальное движение вдоль каталога — прокрутка, а не перенос.
    const y = strip.y + strip.height / 2;
    await touch(cdp, 'touchStart', [[strip.x + 300, y]]);
    for (let i = 1; i <= 8; i++) await touch(cdp, 'touchMove', [[strip.x + 300 - i * 25, y + 1]]);
    await touch(cdp, 'touchEnd', []);
    await settle(page);
    const sl1 = await page.locator('#dock-strip').evaluate((e) => e.scrollLeft);
    record('Каталог прокручивается горизонтально пальцем, предмет не добавляется', sl1 > sl0 && (await S(page)).items.length === n0, { note: `scrollLeft ${sl0}→${sl1}` });
    // Направленное движение вверх запускает перенос; второй палец отменяет.
    await page.locator('#dock-strip').evaluate((e) => { e.scrollLeft = 0; });
    await page.waitForTimeout(300);
    const card = await page.locator('#dock-strip .card').first().boundingBox();
    const cx = card.x + card.width / 2;
    const cy = card.y + card.height / 2;
    await touch(cdp, 'touchStart', [[cx, cy]]);
    for (let i = 1; i <= 8; i++) { await touch(cdp, 'touchMove', [[cx, cy - i * 30]]); await page.waitForTimeout(60); }
    await page.waitForTimeout(800);
    const dragging = await page.evaluate(() => window.__vsemdom.drag());
    // Второй палец касается сцены.
    await touch(cdp, 'touchStart', [[cx, cy - 240], [200, 260]]);
    await page.waitForTimeout(800);
    const afterSecond = await page.evaluate(() => window.__vsemdom.drag());
    await touch(cdp, 'touchEnd', []);
    await settle(page, 800);
    record('Вверх из каталога — перенос; второй палец отменяет без добавления', !!dragging && dragging.kind === 'new' && afterSecond === null && (await S(page)).items.length === n0, { note: JSON.stringify(dragging) });
    // Основные действия доступны: палитры, отделка, двери и потолок.
    const visible = await Promise.all(['#btn-doors', '#btn-sun', '#btn-undo', '#dock-strip', '.modes'].map((sel) => page.locator(sel).first().isVisible()));
    record('390 px: основные кнопки доступны', visible.every(Boolean));
    // Кнопка «Панель» не перекрыта лентой: открывает и закрывает панель касанием.
    const toggleFree = async () => page.evaluate(() => {
      const b = document.getElementById('sheet-toggle').getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !!hit && hit.closest('#sheet-toggle') !== null;
    });
    const free1 = await toggleFree();
    await page.locator('#sheet-toggle').tap({ timeout: 15000 }).catch(() => {});
    const opened = await page.locator('#side-panel').evaluate((e) => !e.classList.contains('collapsed'));
    const free2 = await toggleFree();
    await page.locator('#sheet-toggle').tap({ timeout: 15000 }).catch(() => {});
    const closed = await page.locator('#side-panel').evaluate((e) => e.classList.contains('collapsed'));
    record('390 px: кнопка «Панель» над лентой открывает и закрывает панель', free1 && opened && free2 && closed, { note: `${free1}/${opened}/${free2}/${closed}` });
    await page.locator('#btn-doors').tap();
    await settle(page);
    const modal = await page.locator('.modal').boundingBox();
    record('Модальное окно «Двери и потолок» вписывается в экран', modal && modal.y >= 0 && modal.y + modal.height <= 760 && modal.width <= 390);
    await ctx.close();
    const small = await openPage(browser, { width: 320, height: 640, touch: true });
    const of2 = await small.page.evaluate(() => document.scrollingElement.scrollWidth > window.innerWidth + 1);
    const vis2 = await Promise.all(['.modes', '#dock-strip', '#btn-undo', '#btn-sun'].map((sel) => small.page.locator(sel).first().isVisible()));
    record('320 px: без переполнения, основные элементы видимы', !of2 && vis2.every(Boolean));
    await small.ctx.close();
  },

  async sun(browser) {
    const { ctx, page } = await openPage(browser);
    await page.locator('#btn-sun').click();
    await settle(page, 2500);
    const previews = await page.locator('#sun-previews canvas').count();
    record('Четыре превью освещения (утро, день, вечер, ночь)', previews === 4);
    const info0 = await page.evaluate(() => window.__vsemdom.sunInfo());
    const agree = Math.hypot(...info0.dir.map((v, i) => v - info0.lightDir[i])) < 1e-6;
    record('Источник света и расчёт солнца совпадают (10:30, 21.06)', agree && info0.elevation > 40, { note: `аз ${info0.azimuth.toFixed(1)}°, h ${info0.elevation.toFixed(1)}°` });
    await page.locator('#sun-north').fill('90');
    await page.locator('#sun-north').press('Enter');
    await page.locator('#sun-north').blur();
    await settle(page, 1200);
    const info1 = await page.evaluate(() => window.__vsemdom.sunInfo());
    const rot = Math.atan2(info1.lightDir[2], info1.lightDir[0]) - Math.atan2(info0.lightDir[2], info0.lightDir[0]);
    const rotN = ((rot + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    record('Север 90° поворачивает направление солнца на 90°', Math.abs(Math.abs(rotN) - Math.PI / 2) < 0.02 && (await S(page)).solar.northAngle === 90, { note: `${(rotN * 180 / Math.PI).toFixed(1)}°` });
    await page.locator('#sun-date').fill('2026-12-21');
    await page.locator('#sun-date').dispatchEvent('change');
    await settle(page, 1200);
    const info2 = await page.evaluate(() => window.__vsemdom.sunInfo());
    record('Дата 21.12 даёт низкое зимнее солнце', info2.elevation < 7 && (await S(page)).solar.date === '2026-12-21', { note: `${info2.elevation.toFixed(1)}°` });
    const slider = page.locator('#sun-time');
    await slider.focus();
    await slider.evaluate((el) => { el.value = String(23 * 60 + 30); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle(page, 1500);
    const night = await page.evaluate(() => window.__vsemdom.sunInfo());
    record('Ночь: дневной свет выключен, светильники включены', night.day < 0.05 && night.lamp > 0.9, { note: `day ${night.day.toFixed(2)}, lamp ${night.lamp.toFixed(2)}` });
    await page.locator('#sun-lamps').uncheck();
    await settle(page, 800);
    record('Отключение светильников', (await page.evaluate(() => window.__vsemdom.sunInfo())).lamp === 0 && (await S(page)).lamps === false);
    await page.keyboard.press('Escape');
    await ctx.close();
  },

  async persistence(browser) {
    const { ctx, page } = await openPage(browser);
    // Изменения через интерфейс.
    await clickText(page, '#side-body button', 'Металлочерепица');
    await clickText(page, '.modes button', 'Внутри');
    await clickText(page, '#side-body button', 'Горизонтальная');
    await page.evaluate(() => window.__vsemdom.app.editor.select(12));
    await settle(page);
    await page.locator('#btn-delete').click();
    await settle(page);
    await page.locator('#btn-doors').click();
    await page.locator('#modal-body .swatch', { hasText: 'Тёмный' }).click();
    await page.locator('#modal-body button', { hasText: 'Матовый натяжной' }).click();
    await page.locator('#dc-done').click();
    await settle(page);
    const s = await S(page);
    await page.locator('#btn-link').click();
    await settle(page);
    const url = await page.locator('#link-text').inputValue();
    record('Ссылка содержит #r=1.<base64url>', /#r=1\.[A-Za-z0-9_-]+$/.test(url), { note: `${url.length} символов` });
    // Новый контекст без localStorage: состояние из ссылки.
    const fresh = await openPage(browser, { url });
    const s2 = await S(fresh.page);
    record('Ссылка восстанавливает материалы, удаления, кровлю, потолок, двери', JSON.stringify(s2) === JSON.stringify(s) && !s2.items.some((i) => i.id === 12));
    await fresh.ctx.close();
    // Перезагрузка той же страницы: localStorage.
    await page.reload();
    await page.waitForFunction(() => window.__vsemdom?.ready?.(), null, { timeout: 180000 });
    const s3 = await S(page);
    record('localStorage восстанавливает проект после перезагрузки', JSON.stringify(s3) === JSON.stringify(s));
    // Повреждённая ссылка при открытии страницы (полная загрузка, а не смена hash): сообщение и локальное сохранение.
    await page.goto('about:blank');
    await page.goto(`${BASE}base-house.html?quality=low#r=1.Zm9vYmFy`);
    await page.waitForFunction(() => window.__vsemdom?.ready?.(), null, { timeout: 180000 });
    const st = await page.evaluate(() => window.__vsemdom.startup());
    record('Непригодная ссылка: понятное сообщение, загружено локальное сохранение', st.source === 'local' && st.messages.some((t) => t.includes('Ссылка')) && JSON.stringify(await S(page)) === JSON.stringify(s), { note: st.messages.join(' | ') });
    // Ссылка, вставленная в уже открытую вкладку (меняется только hash).
    await page.evaluate(() => { location.hash = '#r=1.YmFkbGluaw'; });
    await page.waitForFunction(() => window.__vsemdom.linkMessages().length >= 1, null, { timeout: 30000 }).catch(() => {});
    const lm1 = await page.evaluate(() => window.__vsemdom.linkMessages());
    record('Непригодная ссылка в открытой вкладке: сообщение, проект не изменён', lm1.length === 1 && lm1[0].includes('Ссылка') && JSON.stringify(await S(page)) === JSON.stringify(s), { note: lm1.join(' | ') });
    const h0 = await page.evaluate(() => window.__vsemdom.history());
    await page.evaluate(async () => { const m = await import('./project-state.js'); location.hash = m.encodeHash(m.newProject()); });
    await page.waitForFunction(() => window.__vsemdom.linkMessages().length >= 2, null, { timeout: 30000 }).catch(() => {});
    await settle(page);
    const s4 = await S(page);
    const h1 = await page.evaluate(() => window.__vsemdom.history());
    await page.locator('#btn-undo').click();
    await settle(page);
    const s5 = await S(page);
    record('Пригодная ссылка в открытой вкладке: применена одним действием, отменяется', s4.items.length === 23 && s4.items.some((i) => i.id === 12) && h1.index === h0.index + 1 && JSON.stringify(s5) === JSON.stringify(s), { note: `история ${h0.index}→${h1.index}` });
    // Повреждённое локальное сохранение: новый проект и резервная копия.
    await page.evaluate(() => localStorage.setItem('vsemdom-house-12x68-v1', '{"model":"house-plan-12x68","items":[{"id":1,"type":"piano"}]}'));
    await page.goto(`${BASE}base-house.html?quality=low`);
    await page.waitForFunction(() => window.__vsemdom?.ready?.(), null, { timeout: 180000 });
    const backup = await page.evaluate(() => localStorage.getItem('vsemdom-house-12x68-v1-backup'));
    record('Непригодное сохранение: новый проект и резервная копия текста', (await S(page)).items.length === 23 && backup && backup.includes('piano'));
    // PNG.
    // Кадр 1800 × 1120 на программном WebGL рисуется десятки секунд.
    const dl = page.waitForEvent('download', { timeout: 240000 });
    await page.locator('#btn-png').click();
    const download = await dl;
    const path = join(ROOT, 'artifacts', 'export-check.png');
    await download.saveAs(path);
    const buf = readFileSync(path);
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    record('Экспорт PNG 1800 × 1120', buf.slice(1, 4).toString() === 'PNG' && w === 1800 && h === 1120, { note: `${w}×${h}, ${buf.length} байт` });
    await ctx.close();
  },

  // Мангальная зона, костёр, ночной свет участка, лучи солнца в окнах.
  async site(browser) {
    const { ctx, page } = await openPage(browser, { animate: true });
    const f0 = await page.evaluate(() => window.__vsemdom.fire());
    record('Мангальная зона: площадка из плитняка построена, днём (авто) костёр не горит', f0.stones > 60 && f0.k === 0 && !f0.animating && f0.mode === 'auto', { note: JSON.stringify(f0) });
    await page.locator('#btn-sun').click();
    await settle(page, 1500);
    const h0 = await H(page);
    await page.locator('#sun-fire').selectOption('on');
    await settle(page, 800);
    const f1 = await page.evaluate(() => window.__vsemdom.fire());
    const h1 = await H(page);
    record('«Костёр: горит» — одно действие истории, пламя видно', f1.mode === 'on' && f1.k === 1 && f1.flames && h1.index === h0.index + 1, { note: `history ${h0.index}→${h1.index}` });
    await page.locator('[data-close="sun-panel"]').click();
    await settle(page, 600);
    // Программный WebGL рисует кадр за секунды (и компилирует шейдеры огня): после прогрева считаем
    // кадры за 12 с и продвижение времени пламени; дальше анимация ставится на паузу.
    await page.waitForTimeout(4000);
    const live = await page.evaluate(async () => {
      const a = window.__vsemdom.renderCount();
      const t = window.__vsemdom.app.fireTime;
      await new Promise((r) => setTimeout(r, 12000));
      return { frames: window.__vsemdom.renderCount() - a, dt: +(window.__vsemdom.app.fireTime - t).toFixed(2), animating: window.__vsemdom.fire().animating };
    });
    record('Горящий костёр в кадре анимируется (кадры запрашиваются непрерывно, время пламени идёт)', live.animating && live.frames >= 1 && live.dt > 1, { note: JSON.stringify(live) });
    await page.evaluate(() => window.__vsemdom.pauseAnimation(true));
    await page.evaluate(() => { const a = window.__vsemdom.app; a.camera.position.set(-20, 4, 0); a.controls.target.set(-40, 2, 0); a.controls.update(); a.invalidate(); });
    await settle(page, 1200);
    const away = await page.evaluate(async () => { const a = window.__vsemdom.renderCount(); await new Promise((r) => setTimeout(r, 2500)); return { frames: window.__vsemdom.renderCount() - a, animating: window.__vsemdom.fire().animating }; });
    record('Костёр вне кадра — сцена не перерисовывается', !away.animating && away.frames <= 3, { note: JSON.stringify(away) });
    await page.locator('#btn-sun').click();
    await settle(page, 800);
    await page.locator('#btn-bbq').click();
    await settle(page, 1500);
    const cam = await page.evaluate(() => window.__vsemdom.camera());
    const d = Math.hypot(cam.target[0] - 12.2, cam.target[2] - 11);
    record('Кнопка «Показать зону» наводит камеру на мангальную зону', d < 1.5, { note: `цель ${cam.target.map((v) => v.toFixed(1)).join(', ')}` });
    await page.locator('#btn-sun').click().catch(() => {});
    await settle(page, 600);
    if (!(await page.locator('#sun-panel').isVisible())) await page.locator('#btn-sun').click();
    await page.locator('#sun-fire').selectOption('auto');
    const slider = page.locator('#sun-time');
    await slider.evaluate((el) => { el.value = String(23 * 60 + 40); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
    await settle(page, 1500);
    const night = await page.evaluate(() => ({ fire: window.__vsemdom.fire(), lights: window.__vsemdom.pointLights(), sun: window.__vsemdom.sunInfo() }));
    record('Ночь (авто): костёр горит, активны точечные источники (костёр, угли, гирлянда, столбики)', night.fire.k > 0.9 && night.lights >= 8, { note: `огонь ${night.fire.k.toFixed(2)}, источников ${night.lights}` });
    await page.locator('#sun-fire').selectOption('off');
    await settle(page, 800);
    const off = await page.evaluate(() => window.__vsemdom.fire());
    record('«Костёр: погашен» гасит пламя и ночью', off.k === 0 && !off.flames && !off.animating);
    await page.locator('[data-close="sun-panel"]').click();
    // Лучи солнца: только в прогулке, днём со стороны солнца.
    await slider.evaluate((el) => { el.value = String(10 * 60 + 30); el.dispatchEvent(new Event('change', { bubbles: true })); }).catch(() => {});
    await page.evaluate(() => window.__vsemdom.app.store.commit((s) => { s.hour = 10.5; }, 'Время 10:30'));
    await settle(page, 800);
    const b0 = await page.evaluate(() => window.__vsemdom.beams());
    await page.locator('.modes button', { hasText: 'Прогулка' }).click();
    await settle(page, 1500);
    const b1 = await page.evaluate(() => window.__vsemdom.beams());
    record('Лучи солнца в окнах: видны только в прогулке, есть грани от окон на солнечной стороне', !b0.visible && b1.visible && b1.faces >= 8, { note: `${JSON.stringify(b0)} → ${JSON.stringify(b1)}` });
    await ctx.close();
  },

  async geometryLive(browser) {
    const { ctx, page } = await openPage(browser);
    const r = await page.evaluate(async () => {
      const THREE = await import('three');
      const a = window.__vsemdom.app;
      const out = {};
      // Габариты реальных моделей мебели в плане.
      const { ITEM_TYPES } = await import('./catalog.js');
      out.dims = [];
      for (const [id, obj] of a.house.itemObjects) {
        const it = a.store.get().items.find((i) => i.id === id);
        const clone = obj.clone(true);
        clone.position.set(0, 0, 0);
        clone.rotation.set(0, 0, 0);
        clone.updateMatrixWorld(true);
        const box = new THREE.Box3();
        clone.traverse((o) => { if (o.isMesh && !o.userData.installation && !o.parent?.name?.startsWith('installation')) box.expandByObject(o, true); });
        const s = box.getSize(new THREE.Vector3());
        const t = ITEM_TYPES[it.type];
        out.dims.push({ type: it.type, w: +s.x.toFixed(4), d: +s.z.toFixed(4), cw: t.w, cd: t.d + (t.mount === 'wall' ? 0.03 : 0) });
      }
      // Верх стен в полной сцене совпадает с потолком.
      out.ceiling = [a.house.state ? window.__vsemdom.ceilingAt(0) : 0, window.__vsemdom.ceilingAt(3.25)];
      out.roof = a.house.parts.roof.children.map((c) => ({ opacity: c.material.opacity, transmission: c.material.transmission ?? 0, depthWrite: c.material.depthWrite, transparent: c.material.transparent }));
      return out;
    });
    const bad = r.dims.filter((d) => Math.abs(d.w - d.cw) > 0.0025 || Math.abs(d.d - d.cd) > 0.0025);
    const unique = [...new Map(r.dims.map((d) => [d.type, d])).values()];
    record('Габариты моделей мебели совпадают с каталогом (±2,5 мм)', bad.length === 0, { note: bad.length ? JSON.stringify(bad) : unique.map((d) => `${d.type} ${d.w}×${d.d}`).join(', ') });
    record('Высоты потолка 2,70 под коньком и 2,30 у стен', Math.abs(r.ceiling[0] - 2.7) < 1e-9 && Math.abs(r.ceiling[1] - 2.3) < 1e-3);
    record('Кровля непрозрачна: opacity=1, transmission=0, запись глубины', r.roof.every((m) => m.opacity === 1 && m.transmission === 0 && m.depthWrite && !m.transparent));
    // Пол без щелей: в режиме «Внутри» (разрез 0,72 м) лучи сверху по сетке 4 см через весь контур дома
    // должны попадать в пол, порог, стену или мебель — но не в землю под домом.
    await page.locator('.modes button', { hasText: 'Внутри' }).click();
    await settle(page, 1200);
    const holes = await page.evaluate(async () => {
      const THREE = await import('three');
      const a = window.__vsemdom.app;
      const targets = [];
      a.house.root.traverse((o) => { if (o.isMesh && o.visible && !o.userData.windowGlow) targets.push(o); });
      const vis = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
      const meshes = targets.filter(vis);
      const rc = new THREE.Raycaster();
      const found = [];
      let n = 0;
      for (let x = -5.98; x <= 5.98; x += 0.04) {
        for (let z = -3.38; z <= 3.38; z += 0.04) {
          rc.set(new THREE.Vector3(x, 3, z), new THREE.Vector3(0, -1, 0));
          const hit = rc.intersectObjects(meshes, false).find((h) => h.object.material?.opacity !== 0);
          n++;
          if (!hit || hit.point.y < -0.05) found.push([+x.toFixed(2), +z.toFixed(2)]);
        }
      }
      return { n, found: found.slice(0, 12), count: found.length };
    });
    record('Пол без щелей: стыки помещений закрыты порогами (лучи сверху, сетка 4 см)', holes.count === 0, { note: `${holes.n} лучей, щелей ${holes.count}${holes.count ? ' ' + JSON.stringify(holes.found) : ''}` });
    // Разрез одинаков при выборе помещения и повороте камеры; навесные детали и фасадные светильники скрыты.
    const wallSig = () => page.evaluate(() => window.__vsemdom.app.house.parts.walls.children.map((m) => m.geometry.attributes.position.count).join(','));
    const sig0 = await wallSig();
    await page.evaluate(() => window.__vsemdom.app.selectRoom('006'));
    await settle(page, 1200);
    const sig1 = await wallSig();
    await page.evaluate(() => { const a = window.__vsemdom.app; a.camera.position.set(4, 9, -12); a.controls.update(); a.controls.dispatchEvent({ type: 'end' }); a.invalidate(); });
    await settle(page, 800);
    const sig2 = await wallSig();
    record('Выбор помещения и поворот камеры не меняют разрез стен', sig0 === sig1 && sig1 === sig2, { note: `${sig0.length}/${sig1.length}/${sig2.length}` });
    const floating = await page.evaluate(() => {
      const a = window.__vsemdom.app;
      const shown = [];
      a.house.root.traverse((o) => {
        if (!o.isMesh || !o.userData.wallMounted) return;
        for (let p = o; p; p = p.parent) if (!p.visible) return;
        shown.push(o.name || o.material?.name);
      });
      return { shown, lamps: a.house.parts.lamps?.visible ?? null };
    });
    record('При разрезе нет висящих деталей: навесные части и фасадные светильники скрыты', floating.shown.length === 0 && floating.lamps === false, { note: JSON.stringify(floating) });
    await ctx.close();
  },
};

async function main() {
  await startServer();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(join(ROOT, 'dist', 'blank.html'), '<!doctype html><link rel="icon" href="data:,"><title>blank</title>');
  const browser = await launchChromium(LAUNCH);
  const version = browser.version();
  const t0 = Date.now();
  for (const [name, fn] of Object.entries(scenarios)) {
    if (ONLY && !ONLY.includes(name)) continue;
    currentScenario = name;
    console.log(`\n— ${name}`);
    try {
      await fn(browser);
    } catch (e) {
      record(`Сценарий ${name}: исключение`, false, { note: e.message.split('\n')[0] });
    }
  }
  await browser.close();
  server?.kill();
  const passed = results.filter((r) => r.ok).length;
  const report = {
    date: new Date().toISOString(),
    environment: `Chromium ${version} headless, программный WebGL (SwiftShader) — это не измерение пользовательской видеокарты; сенсорный ввод — эмуляция CDP`,
    durationSec: Math.round((Date.now() - t0) / 1000),
    passed,
    failed: results.length - passed,
    consoleErrors: [...new Set(consoleErrors)].filter((e) => !/favicon/.test(e)),
    results,
  };
  writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\nИтог: ${passed}/${results.length}, ошибок консоли: ${report.consoleErrors.length}, ${report.durationSec} с → ${OUT}`);
  process.exit(report.failed ? 1 : 0);
}

main();
