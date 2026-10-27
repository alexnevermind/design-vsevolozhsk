// Реальные кадры работающего приложения (headless Chromium, программный WebGL).
// Камера для отдельных ракурсов ставится через диагностический API; отделка меняется через интерфейс.
// Запуск: npm run screenshots  (результат: artifacts/screenshots/*.png и index.json)
import { launchChromium } from './browser-launch.mjs';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'artifacts', 'screenshots');
mkdirSync(OUT, { recursive: true });
const PORT = 8772;
const only = process.argv[2] ? process.argv[2].split(',') : null;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', join(ROOT, 'dist')], { stdio: 'ignore' });
const BASE = `http://127.0.0.1:${PORT}/`;
for (let i = 0; i < 50; i++) { try { await fetch(BASE); break; } catch { await new Promise((r) => setTimeout(r, 200)); } }

const browser = await launchChromium();
const index = [];

async function open({ w = 1440, h = 900, touch = false, url = `${BASE}base-house.html` } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch, deviceScaleFactor: 1 });
  ctx.setDefaultTimeout(300000);
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => window.__vsemdom?.ready?.(), null, { timeout: 240000 });
  // Огонь на снимках — фиксированный кадр анимации (детерминированно и без непрерывного рендера).
  await page.evaluate(() => window.__vsemdom.pauseAnimation(true, 2.4));
  await page.addScriptTag({ content: `
    window.__pose = (x, z, fx, fz, pitch = 0, room = null) => {
      const a = window.__vsemdom.app;
      if (a.mode !== 'walk') a.setMode('walk');
      const w = a.walk;
      const s = w.world.safeSpot(x, z, room) || { x, z };
      w.pose.x = s.x; w.pose.z = s.z; w.pose.yaw = Math.atan2(-fx, -fz); w.pose.pitch = pitch;
      w.apply(); a.invalidate();
    };
    window.__orbit = (pos, target) => { const a = window.__vsemdom.app; a.camera.position.set(...pos); a.controls.target.set(...target); a.controls.update(); a.applyViewOffset(); a.invalidate(); };
  ` });
  return { ctx, page };
}

async function idle(page, ms = 1500) {
  await page.waitForTimeout(200);
  await page.waitForFunction(() => window.__vsemdom.idle() && window.__vsemdom.texturesPending() === 0, null, { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function shot(page, name, caption) {
  if (only && !only.includes(name)) return;
  await idle(page);
  await page.screenshot({ path: join(OUT, `${name}.png`), timeout: 300000 });
  index.push({ file: `${name}.png`, caption, origin: 'браузерный кадр приложения (Three.js, Chromium headless, программный WebGL)' });
  console.log('✔', name);
}

// Кадр в середине жеста (без ожидания покоя сцены).
async function rawShot(page, name, caption) {
  if (only && !only.includes(name)) return;
  await page.screenshot({ path: join(OUT, `${name}.png`), timeout: 300000 });
  index.push({ file: `${name}.png`, caption, origin: 'браузерный кадр приложения' });
  console.log('✔', name);
}

const click = async (page, sel, text) => { await page.locator(sel, { hasText: text }).first().click(); await idle(page, 600); };

try {
  // --- Снаружи ---
  let { ctx, page } = await open();
  await shot(page, '01-facade-default', 'Фасадный ракурс по умолчанию: светлый торец у террасы, графитовые стороны, кликфальц; сосновый лес, забор, самшит, туя');
  await page.evaluate(() => window.__orbit([13.5, 6.2, -12.5], [1.5, 2.2, -2]));
  await shot(page, '02-roof-standing-seam', 'Кровля «кликфальц»: фальцы 25 мм с шагом 430 мм, коньковый элемент, вентвыводы');
  await click(page, '#side-body button', 'Металлочерепица');
  await shot(page, '03-roof-metal-tile', 'Кровля «металлочерепица»: волна 183 мм, ряды 350 мм со ступенью 12 мм — другая геометрия покрытия');
  await page.evaluate(() => window.__orbit([-17, 4.2, -14], [-0.5, 1.0, 0]));
  await shot(page, '04-facade-north-west', 'Северный фасад и западный торец: окна по размерным цепочкам, обвязка под домом');
  await click(page, '#side-body button', 'Кликфальц');
  await click(page, '#side-body button', 'Весь дом одним цветом');
  await click(page, '#dock-strip .swatch', 'Серо-голубой');
  await page.evaluate(() => window.__orbit([17.5, 3.4, 13.5], [4.5, 1.1, 0.5]));
  await shot(page, '05-whole-house-color-terrace', 'Весь дом одним цветом (Q451) и крытая терраса со стенками-крыльями, ступени, светильники');
  await page.locator('#btn-undo').click();
  await click(page, '#dock-tabs button', 'Терраса');
  await click(page, '#dock-strip .swatch', 'Светлый дуб');
  await shot(page, '06-terrace-light-oak', 'Настил террасы и ступеней — светлый дуб');
  await click(page, '#dock-strip .swatch', 'Чёрный ясень');
  await shot(page, '07-terrace-black-ash', 'Настил террасы и ступеней — чёрный ясень');
  await page.locator('#dock-strip .swatch', { hasText: 'Орех' }).click();
  await page.locator('#btn-sun').click();
  await page.evaluate(() => window.__orbit([24, 9, 25], [1.5, 1.5, 0]));
  await shot(page, '08-sun-panel', 'Панель солнца: траектория, значок, азимут и высота из одного расчёта, четыре превью');
  await page.locator('#sun-time').evaluate((el) => { el.value = String(23 * 60 + 40); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.locator('#sun-date').fill('2026-09-20');
  await page.locator('#sun-date').dispatchEvent('change');
  await page.locator('[data-close="sun-panel"]').click();
  await page.evaluate(() => window.__orbit([17.5, 2.8, -7.5], [6.5, 0.9, 0.8]));
  await shot(page, '09-night-lamps', 'Ночь 20.09, 23:40: светильники торца у террасы, столбики вдоль дорожки, свечение окон, лунный свет с мягкими тенями');
  await ctx.close();
  // --- Участок и лес ---
  ({ ctx, page } = await open());
  // Без интерфейса: скрытие проверяется перед каждым кадром группы.
  const hideUI = () => page.evaluate(() => { const a = window.__vsemdom.app; if (!document.getElementById('app').classList.contains('ui-hidden')) { a.hidden = false; a.toggleUI(); } });
  await idle(page);
  await hideUI();
  await page.evaluate(() => window.__orbit([16, 1.0, 14], [0, 1.6, 0]));
  await shot(page, '29-garden-eye-level', 'Участок с высоты человека: стриженый газон, куртины у цоколя, самшит, туя, сосновый лес за забором');
  await hideUI();
  await page.evaluate(() => window.__orbit([-4, 3, -11], [2, 3, -40]));
  await shot(page, '30-pine-forest', 'Сосна обыкновенная: рыжая кора вверху, крона в верхней трети, лесная подстилка, дымка и кромка леса на горизонте');
  await hideUI();
  await page.evaluate(() => window.__orbit([8.6, 1.6, -1.0], [40, 0.5, 22]));
  await shot(page, '31-meadow-view', 'Вид с террасы на поляну: луговая трава за площадкой, дальний лес по кругу');
  await ctx.close();

  // --- Мангальная зона и дорожки ---
  ({ ctx, page } = await open());
  const setTime = (hour, date) => page.evaluate(([h, d]) => window.__vsemdom.app.store.commit((s) => { s.hour = h; if (d) s.solar.date = d; }, 'Время'), [hour, date]);
  await idle(page);
  await hideUI();
  await page.evaluate(() => window.__orbit([17.4, 1.6, 17.2], [11.6, -0.15, 10.4]));
  await shot(page, '33-bbq-zone-day', 'Мангальная зона днём: площадка из плитняка, кострище из колотого камня, скамьи с подушками и пледом, пни, мангал, поленница, гирлянда; гравийная дорожка от террасы');
  await hideUI();
  await page.evaluate(() => window.__orbit([14.6, 0.5, 13.4], [12.0, -0.3, 10.8]));
  await shot(page, '34-bbq-fire-pit-day', 'Кострище вблизи: камни с копотью изнутри, берёзовые дрова шалашом с обугленным низом, зола, гравийные швы');
  await hideUI();
  await page.evaluate(() => window.__orbit([10.3, 1.05, 0.2], [12.0, -0.3, 9.5]));
  await shot(page, '35-gravel-path', 'Гравийная дорожка от ступеней террасы к мангальной зоне: стальной бордюр, столбики-светильники, куртины по краю');
  await hideUI();
  await page.evaluate(() => window.__orbit([11.6, 1.9, 10.4], [6.2, 1.2, 3.4]));
  await shot(page, '36-gutters-downpipe', 'Водосточная система: полукруглый желоб с крюками, труба с коленами к стене, хомуты, отмёт на гравийную отмостку');
  await setTime(23.0, '2026-08-25');
  await hideUI();
  await page.evaluate(() => window.__orbit([17.4, 1.6, 17.2], [11.6, -0.15, 10.4]));
  await shot(page, '37-bbq-zone-night', 'Ночь 25.08, 23:00: костёр (процедурное пламя, искры, тлеющие угли), свет огня на плитняке и скамьях, угли в мангале, гирлянда, столбики');
  await hideUI();
  await page.evaluate(() => window.__orbit([14.3, 0.75, 13.1], [12.1, 0.05, 10.9]));
  await shot(page, '38-bbq-fire-close-night', 'Костёр ночью вблизи: языки пламени, искры, обугленные дрова с тлеющими трещинами, отсветы на камнях');
  await hideUI();
  await page.evaluate(() => window.__orbit([22.3, 4.4, 27], [1.6, 0.8, 0]));
  await shot(page, '39-night-overview', 'Ночной общий вид: лунный свет с мягкими тенями, луна, окна, фасадные светильники, костёр и гирлянда');
  await ctx.close();

  // --- Внутри ---
  ({ ctx, page } = await open());
  await click(page, '.modes button', 'Внутри');
  await shot(page, '10-interior-overview', 'Режим «Внутри»: единый разрез 0,72 м; сплошная стена только за кухней; над срезом ничего не висит');
  await click(page, '.room-list button', '005');
  await shot(page, '11-interior-room-005', 'Выбранное помещение 005: тот же разрез 0,72 м (стены не «прыгают»), контур помещения на полу');
  await click(page, '.room-list button', '006');
  await shot(page, '12-interior-room-006', 'Санузел 006 в редакторе: душевая, раковина, подвесной унитаз, стиральная машина');
  await click(page, '.room-list button', '005');
  await page.locator('#dock-strip .card', { hasText: 'Телевизор' }).click();
  await shot(page, '13-tv-added', 'Добавлен настенный телевизор 55″: выбран участок стены, камера показывает его');
  const tv = await page.evaluate(() => window.__vsemdom.state().items.find((i) => i.type === 'tv').id);
  const p = await page.evaluate((id) => window.__vsemdom.itemScreen(id), tv);
  await page.mouse.move(p[0], p[1]);
  await page.mouse.down();
  await page.mouse.move(p[0] - 30, p[1] - 10, { steps: 6 });
  await page.waitForTimeout(1500);
  await rawShot(page, '14-drag-tv', 'Перенос телевизора по стене: подсказка состояния');
  await page.mouse.up();
  await click(page, '.room-list button', '003');
  const bed = await page.evaluate(() => window.__vsemdom.itemScreen(2));
  await page.mouse.move(bed[0], bed[1]);
  await page.mouse.down();
  await page.mouse.move(bed[0] + 40, bed[1] - 20, { steps: 8 });
  await page.waitForTimeout(1800);
  await rawShot(page, '15-drag-bed', 'Перенос кровати: подъём 14 см, контур основания, цвет допустимости, подсказка');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await ctx.close();

  // --- Прогулка ---
  ({ ctx, page } = await open());
  await page.evaluate(() => window.__pose(1.0, 1.1, 0.55, -0.85, -0.12, '005'));
  await shot(page, '16-walk-kitchen', 'Прогулка: кухня — мойка со смесителем, плита с духовкой и вытяжкой, шкаф, холодильник, фартук из имитации бруса');
  await page.evaluate(() => window.__pose(-3.1, 1.2, -0.75, 0.65, -0.2, '003'));
  await shot(page, '17-walk-bedroom', 'Прогулка: спальня 003 — кровать 140×200 с одеялом и подушками, окна 2150 мм');
  await page.evaluate(() => window.__pose(3.3, -2.3, -0.35, 1, -0.32, '006'));
  await shot(page, '18-walk-bathroom-wc', 'Санузел: подвесной унитаз (модель Blender), клавиша смыва 1,08 м, плитка 600×600');
  await page.evaluate(() => window.__pose(2.2, -1.2, -0.9, -0.4, -0.15, '007'));
  await shot(page, '19-walk-sauna', 'Парная 007: липовая вагонка, полки, печь-каменка');
  await page.evaluate(() => window.__pose(1.6, 0.6, -1, 0.55, -0.25, '005'));
  await shot(page, '40-walk-living-decor', 'Гостиная: подушки с защипом, растение из настоящих листьев, ваза, книги, свеча; льняные шторы; луч солнца из южного окна');
  await page.evaluate(() => window.__pose(2.0, 0.7, 1, 0.7, -0.3, '005'));
  await shot(page, '41-walk-dining-decor', 'Обеденная зона: ваза с ветками эвкалипта, шторы у окна, раздвижное остекление на террасу');
  await page.evaluate(() => window.__pose(-0.9, -1.7, -0.8, -0.8, -0.3, '001'));
  await shot(page, '42-walk-office-decor', 'Кабинет: настольная лампа с льняным абажуром, книги, базилик в горшке, шторы');
  await page.evaluate(() => window.__pose(2.0, 1.6, 0.1, -1, 0.72, '005'));
  await shot(page, '20-ceiling-timber', 'Потолок «имитация бруса» по двум скатам 2,30–2,70 м, стык стен с потолком');
  await page.locator('#walk-finish').click();
  await page.locator('#modal-body button', { hasText: 'Матовый натяжной' }).click();
  await page.locator('#modal-body .swatch', { hasText: 'Sepal' }).click();
  await page.locator('#modal-body .swatch', { hasText: 'Серый' }).click();
  await page.waitForTimeout(500);
  await rawShot(page, '21-doors-ceiling-panel', 'Панель «Двери и потолок» во время прогулки (прогулка на паузе)');
  await page.locator('#dc-done').click();
  await page.locator('#walk-resume').click().catch(() => {});
  await page.evaluate(() => window.__pose(2.0, 1.6, 0.1, -1, 0.72, '005'));
  await shot(page, '22-ceiling-stretch', 'Матовый натяжной потолок (оттенок L447) по тем же скатам');
  await page.evaluate(() => window.__pose(-1.2, 0.7, -1, -0.35, -0.05, '005'));
  await shot(page, '23-walk-doors-grey', 'Серые межкомнатные двери спален 002 и 003: полотно 42 мм с филёнками, ручки, наличники');
  await page.evaluate(() => window.__pose(8.4, 2.6, -0.85, -0.55, -0.05, '008'));
  await shot(page, '24-walk-terrace', 'Терраса: раздвижное остекление 005, стеклянная входная дверь 004 открывается вокруг петли');
  await page.evaluate(() => window.__pose(-1.6, 0.2, -1, -0.15, -0.55, '005'));
  await shot(page, '32-walk-thresholds', 'Пороги в дверных проёмах спален: пол на стыках помещений закрыт');
  await ctx.close();

  // --- Мобильные ---
  ({ ctx, page } = await open({ w: 390, h: 844, touch: true }));
  await page.locator('.modes button', { hasText: 'Внутри' }).tap();
  await page.locator('#sheet-toggle').tap();
  await shot(page, '25-mobile-390-panel', 'Ширина 390 px: панель помещений, каталог с горизонтальной прокруткой');
  await page.locator('#sheet-toggle').tap();
  await page.locator('#btn-doors').tap();
  await shot(page, '26-mobile-390-doors-ceiling', 'Ширина 390 px: модальная панель «Двери и потолок» прокручивается внутри экрана');
  await ctx.close();
  ({ ctx, page } = await open({ w: 320, h: 640, touch: true }));
  await shot(page, '27-mobile-320', 'Ширина 320 px: основные действия доступны, нет горизонтального переполнения');
  await page.locator('.modes button', { hasText: 'Прогулка' }).tap();
  await shot(page, '28-mobile-320-walk', 'Прогулка на телефоне: джойстик и кнопки');
  await ctx.close();
} finally {
  await browser.close();
  server.kill();
  // Частичный прогон (список кадров в аргументе) заменяет только свои записи индекса.
  let prev = [];
  if (only) {
    try { prev = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')).shots.filter((x) => !index.some((n) => n.file === x.file)); } catch { prev = []; }
  }
  writeFileSync(join(OUT, 'index.json'), JSON.stringify({ date: new Date().toISOString(), environment: 'Chromium headless, SwiftShader (программный WebGL)', shots: [...prev, ...index].sort((a, b) => a.file.localeCompare(b.file)) }, null, 2) + '\n');
}
