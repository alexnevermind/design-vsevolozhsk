// Строит данные нового дома из scripts/plan-source.mjs, проверяет согласованность размеров
// и записывает PROJECT_SPEC.json, INITIAL_PROJECT_STATE.json, HOUSE_PLAN.svg, dist/data/*.js,
// docs/PLAN_CHECK.md. Запуск: npm run spec  (флаг --check — только проверка без записи).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DRAWING_LABELS, CORRECTIONS, HOUSE, ROOMS, WALLS, BUILTINS, ITEMS, EXTERIOR_FIXTURES,
} from './plan-source.mjs';
import { ITEM_TYPES, CATALOG_ORDER } from '../dist/catalog.js';
import * as choices from '../dist/choices.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

// Перевод из мм чертежа в метры сцены: центр основного объёма — начало координат.
export const ORIGIN_MM = [6000, 3400];
const r4 = (v) => Math.round(v * 10000) / 10000;
const toX = (x) => r4((x - ORIGIN_MM[0]) / 1000);
const toZ = (z) => r4((z - ORIGIN_MM[1]) / 1000);
const toM = (v) => r4(v / 1000);

const report = [];
const errors = [];
const sum = (a) => a.reduce((s, v) => s + v, 0);
function check(ok, msg) {
  report.push(`${ok ? '✔' : '✘'} ${msg}`);
  if (!ok) errors.push(msg);
}

// ---------- 1. Размерные цепочки ----------
const L = DRAWING_LABELS;
const printedNorth = sum(L.north.slice(0, -1));
const printedSouth = sum(L.south.slice(0, -1));
report.push('## Размерные цепочки (как напечатано)');
report.push(`- Северная: ${L.north.join(' + ')} → до конца крыла ${printedNorth}, всего ${sum(L.north)} (габарит с террасой ${L.overall.length + L.overall.terrace})`);
report.push(`- Южная: ${L.south.join(' + ')} → до конца крыла ${printedSouth}, всего ${sum(L.south)}`);
report.push(`- Западная: ${L.west.join(' + ')} = ${sum(L.west)} (габарит ${L.overall.depth})`);
report.push(`- Восточная: ${L.east.join(' + ')} = ${sum(L.east)} (габарит ${L.overall.depth})`);
report.push(`- Внутренняя верхняя + 2×150: ${sum(L.interiorTop) + 300} (габарит ${L.overall.length})`);
report.push(`- Внутренняя нижняя + 2×150: ${sum(L.interiorBottom) + 300}`);
report.push(`- Внутренняя левая + 2×150: ${sum(L.interiorLeft) + 300}`);
report.push(`- Внутренняя правая + 2×150: ${sum(L.interiorRight) + 300}`);
report.push(`- Коридорная: ${sum(L.corridor)} (= 8450 по нижней цепочке)`);
report.push(`- Перегородка спален: ${sum(L.partition)} (= 6500 в чистоте)`);
report.push(`- Южная стена кабинета: ${sum(L.room001South)} (= 3050)`);
report.push(`- Стена мокрой зоны: ${sum(L.wetZoneWall)} (= 2450)`);
report.push('');
report.push('## Проверка исправленных цепочек');
check(sum(L.interiorBottom) + 300 === HOUSE.length, 'нижняя внутренняя цепочка даёт 12000');
check(sum(L.interiorLeft) + 300 === HOUSE.depth, 'левая внутренняя цепочка даёт 6800');
check(sum(L.interiorRight) + 300 === HOUSE.depth, 'правая внутренняя цепочка даёт 6800');
check(sum(L.corridor) === 8450, 'коридорная цепочка = 8450');
check(sum(L.partition) === 6500, 'цепочка перегородки спален = 6500');
check(sum(L.room001South) === 3050, 'цепочка южной стены кабинета = 3050');
check(sum(L.wetZoneWall) === 2450, 'цепочка стены парной/санузла = 2450');
for (const c of CORRECTIONS) {
  if (c.chain === 'west' || c.chain === 'east') {
    check(sum(c.used) === HOUSE.depth, `${c.id}: ${c.chain} после исправления = ${sum(c.used)}`);
  }
}
check(1880 + 800 + 970 + 800 + 2350 + 600 + 1288 + 600 + 4212 === HOUSE.length + HOUSE.wingLength, 'C3: северная цепочка до конца крыла = 13 500');
check(750 + 2000 + 3850 + 2000 + 4900 === HOUSE.length + HOUSE.wingLength, 'C3: южная цепочка до конца крыла = 13 500');
const topInterior = [3100, 150, 3050, 100, 1838, 150, 1838, 150, 1324];
check(sum(topInterior) + 300 === HOUSE.length, 'C4: внутренняя верхняя цепочка с прихожей 1324 = 12000');

// ---------- 2. Помещения ----------
function rectPoly([x0, z0, x1, z1]) {
  return [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
}
function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i];
    const [x2, z2] = p[(i + 1) % p.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}
function centroid(p) {
  let a = 0, cx = 0, cz = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, z1] = p[i];
    const [x2, z2] = p[(i + 1) % p.length];
    const f = x1 * z2 - x2 * z1;
    a += f; cx += (x1 + x2) * f; cz += (z1 + z2) * f;
  }
  return [cx / (3 * a), cz / (3 * a)];
}
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > pt[1]) !== (zj > pt[1]) && pt[0] < ((xj - xi) * (pt[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

report.push('');
report.push('## Помещения: площадь по подписи и по полигону');
report.push('| ID | Название | Подпись, м² | Полигон, м² | Δ |');
report.push('|---|---|---:|---:|---:|');
const roomsMm = ROOMS.map((r) => {
  const poly = r.polygon || rectPoly(r.rects[0]);
  const area = polyArea(poly) / 1e6;
  const delta = area - r.area;
  report.push(`| ${r.id} | ${r.name} | ${r.area.toFixed(1)} | ${area.toFixed(3)} | ${delta >= 0 ? '+' : ''}${delta.toFixed(3)} |`);
  return { ...r, poly, polyArea: area };
});
for (const r of roomsMm) {
  check(polyArea(r.poly) > 0, `${r.id}: контур задан по часовой стрелке (z вниз)`);
  check(Math.abs(r.polyArea - r.area) <= 0.06, `${r.id}: площадь полигона ${r.polyArea.toFixed(3)} совпадает с подписью ${r.area} (±0,06)`);
}
const houseArea = sum(ROOMS.filter((r) => r.kind !== 'terrace').map((r) => r.area));
check(Math.abs(houseArea - 72.0) < 1e-9, `сумма подписей помещений дома = ${houseArea.toFixed(1)} м²`);

// ---------- 3. Стены и проёмы ----------
function wallFrame(w) {
  const dx = w.b[0] - w.a[0];
  const dz = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dz);
  return { len, ux: dx / len, uz: dz / len, nx: -dz / len, nz: dx / len };
}
function wallRect(w) {
  const f = wallFrame(w);
  const h = w.t / 2;
  const xs = [w.a[0] + f.nx * h, w.a[0] - f.nx * h, w.b[0] + f.nx * h, w.b[0] - f.nx * h];
  const zs = [w.a[1] + f.nz * h, w.a[1] - f.nz * h, w.b[1] + f.nz * h, w.b[1] - f.nz * h];
  return [Math.min(...xs), Math.min(...zs), Math.max(...xs), Math.max(...zs)];
}
report.push('');
report.push('## Стены и проёмы');
const roomIds = new Set(ROOMS.map((r) => r.id));
const wallIds = new Set();
for (const w of WALLS) {
  check(!wallIds.has(w.id), `${w.id}: уникальный ID`);
  wallIds.add(w.id);
  const f = wallFrame(w);
  check(Math.abs(f.ux) === 1 || Math.abs(f.uz) === 1, `${w.id}: ось параллельна X или Z`);
  check(f.ux >= 0 && f.uz >= 0, `${w.id}: направление +x/+z`);
  for (const side of ['left', 'right']) {
    if (w[side] !== null) check(roomIds.has(w[side]), `${w.id}.${side} = ${w[side]} существует`);
  }
  const ops = [...w.openings].sort((a, b) => a.from - b.from);
  let prev = 0;
  for (const o of ops) {
    check(o.from >= 0 && o.to <= f.len && o.to > o.from, `${w.id}/${o.id}: проём ${o.from}…${o.to} в пределах длины ${f.len}`);
    check(o.from >= prev, `${w.id}/${o.id}: не перекрывает соседний проём`);
    check(o.high > o.low && o.high <= 2300, `${w.id}/${o.id}: высоты ${o.low}…${o.high} ниже края потолка 2300`);
    prev = o.to;
  }
}
// Стены не пересекаются друг с другом (касание по граням допустимо).
const rects = WALLS.map((w) => ({ id: w.id, r: wallRect(w) }));
let overlapCount = 0;
for (let i = 0; i < rects.length; i++) {
  for (let j = i + 1; j < rects.length; j++) {
    const a = rects[i].r, b = rects[j].r;
    const ox = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
    const oz = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
    if (ox > 0.5 && oz > 0.5) { overlapCount++; errors.push(`стены ${rects[i].id} и ${rects[j].id} перекрываются`); }
  }
}
check(overlapCount === 0, 'тела стен не перекрываются');
// Стены не заходят внутрь полигонов помещений.
let wallInRoom = 0;
for (const { id, r } of rects) {
  const pts = [];
  for (let k = 1; k < 8; k++) for (let m = 1; m < 4; m++) pts.push([r[0] + ((r[2] - r[0]) * k) / 8, r[1] + ((r[3] - r[1]) * m) / 4]);
  for (const room of roomsMm) {
    if (pts.some((p) => pointInPoly(p, room.poly))) { wallInRoom++; errors.push(`стена ${id} заходит в помещение ${room.id}`); }
  }
}
check(wallInRoom === 0, 'стены лежат вне полигонов помещений');
// Каждая сторона полигона помещения опирается на грань стены (кроме открытых краёв террасы).
function edgeCovered(p, q, roomId) {
  const steps = 20;
  for (let s = 1; s < steps; s++) {
    const x = p[0] + ((q[0] - p[0]) * s) / steps;
    const z = p[1] + ((q[1] - p[1]) * s) / steps;
    const hit = rects.some(({ r }) => x >= r[0] - 0.5 && x <= r[2] + 0.5 && z >= r[1] - 0.5 && z <= r[3] + 0.5);
    if (!hit) return false;
  }
  return true;
}
for (const room of roomsMm) {
  if (room.kind === 'terrace') continue;
  let ok = true;
  for (let i = 0; i < room.poly.length; i++) {
    if (!edgeCovered(room.poly[i], room.poly[(i + 1) % room.poly.length], room.id)) {
      ok = false;
      errors.push(`${room.id}: сторона ${i} без стены`);
    }
  }
  check(ok, `${room.id}: все стороны контура закрыты стенами`);
}
// Стороны стен смотрят в заявленные помещения.
for (const w of WALLS) {
  const f = wallFrame(w);
  const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
  for (const [side, sgn] of [['left', 1], ['right', -1]]) {
    const id = w[side];
    const probe = [mid[0] + f.nx * sgn * (w.t / 2 + 40), mid[1] + f.nz * sgn * (w.t / 2 + 40)];
    const room = roomsMm.find((r) => pointInPoly(probe, r.poly));
    check((room?.id ?? null) === id, `${w.id}: сторона ${side} → ${id ?? 'снаружи'} (найдено ${room?.id ?? 'снаружи'})`);
  }
}

// ---------- 4. Предметы ----------
function footprintMm(it) {
  const t = ITEM_TYPES[it.type];
  const a = (it.ry * Math.PI) / 180;
  const c = Math.cos(a), s = Math.sin(a);
  const hw = (t.w * 1000) / 2, hd = (t.d * 1000) / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => [it.x + lx * c + lz * s, it.z - lx * s + lz * c]);
}
report.push('');
report.push('## Исходная расстановка');
for (const it of ITEMS) {
  check(!!ITEM_TYPES[it.type], `предмет ${it.id}: тип ${it.type} известен`);
  const room = roomsMm.find((r) => r.id === it.room);
  const fp = footprintMm(it);
  const inset = fp.map(([x, z]) => [x + Math.sign(it.x - x) * 1, z + Math.sign(it.z - z) * 1]);
  check(inset.every((p) => pointInPoly(p, room.poly)), `предмет ${it.id} (${it.type}) целиком в ${it.room}`);
}

// ---------- 5. Сборка данных в метрах ----------
const C_EDGE = 2.3, C_RIDGE = 2.7, HALF_SPAN = (HOUSE.depth / 2 - HOUSE.outerWall) / 1000;
const heights = {
  floorY: 0,
  groundY: -0.7,
  ceilingEdge: C_EDGE,
  ceilingRidge: C_RIDGE,
  ridgeZ: 0,
  halfSpan: HALF_SPAN,
  slope: r4((C_RIDGE - C_EDGE) / HALF_SPAN * 1e4) / 1e4,
  formula: 'ceilingHeight(z) = 2.70 − slope × |z − ridgeZ|, slope = 0.40 / 3.25',
};
const spec = {
  model: 'house-plan-12x68',
  schemaVersion: 1,
  approximate: true,
  generatedBy: 'scripts/build-spec.mjs из scripts/plan-source.mjs',
  source: 'Новая планировка владельца: 12000 × 6800 мм + терраса 3000 мм, 2 листа (обмерный и размерный).',
  units: 'm',
  axes: {
    X: 'вправо по плану (на восток условного севера)',
    Z: 'вниз по плану; отрицательный Z — верхняя сторона листа',
    Y: 'вверх; чистый пол Y = 0, земля Y = −0,70',
    fromDrawingMm: `X = (x − ${ORIGIN_MM[0]}) / 1000; Z = (z − ${ORIGIN_MM[1]}) / 1000`,
    sideRule: 'side = 1 — нормаль [−dz, dx]; side = −1 — противоположная',
  },
  house: {
    outer: { x0: toX(0), x1: toX(HOUSE.length), z0: toZ(0), z1: toZ(HOUSE.depth) },
    size: [HOUSE.length / 1000, HOUSE.depth / 1000],
    terrace: { x0: toX(HOUSE.length), x1: toX(HOUSE.length + HOUSE.terraceDepth), z0: toZ(0), z1: toZ(HOUSE.depth) },
    wingEndX: toX(HOUSE.length + HOUSE.wingLength),
    roomsArea: houseArea,
    terraceArea: 20.0,
    footprintArea: (HOUSE.length * HOUSE.depth) / 1e6,
  },
  heights,
  roof: {
    structureDepth: 0.3,
    baseThickness: 0.075,
    overhang: 0.23,
    coversWings: true,
    x0: toX(0),
    x1: toX(HOUSE.length + HOUSE.wingLength),
    seamSpacing: 0.43,
    tile: { wavePitch: 0.183, rowPitch: 0.35, waveHeight: 0.036, step: 0.012 },
  },
  terrace: { topY: -0.02, boardWidth: 0.14, boardLength: 3.4 },
  walls: {
    exteriorThickness: 0.15,
    snapInset: 'половина толщины стены от оси (0,075 для 150 мм, 0,05 для 100 мм, 0,10 для 200 мм)',
    claddingBoard: 0.145,
    baseboard: 0.065,
    cutHeight: 0.72,
  },
  floors: { board: { width: 0.18, length: 1.8, seam: 0.0016 }, tile: { size: 0.6, seam: 0.0024 } },
  doors: { leafThickness: 0.042, leafHeight: 2.045, leafNarrower: 0.065, trimTop: 2.16 },
  floorGroups: { wood: ['001', '002', '003', '004', '005'], wet: ['006', '007'], terrace: ['008'] },
  paintedRooms: ['001', '002', '003', '004', '005', '006'],
  fixedFinishRooms: { '007': 'Парная: необработанная липа на стенах и потолке, пол — плитка мокрой зоны' },
  rooms: roomsMm.map((r) => {
    const polygon = r.poly.map(([x, z]) => [toX(x), toZ(z)]);
    const c = r.label || centroid(r.poly);
    return {
      id: r.id,
      name: r.name,
      area: r.area,
      kind: r.kind,
      kitchen: r.id === '005' || undefined,
      polygon,
      center: [toX(c[0]), toZ(c[1])],
      polygonArea: r4(r.polyArea),
    };
  }),
  walls_: null,
};
delete spec.walls_;
spec.wallList = WALLS.map((w) => ({
  id: w.id,
  a: [toX(w.a[0]), toZ(w.a[1])],
  b: [toX(w.b[0]), toZ(w.b[1])],
  t: toM(w.t),
  left: w.left,
  right: w.right,
  ...(w.facade ? { facade: w.facade } : {}),
  ...(w.wing ? { wing: true } : {}),
  openings: w.openings.map((o) => ({
    ...o,
    from: toM(o.from),
    to: toM(o.to),
    low: toM(o.low),
    high: toM(o.high),
  })),
}));
spec.builtins = BUILTINS.map((b) => ({
  ...b,
  rect: [toX(b.rect[0]), toZ(b.rect[1]), toX(b.rect[2]), toZ(b.rect[3])],
  top: toM(b.top),
}));
spec.exteriorFixtures = {
  wallLamps: EXTERIOR_FIXTURES.wallLamps.map((l) => ({ ...l, u: toM(l.u), y: toM(l.y) })),
  roofVents: EXTERIOR_FIXTURES.roofVents.map((v) => ({ x: toX(v.x), z: toZ(v.z), d: toM(v.d) })),
  terraceStair: {
    edge: 'east',
    x: toX(HOUSE.length + HOUSE.terraceDepth),
    center: toZ(EXTERIOR_FIXTURES.terraceStair.center),
    width: toM(EXTERIOR_FIXTURES.terraceStair.width),
    treads: EXTERIOR_FIXTURES.terraceStair.treads,
    rise: toM(EXTERIOR_FIXTURES.terraceStair.rise),
    run: toM(EXTERIOR_FIXTURES.terraceStair.run),
  },
};
spec.walk = {
  start: { room: '004', x: toX(11190), z: toZ(2350), yaw: Math.PI },
  eyeHeight: 1.6, personHeight: 1.75, radius: 0.22, speed: 1.4, fastSpeed: 2.6, fov: 68, near: 0.06, maxStep: 0.04,
  doorReach: 1.6, initialInteriorAngle: -90, initialEntryAngle: 80,
};
spec.solarDefaults = { latitude: 59.94, longitude: 30.31, utcOffset: 3, date: '2026-06-21', hour: 10.5, northAngle: 0, orientationConfirmed: false };

// Начальное состояние проекта.
const mats = {
  'facade:north': 'ext-D129', 'facade:east': 'ext-Q854', 'facade:south': 'ext-D129', 'facade:west': 'ext-D129',
};
for (const id of spec.paintedRooms) mats[`wall:${id}`] = 'tk-H484';
for (const id of spec.floorGroups.wood) mats[`floor:${id}`] = 'oak';
for (const id of spec.floorGroups.wet) mats[`floor:${id}`] = 'terrazzo';
mats['floor:008'] = 'walnut';
Object.assign(mats, {
  interiorDoors: 'door-light', ceiling: 'tk-F497', joinery: 'walnut', upholstery: 'boucle', accent: 'rust', bedding: 'linen', counter: 'travertine',
});
const initialState = {
  model: spec.model,
  revision: 2,
  finishRevision: 1,
  wallLayout: 'vertical',
  ceilingType: 'timber',
  roofType: 'standingSeam',
  solar: {
    latitude: 59.94, longitude: 30.31, utcOffset: 3, date: '2026-06-21', northAngle: 0, orientationConfirmed: false,
  },
  mats,
  cladding: { loggia: 'ext-Q854' },
  items: ITEMS.map((it) => ({
    id: it.id,
    type: it.type,
    x: toX(it.x),
    z: toZ(it.z),
    ry: it.ry === 0 ? 0 : (it.ry * Math.PI) / 180,
    room: it.room,
    mats: {},
    ...(it.anchor ? { anchor: { ...it.anchor } } : {}),
  })),
  hour: 10.5,
  lamps: true,
  fire: 'auto',
  notes: false,
};

const fullSpec = {
  ...spec,
  catalog: {
    order: CATALOG_ORDER,
    types: Object.fromEntries(Object.entries(ITEM_TYPES).map(([k, v]) => [k, { label: v.label, w: v.w, d: v.d, h: v.h, catalog: !!v.catalog, snap: v.snap || null, mount: v.mount || 'floor' }])),
  },
  palettes: {
    interior: choices.INTERIOR_PAINTS,
    facade: choices.FACADE_PAINTS,
    doors: choices.DOOR_FINISHES,
    woods: choices.WOODS,
    stones: choices.STONES,
    fabrics: choices.FABRICS,
    slotOptions: choices.SLOT_OPTIONS,
  },
  initialItems: initialState.items,
  corrections: CORRECTIONS,
};

// ---------- 6. SVG-схема по тем же координатам ----------
function buildSvg() {
  const S = 60; // px на метр
  const pad = 1.2;
  const x0 = spec.house.outer.x0 - pad, x1 = spec.house.terrace.x1 + pad + 1.3;
  const z0 = spec.house.outer.z0 - pad, z1 = spec.house.outer.z1 + pad;
  const W = (x1 - x0) * S, H = (z1 - z0) * S;
  const px = (x) => ((x - x0) * S).toFixed(1);
  const pz = (z) => ((z - z0) * S).toFixed(1);
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}" width="${W.toFixed(0)}" height="${H.toFixed(0)}" font-family="Arial, sans-serif">`);
  out.push(`<rect width="100%" height="100%" fill="#fbfaf6"/>`);
  out.push(`<g id="grid" stroke="#ece8de" stroke-width="1">`);
  for (let x = Math.ceil(x0); x <= x1; x++) out.push(`<line x1="${px(x)}" y1="0" x2="${px(x)}" y2="${H.toFixed(0)}"/>`);
  for (let z = Math.ceil(z0); z <= z1; z++) out.push(`<line x1="0" y1="${pz(z)}" x2="${W.toFixed(0)}" y2="${pz(z)}"/>`);
  out.push('</g>');
  const fills = { room: '#f1ede4', entry: '#ebe5d8', wet: '#dfe3e3', sauna: '#e8dcc6', terrace: '#e6d9c3' };
  for (const r of spec.rooms) {
    out.push(`<polygon points="${r.polygon.map(([x, z]) => `${px(x)},${pz(z)}`).join(' ')}" fill="${fills[r.kind]}" stroke="#b9b1a2" stroke-width="1"/>`);
  }
  for (const b of spec.builtins) {
    const [bx0, bz0, bx1, bz1] = b.rect;
    out.push(`<rect x="${px(bx0)}" y="${pz(bz0)}" width="${((bx1 - bx0) * S).toFixed(1)}" height="${((bz1 - bz0) * S).toFixed(1)}" fill="none" stroke="#9c8a6c" stroke-dasharray="4 3"/>`);
  }
  for (const w of spec.wallList) {
    const f = wallFrame({ a: w.a, b: w.b });
    const h = w.t / 2;
    const corner = (u, s) => [w.a[0] + f.ux * u + f.nx * h * s, w.a[1] + f.uz * u + f.nz * h * s];
    // Сплошные участки между проёмами.
    let u = 0;
    const segs = [];
    for (const o of [...w.openings].sort((a, b) => a.from - b.from)) {
      if (o.from > u) segs.push([u, o.from]);
      u = o.to;
    }
    if (u < f.len) segs.push([u, f.len]);
    for (const [u0, u1] of segs) {
      const pts = [corner(u0, 1), corner(u1, 1), corner(u1, -1), corner(u0, -1)];
      out.push(`<polygon points="${pts.map(([x, z]) => `${px(x)},${pz(z)}`).join(' ')}" fill="#4a4a48"/>`);
    }
    for (const o of w.openings) {
      const p0 = corner(o.from, 0), p1 = corner(o.to, 0);
      const color = o.type === 'window' || o.type === 'glazing' ? '#2f7fb0' : '#b05a2f';
      out.push(`<line x1="${px(p0[0])}" y1="${pz(p0[1])}" x2="${px(p1[0])}" y2="${pz(p1[1])}" stroke="${color}" stroke-width="3"/>`);
      if (o.hinge) {
        const hu = o.hinge === 'from' ? o.from : o.to;
        const tu = o.hinge === 'from' ? o.to : o.from;
        const hp = corner(hu, 0);
        const leafLen = o.to - o.from;
        const open = [hp[0] + f.nx * o.swing * leafLen, hp[1] + f.nz * o.swing * leafLen];
        const tp = corner(tu, 0);
        out.push(`<line x1="${px(hp[0])}" y1="${pz(hp[1])}" x2="${px(open[0])}" y2="${pz(open[1])}" stroke="#b05a2f" stroke-width="1.5"/>`);
        const sv = [open[0] - hp[0], open[1] - hp[1]];
        const ev = [tp[0] - hp[0], tp[1] - hp[1]];
        const sweep = sv[0] * ev[1] - sv[1] * ev[0] > 0 ? 1 : 0;
        out.push(`<path d="M ${px(open[0])} ${pz(open[1])} A ${(leafLen * S).toFixed(1)} ${(leafLen * S).toFixed(1)} 0 0 ${sweep} ${px(tp[0])} ${pz(tp[1])}" fill="none" stroke="#b05a2f" stroke-width="0.8" stroke-dasharray="3 2"/>`);
      }
    }
  }
  for (const it of initialState.items) {
    const t = ITEM_TYPES[it.type];
    const c = Math.cos(it.ry), s = Math.sin(it.ry);
    const pts = [[-t.w / 2, -t.d / 2], [t.w / 2, -t.d / 2], [t.w / 2, t.d / 2], [-t.w / 2, t.d / 2]]
      .map(([lx, lz]) => [it.x + lx * c + lz * s, it.z - lx * s + lz * c]);
    out.push(`<polygon points="${pts.map(([x, z]) => `${px(x)},${pz(z)}`).join(' ')}" fill="#ffffff" fill-opacity="0.7" stroke="#6f6a60" stroke-width="1"/>`);
    const fx = it.x + s * t.d * 0.38, fz = it.z + c * t.d * 0.38;
    out.push(`<circle cx="${px(fx)}" cy="${pz(fz)}" r="2" fill="#6f6a60"/>`);
  }
  for (const r of spec.rooms) {
    out.push(`<text x="${px(r.center[0])}" y="${pz(r.center[1]) - 4}" font-size="13" text-anchor="middle" fill="#333">${r.id}</text>`);
    out.push(`<text x="${px(r.center[0])}" y="${(pz(r.center[1]) * 1 + 11).toFixed(1)}" font-size="10" text-anchor="middle" fill="#555">${r.name} · ${r.area.toFixed(1)} м²</text>`);
  }
  const st = spec.exteriorFixtures.terraceStair;
  for (let i = 1; i <= st.treads; i++) {
    out.push(`<rect x="${px(st.x + (i - 1) * st.run)}" y="${pz(st.center - st.width / 2)}" width="${(st.run * S).toFixed(1)}" height="${(st.width * S).toFixed(1)}" fill="#d9ccb4" stroke="#a8977a"/>`);
  }
  const ax = spec.house.outer, dimY = pz(ax.z1 + 0.7);
  out.push(`<g font-size="11" fill="#333" stroke="#333">`);
  out.push(`<line x1="${px(ax.x0)}" y1="${dimY}" x2="${px(ax.x1)}" y2="${dimY}"/><text stroke="none" x="${px(0)}" y="${dimY - 4}" text-anchor="middle">12,00 м</text>`);
  out.push(`<line x1="${px(ax.x1)}" y1="${dimY}" x2="${px(spec.house.terrace.x1)}" y2="${dimY}"/><text stroke="none" x="${px((ax.x1 + spec.house.terrace.x1) / 2)}" y="${dimY - 4}" text-anchor="middle">3,00 м</text>`);
  const dimX = px(ax.x0 - 0.6);
  out.push(`<line x1="${dimX}" y1="${pz(ax.z0)}" x2="${dimX}" y2="${pz(ax.z1)}"/><text stroke="none" x="${dimX - 6}" y="${pz(0)}" text-anchor="middle" transform="rotate(-90 ${dimX - 6} ${pz(0)})">6,80 м</text>`);
  out.push('</g>');
  out.push(`<text x="12" y="20" font-size="13" fill="#333">VSEMDOM.COM · дом 12,0 × 6,8 м · ${houseArea.toFixed(1)} м² + терраса 20,0 м² · координаты сцены, 1 клетка = 1 м · approximate=true</text>`);
  out.push(`<g transform="translate(${(W - 40).toFixed(0)},40)"><path d="M0 -18 L6 6 L0 2 L-6 6 Z" fill="#333"/><text y="22" font-size="11" text-anchor="middle">N усл.</text></g>`);
  out.push('</svg>');
  return out.join('\n');
}

// ---------- 7. Запись ----------
report.unshift(
  '# Проверка согласованности схемы нового дома',
  '',
  'Сгенерировано `npm run spec` из `scripts/plan-source.mjs`. Перевод: X = (x − 6000)/1000, Z = (z − 3400)/1000 (м).',
  '',
);
report.push('');
report.push(`Итог: ${errors.length === 0 ? 'ошибок нет' : `ошибок ${errors.length}`}.`);
if (errors.length) {
  console.error(report.join('\n'));
  console.error('\nОшибки:\n' + errors.join('\n'));
  process.exit(1);
}

const geometryModule = {
  model: spec.model,
  approximate: spec.approximate,
  axes: spec.axes,
  house: spec.house,
  heights: spec.heights,
  roof: spec.roof,
  terrace: spec.terrace,
  walls: spec.walls,
  floors: spec.floors,
  doors: spec.doors,
  floorGroups: spec.floorGroups,
  paintedRooms: spec.paintedRooms,
  rooms: spec.rooms,
  wallList: spec.wallList,
  builtins: spec.builtins,
  exteriorFixtures: spec.exteriorFixtures,
  walk: spec.walk,
  solarDefaults: spec.solarDefaults,
};

if (!CHECK_ONLY) {
  const banner = '// Сгенерировано scripts/build-spec.mjs — не редактировать вручную.\n';
  mkdirSync(join(ROOT, 'dist/data'), { recursive: true });
  mkdirSync(join(ROOT, 'docs'), { recursive: true });
  writeFileSync(join(ROOT, 'PROJECT_SPEC.json'), JSON.stringify(fullSpec, null, 2) + '\n');
  writeFileSync(join(ROOT, 'INITIAL_PROJECT_STATE.json'), JSON.stringify(initialState, null, 2) + '\n');
  writeFileSync(join(ROOT, 'dist/data/project-spec.js'), `${banner}export default ${JSON.stringify(geometryModule, null, 1)};\n`);
  writeFileSync(join(ROOT, 'dist/data/initial-state.js'), `${banner}export default ${JSON.stringify(initialState, null, 1)};\n`);
  writeFileSync(join(ROOT, 'HOUSE_PLAN.svg'), buildSvg() + '\n');
  writeFileSync(join(ROOT, 'docs/PLAN_CHECK.md'), report.join('\n') + '\n');
}
console.log(report.filter((l) => l.startsWith('✘') || l.startsWith('Итог')).join('\n') || 'ok');
console.log(`Проверок: ${report.filter((l) => l.startsWith('✔')).length}, ошибок: ${errors.length}`);
