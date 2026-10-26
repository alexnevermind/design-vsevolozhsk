// Геометрия нового дома: зоны, площади, стены, проёмы, высоты, единый источник данных.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import SPEC from '../dist/data/project-spec.js';
import {
  ROOMS, ROOM_BY_ID, WALLS, WALL_BY_ID, OPENINGS, LIGHT_OPENINGS, ceilingHeight, roofUndersideY, faceRange, roomAt, wallPoint,
  FLOOR_Y, GROUND_Y, collinearRun,
} from '../dist/plan.js';
import { polygonArea, orthoPolygonToRects, obb, obbOverlap, pointInPolygon } from '../dist/geometry.js';

const full = JSON.parse(readFileSync(new URL('../PROJECT_SPEC.json', import.meta.url)));

test('восемь зон нового плана с номерами, названиями и площадями по подписям', () => {
  const expected = { '001': 6.1, '002': 9.8, '003': 9.8, '004': 4.1, '005': 33.2, '006': 4.5, '007': 4.5, '008': 20.0 };
  assert.deepEqual(Object.fromEntries(ROOMS.map((r) => [r.id, r.area])), expected);
  assert.equal(ROOM_BY_ID['008'].kind, 'terrace');
  assert.equal(ROOM_BY_ID['004'].kind, 'entry');
  assert.equal(ROOM_BY_ID['007'].kind, 'sauna');
  assert.equal(ROOM_BY_ID['006'].kind, 'wet');
  assert.equal(SPEC.house.roomsArea, 72.0);
});

test('полигоны помещений согласованы с подписями (±0,06 м²), подпись не заменяется вычисленной', () => {
  for (const r of ROOMS) {
    const a = polygonArea(r.polygon);
    assert.ok(a > 0, `${r.id} по часовой (z вниз)`);
    assert.ok(Math.abs(a - r.area) <= 0.06, `${r.id}: ${a} vs ${r.area}`);
    assert.ok(Math.abs(r.polygonArea - a) < 1e-4, `${r.id}: площадь полигона хранится отдельно от подписи`);
  }
});

test('наружный контур 12,0 × 6,8 м, терраса 3,0 × 6,8 м, крылья 1,5 м', () => {
  const o = SPEC.house.outer;
  assert.equal(o.x1 - o.x0, 12);
  assert.ok(Math.abs(o.z1 - o.z0 - 6.8) < 1e-9);
  const t = SPEC.house.terrace;
  assert.equal(t.x1 - t.x0, 3);
  assert.equal(SPEC.house.wingEndX - o.x1, 1.5);
  assert.equal(WALL_BY_ID['north-wing'].len, 1.5);
  assert.equal(WALL_BY_ID['south-wing'].len, 1.5);
});

test('разбиение ортогональных полигонов на прямоугольники сохраняет площадь', () => {
  for (const r of ROOMS) {
    const rects = orthoPolygonToRects(r.polygon);
    const s = rects.reduce((acc, [x0, z0, x1, z1]) => acc + (x1 - x0) * (z1 - z0), 0);
    assert.ok(Math.abs(s - polygonArea(r.polygon)) < 1e-9, r.id);
  }
});

test('проёмы: 8 окон, остекление 005, входная дверь 004, шесть межкомнатных дверей', () => {
  const by = (type) => OPENINGS.filter((o) => o.type === type);
  assert.equal(by('window').length, 8);
  assert.equal(by('glazing').length, 1);
  assert.equal(by('entry').length, 1);
  assert.equal(by('door').length, 6);
  assert.equal(LIGHT_OPENINGS.length, 10);
  const g = by('glazing')[0];
  assert.equal(g.wall.id, 'east-005');
  assert.equal(g.wall.left, '005');
  assert.equal(g.wall.right, '008');
  assert.ok(Math.abs(g.to - g.from - 2.3) < 1e-9);
  const e = by('entry')[0];
  assert.equal(e.wall.left, '004');
  assert.equal(e.wall.right, '008');
  assert.ok(Math.abs(e.to - e.from - 0.9) < 1e-9);
});

test('размеры фасадных проёмов совпадают с цепочками чертежа (после исправлений C1–C3)', () => {
  const mm = (v) => Math.round(v * 1000);
  const w = (id) => WALL_BY_ID[id].openings[0];
  assert.deepEqual([mm(WALL_BY_ID['north-002'].a[0] + 6 + w('north-002').from), mm(w('north-002').to - w('north-002').from)], [1880, 800]);
  assert.deepEqual([mm(w('south-003').from), mm(w('south-003').to - w('south-003').from)], [750, 2000]);
  assert.deepEqual([mm(w('west-002').from + 0.15), mm(w('west-002').to - w('west-002').from)], [675, 2150]);
  assert.deepEqual([mm(w('east-004').from + 0.15), mm(w('east-004').to - w('east-004').from)], [900, 900]);
  assert.deepEqual([mm(w('east-005').from + 3.325), mm(w('east-005').to - w('east-005').from)], [3980, 2300]);
});

test('стены: стороны смотрят в заявленные помещения, тела стен не заходят в полигоны', () => {
  for (const w of WALLS) {
    const mid = w.len / 2;
    for (const side of [1, -1]) {
      const id = side === 1 ? w.left : w.right;
      const [x, z] = wallPoint(w, mid, side, w.t / 2 + 0.04);
      assert.equal(roomAt(x, z)?.id ?? null, id, `${w.id} side ${side}`);
    }
    const o = obb(...wallPoint(w, mid), w.len - 0.002, w.t - 0.002, Math.atan2(-w.uz, w.ux));
    for (const r of ROOMS) {
      for (const rc of r.rects) {
        const ro = obb((rc[0] + rc[2]) / 2, (rc[1] + rc[3]) / 2, rc[2] - rc[0] - 0.002, rc[3] - rc[1] - 0.002, 0);
        assert.equal(obbOverlap(o, ro), 0, `${w.id} ∩ ${r.id}`);
      }
    }
  }
});

test('пол поднят на 0,70 м; потолок 2,30 у продольных стен и 2,70 под коньком', () => {
  assert.equal(FLOOR_Y, 0);
  assert.equal(GROUND_Y, -0.7);
  const inner = SPEC.house.outer.z1 - 0.15;
  assert.ok(Math.abs(ceilingHeight(0) - 2.7) < 1e-9);
  assert.ok(Math.abs(ceilingHeight(inner) - 2.3) < 1e-3);
  assert.ok(Math.abs(ceilingHeight(-inner) - 2.3) < 1e-3);
  assert.ok(roofUndersideY(0) > ceilingHeight(0));
  // Верх стены проверяется по обеим граням: у продольной наружной стены наружная грань ниже внутренней.
  const north = WALL_BY_ID['north-001'];
  const zInner = north.a[1] + north.t / 2;
  const zOuter = north.a[1] - north.t / 2;
  assert.ok(ceilingHeight(zOuter) < ceilingHeight(zInner));
});

test('конёк вдоль X: высота потолка не зависит от X и симметрична по Z', () => {
  for (const z of [-3, -1.2, 0.4, 2.8]) assert.ok(Math.abs(ceilingHeight(z) - ceilingHeight(-z)) < 1e-12);
});

test('единый источник: PROJECT_SPEC.json и модуль dist/data совпадают', () => {
  assert.deepEqual(full.rooms, SPEC.rooms.map(({ rects, ...r }) => r));
  assert.deepEqual(full.wallList, SPEC.wallList);
  assert.deepEqual(full.heights, SPEC.heights);
  const init = JSON.parse(readFileSync(new URL('../INITIAL_PROJECT_STATE.json', import.meta.url)));
  assert.deepEqual(full.initialItems, init.items);
});

test('HOUSE_PLAN.svg построен по тем же координатам', () => {
  const svg = readFileSync(new URL('../HOUSE_PLAN.svg', import.meta.url), 'utf8');
  for (const r of ROOMS) assert.ok(svg.includes(`>${r.id}<`), r.id);
  assert.ok(svg.includes('approximate=true'));
});

test('торцевые проёмы: остекление → 005, вход → 004; парная и санузел — мокрая зона', () => {
  assert.deepEqual(SPEC.floorGroups.wet, ['006', '007']);
  assert.deepEqual(SPEC.floorGroups.wood, ['001', '002', '003', '004', '005']);
  const toilet = WALL_BY_ID['kitchen-006'];
  assert.equal(toilet.right, '006');
});

test('соосные стены одной линии образуют общую протяжённость (кухня 3,826 м)', () => {
  const run = collinearRun(WALL_BY_ID['kitchen-007'], 1);
  const ids = run.walls.map((w) => w.wall.id).sort();
  assert.deepEqual(ids, ['kitchen-006', 'kitchen-007']);
  const r0 = faceRange(WALL_BY_ID['kitchen-007'], 1);
  const r1 = faceRange(WALL_BY_ID['kitchen-006'], 1);
  assert.ok(Math.abs(r0[1] - r0[0] + r1[1] - r1[0] - 3.826) < 0.012);
});

test('точка в полигоне: ниша 1,77 × 1,2 м относится к 005', () => {
  assert.equal(roomAt(-0.6, -0.5)?.id, '005');
  assert.ok(pointInPolygon(-0.6, -0.5, ROOM_BY_ID['005'].polygon));
  assert.equal(roomAt(-1.37, -0.5), null); // стенка ниши
});
