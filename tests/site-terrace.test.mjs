// Открытая терраса гостевого дома (правки после этапа 4): контур по линии владельца, настил вровень с
// полом, ступени к дорожке от кострища, купель в настиле, дорожки и столбики под террасой убраны, по
// настилу и ступеням можно пройти; цвет настила — в состоянии и ссылке.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE, BUILDING, TERRACE, TERRACE_Y, terraceSteps, floorY, padY, groundY } from '../dist/site-data.js';
import { pointInPolygon, distToSegment, polygonArea } from '../dist/geometry.js';
import { walkData } from '../dist/site-buildings.js';
import { SiteWalkWorld, WALK, WALK_SPOTS } from '../dist/site-walk.js';
import { bollardSpots } from '../dist/site-lights.js';
import { newSite, validate, encodeHash, decodeHash, loadState } from '../dist/site-state.js';

const near = (x, z, poly, m) => pointInPolygon(x, z, poly) || poly.some((a, i) => { const b = poly[(i + 1) % poly.length]; return distToSegment(x, z, a[0], a[1], b[0], b[1]).d < m; });

test('терраса: прямоугольник 4,00 × 10,04 м по стенам основного объёма, перехода и бани', () => {
  const xs = TERRACE.poly.map((p) => p[0]), zs = TERRACE.poly.map((p) => p[1]);
  const [main, link, wing] = BUILDING.guest.footprint;
  assert.ok(Math.abs(Math.min(...xs) - Math.min(...main.map((p) => p[0]))) < 1e-6, 'западный край — по углу основного объёма');
  assert.ok(Math.abs(Math.min(...zs) - Math.max(...main.map((p) => p[1]))) < 1e-6, 'северный край — по южной стене основного объёма');
  assert.ok(Math.abs(Math.max(...zs) - Math.max(...wing.map((p) => p[1]))) < 1e-6, 'южный край — по торцу бани');
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...link.map((p) => p[0]))) < 1e-6, 'у входа — до стены перехода');
  assert.ok(Math.abs(Math.max(...zs) - Math.min(...zs) - 10.035) < 0.01);
  assert.ok(Math.abs(Math.abs(polygonArea(TERRACE.poly)) - 41.2) < 0.2);
  // Не заходит в постройки.
  for (const poly of BUILDING.guest.footprint) {
    const c = poly.reduce((m, q) => [m[0] + q[0] / poly.length, m[1] + q[1] / poly.length], [0, 0]);
    assert.ok(!pointInPolygon(c[0], c[1], TERRACE.poly));
  }
});

test('терраса: настил вровень с полом (порог 15 мм), под ней спланированная земля «пол − 0,25»', () => {
  assert.ok(Math.abs(TERRACE_Y - (floorY('guest') - 0.015)) < 1e-9);
  for (const [x, z] of [[17.5, 22.5], [19.0, 27.0], [20.5, 31.5]]) assert.ok(Math.abs(groundY(x, z) - padY('guest')) < 0.01, `земля под террасой в (${x}; ${z})`);
});

test('терраса: купель внутри настила, сосна Т15 сквозь настил, Т14 снаружи у угла', () => {
  const pool = SITE.features.plungePool;
  for (let a = 0; a < 360; a += 30) {
    const t = a * Math.PI / 180;
    assert.ok(pointInPolygon(pool.center[0] + Math.cos(t) * (pool.r + 0.15), pool.center[1] + Math.sin(t) * (pool.r + 0.15), TERRACE.poly));
  }
  const t15 = SITE.trees.find((t) => t.id === 'T15'), t14 = SITE.trees.find((t) => t.id === 'T14');
  assert.ok(pointInPolygon(t15.pos[0], t15.pos[1], TERRACE.poly));
  assert.ok(!pointInPolygon(t14.pos[0], t14.pos[1], TERRACE.poly));
});

test('дорожки и столбики: под террасой нет, дорожка от кострища подходит к ступеням', () => {
  assert.ok(!SITE.paths.some((p) => p.id === 'P6'), 'дорожка к купели убрана');
  for (const p of SITE.paths) {
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const a = p.pts[i], b = p.pts[i + 1];
      for (let k = 0; k <= 20; k++) {
        const x = a[0] + (b[0] - a[0]) * k / 20, z = a[1] + (b[1] - a[1]) * k / 20;
        assert.ok(!pointInPolygon(x, z, TERRACE.poly), `${p.id} заходит на террасу`);
      }
    }
  }
  const p2 = SITE.paths.find((p) => p.id === 'P2');
  assert.deepEqual(p2.pts.at(-1), TERRACE.stair.foot);
  const spots = bollardSpots();
  assert.ok(spots.length >= 6, `столбиков ${spots.length}`);
  assert.ok(spots.every((s) => !near(s.x, s.z, TERRACE.poly, 0.45)), 'столбики не на террасе');
});

test('прогулка: со дорожки по ступени на настил, по террасе к двери гостиной', () => {
  const w = new SiteWalkWorld({}, walkData());
  const steps = terraceSteps();
  assert.equal(steps.length, TERRACE.stair.treads);
  assert.ok(steps.every((s) => s.rise < 0.18), 'подъём ступени < 18 см');
  const [fx, fz] = TERRACE.stair.foot;
  let pose = { x: fx - 1.2, z: fz };
  pose.y = w.floorAt(pose.x, pose.z);
  for (let i = 0; i < 80; i++) pose = w.move(pose, 0.05, 0);
  assert.ok(pointInPolygon(pose.x, pose.z, TERRACE.poly), `на террасе: ${pose.x.toFixed(2)}, ${pose.z.toFixed(2)}`);
  assert.ok(Math.abs(pose.y - TERRACE_Y) < 1e-9, `высота настила ${pose.y.toFixed(3)}`);
  // Купель — препятствие (борт 0,45 м).
  const pool = SITE.features.plungePool;
  pose = { x: pool.center[0] - pool.r - 1.0, z: pool.center[1], y: TERRACE_Y };
  for (let i = 0; i < 60; i++) pose = w.move(pose, 0.05, 0);
  assert.ok(Math.hypot(pose.x - pool.center[0], pose.z - pool.center[1]) > pool.r + WALK.radius - 0.05, 'в купель не войти');
});

test('прогулка: шаг быстрее базового, старт у калитки и у каждой постройки', () => {
  assert.ok(WALK.speed >= 2.5 && WALK.fastSpeed >= 5.5);
  assert.deepEqual(WALK_SPOTS.map((s) => s.id), ['gate', 'guest', 'grill', 'garage']);
});

test('состояние: цвет настила террасы проверяется и проходит через ссылку', () => {
  const s = newSite();
  assert.equal(s.terrace, 'oak');
  for (const id of ['walnut', 'smoked', 'ash']) {
    s.terrace = id;
    const back = decodeHash(encodeHash(s));
    assert.deepEqual(validate(back), []);
    assert.equal(back.terrace, id);
  }
  assert.ok(validate({ ...s, terrace: 'pink' }).length > 0);
  const old = newSite();
  delete old.terrace;
  assert.equal(loadState(old).state.terrace, 'oak', 'старые ссылки — медовый дуб');
});
