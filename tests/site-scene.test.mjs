// Сцена участка (этап 2): планировка у построек, пруд, деревья по плану, прогулка (коллизии, высота
// пола), состояние и ссылка.
import test from 'node:test';
import assert from 'node:assert/strict';
import { SITE, BUILDING, groundY, padY, floorY, POND_LEVEL, PADS, insideSite } from '../dist/site-data.js';
import { pointInPolygon, distToSegment } from '../dist/geometry.js';
import { plannedTrees } from '../dist/site-trees.js';
import { SiteWalkWorld, WALK } from '../dist/site-walk.js';
import { newSite, encodeHash, decodeHash, loadState, validate } from '../dist/site-state.js';

const edgeDist = (x, z, poly) => Math.min(...poly.map((a, i) => { const b = poly[(i + 1) % poly.length]; return distToSegment(x, z, a[0], a[1], b[0], b[1]).d; }));

test('планировка: у стен построек земля на отметке «пол − 0,25»', () => {
  for (const b of SITE.buildings) {
    const pad = padY(b.id);
    assert.ok(Math.abs(floorY(b.id) - pad - 0.25) < 1e-9, `${b.id}: пол на 0,25 выше планировки`);
    for (const poly of b.footprint) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], c = poly[(i + 1) % poly.length];
        const m = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2];
        // Точка в 0,3 м снаружи от середины грани.
        let n = [c[1] - a[1], -(c[0] - a[0])];
        const l = Math.hypot(...n);
        n = [n[0] / l, n[1] / l];
        if (pointInPolygon(m[0] + n[0] * 0.05, m[1] + n[1] * 0.05, poly)) n = [-n[0], -n[1]];
        const x = m[0] + n[0] * 0.3, z = m[1] + n[1] * 0.3;
        if (b.footprint.some((p) => p !== poly && pointInPolygon(x, z, p))) continue;
        if (!insideSite(x, z)) continue;
        assert.ok(Math.abs(groundY(x, z) - pad) < 0.02, `${b.id}: грань ${i} — ${groundY(x, z).toFixed(3)} ≠ ${pad.toFixed(3)}`);
      }
    }
  }
  assert.ok(PADS.some((p) => p.id === 'carport'), 'пол навеса спланирован');
});

test('пруд: вода ниже берега, дно глубже 0,5 м, кромка по окружности с плана', () => {
  const { center: [cx, cz], r } = SITE.features.pond;
  assert.ok(groundY(cx, cz) < POND_LEVEL - 0.5, 'глубина в центре');
  for (let a = 0; a < 360; a += 10) {
    const t = a * Math.PI / 180;
    const inner = groundY(cx + Math.cos(t) * (r - 0.15), cz + Math.sin(t) * (r - 0.15));
    const outer = groundY(cx + Math.cos(t) * (r + 0.05), cz + Math.sin(t) * (r + 0.05));
    assert.ok(inner < POND_LEVEL, `${a}°: у кромки дно под водой`);
    assert.ok(outer > POND_LEVEL, `${a}°: берег над водой`);
  }
});

test('деревья: сохранённые по плану, не в пятнах построек, кроны и высоты по диаметру', () => {
  const keep = SITE.trees.filter((t) => t.status === 'keep');
  const planned = plannedTrees();
  assert.equal(planned.length, keep.length);
  for (const t of planned) {
    assert.ok(insideSite(t.x, t.z), `${t.id} на участке`);
    assert.ok(!SITE.buildings.some((b) => b.footprint.some((p) => pointInPolygon(t.x, t.z, p))), `${t.id} не в постройке`);
    assert.ok(t.h > 5 && t.h < 22 && t.crown > 2 && t.crown < 7.5, `${t.id}: h ${t.h}, крона ${t.crown}`);
  }
  // Диаметр больше — дерево выше (одна порода).
  const pines = planned.filter((t) => t.species === 'pine').sort((a, b) => a.dbh - b.dbh);
  for (let i = 1; i < pines.length; i++) assert.ok(pines[i].h >= pines[i - 1].h);
});

test('прогулка: старт свободен, стены и пруд непроходимы, забор держит внутри', () => {
  const w = new SiteWalkWorld({});
  const wk = SITE.gates.wicket;
  const start = w.safeSpot((wk.x0 + wk.x1) / 2, 39.6);
  assert.ok(start && !w.blocked(start.x, start.z));
  for (const b of SITE.buildings) for (const p of b.footprint) {
    const c = p.reduce((m, q) => [m[0] + q[0] / p.length, m[1] + q[1] / p.length], [0, 0]);
    assert.ok(w.blocked(c[0], c[1]), `${b.id}: центр занят`);
  }
  // Идти на восток в западную стену основного объёма гостевого дома.
  const main = BUILDING.guest.footprint[0];
  const x0 = Math.min(...main.map((p) => p[0]));
  let pose = { x: x0 - 2, z: 19.2 };
  for (let i = 0; i < 100; i++) pose = w.move(pose, 0.05, 0);
  assert.ok(pose.x < x0 - WALK.radius + 0.02 && pose.x > x0 - WALK.radius - 0.1, `остановка у стены: ${pose.x.toFixed(3)}`);
  // Пруд.
  const { center: [px, pz], r } = SITE.features.pond;
  pose = { x: px - r - 1, z: pz };
  for (let i = 0; i < 80; i++) pose = w.move(pose, 0.05, 0);
  assert.ok(Math.hypot(pose.x - px, pose.z - pz) >= r - 0.1 + WALK.radius - 0.01, 'в пруд не зайти');
  // Забор (южная граница у калитки): шаги на юг не выводят за участок.
  pose = { ...start };
  for (let i = 0; i < 100; i++) pose = w.move(pose, 0, 0.05);
  assert.ok(insideSite(pose.x, pose.z) && edgeDist(pose.x, pose.z, SITE.boundary) > WALK.radius, 'внутри забора');
});

test('прогулка: пол настила обеденной площадки и рельеф', () => {
  const w = new SiteWalkWorld({});
  const d = BUILDING.grill.dining;
  const c = d.reduce((m, q) => [m[0] + q[0] / 4, m[1] + q[1] / 4], [0, 0]);
  assert.ok(Math.abs(w.floorAt(c[0], c[1]) - (floorY('grill') - 0.05)) < 1e-9);
  assert.ok(Math.abs(w.floorAt(14, 25) - (groundY(14, 25) + 0.03)) < 1e-9);
});

test('состояние участка: по умолчанию, ссылка туда и обратно, проверка значений', () => {
  const s = newSite();
  assert.deepEqual(validate(s), []);
  s.hour = 19.25;
  s.fire = 'on';
  const back = loadState(decodeHash(encodeHash(s)));
  assert.ok(back.ok);
  assert.equal(back.state.hour, 19.25);
  assert.equal(back.state.fire, 'on');
  assert.ok(!loadState({ ...s, fire: 'smoke' }).ok);
  assert.ok(!loadState({ ...s, hour: 25 }).ok);
  assert.equal(s.solar.latitude, SITE.geo.latitude);
});
