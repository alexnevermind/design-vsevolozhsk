// Солнце Санкт-Петербурга (NOAA) и модель прогулки на данных плана.
import test from 'node:test';
import assert from 'node:assert/strict';
import { solarPosition, sunDirection, sunState, sunPath, nearestPathHour, daylightFactor, lampFactor, formatHour, dayPhase } from '../dist/solar.js';
import { WalkWorld, startPose, DOORS, DOOR_BY_ID, leafObb, initialDoorStates, WALK } from '../dist/walk-geometry.js';
import { newProject } from '../dist/project-state.js';
import { roomAt } from '../dist/plan.js';
import { obbCorners } from '../dist/geometry.js';

const SPB = { latitude: 59.94, longitude: 30.31, utcOffset: 3, date: '2026-06-21', northAngle: 0 };

test('солнцестояние в Санкт-Петербурге: полуденная высота ≈ 53,5°, азимут ≈ 180° около 13:10', () => {
  let best = { elevation: -90 };
  for (let m = 600; m < 960; m++) {
    const p = solarPosition({ ...SPB, hour: m / 60 });
    if (p.elevation > best.elevation) best = { ...p, hour: m / 60 };
  }
  assert.ok(Math.abs(best.elevation - 53.5) < 0.3, best.elevation);
  assert.ok(Math.abs(best.azimuth - 180) < 1.5, best.azimuth);
  assert.ok(best.hour > 12.9 && best.hour < 13.4, best.hour);
});

test('восход ≈ 03:35 и заход ≈ 22:26 (высота пересекает −0,83°); белая ночь — сумерки, а не ночь', () => {
  const cross = (from, to) => {
    for (let m = from; m < to; m++) {
      const a = solarPosition({ ...SPB, hour: m / 60 }).elevation + 0.833;
      const b = solarPosition({ ...SPB, hour: (m + 1) / 60 }).elevation + 0.833;
      if (a * b <= 0) return m / 60;
    }
    return null;
  };
  const rise = cross(120, 360);
  const set = cross(1200, 1439);
  assert.ok(Math.abs(rise - 3.58) < 0.12, formatHour(rise));
  assert.ok(Math.abs(set - 22.43) < 0.12, formatHour(set));
  const midnight = solarPosition({ ...SPB, hour: 1.1 }).elevation;
  assert.ok(midnight > -8 && midnight < -5, midnight);
  const winter = solarPosition({ ...SPB, date: '2026-12-21', hour: 13.1 }).elevation;
  assert.ok(winter > 6 && winter < 7.3, winter);
  assert.notEqual(dayPhase(midnight), 'night', 'летняя ночь — сумерки');
  assert.equal(dayPhase(solarPosition({ ...SPB, date: '2026-12-21', hour: 22 }).elevation), 'night');
});

test('северный угол поворачивает физическое направление солнца', () => {
  const p = { azimuth: 180, elevation: 30 };
  const d0 = sunDirection(p, 0);
  assert.ok(Math.abs(d0[0]) < 1e-9 && d0[2] > 0, 'юг — вниз плана при севере вверх');
  const d90 = sunDirection(p, 90);
  assert.ok(d90[0] < -0.8, 'север вправо → юг влево');
  const east = sunDirection({ azimuth: 90, elevation: 0 }, 0);
  assert.ok(Math.abs(east[0] - 1) < 1e-9);
  assert.ok(Math.abs(Math.hypot(...d90) - 1) < 1e-12);
});

test('дата, время и север меняют направление; один расчёт для траектории и источника', () => {
  const a = sunState(SPB, 10.5).dir;
  const b = sunState({ ...SPB, date: '2026-12-21' }, 10.5).dir;
  const c = sunState({ ...SPB, northAngle: 45 }, 10.5).dir;
  assert.ok(a[1] > b[1]);
  assert.notDeepEqual(a, c);
  const path = sunPath(SPB, 10);
  const p = path.find((q) => Math.abs(q.hour - 10.5) < 1e-9);
  assert.deepEqual(p.dir, a);
});

test('выбор времени на проекции траектории учитывает непрерывные сегменты', () => {
  const path = sunPath(SPB, 30);
  // Ортографическая проекция сверху: x, z.
  const proj = (d) => [d[0] * 100, d[2] * 100];
  const target = sunState(SPB, 9.75).dir;
  const r = nearestPathHour(path, proj, target[0] * 100, target[2] * 100);
  assert.ok(Math.abs(r.hour - 9.75) < 0.1, r.hour);
});

test('дневной свет, сумерки и светильники различимы', () => {
  assert.equal(daylightFactor(30), 1);
  assert.equal(daylightFactor(-10), 0);
  assert.ok(daylightFactor(-2) > 0 && daylightFactor(-2) < 1);
  assert.equal(lampFactor(20, true), 0);
  assert.equal(lampFactor(-10, true), 1);
  assert.equal(lampFactor(-10, false), 0);
});

test('прогулка: старт в прихожей 004 на свободной точке, высота глаз 1,60 м', () => {
  const w = new WalkWorld(newProject().items);
  const s = startPose();
  assert.equal(roomAt(s.x, s.z)?.id, '004');
  assert.equal(w.collides(s.x, s.z), null);
  assert.equal(WALK.eyeHeight, 1.6);
  assert.equal(WALK.radius, 0.22);
  assert.equal(WALK.maxStep, 0.04);
});

test('сквозь стену и окно пройти нельзя; вдоль стены — скольжение', () => {
  const w = new WalkWorld(newProject().items);
  // Спальня 2 (003): на юг в окно W5.
  let p = { x: -4.5, z: 2.8 };
  for (let i = 0; i < 100; i++) p = w.move(p, 0, 0.05);
  assert.ok(p.z < 3.25 - 0.21 && p.z > 3.0, `z=${p.z}`);
  // Спальня 1 (002): диагональ в западную стену — скольжение по z.
  const q = w.move({ x: -5.6, z: -0.6 }, -0.2, 0.2);
  assert.ok(q.z > -0.45 && q.x >= -5.85 + 0.219, JSON.stringify(q));
});

test('открытая дверь пропускает, закрытая — нет', () => {
  const items = newProject().items;
  const open = new WalkWorld(items);
  // Из прихожей 004 на юг в кухню-гостиную через D-004.
  let p = { x: 5.0, z: -1.0 };
  for (let i = 0; i < 80; i++) p = open.move(p, 0, 0.05);
  assert.equal(roomAt(p.x, p.z)?.id, '005', JSON.stringify(p));
  const closed = new WalkWorld(items, { ...initialDoorStates(), 'D-004': 0 });
  let q = { x: 5.0, z: -1.0 };
  for (let i = 0; i < 80; i++) q = closed.move(q, 0, 0.05);
  assert.equal(roomAt(q.x, q.z)?.id, '004');
});

test('выход на террасу через входную дверь; край террасы не пускает на землю', () => {
  const w = new WalkWorld(newProject().items);
  let p = { x: 5.4, z: -2.05 };
  for (let i = 0; i < 120; i++) p = w.move(p, 0.05, 0);
  assert.equal(roomAt(p.x, p.z)?.id, '008', JSON.stringify(p));
  for (let i = 0; i < 200; i++) p = w.move(p, 0.05, 0);
  assert.ok(p.x <= 9 - 0.2, `x=${p.x}`);
});

test('раздвижное остекление: закрытая створка — преграда, открытая — проход', () => {
  const items = newProject().items;
  const closed = new WalkWorld(items);
  let p = { x: 5.2, z: 1.15 };
  for (let i = 0; i < 60; i++) p = closed.move(p, 0.05, 0);
  assert.equal(roomAt(p.x, p.z)?.id, '005');
  const opened = new WalkWorld(items, { ...initialDoorStates(), G1: 1 });
  let q = { x: 5.2, z: 1.0 };
  for (let i = 0; i < 60; i++) q = opened.move(q, 0.05, 0);
  assert.equal(roomAt(q.x, q.z)?.id, '008', JSON.stringify(q));
});

test('мебель — преграда для прогулки', () => {
  const w = new WalkWorld(newProject().items);
  let p = { x: 3.9, z: 0.9 };
  for (let i = 0; i < 60; i++) p = w.move(p, 0, 0.05);
  // Обеденный стол 1,2 × 0,75 с центром z = 2,22 и стул перед ним.
  assert.ok(p.z < 2.22 - 0.375 - 0.2, `z=${p.z}`);
});

test('створка вращается вокруг петли и останавливается, не задевая человека', () => {
  const d = DOOR_BY_ID['D-004'];
  const open = obbCorners(leafObb(d, 90));
  const closed = obbCorners(leafObb(d, 0));
  const dist = (pts) => Math.min(...pts.map(([x, z]) => Math.hypot(x - d.hinge[0], z - d.hinge[1])));
  assert.ok(dist(open) < 0.03 && dist(closed) < 0.03, 'петля остаётся на месте');
  const w = new WalkWorld(newProject().items);
  // Человек стоит в траектории закрывания со стороны открывания (005).
  const person = { x: 5.25, z: 0.45 };
  let r;
  for (let i = 0; i < 100; i++) { r = w.stepDoor('D-004', 0, 1 / 60, person); if (r.done) break; }
  assert.equal(r.blocked, true);
  assert.ok(w.doorStates['D-004'] > 10);
  assert.equal(w.doorBlockedBy(d, w.doorStates['D-004'], person.x, person.z), false);
});

test('ближайшая дверь в пределах 1,6 м с учётом направления взгляда', () => {
  const w = new WalkWorld(newProject().items);
  assert.equal(w.nearestDoor(5.2, -1.4, 0, 1)?.id, 'D-004');
  assert.equal(w.nearestDoor(5.2, -1.4, 0, -1)?.id, 'D-entry');
  assert.equal(w.nearestDoor(-4.0, 2.0, 0, 1), null);
  assert.equal(DOORS.length, 8);
});

test('безопасная точка рядом с занятой', () => {
  const w = new WalkWorld(newProject().items);
  const s = w.safeSpot(3.9, 2.22, '005');
  assert.ok(s);
  assert.equal(w.collides(s.x, s.z), null);
});
