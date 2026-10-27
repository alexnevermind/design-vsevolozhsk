// Интерьеры (этап 3): прогулка внутри по стенам и проёмам из генератора построек (вход через дверь,
// стены держат, лестница на мансарду), расстановка мебели по листам в границах помещений, состояние.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE, SRC, BUILDING, placer, floorY } from '../dist/site-data.js';
const SITE_TREES = SITE.trees;
import { walkData } from '../dist/site-buildings.js';
import { SiteWalkWorld } from '../dist/site-walk.js';
import { ROOMS, fitsRoom } from '../dist/site-edit.js';
import { layout, footprint } from '../dist/site-furniture.js';
import { newSite, validate, encodeHash, decodeHash, loadState } from '../dist/site-state.js';
import { buildingVolumes } from '../dist/site-trees.js';

const world = new SiteWalkWorld({}, walkData());
const G = SRC.guest;
const vol = Object.fromEntries(G.volumes.map((v) => [v.id, v.rect.map((q) => q / 1000)]));
const W = (bid) => { const at = placer(BUILDING[bid]); return (x, z) => at(x * 1000, z * 1000); };
// Идти к точке малыми шагами; возвращает позу.
function walkTo(pose, [tx, tz], maxSteps = 400) {
  for (let i = 0; i < maxSteps; i++) {
    const dx = tx - pose.x, dz = tz - pose.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.03) break;
    const k = Math.min(0.04, d) / d;
    const r = world.move(pose, dx * k, dz * k);
    if (r.x === pose.x && r.z === pose.z) break;
    pose = r;
  }
  return pose;
}

test('гостевой дом: вход снаружи через дверь холла, внутри — пол 1 этажа', () => {
  const door = G.openings.find((o) => o.id === 'GD2');
  const cx = (door.from + door.to) / 2000, z1 = vol.link[3];
  const at = W('guest');
  const out = at(cx, z1 + 1.4);
  let pose = { x: out[0], z: out[1] };
  pose.y = world.floorAt(pose.x, pose.z);
  assert.ok(!world.buildingAt(pose.x, pose.z), 'старт снаружи');
  pose = walkTo(pose, at(cx, z1 - 1.2));
  assert.equal(world.buildingAt(pose.x, pose.z), 'guest', 'прошёл в дверь');
  assert.ok(Math.abs(pose.y - floorY('guest')) < 1e-9, `пол ${pose.y.toFixed(3)}`);
});

test('гостевой дом: наружные стены и перегородки непроходимы изнутри', () => {
  const at = W('guest');
  const [mx0, mz0, mx1] = vol.main;
  // Из гостиной на запад — упор в наружную стену основного объёма.
  let pose = { x: at(2.5, 6.5)[0], z: at(2.5, 6.5)[1], y: floorY('guest') };
  pose = walkTo(pose, at(mx0 - 3, 6.5));
  assert.equal(world.buildingAt(pose.x, pose.z), 'guest', 'остался внутри');
  // Из кухни на юг в стену санузла через холл не пройти: перегородка между кухней и холлом (x = mx1) — проход только в проёме.
  pose = { x: at(2.5, 1.2)[0], z: at(2.5, 1.2)[1], y: floorY('guest') };
  pose = walkTo(pose, at(mx1 + 2, 1.2));
  const local = (() => { const b = BUILDING.guest; const th = placer(b).theta; const dx = pose.x - b.origin[0], dz = pose.z - b.origin[1]; return [dx * Math.cos(th) - dz * Math.sin(th), dx * Math.sin(th) + dz * Math.cos(th)]; })();
  assert.ok(local[0] < mx1 - 0.2, `стена кухни держит: x ${local[0].toFixed(2)}`);
  void mz0;
});

test('гостевой дом: по Г-образной лестнице — на пол мансарды', () => {
  const st = G.stairs.rect.map((q) => q / 1000);
  const f2 = G.heights.main.floor2 / 1000;
  const zIn = vol.main[1] + G.outerWall / 1000;
  const run = (st[3] - st[1]) / 8;
  const sx = (st[0] + st[2]) / 2, zc = (zIn + st[1]) / 2, xEnd = st[0] - 6 * run;
  const at = W('guest');
  let pose = { x: at(sx, st[3] + 0.6)[0], z: at(sx, st[3] + 0.6)[1], y: floorY('guest') };
  pose = walkTo(pose, at(sx, zc));
  assert.ok(Math.abs(pose.y - floorY('guest') - 9 * f2 / 16) < 1e-6, `площадка: ${(pose.y - floorY('guest')).toFixed(3)}`);
  pose = walkTo(pose, at(xEnd - 0.8, zc));
  assert.ok(Math.abs(pose.y - floorY('guest') - f2) < 1e-6, `мансарда: ${(pose.y - floorY('guest')).toFixed(3)} м`);
  // Под началом марша 2 (подшивка ниже 1,95 м) с пола не пройти.
  const under = at(st[0] - 1.5 * run, zc);
  assert.ok(world.blocked(under[0], under[1], 0.25, floorY('guest')), 'под маршем — низко');
});

test('гриль-дом и хоз.блок: вход через двери, внутри — пол постройки', () => {
  for (const [bid, poly] of [['grill', ROOMS['grill:K01'].poly], ['garage', ROOMS['garage:H01'].poly]]) {
    const at = W(bid);
    const c = poly.reduce((m, q) => [m[0] + q[0] / poly.length, m[1] + q[1] / poly.length], [0, 0]);
    const w = at(c[0] + 0.6, c[1] + 0.6);
    const s = world.safeSpot(w[0], w[1], floorY(bid));
    assert.ok(s, `${bid}: внутри есть свободное место`);
    assert.equal(world.buildingAt(s.x, s.z), bid);
    assert.ok(Math.abs(world.floorAt(s.x, s.z, floorY(bid)) - floorY(bid)) < 1e-9);
  }
});

test('мебель по листам: каждый переставляемый предмет в границах своего помещения', () => {
  const L = layout();
  let n = 0;
  for (const [bid, list] of Object.entries(L)) {
    for (const o of list) {
      assert.ok(ROOMS[`${bid}:${o.room}`], `${bid}:${o.id} — помещение ${o.room}`);
      if (o.fixed) continue;
      const [w, d] = footprint(o);
      assert.ok(fitsRoom({ building: bid, room: o.room, w, d }, o.x / 1000, o.z / 1000, o.rot ?? 0), `${bid}:${o.id} в ${o.room}`);
      n++;
    }
  }
  assert.ok(n >= 25, `переставляемых предметов: ${n}`);
  // За пределы помещения не выносится.
  const sofa = L.guest.find((o) => o.id === 'sofa');
  const [w, d] = footprint(sofa);
  assert.ok(!fitsRoom({ building: 'guest', room: 'G02', w, d }, -1, 6, 0));
});

test('состояние: фасад и перестановки мебели проверяются и проходят через ссылку', () => {
  const s = newSite();
  assert.equal(s.facade, 'board');
  s.facade = 'plaster';
  s.items['guest:sofa'] = [2.2, 5.4, 45];
  const back = decodeHash(encodeHash(s));
  assert.deepEqual(validate(back), []);
  assert.equal(back.facade, 'plaster');
  assert.deepEqual(back.items['guest:sofa'], [2.2, 5.4, 45]);
  assert.ok(validate({ ...s, facade: 'glass' }).length > 0, 'неизвестный фасад');
  assert.ok(validate({ ...s, items: { 'guest:sofa': [1, 'x', 0] } }).length > 0, 'координаты — числа');
  assert.ok(validate({ ...s, items: { 'pool:sofa': [1, 2, 0] } }).length > 0, 'только постройки участка');
  // Ссылки и сохранения этапа 2 (без фасада и мебели) открываются с доской и расстановкой по листам.
  const old = newSite();
  delete old.facade;
  delete old.items;
  const r = loadState(old);
  assert.ok(r.ok);
  assert.equal(r.state.facade, 'board');
  assert.deepEqual(r.state.items, {});
});

test('кроны у стен: объёмы построек под кровлей (хвоя внутри не рисуется) покрывают все пятна', () => {
  const vols = buildingVolumes();
  // Тот же расчёт, что в шейдере: точка внутри объёма — ниже ската над ней.
  const inside = (x, y, z) => vols.some(({ A, B }) => {
    if (y < B[0]) return false;
    let d;
    if (B[3] > 1.5) {
      const q = [x - A[0], z - A[1]];
      d = Math.max(Math.abs(q[0]), Math.abs(q[0] * 0.5 + q[1] * 0.8660254), Math.abs(-q[0] * 0.5 + q[1] * 0.8660254));
      if (d > A[2]) return false;
    } else {
      if (x < A[0] || x > A[2] || z < A[1] || z > A[3]) return false;
      d = B[3] < 0.5 ? Math.abs(z - (A[1] + A[3]) / 2) : Math.abs(x - (A[0] + A[2]) / 2);
    }
    return y < B[1] - d * B[2];
  });
  for (const b of Object.values(BUILDING)) {
    for (const poly of b.footprint) {
      const c = poly.reduce((m, q) => [m[0] + q[0] / poly.length, m[1] + q[1] / poly.length], [0, 0]);
      assert.ok(inside(c[0], floorY(b.id) + 2, c[1]), `${b.id}: середина помещения`);
      assert.ok(!inside(c[0], floorY(b.id) + 9, c[1]), `${b.id}: над кровлей — снаружи`);
    }
  }
  // Ветви ели Е-40 у северной стены гостевого дома (крона заходит за стену) внутри — не рисуются.
  const spruce = SITE_TREES.find((t) => t.label === 'Е-40');
  const g = BUILDING.guest.footprint[0];
  const zWall = Math.min(...g.map((q) => q[1]));
  assert.ok(zWall - spruce.pos[1] < spruce.crown / 2, 'крона Е-40 заходит за стену');
  assert.ok(inside(spruce.pos[0], floorY('guest') + 3, zWall + 0.3));
});
