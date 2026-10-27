// Данные участка (dist/data/site-spec.js из scripts/build-site.mjs): граница, рельеф, постройки,
// деревья, площадки, ворота и дорожки согласованы между собой и с подписями листов.
import test from 'node:test';
import assert from 'node:assert/strict';
import SITE from '../dist/data/site-spec.js';
import { terrainAt } from '../dist/site-terrain.js';
import { polygonArea, pointInPolygon, distToSegment } from '../dist/geometry.js';

const B = Object.fromEntries(SITE.buildings.map((b) => [b.id, b]));
const inSite = ([x, z]) => pointInPolygon(x, z, SITE.boundary);
const len = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

test('участок: четыре угла, ≈12 соток, север вверх, солнце для Всеволожска', () => {
  assert.equal(SITE.boundary.length, 4);
  const area = Math.abs(polygonArea(SITE.boundary));
  assert.ok(area > 1150 && area < 1250, `площадь ${area}`);
  assert.equal(SITE.geo.northAngle, 0);
  assert.ok(Math.abs(SITE.geo.latitude - 60.02) < 0.01 && Math.abs(SITE.geo.longitude - 30.64) < 0.01);
});

test('рельеф: сплайн проходит у отметок (±7 см), без выбросов 26,32 и 21,30', () => {
  const t = SITE.terrain;
  assert.ok(t.points.length >= 140);
  assert.ok(!t.heights.some((h) => h > 25 || h < 23.5));
  t.points.forEach((p, i) => assert.ok(Math.abs(terrainAt(t, p[0], p[1]) - t.heights[i]) < 0.07, `отметка ${p} ${t.heights[i]}`));
  for (let x = 1; x < 28; x += 3) for (let z = 1; z < 40; z += 3) {
    const h = terrainAt(t, x, z);
    assert.ok(h > 23.7 && h < 25, `рельеф ${h} в (${x}; ${z})`);
  }
});

test('постройки внутри участка и не ближе 8 м друг к другу; пол на 0,25 над спланированной землёй', () => {
  for (const b of SITE.buildings) {
    for (const poly of b.footprint) for (const p of poly) assert.ok(inSite(p), `${b.id} ${p}`);
    const lv = SITE.levels[b.id];
    assert.ok(Math.abs(lv.floor - lv.pad - 0.25) < 1e-6, `${b.id}: пол ${lv.floor}, планировка ${lv.pad}`);
    assert.ok(lv.pad - lv.groundMin <= 0.3 && lv.groundMax - lv.pad <= 0.3, `${b.id}: подсыпка/срезка ≤ 0,3 м`);
  }
  const d = (a, b) => Math.min(...a.footprint.flat().map((p) => Math.min(...b.footprint.flatMap((poly) => poly.map((q, i) => distToSegment(p[0], p[1], q[0], q[1], poly[(i + 1) % poly.length][0], poly[(i + 1) % poly.length][1]).d)))));
  assert.ok(d(B.guest, B.grill) > 8 && d(B.guest, B.garage) > 8 && d(B.grill, B.garage) > 8);
});

test('гриль-дом: шестиугольник 8210/7110, площадь 37,2, три фронтона З/СВ/ЮВ', () => {
  const hex = B.grill.footprint[0];
  assert.equal(hex.length, 6);
  assert.ok(Math.abs(len(hex[0], hex[3]) - 8.21) < 0.002, 'вершина — вершина');
  assert.ok(Math.abs(Math.abs(polygonArea(B.grill.rooms[0].poly)) - 37.27) < 0.05);
  assert.equal(B.grill.roofs[0].ridges.length, 3);
  assert.deepEqual(SITE.sources.grill.roof.gables, ['W', 'NE', 'SE']);
});

test('гостевой дом: 15215 по длине, баня 6510 × 5180, переход 3525 × 3180; размеры привязки', () => {
  const vols = SITE.sources.guest.volumes;
  const w = (r) => [r[2] - r[0], r[3] - r[1]];
  assert.deepEqual(w(vols[0].rect), [5180, 9180]);
  assert.deepEqual(w(vols[1].rect), [3525, 3180]);
  assert.deepEqual(w(vols[2].rect), [6510, 5180]);
  const main = B.guest.footprint[0];
  const wing = B.guest.footprint[2];
  // 9105 от южной грани бани до южной границы, 3000 от восточной грани бани до забора — по подписям.
  const southZ = (x) => { const [, , se, sw] = SITE.boundary; return sw[1] + (se[1] - sw[1]) * (x - sw[0]) / (se[0] - sw[0]); };
  const sFace = wing.filter((p) => Math.abs(p[1] - Math.max(...wing.map((q) => q[1]))) < 1e-3);
  const xm = (sFace[0][0] + sFace[1][0]) / 2;
  assert.ok(Math.abs(southZ(xm) - sFace[0][1] - 9.105) < 0.15);
  assert.ok(Math.max(...main.map((p) => p[0])) - Math.min(...main.map((p) => p[0])) > 9.17);
});

test('навес: 7500 × 8000, стойки внутри участка, ворота по оси навеса, калитка за зоной отката', () => {
  const cp = B.garage.carport;
  assert.ok(cp.posts.every(inSite));
  const roofW = len(cp.roof[0], cp.roof[1]);
  assert.ok(Math.abs(roofW - 7.5) < 1e-3);
  const g = SITE.gates;
  assert.ok(Math.abs(g.gate.x1 - g.gate.x0 - 4) < 1e-3);
  assert.ok(g.wicket.x0 >= g.slideEnd, 'калитка не перекрыта откатом');
  const axis = (cp.roof[0][0] + cp.roof[1][0]) / 2;
  assert.ok(Math.abs((g.gate.x0 + g.gate.x1) / 2 - axis) < 0.01);
});

test('деревья: только внутри участка, красные — под вырубку, ни одного сохранённого ствола в постройках и площадках', () => {
  assert.ok(SITE.trees.length >= 40);
  for (const t of SITE.trees) {
    assert.ok(inSite(t.pos), t.id);
    assert.ok(['birch', 'spruce', 'pine'].includes(t.species));
    assert.ok(t.height > 3 && t.height < 30 && t.crown > 1);
  }
  const cut = SITE.trees.filter((t) => t.status === 'cut').map((t) => t.id);
  for (const id of ['T35', 'T36', 'T44']) assert.ok(cut.includes(id), id);
  for (const t of SITE.trees.filter((q) => q.status === 'keep')) {
    for (const b of SITE.buildings) for (const poly of b.footprint) assert.ok(!pointInPolygon(t.pos[0], t.pos[1], poly), `${t.id} в ${b.id}`);
    assert.ok(!pointInPolygon(t.pos[0], t.pos[1], SITE.features.sport.poly), `${t.id} на спортплощадке`);
    assert.ok(len(t.pos, SITE.features.pond.center) > SITE.features.pond.r, `${t.id} в пруду`);
  }
});

test('дорожки: внутри участка, мимо стволов и построек', () => {
  for (const p of SITE.paths) {
    assert.ok(p.pts.length >= 2 && p.pts.every((q) => Number.isFinite(q[0]) && Number.isFinite(q[1])), p.id);
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const [a, b] = [p.pts[i], p.pts[i + 1]];
      for (let k = 0; k <= 10; k++) {
        const q = [a[0] + (b[0] - a[0]) * k / 10, a[1] + (b[1] - a[1]) * k / 10];
        assert.ok(inSite(q), `${p.id} вне участка`);
        for (const bd of SITE.buildings) for (const poly of bd.footprint) assert.ok(!pointInPolygon(q[0], q[1], poly), `${p.id} через ${bd.id}`);
      }
      for (const t of SITE.trees.filter((q) => q.status === 'keep')) {
        assert.ok(distToSegment(t.pos[0], t.pos[1], a[0], a[1], b[0], b[1]).d >= p.width / 2 + 0.3, `${p.id} у ствола ${t.id}`);
      }
    }
  }
});
