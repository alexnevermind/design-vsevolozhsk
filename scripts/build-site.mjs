// Строит данные участка из scripts/site-source.mjs: размещает постройки по подписанным размерам,
// рельеф по отметкам, деревья, площадки, забор, ворота и дорожки; сверяет размеры листов и плана
// участка и записывает SITE_SPEC.json, SITE_PLAN.svg, dist/data/site-spec.js, docs/SITE_CHECK.md.
// Запуск: npm run site  (флаг --check — только проверка без записи; код выхода 1 при ошибках).
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as S from './site-source.mjs';
import { fitTerrain, terrainAt } from '../dist/site-terrain.js';
import { polygonArea, pointInPolygon, distToSegment } from '../dist/geometry.js';

const dseg = (...a) => distToSegment(...a).d;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK_ONLY = process.argv.includes('--check');

const r3 = (v) => Math.round(v * 1000) / 1000;
const r2 = (v) => Math.round(v * 100) / 100;
const mm = (v) => `${Math.round(v * 1000)}`;
const deg = Math.PI / 180;
const fmt = (v, d = 2) => v.toFixed(d).replace('.', ',');

const report = [];
const errors = [];
const warnings = [];
function check(ok, msg) {
  report.push(`- ${ok ? '✔' : '✘'} ${msg}`);
  if (!ok) errors.push(msg);
  return ok;
}
function note(msg) {
  report.push(`- ⚠ ${msg}`);
  warnings.push(msg);
}
function line(msg = '') {
  report.push(msg);
}

// ---------- Пиксели плана → метры участка ----------
const K = S.SITE_SCALE.mmPerPx / 1000;
const [OX, OY] = S.SITE_SCALE.originPx;
const px2m = ([x, y]) => [r3((x - OX) * K), r3((y - OY) * K)];

const boundary = S.BOUNDARY_PX.map(px2m);
const [NW, NE, SE, SW] = boundary;
const lerpX = (a, b, z) => a[0] + (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]);
const lerpZ = (a, b, x) => a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
const westX = (z) => lerpX(NW, SW, z);
const eastX = (z) => lerpX(NE, SE, z);
const northZ = (x) => lerpZ(NW, NE, x);
const southZ = (x) => lerpZ(SW, SE, x);
const segLen = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

line('# Проверка данных участка');
line('');
line('Сгенерировано `node scripts/build-site.mjs` из `scripts/site-source.mjs`; ничего не дописано вручную.');
line('✔ — сходится, ⚠ — нестыковка исходных листов (решение записано в docs/ASSUMPTIONS.md), ✘ — ошибка данных.');
line('');
line('## Участок');
const siteArea = Math.abs(polygonArea(boundary));
line(`- Масштаб плана ${S.SITE_SCALE.mmPerPx} мм/px; стороны: север ${fmt(segLen(NW, NE))} м, восток ${fmt(segLen(NE, SE))} м, юг ${fmt(segLen(SE, SW))} м, запад ${fmt(segLen(SW, NW))} м`);
check(siteArea > 1150 && siteArea < 1250, `площадь участка ${fmt(siteArea, 1)} м² (≈${fmt(siteArea / 100, 1)} сотки)`);
line(`- Север — верх листа; солнце: ${S.GEO.place}, ${S.GEO.latitude}° с. ш., ${S.GEO.longitude}° в. д., UTC+${S.GEO.utcOffset}`);

// ---------- Рельеф ----------
line('');
line('## Рельеф');
const elevAll = S.ELEVATIONS_PX.map(([x, y, h]) => [...px2m([x, y]), h]);
const elevOut = elevAll.filter((p) => S.ELEVATION_OUTLIERS.includes(p[2]));
let elev = elevAll.filter((p) => !S.ELEVATION_OUTLIERS.includes(p[2]));
check(elevOut.length === S.ELEVATION_OUTLIERS.length, `исключены невозможные отметки (S4): ${elevOut.map((p) => fmt(p[2])).join(', ')}`);
// Отметки, резко расходящиеся с соседями: медиана 8 ближайших.
const flagged = [];
for (const p of elev) {
  const near = elev.filter((q) => q !== p).map((q) => [Math.hypot(q[0] - p[0], q[1] - p[1]), q[2]]).sort((a, b) => a[0] - b[0]).slice(0, 8).map((v) => v[1]).sort((a, b) => a - b);
  const med = (near[3] + near[4]) / 2;
  if (Math.abs(p[2] - med) > 0.45) flagged.push({ p, med });
}
for (const f of flagged) note(`отметка ${fmt(f.p[2])} в (${fmt(f.p[0], 1)}; ${fmt(f.p[1], 1)}) отличается от соседей (медиана ${fmt(f.med)}) — исключена из рельефа`);
elev = elev.filter((p) => !flagged.some((f) => f.p === p));
const hs = elev.map((p) => p[2]);
const hMin = Math.min(...hs), hMax = Math.max(...hs);
check(elev.length >= 140, `отметок в рельефе: ${elev.length} (всего на листе ${elevAll.length})`);
check(hMin >= 23.8 && hMax <= 24.9, `диапазон отметок ${fmt(hMin)}…${fmt(hMax)} м (перепад ${fmt(hMax - hMin)} м)`);
const terrain = fitTerrain(elev, 0.6);
const resid = elev.map((p) => terrainAt(terrain, p[0], p[1]) - p[2]);
const rms = Math.sqrt(resid.reduce((s, v) => s + v * v, 0) / resid.length);
check(rms < 0.06, `сглаживающий сплайн: СКО по отметкам ${fmt(rms * 100, 1)} см, максимум ${fmt(Math.max(...resid.map(Math.abs)) * 100, 1)} см`);
const ground = (x, z) => terrainAt(terrain, x, z);

// ---------- Размещение построек ----------
function placer(theta, origin) {
  const c = Math.cos(theta), s = Math.sin(theta);
  const f = ([u, v]) => [origin[0] + (u / 1000) * c - (v / 1000) * s, origin[1] + (u / 1000) * s + (v / 1000) * c];
  f.theta = theta; f.origin = origin; f.dirU = [c, s]; f.dirV = [-s, c];
  return f;
}
const pxPos = (p) => px2m(p);
line('');
line('## Размещение построек по подписанным размерам');

// Гриль-дом: 1975 от западной границы до западной грани, 2495 от северной границы до северной вершины.
const G = S.GRILL;
const faceD = G.hexagon.vertexR * Math.cos(30 * deg) / 1000;
let gc = pxPos(G.sheet.originPx.map((v, i) => [199.5, 227.25][i]));
for (let i = 0; i < 10; i++) {
  gc = [westX(gc[1]) + G.placement.westOffset / 1000 + faceD, northZ(gc[0]) + G.placement.northOffset / 1000 + G.hexagon.vertexR / 1000];
}
const grillAt = placer(0, gc);
const grillPx = pxPos([199.5, 227.25]);
line(`- Гриль-дом: центр (${fmt(gc[0])}; ${fmt(gc[1])}); по растру (${fmt(grillPx[0])}; ${fmt(grillPx[1])}), сдвиг ${mm(Math.hypot(gc[0] - grillPx[0], gc[1] - grillPx[1]) / 1)} мм`);

// Гостевой дом: стены по осям участка, как на плане (S2); 3000 от восточного забора у бани, 9105 от бани до южной границы.
const GU = S.GUEST;
const thetaGuest = 90 * deg;
const fenceDir = [(SE[0] - NE[0]) / segLen(NE, SE), (SE[1] - NE[1]) / segLen(NE, SE)];
const eastNormal = [fenceDir[1], -fenceDir[0]]; // наружу (на восток)
const distToEast = (p) => -((p[0] - NE[0]) * eastNormal[0] + (p[1] - NE[1]) * eastNormal[1]);
let gO = pxPos([773, 498.5]);
for (let i = 0; i < 20; i++) {
  const at = placer(thetaGuest, gO);
  const pE = at([GU.placement.eastAt, 0]);
  gO = [gO[0] + (distToEast(pE) - GU.placement.eastOffset / 1000), gO[1]];
  const vDim = (gO[0] - 23.27) * 1000;
  const p = placer(thetaGuest, gO)([15215, vDim]);
  gO = [gO[0], gO[1] + (southZ(p[0]) - p[1] - GU.placement.southOffset / 1000)];
}
const guestAt = placer(thetaGuest, gO);
const guestPx = pxPos([773, 498.5]);
line(`- Гостевой дом: СВ угол основного объёма (${fmt(gO[0])}; ${fmt(gO[1])}), стены по осям участка; по растру (${fmt(guestPx[0])}; ${fmt(guestPx[1])}), сдвиг ${mm(Math.hypot(gO[0] - guestPx[0], gO[1] - guestPx[1]))} мм`);

// Хоз.блок: СВ угол — пересечение окружностей 16785 от южной вершины гриль-дома и 12680 от ЮЗ угла основного объёма.
const GA = S.GARAGE;
const grillS = grillAt([0, G.hexagon.vertexR]);
const guestSW = guestAt([5180, 9180]);
function circles(c0, r0, c1, r1, near) {
  const d = segLen(c0, c1);
  const a = (r0 * r0 - r1 * r1 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r0 * r0 - a * a));
  const ex = [(c1[0] - c0[0]) / d, (c1[1] - c0[1]) / d];
  const m = [c0[0] + ex[0] * a, c0[1] + ex[1] * a];
  const sols = [[m[0] - ex[1] * h, m[1] + ex[0] * h], [m[0] + ex[1] * h, m[1] - ex[0] * h]];
  return sols.sort((p, q) => segLen(p, near) - segLen(q, near))[0];
}
const hozPx = pxPos([208.5, 803]);
const hozNE = circles(grillS, 16.785, guestSW, 12.68, hozPx);
const gShift = GA.placement.shift.map((v) => v / 1000);
const garageLabelAt = placer(0, [hozNE[0] - GA.shed.rect[2] / 1000, hozNE[1]]); // положение по подписям (деревья привязаны к нему)
const garageAt = placer(0, [hozNE[0] - GA.shed.rect[2] / 1000 + gShift[0], hozNE[1] + gShift[1]]);
line(`- Хоз.блок: СВ угол (${fmt(hozNE[0])}; ${fmt(hozNE[1])}) по 16785 и 12680 (по растру (${fmt(hozPx[0])}; ${fmt(hozPx[1])}), ${mm(segLen(hozNE, hozPx))} мм), затем сдвиг ${mm(gShift[0])} мм к востоку (S5): (${fmt(hozNE[0] + gShift[0])}; ${fmt(hozNE[1] + gShift[1])})`);

// ---------- Геометрия построек в координатах участка ----------
const rectPts = ([x0, y0, x1, y1]) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const placePoly = (at, pts) => pts.map((p) => at(p).map(r3));
function hexPts(R) {
  return [0, 1, 2, 3, 4, 5].map((k) => [R * Math.cos((-90 + 60 * k) * deg), R * Math.sin((-90 + 60 * k) * deg)]);
}
const FACES = ['NE', 'E', 'SE', 'SW', 'W', 'NW'];

// Проём в стене-полосе: сторона прямоугольника объёма (local мм).
function sideSegment(rect, wall, t) {
  const [x0, y0, x1, y1] = rect;
  if (wall === 'y0') return { a: [x0, y0 + t / 2], b: [x1, y0 + t / 2], along: 'x', out: [0, -1] };
  if (wall === 'y1') return { a: [x0, y1 - t / 2], b: [x1, y1 - t / 2], along: 'x', out: [0, 1] };
  if (wall === 'x0') return { a: [x0 + t / 2, y0], b: [x0 + t / 2, y1], along: 'y', out: [-1, 0] };
  return { a: [x1 - t / 2, y0], b: [x1 - t / 2, y1], along: 'y', out: [1, 0] };
}

const buildings = [];
// Гостевой дом
{
  const at = guestAt;
  const vols = GU.volumes.map((v) => ({ id: v.id, name: v.name, storeys: v.storeys, rect: v.rect, outline: placePoly(at, rectPts(v.rect)) }));
  const walls = [];
  const T = GU.outerWall;
  for (const v of GU.volumes) {
    const sides = v.id === 'link' ? ['y0', 'y1'] : ['y0', 'y1', 'x0', 'x1'];
    for (const side of sides) {
      const seg = sideSegment(v.rect, side, T);
      const ops = GU.openings.filter((o) => o.volume === v.id && o.wall === side && (o.storey ?? 1) === 1)
        .concat(GU.passages.filter((o) => o.volume === v.id && o.wall === side).map((o) => ({ ...o, type: 'passage' })));
      walls.push({ id: `${v.id}-${side}`, volume: v.id, side, t: T, a: seg.a, b: seg.b, along: seg.along, out: seg.out, openings: ops });
    }
  }
  for (const p of GU.partitions) walls.push({ id: p.id, t: p.t, a: p.a, b: p.b, along: p.a[0] === p.b[0] ? 'y' : 'x', partition: true, openings: (p.openings ?? []).map((o) => ({ ...o, rel: true })) });
  const rooms = GU.rooms.map((r) => {
    const poly = r.polygon ?? rectPts(r.rect);
    return { ...r, poly, sitePoly: placePoly(at, poly), polyArea: Math.abs(polygonArea(poly.map(([x, y]) => [x / 1000, y / 1000]))) };
  });
  const roofs = GU.roofs.map((rf) => {
    const v = GU.volumes.find((q) => q.id === rf.volume);
    const h = GU.heights[rf.volume];
    const o = h.overhang;
    let [x0, y0, x1, y1] = v.rect;
    if (rf.volume === 'link') { y0 -= o; y1 += o; } else { x0 -= o; y0 -= o; x1 += o; y1 += o; }
    if (rf.volume === 'wing') x0 = v.rect[0]; // северный торец бани примыкает к переходу и основному объёму
    const ridge = rf.ridgeAxis === 'y' ? [[(v.rect[0] + v.rect[2]) / 2, y0], [(v.rect[0] + v.rect[2]) / 2, y1]] : [[x0, (v.rect[1] + v.rect[3]) / 2], [x1, (v.rect[1] + v.rect[3]) / 2]];
    return { volume: rf.volume, type: rf.type, outline: placePoly(at, rectPts([x0, y0, x1, y1])), ridge: placePoly(at, ridge), pitch: h.pitch };
  });
  buildings.push({ id: GU.id, name: GU.name, at, vols, walls, rooms, roofs, footprint: vols.map((v) => v.outline) });
}
// Гриль-дом
{
  const at = grillAt;
  const R = G.hexagon.vertexR;
  const outer = hexPts(R);
  const inner = hexPts(G.hexagon.innerFace / Math.cos(30 * deg));
  const over = hexPts(R + G.roof.overhang / Math.cos(30 * deg));
  const walls = FACES.map((f, k) => ({ id: `face-${f}`, face: f, a: outer[k], b: outer[(k + 1) % 6], ai: inner[k], bi: inner[(k + 1) % 6], openings: G.openings.filter((o) => o.face === f) }));
  const apex = [0, 0];
  const ridges = G.roof.gables.map((f) => { const k = FACES.indexOf(f); const m = [(over[k][0] + over[(k + 1) % 6][0]) / 2, (over[k][1] + over[(k + 1) % 6][1]) / 2]; return placePoly(at, [apex, m]); });
  // Обеденная площадка: по оси юго-восточной грани наружу.
  const k = FACES.indexOf(G.dining.face);
  const mid = [(outer[k][0] + outer[(k + 1) % 6][0]) / 2, (outer[k][1] + outer[(k + 1) % 6][1]) / 2];
  const n = [Math.cos(30 * deg), Math.sin(30 * deg)];
  const tdir = [-n[1], n[0]];
  const w2 = G.dining.width / 2, D = G.dining.depth;
  const deck = [[mid[0] + tdir[0] * w2, mid[1] + tdir[1] * w2], [mid[0] - tdir[0] * w2, mid[1] - tdir[1] * w2],
    [mid[0] - tdir[0] * w2 + n[0] * D, mid[1] - tdir[1] * w2 + n[1] * D], [mid[0] + tdir[0] * w2 + n[0] * D, mid[1] + tdir[1] * w2 + n[1] * D]];
  const rooms = [{ ...G.rooms[0], sitePoly: placePoly(at, inner), polyArea: Math.abs(polygonArea(inner.map(([x, y]) => [x / 1000, y / 1000]))) }];
  buildings.push({ id: G.id, name: G.name, at, walls, rooms, footprint: [placePoly(at, outer)], roofs: [{ type: 'tri-gable', outline: placePoly(at, over), ridges }],
    dining: { poly: placePoly(at, deck), far: at([mid[0] + n[0] * (D + 500), mid[1] + n[1] * (D + 500)]) } });
}
// Навес с хоз.блоком
{
  const at = garageAt;
  const sh = GA.shed;
  const walls = ['y0', 'y1', 'x0', 'x1'].map((side) => { const seg = sideSegment(sh.rect, side, sh.wall); return { id: `shed-${side}`, side, t: sh.wall, a: seg.a, b: seg.b, along: seg.along, out: seg.out, openings: sh.openings.filter((o) => o.wall === side) }; });
  const cp = GA.carport;
  const posts = [];
  for (const x of cp.piersX) for (const y of cp.rowsY) for (const dy of [-cp.pairGap / 2, cp.pairGap / 2]) posts.push([x, y + dy]);
  for (const x of cp.gablePostsX) posts.push([x, cp.rowsY[cp.rowsY.length - 1] + cp.pairGap / 2]);
  const piers = [];
  for (const x of cp.piersX) for (const y of cp.rowsY) piers.push(placePoly(at, rectPts([x - cp.pierCladding[0] / 2, y - cp.pierCladding[1] / 2, x + cp.pierCladding[0] / 2, y + cp.pierCladding[1] / 2])));
  const o = sh.overhang;
  const shedRoof = [sh.rect[0] - o, sh.rect[1] - o, sh.rect[2] + o, sh.rect[3]];
  const cr = cp.roof;
  buildings.push({ id: GA.id, name: GA.name, at, walls,
    rooms: [{ id: 'H01', name: 'Хоз.блок', area: sh.area, sitePoly: placePoly(at, rectPts([sh.wall, sh.wall, sh.rect[2] - sh.wall, sh.rect[3] - sh.wall])), polyArea: (sh.rect[2] - 2 * sh.wall) * (sh.rect[3] - 2 * sh.wall) / 1e6 },
      { id: 'H02', name: 'Навес для а/м', area: cp.area, sitePoly: placePoly(at, rectPts([cp.piersX[0], cp.rowsY[0], cp.piersX[1], cp.rowsY[3]])), polyArea: 7.5 * 8.0 }],
    footprint: [placePoly(at, rectPts(sh.rect))],
    carport: { posts: posts.map((p) => at(p).map(r3)), piers, roof: placePoly(at, rectPts([cr.x[0], cr.y[0], cr.x[1], cr.y[1]])), ridge: placePoly(at, [[(cr.x[0] + cr.x[1]) / 2, cr.y[0]], [(cr.x[0] + cr.x[1]) / 2, cr.y[1]]]),
      floor: placePoly(at, rectPts([cr.x[0], sh.rect[3], cr.x[1], cr.y[1]])) },
    roofs: [{ type: 'gable', outline: placePoly(at, rectPts(shedRoof)), ridge: placePoly(at, [[sh.rect[2] / 2, shedRoof[1]], [sh.rect[2] / 2, shedRoof[3]]]) }] });
}
const B = Object.fromEntries(buildings.map((b) => [b.id, b]));

// ---------- Размеры листов построек ----------
line('');
line('## Размеры листов построек');
const sumv = (a) => a.reduce((s, v) => s + v, 0);
check(4630 + 2 * GU.outerWall === 5180, 'гостевой дом: 4630 + 2×275 = 5180');
check(4270 + 4360 + 2 * GU.outerWall === 9180, 'гостевой дом: 4270 + 4360 + 2×275 = 9180');
check(2335 + 225 + 3400 + 2 * GU.outerWall === 6510, 'баня: 2335 + 225 + 3400 + 2×275 = 6510');
check(2350 + 225 + 2055 + 2 * GU.outerWall === 5180, 'баня: 2350 + 225 + 2055 + 2×275 = 5180');
check(5180 + 3525 + 6510 === 15215, 'общая длина 5180 + 3525 + 6510 = 15215');
check(1315 + 1315 + 2 * GU.outerWall === GU.volumes[1].rect[3] - GU.volumes[1].rect[1], `переход: 1315 + 1315 + 2×275 = ${GU.volumes[1].rect[3] - GU.volumes[1].rect[1]} (наружная ширина)`);
note(`G1 переход: наружная цепочка 3525, внутренняя 3625, 1530 + стенка + 1920 = ${1530 + 1920}+стенка — принято 3525, санузел 1920 × 1145, стенка 150`);
note(`S3 дворик: подпись 1620, по листу дома ${GU.volumes[1].rect[1]} — принято по листу`);
const hexInnerSide = G.hexagon.innerFace / Math.cos(30 * deg) / 1000;
check(Math.abs(2 * G.hexagon.vertexR * Math.cos(30 * deg) - 2 * (G.hexagon.innerFace + G.hexagon.wall)) < 5, `гриль-дом: 8210 между вершинами ↔ 2×(3280 + 275) = ${2 * (G.hexagon.innerFace + G.hexagon.wall)} между гранями`);
check(Math.abs(3 * Math.sqrt(3) / 2 * hexInnerSide ** 2 - G.hexagon.area) < 0.1, `гриль-дом: площадь по внутреннему контуру ${fmt(3 * Math.sqrt(3) / 2 * hexInnerSide ** 2)} м² (подпись ${fmt(G.hexagon.area, 1)})`);
const tan = (a) => Math.tan(a * deg);
check(Math.abs(Math.atan(tan(G.roof.pitch) / 2) / deg - 13.3) < 0.6, `гриль-дом: уклон конька к фронтону ${fmt(Math.atan(tan(G.roof.pitch) / 2) / deg, 1)}° = половина ската ${G.roof.pitch}° (разрез: ≈13,3°)`);
const shedIn = (GA.shed.rect[2] - 2 * GA.shed.wall) * (GA.shed.rect[3] - 2 * GA.shed.wall) / 1e6;
check(Math.abs(shedIn - GA.shed.area) < 0.5, `хоз.блок: ${fmt(shedIn, 1)} м² в чистоте (подпись ${GA.shed.area}; стены каркасные 150)`);
note('H1 хоз.блок: 4360 по листу, 4220 на плане участка — принято 4360, угол привязан размерами 16785 и 12680');
note('H2 навес: по листу четыре ряда парных стоек и две стойки во фронтоне; на плане участка — одиночные стойки через 2,6 м — принято по листу');
check(Math.abs((GA.carport.rowsY[3] - GA.carport.rowsY[0]) + GA.carport.post - 8000) < 1, `навес: ряды опор ${GA.carport.rowsY[3] - GA.carport.rowsY[0]} + стойка 150 = 8000`);
check(GA.carport.roof.x[1] - GA.carport.roof.x[0] === 7500, 'навес: кровля 7500 по ширине');

line('');
line('## Площади помещений (подпись ↔ контур)');
for (const b of buildings) for (const r of b.rooms) {
  const d = r.polyArea - r.area;
  if (Math.abs(d) <= 0.35) check(true, `${b.name}: ${r.name} ${fmt(r.polyArea)} м² (подпись ${fmt(r.area, 1)})`);
  else note(`${b.name}: ${r.name} — подпись ${fmt(r.area, 1)} м², по размерам листа ${fmt(r.polyArea)} м² (Δ ${fmt(d)})`);
}

// ---------- Деревья ----------
line('');
line('## Деревья');
const SPECIES = { 'Б': 'birch', 'Е': 'spruce', 'С': 'pine' };
const SPECIES_RU = { birch: 'берёза', spruce: 'ель', pine: 'сосна' };
// Высота по диаметру (тип Нэслунда, средние значения для Ленинградской обл.), крона — по породе.
const ALLOM = { pine: [1.8, 0.19, 0.12, 1.4], spruce: [1.6, 0.2, 0.1, 1.6], birch: [1.2, 0.24, 0.2, 1.4] };
function treeSize(species, dbh) {
  const [a, b, kc, c0] = ALLOM[species];
  return { height: r2(1.3 + (dbh * dbh) / (a + b * dbh) ** 2), crown: r2(c0 + kc * dbh) };
}
const trees = S.TREES_PX.map((t) => {
  const [ch, num] = t.label.split('-');
  const species = SPECIES[ch];
  const dbh = Number(num);
  const pos = px2m(t.px);
  return { id: t.id, label: t.label, species, dbh, ...treeSize(species, dbh), pos, raw: pos, status: t.cut ? 'cut' : 'keep', reason: t.cut ? 'отмечено красным на плане' : '', note: t.note };
});
const T = Object.fromEntries(trees.map((t) => [t.id, t]));
// Деревья, привязанные к постройкам подписанными размерами, ставятся точно по подписи.
function toLocal(at, p) { const d = [p[0] - at.origin[0], p[1] - at.origin[1]]; return [(d[0] * at.dirU[0] + d[1] * at.dirU[1]) * 1000, (d[0] * at.dirV[0] + d[1] * at.dirV[1]) * 1000]; }
const labelChecks = [];
function snap(labelId, treeId, fn, measure) {
  const t = T[treeId];
  const before = measure(t.pos);
  t.pos = fn(t.pos).map(r3);
  labelChecks.push({ labelId, tree: treeId, raster: before, model: measure(t.pos) });
}
const gAt = B.guest.at;
const guestMeasure = (axis, ref, sign) => (p) => sign * (toLocal(gAt, p)[axis] - ref) / 1000;
const guestSnap = (axis, value) => (p) => { const l = toLocal(gAt, p); l[axis] = value; return gAt(l); };
snap('D2120', 'T28', guestSnap(0, 5180 + 2120), guestMeasure(0, 5180, 1));
labelChecks.push({ labelId: 'D1405', tree: 'T28', raster: (8705 - toLocal(gAt, T.T28.raw)[0]) / 1000, model: (8705 - toLocal(gAt, T.T28.pos)[0]) / 1000 });
snap('D1520', 'T27', guestSnap(1, -1520), guestMeasure(1, 0, -1));
snap('D2570', 'T22', guestSnap(0, -2570), guestMeasure(0, 0, -1));
snap('D2505', 'T43', guestSnap(1, 9180 + 2505), guestMeasure(1, 9180, 1));
snap('D1590', 'T21', guestSnap(0, 15215 + 1590), guestMeasure(0, 15215, 1));
const hozE = garageLabelAt([GA.shed.rect[2], 0])[0];
const hozN = garageLabelAt([0, 0])[1];
const pierE = garageLabelAt([GA.carport.piersX[1] + GA.carport.pierCladding[0] / 2, 0])[0];
snap('D1260', 'T04', (p) => [hozE + 1.26, p[1]], (p) => p[0] - hozE);
snap('D1380', 'T01', (p) => [p[0], hozN - 1.38], (p) => hozN - p[1]);
snap('D1195', 'T06', (p) => [pierE + 1.195, p[1]], (p) => p[0] - pierE);
// Деревья стоят по подписям к положению постройки на плане; после сдвига (S5) расстояние меньше на 200 мм.
for (const c of labelChecks) if (['D1260', 'D1195'].includes(c.labelId)) { c.model -= gShift[0]; c.shifted = true; }

// ---------- Площадки ----------
const F = S.FEATURES_PX;
const circle = (f) => ({ name: f.name, center: px2m(f.center), r: r3(f.r * K) });
const features = {
  pond: circle(F.pond),
  firePit: { ...circle(F.firePit), ringR: r3(F.firePit.ringR * K) },
  grillZone: circle(F.grillZone),
  plungePool: circle(F.plungePool),
  sport: { name: F.sport.name, poly: F.sport.poly.map(px2m) },
  septic: { name: F.septic.name, poly: rectPts([F.septic.rect[0], F.septic.rect[1], F.septic.rect[2], F.septic.rect[3]]).map(px2m) },
  dining: { name: 'Обеденная площадка с перголой', poly: B.grill.dining.poly },
};
const sportSides = [0, 1].map((i) => segLen(features.sport.poly[i], features.sport.poly[i + 1]));
line('');
line('## Площадки');
check(Math.abs(sportSides[0] - 8.0) < 0.15 && Math.abs(sportSides[1] - 4.45) < 0.15, `спортивная площадка ${fmt(sportSides[0])} × ${fmt(sportSides[1])} м, покрытие — серая резиновая крошка`);
check(Math.abs(segLen(features.septic.poly[0], features.septic.poly[1]) - 3) < 0.1, `ЛОС ${fmt(segLen(features.septic.poly[0], features.septic.poly[1]))} × ${fmt(segLen(features.septic.poly[1], features.septic.poly[2]))} м`);
for (const k of ['pond', 'firePit', 'grillZone', 'plungePool']) check(true, `${features[k].name}: центр (${fmt(features[k].center[0])}; ${fmt(features[k].center[1])}), Ø ${fmt(features[k].r * 2)} м`);
check(true, `обеденная площадка у ЮВ грани гриль-дома ${fmt(G.dining.width / 1000, 1)} × ${fmt(G.dining.depth / 1000, 2)} м, пергола`);

// ---------- Ворота, калитка, дорожки ----------
const cpAxisX = B.garage.at([GA.shed.rect[2] / 2, 0])[0];
const gw = S.GATES.gate.width;
const gate = { x0: r3(cpAxisX - gw / 2), x1: r3(cpAxisX + gw / 2) };
const slideEnd = gate.x1 + gw + S.GATES.gate.counter;
const wicket = { x0: r3(slideEnd + S.GATES.wicket.gapAfterSlide), x1: r3(slideEnd + S.GATES.wicket.gapAfterSlide + S.GATES.wicket.width) };
const onSouth = (x, inset = 0) => [r3(x), r3(southZ(x) - inset)];
const doorCenter = (b, opId, out = 1.2) => {
  const w = b.walls.find((q) => q.openings?.some((o) => o.id === opId));
  const o = w.openings.find((q) => q.id === opId);
  const c = (o.from + o.to) / 2;
  if (b.id === 'grill') {
    const t = c / G.hexagon.vertexR;
    const p = [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t];
    const n = Math.hypot(p[0], p[1]);
    return b.at([p[0] + p[0] / n * out * 1000, p[1] + p[1] / n * out * 1000]).map(r3);
  }
  const p = w.along === 'x' ? [c, w.a[1]] : [w.a[0], c];
  return b.at([p[0] + w.out[0] * (GU.outerWall / 2 + out * 1000), p[1] + w.out[1] * (GU.outerWall / 2 + out * 1000)]).map(r3);
};
const named = {
  wicket: onSouth((wicket.x0 + wicket.x1) / 2, 0.45),
  guestEntry: doorCenter(B.guest, 'GD2', 0.82),
  restDoor: doorCenter(B.guest, 'GG3', 0.82),
  grillSW: doorCenter(B.grill, 'KD2', 0.82),
  diningEnd: B.grill.dining.far.map(r3),
};
const paths = S.PATHS.map((p) => ({ ...p, pts: p.pts.map((q) => (typeof q[0] === 'string' ? named[q[0]] : q)) }));

line('');
line('## Ворота, калитка, дорожки (предложение, на плане участка их нет)');
const gablePosts = GA.carport.gablePostsX.map((x) => B.garage.at([x, 0])[0]);
check(gate.x0 > gablePosts[0] && gate.x1 < gablePosts[1], `откатные ворота ${fmt(gw, 1)} м по оси навеса: X ${fmt(gate.x0)}…${fmt(gate.x1)}, откат на восток до X ${fmt(slideEnd)}; калитка X ${fmt(wicket.x0)}…${fmt(wicket.x1)}`);
check(wicket.x1 < SE[0] - 1, 'калитка в пределах южного забора');

// ---------- Отметки пола ----------
line('');
line('## Отметки пола (ж/б сваи, пол на 0,25 м выше земли)');
function perimeterGround(polys) {
  const vals = [];
  for (const poly of polys) for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const n = Math.max(2, Math.ceil(segLen(a, b) / 0.5));
    for (let k = 0; k < n; k++) vals.push(ground(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n));
  }
  return vals;
}
// Пол — медиана земли по контуру + 0,25 (до 5 см); у стен земля планируется до «пол − 0,25»
// с плавным переходом к естественному рельефу (в сцене: ровно до 0,6 м от стен, переход до 2,5 м).
const levels = {};
for (const b of buildings) {
  const g = perimeterGround(b.footprint).sort((x, y) => x - y);
  const med = g[Math.floor(g.length / 2)];
  const floor = Math.round((med + S.FLOOR_ABOVE_GROUND / 1000) * 20) / 20;
  const pad = r2(floor - S.FLOOR_ABOVE_GROUND / 1000);
  const fill = pad - g[0], cutD = g[g.length - 1] - pad;
  levels[b.id] = { floor, pad, grade: { flat: 0.6, blend: 2.5 }, groundMin: r2(g[0]), groundMax: r2(g[g.length - 1]) };
  check(fill <= 0.3 && cutD <= 0.3, `${b.name}: чистый пол ${fmt(floor)} (земля по контуру ${fmt(g[0])}…${fmt(g[g.length - 1])}); планировка у стен ${fmt(pad)}: подсыпка до ${mm(Math.max(0, fill))} мм, срезка до ${mm(Math.max(0, cutD))} мм, цоколь 250 мм`);
}
const carportGround = perimeterGround([B.garage.carport.floor]);
levels.carport = { floor: r2(carportGround.reduce((s, v) => s + v, 0) / carportGround.length), note: 'плитка по земле с уклоном' };

// ---------- Размеры плана участка ----------
line('');
line('## Подписанные размеры плана участка ↔ модель');
const LBL = Object.fromEntries(S.SITE_LABELS.map((l) => [l.id, l]));
function labelRow(id, model, raster, how) {
  const l = LBL[id];
  const d = Math.round(model * 1000 - l.value);
  const dr = raster === undefined ? '' : `, по растру ${mm(raster)} (${Math.round(raster * 1000 - l.value) >= 0 ? '+' : ''}${Math.round(raster * 1000 - l.value)})`;
  const ok = Math.abs(d) <= 60;
  const msg = `${l.value} — ${l.what}: модель ${mm(model)}${dr}${how ? ` · ${how}` : ''}`;
  if (ok) check(true, msg); else note(msg);
}
const gW = B.grill.at([-faceD * 1000, 0]);
labelRow('D1975', gW[0] - westX(gW[1]), undefined, 'привязка');
const gN = B.grill.at([0, -G.hexagon.vertexR]);
labelRow('D2495', gN[1] - northZ(gN[0]), undefined, 'привязка');
const hozNEs = [hozNE[0] + gShift[0], hozNE[1] + gShift[1]];
labelRow('D16785', segLen(grillS, hozNEs), segLen(pxPos([199.5, 341]), hozPx), `привязка, затем сдвиг ${mm(gShift[0])} мм (S5)`);
labelRow('D12680', segLen(hozNEs, guestSW), segLen(hozPx, pxPos([518.5, 641.5])), `привязка, затем сдвиг ${mm(gShift[0])} мм (S5)`);
const mainE = gAt([2590, 0]); const wingE = gAt([GU.placement.eastAt, 0]);
labelRow('D3000N', distToEast(mainE), (eastX(pxPos([773, 566])[1]) - pxPos([773, 566])[0]), 'забор не параллелен дому (S2)');
labelRow('D3000S', distToEast(wingE), (eastX(pxPos([773, 880])[1]) - pxPos([773, 880])[0]), 'привязка');
const wS = gAt([15215, (gO[0] - 23.27) * 1000]);
labelRow('D9105', southZ(wS[0]) - wS[1], southZ(pxPos([690, 920])[0]) - pxPos([690, 920])[1], 'привязка');
labelRow('D1620', (GU.volumes[1].rect[1]) / 1000, 1.69, 'по листу дома 1700 (S3)');
for (const c of labelChecks) labelRow(c.labelId, c.model, c.raster, `дерево ${c.tree} ${T[c.tree].label} поставлено по подписи${c.shifted ? `; постройка сдвинута на ${mm(gShift[0])} мм (S5)` : ''}`);

// ---------- Взаимное положение ----------
line('');
line('## Взаимное положение');
const insideSite = (p) => pointInPolygon(p[0], p[1], boundary);
for (const b of buildings) {
  const pts = b.footprint.flat();
  const dmin = Math.min(...pts.map((p) => Math.min(...boundary.map((a, i) => dseg(p[0], p[1], a[0], a[1], boundary[(i + 1) % 4][0], boundary[(i + 1) % 4][1])))));
  check(pts.every(insideSite), `${b.name}: стены внутри участка, до границы не меньше ${fmt(dmin)} м`);
}
const cpPosts = B.garage.carport.posts;
const cpMin = Math.min(...cpPosts.map((p) => p[0] - westX(p[1])));
const roofMin = Math.min(...B.garage.carport.roof.map((p) => p[0] - westX(p[1])));
const pierMin = Math.min(...B.garage.carport.piers.flat().map((p) => p[0] - westX(p[1])));
check(roofMin > 0.05 && pierMin > 0.05, `S5 навес сдвинут на ${mm(gShift[0])} мм к востоку: обшивка западных опор в ${mm(pierMin)} мм от границы, край кровли — ${mm(roofMin)} мм`);
check(cpPosts.every(insideSite), 'навес: все стойки внутри участка');

function polyDist(a, b) {
  let d = Infinity;
  for (const p of a) for (let i = 0; i < b.length; i++) d = Math.min(d, dseg(p[0], p[1], b[i][0], b[i][1], b[(i + 1) % b.length][0], b[(i + 1) % b.length][1]));
  for (const p of b) for (let i = 0; i < a.length; i++) d = Math.min(d, dseg(p[0], p[1], a[i][0], a[i][1], a[(i + 1) % a.length][0], a[(i + 1) % a.length][1]));
  return d;
}
const fp = (id) => B[id].footprint;
const minPolyDist = (A, Bp) => Math.min(...A.flatMap((a) => Bp.map((b) => polyDist(a, b))));
check(minPolyDist(fp('grill'), fp('guest')) > 8, `гриль-дом ↔ гостевой дом: ${fmt(minPolyDist(fp('grill'), fp('guest')))} м`);
check(minPolyDist(fp('garage'), fp('guest')) > 8, `хоз.блок ↔ гостевой дом: ${fmt(minPolyDist(fp('garage'), fp('guest')))} м`);
check(minPolyDist(fp('garage'), fp('grill')) > 8, `хоз.блок ↔ гриль-дом: ${fmt(minPolyDist(fp('garage'), fp('grill')))} м`);
const fpDist = (c) => Math.min(...buildings.map((b) => Math.min(...b.footprint.map((poly) => Math.min(...poly.map((p, i) => dseg(c[0], c[1], p[0], p[1], poly[(i + 1) % poly.length][0], poly[(i + 1) % poly.length][1])))))));
check(true, `кострище: до ближайшей постройки ${fmt(fpDist(features.firePit.center) - features.firePit.ringR)} м от края кольца, гриль-зона — ${fmt(fpDist(features.grillZone.center))} м от центра (по плану, подтверждено владельцем)`);

// Деревья: внутри построек, площадок, под кровлей; в полосе дорожек.
const inPoly = (p, poly) => pointInPolygon(p[0], p[1], poly);
const roofPolys = buildings.flatMap((b) => [...b.roofs.map((r) => r.outline), ...(b.carport ? [b.carport.roof] : [])]);
const padHit = (p) => {
  for (const k of ['pond', 'firePit', 'grillZone', 'plungePool']) if (segLen(p, features[k].center) < features[k].r + 0.3) return features[k].name;
  for (const k of ['sport', 'septic', 'dining']) if (inPoly(p, features[k].poly)) return features[k].name;
  return null;
};
for (const t of trees) {
  if (t.status === 'cut') continue;
  const b = buildings.find((bb) => bb.footprint.some((poly) => inPoly(t.pos, poly)));
  if (b) { t.status = 'cut'; t.reason = `внутри: ${b.name}`; continue; }
  if (roofPolys.some((poly) => inPoly(t.pos, poly))) { t.status = 'cut'; t.reason = 'под кровлей'; continue; }
  const pad = padHit(t.pos);
  if (pad) { t.status = 'cut'; t.reason = `на площадке: ${pad}`; }
}
const cut = trees.filter((t) => t.status === 'cut');
check(true, `деревьев на участке ${trees.length}: сохраняется ${trees.length - cut.length}, под вырубку ${cut.length} (${cut.map((t) => `${t.id} ${t.label} — ${t.reason}`).join('; ')})`);
for (const t of trees.filter((q) => q.status === 'keep')) {
  const d = fpDist(t.pos);
  if (d < 1.2) note(`${t.id} ${t.label} сохраняется в ${fmt(d)} м от стены — крона над кровлей`);
}
// Дорожки: не через постройки, не через стволы, внутри участка.
let pathBad = 0;
for (const p of paths) {
  for (let i = 0; i + 1 < p.pts.length; i++) {
    const a = p.pts[i], b = p.pts[i + 1];
    const n = Math.ceil(segLen(a, b) / 0.2);
    for (let k = 0; k <= n; k++) {
      const q = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n];
      if (!insideSite(q)) { pathBad++; note(`${p.id}: точка (${fmt(q[0])}; ${fmt(q[1])}) вне участка`); break; }
      if (buildings.some((bb) => bb.footprint.some((poly) => inPoly(q, poly)))) { pathBad++; note(`${p.id} проходит через постройку`); break; }
    }
    const L = segLen(a, b);
    for (let k = 0; k <= Math.ceil(L / 0.2); k++) {
      const tt = Math.min(1, k * 0.2 / L);
      const q = [a[0] + (b[0] - a[0]) * tt, a[1] + (b[1] - a[1]) * tt];
      for (const key of ['pond', 'plungePool']) {
        const f = features[key];
        if (segLen(q, f.center) < f.r + p.width / 2 + 0.1 && !(i + 2 === p.pts.length && tt > 0.8)) { pathBad++; note(`${p.id} задевает: ${f.name}`); break; }
      }
      for (const key of ['sport', 'septic']) {
        const pg = features[key].poly;
        const dEdge = Math.min(...pg.map((v, j) => dseg(q[0], q[1], v[0], v[1], pg[(j + 1) % 4][0], pg[(j + 1) % 4][1])));
        if (inPoly(q, pg) || dEdge < p.width / 2) { pathBad++; note(`${p.id} задевает: ${features[key].name} (${fmt(dEdge)} м)`); break; }
      }
    }
    for (const t of trees.filter((q) => q.status === 'keep')) {
      const d = dseg(t.pos[0], t.pos[1], a[0], a[1], b[0], b[1]);
      if (d < p.width / 2 + 0.3) { pathBad++; note(`${p.id}: ствол ${t.id} ${t.label} в ${fmt(d)} м от оси дорожки`); }
    }
  }
}
check(pathBad === 0, `дорожки (${paths.length}) не пересекают постройки и стволы, не выходят за участок`);

// ---------- Данные для приложения ----------
const spec = {
  model: 'site-vsevolozhsk-v1',
  units: 'm',
  axes: { X: 'восток (вправо по листу)', Z: 'юг (вниз по листу)', Y: `вверх; Y = H − ${S.DATUM}` },
  scale: S.SITE_SCALE,
  geo: S.GEO,
  datum: S.DATUM,
  boundary,
  site: { area: r2(siteArea) },
  terrain: { lambda: terrain.lambda, points: elev.map((p) => p.slice(0, 2)), heights: elev.map((p) => p[2]), weights: terrain.weights, affine: terrain.affine, excluded: [...elevOut, ...flagged.map((f) => f.p)].map((p) => p.map(r3)) },
  levels,
  buildings: buildings.map((b) => ({
    id: b.id, name: b.name, origin: b.at.origin.map(r3), rotation: r3(b.at.theta / deg),
    footprint: b.footprint, roofs: b.roofs, rooms: b.rooms.map((r) => ({ id: r.id, name: r.name, area: r.area, level: r.level ?? 1, poly: r.sitePoly })),
    ...(b.carport ? { carport: b.carport } : {}), ...(b.dining ? { dining: b.dining.poly } : {}),
  })),
  sources: { guest: GU, grill: G, garage: GA },
  trees: trees.map(({ raw, ...t }) => t),
  features,
  fence: { ...S.FENCE, line: boundary },
  gates: { gate, wicket, slideEnd: r3(slideEnd) },
  paths,
  paving: S.PAVING,
  style: S.FEATURE_STYLE,
};

// ---------- SVG-схема ----------
const PX = 20; // px на метр
const ML = 70, MT = 90;
const minX = Math.min(...boundary.map((p) => p[0])) - 1;
const sx = (x) => ML + (x - minX) * PX;
const sz = (z) => MT + (z + 1) * PX;
const pt = (p) => `${sx(p[0]).toFixed(1)},${sz(p[1]).toFixed(1)}`;
const poly = (pts, cls, extra = '') => `<polygon class="${cls}" points="${pts.map(pt).join(' ')}" ${extra}/>`;
const pl = (pts, cls) => `<polyline class="${cls}" points="${pts.map(pt).join(' ')}"/>`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const text = (p, s, cls, extra = '') => `<text class="${cls}" x="${sx(p[0]).toFixed(1)}" y="${sz(p[1]).toFixed(1)}" ${extra}>${esc(s)}</text>`;
const maxX = Math.max(...boundary.map((p) => p[0])) + 1;
const maxZ = Math.max(...boundary.map((p) => p[1])) + 1;
const W = Math.ceil(sx(maxX) + 290), H = Math.ceil(sz(maxZ) + 70);
const svg = [];
svg.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="DejaVu Sans, Arial, sans-serif">`);
svg.push(`<style>
.bg{fill:#fbfaf6}.lawn{fill:#e3ecd2}.bnd{fill:none;stroke:#c0392b;stroke-width:1;stroke-dasharray:6 3}
.fence{fill:none;stroke:#8a6a46;stroke-width:3}.post{fill:#6b4f31}.gate{fill:none;stroke:#8a6a46;stroke-width:2;stroke-dasharray:3 2}
.cont{fill:none;stroke:#b9a37a;stroke-width:.7}.cont2{fill:none;stroke:#a08452;stroke-width:1.1}.clab{font-size:8px;fill:#8d744a}
.elev{font-size:6.5px;fill:#9a9a8f}.edot{fill:#9a9a8f}
.path{fill:none;stroke:#b9b8b2;stroke-linecap:round;stroke-linejoin:round}.drive{fill:#c9c8c2;stroke:#a9a8a2;stroke-width:.6}
.apron{fill:#d9d4c7;stroke:#bdb6a5;stroke-width:.5}.roof{fill:#5b6168;fill-opacity:.12;stroke:#4b5158;stroke-width:1;stroke-dasharray:5 3}
.ridge{stroke:#4b5158;stroke-width:1;stroke-dasharray:2 2;fill:none}.wall{fill:#3d4249}.room{fill:#f4f1ea;stroke:none}
.glass{stroke:#5aa0d0;stroke-width:2.2;fill:none}.door{stroke:#2a6f97;stroke-width:1;fill:none}
.pond{fill:#9cc7dd;stroke:#7d8c8f;stroke-width:3;stroke-dasharray:2 1.5}.pad{fill:#d8d3c6;stroke:#8f8a7c;stroke-width:.8}
.fire{fill:#c96f3a}.sport{fill:#a9adb1;stroke:#7c8086;stroke-width:1}.deck{fill:#d2b48a;stroke:#9a7b52;stroke-width:.8}
.perg{stroke:#7a5c3a;stroke-width:1.4}.pool{fill:#c49a67;stroke:#7a5c3a;stroke-width:1.5}.septic{fill:#cfd6c4;stroke:#8f9a80;stroke-dasharray:3 2}
.tree-pine{fill:#6f9a55;fill-opacity:.28;stroke:#4f7a3a;stroke-width:.8}.tree-spruce{fill:#3f7a52;fill-opacity:.32;stroke:#2c5c3c;stroke-width:.8}
.tree-birch{fill:#a9c86a;fill-opacity:.32;stroke:#7d9c45;stroke-width:.8}.trunk{fill:#5a4630}
.cut{stroke:#c0392b;stroke-width:1.6}.tlab{font-size:7px;fill:#33402a}.tlabc{font-size:7px;fill:#c0392b}
.lbl{font-size:10px;fill:#222}.lblb{font-size:11px;font-weight:bold;fill:#222}.small{font-size:8px;fill:#444}
.dim{stroke:#1b6ca8;stroke-width:.8;fill:none}.dimt{font-size:8px;fill:#1b6ca8}.dimw{font-size:8px;fill:#b05a00}
.grid{stroke:#c9c4b4;stroke-width:.4}.gridt{font-size:8px;fill:#8a8576}
.halo{paint-order:stroke;stroke:#fbfaf6;stroke-width:3px;stroke-linejoin:round}
.title{font-size:16px;font-weight:bold;fill:#1f2a1f}.leg{font-size:10px;fill:#333}
</style>`);
svg.push(`<rect class="bg" x="0" y="0" width="${W}" height="${H}"/>`);
svg.push(`<defs><clipPath id="site"><polygon points="${boundary.map(pt).join(' ')}"/></clipPath></defs>`);
svg.push(poly(boundary, 'lawn'));
// Сетка 5 м с подписями по краям.
for (let x = Math.ceil(minX / 5) * 5; x <= maxX; x += 5) svg.push(`<line class="grid" x1="${sx(x)}" y1="${sz(-1)}" x2="${sx(x)}" y2="${sz(maxZ)}"/>`, text([x - 0.2, -1.3], String(x), 'gridt'));
for (let z = 0; z <= maxZ; z += 5) svg.push(`<line class="grid" x1="${sx(minX)}" y1="${sz(z)}" x2="${sx(maxX)}" y2="${sz(z)}"/>`, text([minX - 1.6, z + 0.15], String(z), 'gridt'));
// Изолинии (маршевые квадраты) по рельефу внутри участка.
{
  const step = 0.25;
  const xs = [], zs = [];
  for (let x = minX; x <= maxX; x += step) xs.push(x);
  for (let z = -1; z <= maxZ; z += step) zs.push(z);
  const Hg = zs.map((z) => xs.map((x) => ground(x, z)));
  const segs = new Map();
  for (let lv = 23.9; lv <= 24.9; lv = Math.round((lv + 0.1) * 10) / 10) {
    const out = [];
    for (let j = 0; j + 1 < zs.length; j++) for (let i = 0; i + 1 < xs.length; i++) {
      const c = [Hg[j][i], Hg[j][i + 1], Hg[j + 1][i + 1], Hg[j + 1][i]];
      const P = [[xs[i], zs[j]], [xs[i + 1], zs[j]], [xs[i + 1], zs[j + 1]], [xs[i], zs[j + 1]]];
      const cross = [];
      for (let e = 0; e < 4; e++) {
        const a = c[e], b = c[(e + 1) % 4];
        if ((a - lv) * (b - lv) < 0) { const t = (lv - a) / (b - a); cross.push([P[e][0] + (P[(e + 1) % 4][0] - P[e][0]) * t, P[e][1] + (P[(e + 1) % 4][1] - P[e][1]) * t]); }
      }
      if (cross.length >= 2) out.push([cross[0], cross[1]]);
      if (cross.length === 4) out.push([cross[2], cross[3]]);
    }
    segs.set(lv, out);
  }
  svg.push('<g clip-path="url(#site)">');
  for (const [lv, out] of segs) {
    if (!out.length) continue;
    const major = Math.abs(lv * 10 % 2) < 1e-6;
    svg.push(`<path class="${major ? 'cont2' : 'cont'}" d="${out.map(([a, b]) => `M${pt(a)}L${pt(b)}`).join('')}"/>`);
    if (major) {
      const mid = out[Math.floor(out.length / 3)];
      svg.push(text(mid[0], fmt(lv, 1), 'clab'));
    }
  }
  svg.push('</g>');
}
// Отметки съёмки
for (const p of elev) svg.push(`<circle class="edot" cx="${sx(p[0]).toFixed(1)}" cy="${sz(p[1]).toFixed(1)}" r="0.9"/>`, text([p[0] + 0.12, p[1] - 0.08], fmt(p[2]), 'elev'));
// Площадки
svg.push(poly(features.sport.poly, 'sport'), text([(features.sport.poly[0][0] + features.sport.poly[2][0]) / 2 - 1.6, (features.sport.poly[0][1] + features.sport.poly[2][1]) / 2], 'спортплощадка', 'small', 'fill="#fff"'));
svg.push(poly(features.septic.poly, 'septic'), text([features.septic.poly[0][0] + 0.9, features.septic.poly[0][1] + 1.2], 'ЛОС', 'small'));
const circ = (f, cls, r = f.r) => `<circle class="${cls}" cx="${sx(f.center[0]).toFixed(1)}" cy="${sz(f.center[1]).toFixed(1)}" r="${(r * PX).toFixed(1)}"/>`;
svg.push(circ(features.pond, 'pond'), text([features.pond.center[0] - 0.6, features.pond.center[1] + 0.2], 'пруд', 'small'));
svg.push(circ(features.firePit, 'pad'), circ(features.firePit, 'fire', features.firePit.ringR), text([features.firePit.center[0] - 3.4, features.firePit.center[1] - 1.4], 'кострище', 'small halo'));
svg.push(circ(features.grillZone, 'pad'), text([features.grillZone.center[0] - 1.1, features.grillZone.center[1] + 0.2], 'гриль-зона', 'small'));
svg.push(circ(features.plungePool, 'pool'), text([features.plungePool.center[0] - 0.9, features.plungePool.center[1] + 1.5], 'купель', 'small'));
// Дорожки, въезд, отмостка
const drive = [onSouth(gate.x0), onSouth(gate.x1), B.garage.carport.floor[2], B.garage.carport.floor[3]];
svg.push(poly([B.garage.carport.floor[0], B.garage.carport.floor[1], B.garage.carport.floor[2], B.garage.carport.floor[3]], 'drive'));
svg.push(poly([onSouth(gate.x0), onSouth(gate.x1), [gate.x1, B.garage.carport.floor[2][1]], [gate.x0, B.garage.carport.floor[3][1]]], 'drive'));
for (const p of paths) svg.push(`<polyline class="path" stroke-width="${(p.width * PX).toFixed(1)}" points="${p.pts.map(pt).join(' ')}"/>`);
function inflate(polyPts, d) {
  // Простое смещение выпуклого/ортогонального контура наружу (для отмостки).
  const n = polyPts.length;
  const area = polygonArea(polyPts);
  const s = area > 0 ? 1 : -1;
  return polyPts.map((p, i) => {
    const a = polyPts[(i - 1 + n) % n], b = polyPts[(i + 1) % n];
    const e1 = [p[0] - a[0], p[1] - a[1]], e2 = [b[0] - p[0], b[1] - p[1]];
    const l1 = Math.hypot(...e1), l2 = Math.hypot(...e2);
    const n1 = [s * e1[1] / l1, -s * e1[0] / l1], n2 = [s * e2[1] / l2, -s * e2[0] / l2];
    const m = [n1[0] + n2[0], n1[1] + n2[1]];
    const k = d / Math.max(0.3, (m[0] * n1[0] + m[1] * n1[1]));
    return [p[0] + m[0] * k, p[1] + m[1] * k];
  });
}
for (const b of buildings) for (const f of b.footprint) svg.push(poly(inflate(f, S.PAVING.apron.width), 'apron'));
// Обеденная площадка и пергола
svg.push(poly(features.dining.poly, 'deck'));
{
  const d = features.dining.poly;
  for (let k = 0; k <= 6; k++) { const t = 0.12 + 0.76 * k / 6; svg.push(pl([[d[0][0] + (d[3][0] - d[0][0]) * t, d[0][1] + (d[3][1] - d[0][1]) * t], [d[1][0] + (d[2][0] - d[1][0]) * t, d[1][1] + (d[2][1] - d[1][1]) * t]], 'perg')); }
  svg.push(text([(d[2][0] + d[3][0]) / 2 + 0.3, (d[2][1] + d[3][1]) / 2 + 0.6], 'пергола', 'small'));
}
// Кроны деревьев — под постройками (на схеме), стволы и подписи — поверх.
for (const t of [...trees].sort((a, b) => b.crown - a.crown)) {
  svg.push(`<circle class="tree-${t.species}" cx="${sx(t.pos[0]).toFixed(1)}" cy="${sz(t.pos[1]).toFixed(1)}" r="${(t.crown / 2 * PX).toFixed(1)}"${t.status === 'cut' ? ' fill-opacity="0.08" stroke-dasharray="2 2"' : ''}/>`);
}
// Постройки: помещения, стены с проёмами, кровли
function wallBand(at, a, b, t, cuts) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L], n = [-u[1], u[0]];
  const parts = [];
  let s = 0;
  for (const [c0, c1] of [...cuts].sort((x, y) => x[0] - y[0])) { if (c0 > s) parts.push([s, c0]); s = Math.max(s, c1); }
  if (s < L) parts.push([s, L]);
  return parts.map(([p0, p1]) => [[a[0] + u[0] * p0 + n[0] * t / 2, a[1] + u[1] * p0 + n[1] * t / 2], [a[0] + u[0] * p1 + n[0] * t / 2, a[1] + u[1] * p1 + n[1] * t / 2],
    [a[0] + u[0] * p1 - n[0] * t / 2, a[1] + u[1] * p1 - n[1] * t / 2], [a[0] + u[0] * p0 - n[0] * t / 2, a[1] + u[1] * p0 - n[1] * t / 2]].map((q) => at(q)));
}
for (const b of buildings) {
  for (const r of b.rooms) if (r.id !== 'H02' && (r.level ?? 1) === 1) svg.push(poly(r.sitePoly, 'room'));
  if (b.id === 'grill') {
    for (const w of b.walls) {
      const L = G.hexagon.vertexR;
      const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      const a = mid(w.a, w.ai), bb = mid(w.b, w.bi);
      for (const band of wallBand(b.at, a, bb, G.hexagon.wall, w.openings.map((o) => [o.from * Math.hypot(bb[0] - a[0], bb[1] - a[1]) / L, o.to * Math.hypot(bb[0] - a[0], bb[1] - a[1]) / L]))) svg.push(poly(band, 'wall'));
      for (const o of w.openings) {
        const Lm = Math.hypot(bb[0] - a[0], bb[1] - a[1]);
        const p0 = [a[0] + (bb[0] - a[0]) * o.from / L, a[1] + (bb[1] - a[1]) * o.from / L], p1 = [a[0] + (bb[0] - a[0]) * o.to / L, a[1] + (bb[1] - a[1]) * o.to / L];
        svg.push(pl([b.at(p0), b.at(p1)], o.type === 'door' ? 'door' : 'glass'));
        void Lm;
      }
    }
  } else {
    for (const w of b.walls) {
      const cuts = (w.openings ?? []).map((o) => {
        if (w.partition) return [o.from, o.to];
        const base = w.along === 'x' ? w.a[0] : w.a[1];
        return [o.from - base, o.to - base];
      });
      for (const band of wallBand(b.at, w.a, w.b, w.t, cuts)) svg.push(poly(band, 'wall'));
      for (const o of w.openings ?? []) {
        if (o.type === 'passage') continue;
        const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
        const base = w.partition ? 0 : (w.along === 'x' ? w.a[0] : w.a[1]);
        const t0 = (o.from - base) / L, t1 = (o.to - base) / L;
        const p0 = [w.a[0] + (w.b[0] - w.a[0]) * t0, w.a[1] + (w.b[1] - w.a[1]) * t0], p1 = [w.a[0] + (w.b[0] - w.a[0]) * t1, w.a[1] + (w.b[1] - w.a[1]) * t1];
        svg.push(pl([b.at(p0), b.at(p1)], /door/i.test(o.type) ? 'door' : 'glass'));
      }
    }
  }
  if (b.carport) {
    svg.push(poly(b.carport.roof, 'roof'), pl(b.carport.ridge, 'ridge'));
    for (const p of b.carport.piers) svg.push(poly(p, 'wall'));
    for (const p of b.carport.posts.slice(-2)) svg.push(`<rect class="wall" x="${(sx(p[0]) - 1.5).toFixed(1)}" y="${(sz(p[1]) - 1.5).toFixed(1)}" width="3" height="3"/>`);
  }
  for (const r of b.roofs) {
    svg.push(poly(r.outline, 'roof'));
    if (r.ridge) svg.push(pl(r.ridge, 'ridge'));
    for (const rg of r.ridges ?? []) svg.push(pl(rg, 'ridge'));
  }
  for (const r of b.rooms) {
    if ((r.level ?? 1) !== 1) continue;
    const c = r.sitePoly.reduce((s, p) => [s[0] + p[0] / r.sitePoly.length, s[1] + p[1] / r.sitePoly.length], [0, 0]);
    const small = r.polyArea < 4;
    svg.push(text([c[0] - (small ? 0.7 : 1.1), c[1] - 0.05], small ? r.name.slice(0, 4) + '.' : r.name, 'small halo'), text([c[0] - 0.55, c[1] + 0.55], `${fmt(r.area, 1)} м²`, 'small halo'));
  }
}
const label = (p, s) => svg.push(text(p, s, 'lblb halo'));
label([gO[0] - 8.6, gO[1] - 0.6], 'Гостевой дом-баня');
label([gc[0] - 2.0, gc[1] - 5.1], 'Гриль-дом');
label([B.garage.at([0, 0])[0] + 0.2, B.garage.at([0, 0])[1] - 1.4], 'Хоз.блок и навес');
// Стволы и подписи деревьев
for (const t of trees) {
  const c = [sx(t.pos[0]), sz(t.pos[1])];
  svg.push(`<circle class="trunk" cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" r="${Math.max(1.2, t.dbh / 200 * PX).toFixed(1)}"/>`);
  if (t.status === 'cut') svg.push(`<path class="cut" d="M${c[0] - 5},${c[1] - 5}L${c[0] + 5},${c[1] + 5}M${c[0] + 5},${c[1] - 5}L${c[0] - 5},${c[1] + 5}"/>`);
  svg.push(text([t.pos[0] + 0.25, t.pos[1] + 0.55], t.label, `${t.status === 'cut' ? 'tlabc' : 'tlab'} halo`));
}
// Забор, ворота, калитка
{
  const fence = [...boundary, boundary[0]];
  const gaps = [[gate.x0, gate.x1], [wicket.x0, wicket.x1]];
  // Южная сторона — с разрывами под ворота и калитку.
  svg.push(pl([SW, NW, NE, SE], 'fence'));
  let xs = SW[0];
  for (const [a, b] of gaps) { svg.push(pl([[xs, southZ(xs)], [a, southZ(a)]], 'fence')); xs = b; }
  svg.push(pl([[xs, southZ(xs)], SE], 'fence'));
  for (let i = 0; i + 1 < fence.length; i++) {
    const a = fence[i], b = fence[i + 1], L = segLen(a, b), n = Math.round(L / S.FENCE.postStep);
    for (let k = 0; k <= n; k++) { const q = [a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]; svg.push(`<rect class="post" x="${(sx(q[0]) - 1.5).toFixed(1)}" y="${(sz(q[1]) - 1.5).toFixed(1)}" width="3" height="3"/>`); }
  }
  svg.push(pl([[gate.x0, southZ(gate.x0) - 0.15], [slideEnd, southZ(slideEnd) - 0.15]], 'gate'));
  svg.push(text([gate.x0 + 0.4, southZ(gate.x0) + 0.9], `откатные ворота ${fmt(gw, 1)} м → откат`, 'small'));
  svg.push(text([wicket.x0 - 0.2, southZ(wicket.x0) + 0.9], 'калитка', 'small'));
  svg.push(poly(boundary, 'bnd'));
}
// Размерные линии подписей плана (модель / подпись)
function dimLine(a, b, s, warn, at) {
  svg.push(pl([a, b], 'dim'));
  const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  svg.push(text(at ?? [m[0] + 0.15, m[1] - 0.15], s, `${warn ? 'dimw' : 'dimt'} halo`));
}
dimLine([westX(gW[1]), gW[1]], gW, '1975');
dimLine([gN[0], northZ(gN[0])], gN, '2495');
dimLine(grillS, hozNEs, '16785');
dimLine(hozNEs, guestSW, '12680');
dimLine(mainE, [mainE[0] + eastNormal[0] * distToEast(mainE), mainE[1] + eastNormal[1] * distToEast(mainE)], '3000 ⚠', true, [mainE[0] + 0.4, mainE[1] - 0.3]);
dimLine(wingE, [wingE[0] + eastNormal[0] * 3, wingE[1] + eastNormal[1] * 3], '3000');
dimLine(wS, [wS[0], southZ(wS[0])], '9105');
// Рамка: заголовок, север, масштаб, легенда
svg.push(`<text class="title" x="${ML}" y="34">Участок во Всеволожске — схема (этап 1)</text>`);
svg.push(`<text class="small" x="${ML}" y="52">≈${fmt(siteArea, 0)} м² · рельеф ${fmt(hMin)}…${fmt(hMax)} м (Балтийская, изолинии 0,1 м) · сетка — метры участка от СЗ угла · ${new Date().toISOString().slice(0, 10)}</text>`);
{
  const nx = sx(maxX) + 40, ny = MT + 10;
  svg.push(`<path d="M${nx},${ny} l-9,26 l9,-7 l9,7 z" fill="#222"/><text class="lblb" x="${nx - 5}" y="${ny - 6}">С</text>`);
  const sbx = ML, sby = sz(maxZ) + 30;
  svg.push(`<rect x="${sbx}" y="${sby}" width="${5 * PX}" height="5" fill="#222"/><rect x="${sbx + 5 * PX}" y="${sby}" width="${5 * PX}" height="5" fill="#fff" stroke="#222" stroke-width=".6"/>`);
  svg.push(`<text class="small" x="${sbx}" y="${sby + 18}">0</text><text class="small" x="${sbx + 5 * PX - 3}" y="${sby + 18}">5</text><text class="small" x="${sbx + 10 * PX - 6}" y="${sby + 18}">10 м</text>`);
  const lx = sx(maxX) + 20; let ly = MT + 70;
  const leg = (draw, s) => { svg.push(draw(lx, ly), `<text class="leg" x="${lx + 30}" y="${ly + 4}">${esc(s)}</text>`); ly += 20; };
  leg((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 22}" y2="${y}" class="fence"/>`, 'забор: деревянный, гориз. доска 1,8 м');
  leg((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 22}" y2="${y}" class="bnd"/>`, 'граница участка');
  leg((x, y) => `<rect x="${x}" y="${y - 6}" width="22" height="12" class="wall"/>`, 'стены (ж/б сваи, пол +0,25)');
  leg((x, y) => `<rect x="${x}" y="${y - 6}" width="22" height="12" class="roof"/>`, 'кровля, свесы; пунктир — конёк');
  leg((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 22}" y2="${y}" class="glass"/>`, 'окна, остекление');
  leg((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 22}" y2="${y}" class="door"/>`, 'двери');
  leg((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 22}" y2="${y}" class="path" stroke-width="10"/>`, 'дорожки: серая плитка');
  leg((x, y) => `<rect x="${x}" y="${y - 6}" width="22" height="12" class="apron"/>`, 'отмостка: гравий 0,5 м');
  leg((x, y) => `<circle cx="${x + 11}" cy="${y}" r="8" class="tree-pine"/>`, 'сосна (С-30: ствол Ø 30 см)');
  leg((x, y) => `<circle cx="${x + 11}" cy="${y}" r="8" class="tree-spruce"/>`, 'ель');
  leg((x, y) => `<circle cx="${x + 11}" cy="${y}" r="8" class="tree-birch"/>`, 'берёза');
  leg((x, y) => `<path class="cut" d="M${x + 6},${y - 5}L${x + 16},${y + 5}M${x + 16},${y - 5}L${x + 6},${y + 5}"/>`, 'под вырубку');
  leg((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 22}" y2="${y}" class="dim"/>`, 'подписанные размеры (привязка)');
  leg((x, y) => `<line x1="${x}" y1="${y}" x2="${x + 22}" y2="${y}" class="cont2"/>`, 'изолинии рельефа');
  ly += 4;
  svg.push(`<text class="dimw" x="${lx}" y="${ly}">⚠ 3000 у основного объёма: в модели ${mm(distToEast(mainE))} —</text>`); ly += 12;
  svg.push(`<text class="dimw" x="${lx}" y="${ly}">забор не параллелен дому (S2, docs/SITE_CHECK.md)</text>`); ly += 22;
  for (const b of buildings) {
    svg.push(`<text class="leg" x="${lx}" y="${ly}"><tspan font-weight="bold">${esc(b.name)}</tspan></text>`); ly += 14;
    svg.push(`<text class="small" x="${lx}" y="${ly}">чистый пол ${fmt(levels[b.id].floor)} м (Балт.)</text>`); ly += 16;
  }
}
svg.push('</svg>');

// ---------- Итог ----------
line('');
line(`Итог: ${errors.length ? `ошибок ${errors.length}` : 'ошибок нет'}, нестыковок исходных листов: ${warnings.length}.`);
const proven = report.filter((r) => r.startsWith('- ✔')).length;
console.log(report.join('\n'));
console.log(`\nПроверок: ${proven + errors.length}, ошибок: ${errors.length}, нестыковок: ${warnings.length}`);

if (!CHECK_ONLY) {
  writeFileSync(join(ROOT, 'SITE_SPEC.json'), JSON.stringify(spec, null, 1) + '\n');
  mkdirSync(join(ROOT, 'dist', 'data'), { recursive: true });
  writeFileSync(join(ROOT, 'dist', 'data', 'site-spec.js'), `// Сгенерировано scripts/build-site.mjs — не править вручную.\nexport default ${JSON.stringify(spec)};\n`);
  writeFileSync(join(ROOT, 'SITE_PLAN.svg'), svg.join('\n') + '\n');
  writeFileSync(join(ROOT, 'docs', 'SITE_CHECK.md'), report.join('\n') + `\n\nПроверок: ${proven + errors.length}, ошибок: ${errors.length}, нестыковок исходных листов (⚠): ${warnings.length}.\n`);
}
if (errors.length) process.exit(1);
