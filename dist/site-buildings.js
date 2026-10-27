// Постройки участка снаружи по данным листов (dist/data/site-spec.js): гостевой дом-баня (основной объём
// с мансардой, переход, баня), гриль-дом (шестигранник с тремя фронтонами и обеденной площадкой под
// перголой), хоз.блок с навесом для двух машин. Все на ж/б сваях: чистый пол на 0,25 м выше
// спланированной земли, цоколь — штукатурка. Отделка — по фотореалистичным рендерам владельца.
// Каждая постройка — группа в локальных метрах листа (x — вправо по листу, z — вниз), повёрнутая и
// поставленная на участок; y = 0 — чистый пол.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GroupBuilder } from './mesh-builder.js';
import { SRC, BUILDING, SITE, floorY, placer } from './site-data.js';
import { siteMaterials, wallGeometry, opening, rectHole, plinth, cornerBoards, box, planar, interiorDoor, interiorLight, TILE } from './site-arch.js';
import { gableRoof, makePlane, roofPlane, ridgeCap, chimney, skylight, downpipe, ceilingUnder } from './site-roof.js';
import { pointInPolygon, distToSegment } from './geometry.js';

const DEG = Math.PI / 180;
const mm = (v) => v / 1000;

// Построитель постройки: геометрия по ключам материалов, отдельные створки дверей на петлях, стены для
// прогулки, высоты разреза режима «Внутри».
function builder(cutHeights = [2.1]) {
  const G = new GroupBuilder();
  G.extra = [];
  G.openings = [];
  G.leaves = [];
  G.walls = [];
  G.cutHeights = cutHeights;
  G.newLeaf = (info) => {
    const B = new GroupBuilder();
    G.leaves.push({ ...info, builder: B });
    return B;
  };
  return G;
}

// Стена для прогулки: наружная грань a→b (локальные XZ), нормаль n, толщина t, проходы gaps [[s0, s1]].
function wallRecord(G, w, n, t, gaps, level = 0) {
  const a = w.P(0, 0, 0), b = w.P(w.L, 0, 0);
  G.walls.push({ a: [a[0], a[2]], b: [b[0], b[2]], n, t, gaps, level });
}

// Проём с записью положения (центр по низу, полуширина, низ) — для посадок у фасадов и прогулки.
function openingAt(G, w, n, t, h, opts) {
  if (h.poly) {
    const ss = h.poly.map((p) => p[0]);
    const s0 = Math.min(...ss), s1 = Math.max(...ss);
    G.openings.push({ c: w.P((s0 + s1) / 2, 0, 0), n, half: (s1 - s0) / 2, low: Math.min(...h.poly.map((p) => p[1])), kind: h.kind });
  } else G.openings.push({ c: w.P((h.s0 + h.s1) / 2, 0, 0), n, half: (h.s1 - h.s0) / 2, low: h.y0, kind: h.kind, door: h.door, id: h.id });
  opening(G, w, n, t, h, opts);
  return h.kind === 'door' ? [h.s0, h.s1] : h.door ? [...h.door] : null;
}

// Меши по ключам материалов; тени — у всего, кроме стекла.
function emit(G, mats, name) {
  const group = new THREE.Group();
  group.name = name;
  for (const [key, mb] of G.entries()) {
    const cut = key.startsWith('cut');
    const mesh = new THREE.Mesh(mb.build(), cut ? mats.section : mats[key] ?? mats.trim);
    mesh.name = `${name}:${key}`;
    mesh.castShadow = key !== 'glass' && !cut;
    mesh.receiveShadow = true;
    mesh.userData.slot = key;
    if (cut) { mesh.visible = false; mesh.userData.cut = Number(key.slice(3)); }
    group.add(mesh);
  }
  // Створки дверей: группа-петля, геометрия относительно оси; знак угла — открывание внутрь (−n).
  group.userData.doors = [];
  for (const L of G.leaves) {
    const pivot = new THREE.Group();
    pivot.position.set(...L.hinge);
    for (const [key, mb] of L.builder.entries()) {
      const geo = mb.build();
      geo.translate(-L.hinge[0], -L.hinge[1], -L.hinge[2]);
      const m = new THREE.Mesh(geo, mats[key] ?? mats.trim);
      m.castShadow = key !== 'glass' && key !== 'saunaGlass';
      m.receiveShadow = true;
      m.userData.slot = key;
      pivot.add(m);
    }
    const v = L.fromEnd ? [-L.u[0], -L.u[1]] : L.u;
    const sign = Math.sign(-v[1] * L.n[0] + v[0] * L.n[1]) || 1;
    const mid = [L.hinge[0] + v[0] * L.width / 2, L.hinge[2] + v[1] * L.width / 2];
    pivot.name = `door:${L.id ?? group.userData.doors.length}`;
    pivot.userData.door = { id: L.id, sign, angle: 0, max: 1.6, mid, width: L.width };
    group.add(pivot);
    group.userData.doors.push(pivot);
  }
  const byKey = new Map();
  for (const { key, geo } of G.extra) {
    if (!geo.attributes.color) geo.setAttribute('color', new THREE.Float32BufferAttribute(new Array(geo.attributes.position.count * 3).fill(1), 3));
    if (geo.index === null) geo.setIndex([...Array(geo.attributes.position.count).keys()]);
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(geo);
  }
  for (const [key, list] of byKey) {
    const mesh = new THREE.Mesh(mergeGeometries(list), mats[key] ?? mats.trim);
    mesh.name = `${name}:${key}+`;
    mesh.userData.slot = key;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// Водосточные трубы у концов желобов: к ближайшей точке контура постройки, вниз до планировки.
function pipesFor(G, outline, yBottom, every = 1) {
  const ends = (G.gutterEnds || []);
  ends.forEach(([a, b], i) => {
    if (i % every) return;
    const top = b;
    let best = null;
    for (let k = 0; k < outline.length; k++) {
      const p = outline[k], q = outline[(k + 1) % outline.length];
      const r = distToSegment(top[0], top[2], p[0], p[1], q[0], q[1]);
      if (!best || r.d < best.d) best = { ...r, p, q };
    }
    let n = [best.q[1] - best.p[1], -(best.q[0] - best.p[0])];
    const l = Math.hypot(...n);
    n = [n[0] / l, n[1] / l];
    if (pointInPolygon(best.cx + n[0] * 0.05, best.cz + n[1] * 0.05, outline)) n = [-n[0], -n[1]];
    const wall = [best.cx + n[0] * 0.08, 0, best.cz + n[1] * 0.08];
    downpipe(G, [top[0], top[1] - 0.04, top[2]], wall, yBottom, n);
    void a;
  });
}

// Фриз: белая доска 220 мм по верху карнизной стены под подшивкой свеса (как на рендерах).
function frieze(G, a, b, n, y, h = 0.22) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  box(G, 'trim', [(a[0] + b[0]) / 2 + n[0] * 0.012, y - h / 2, (a[1] + b[1]) / 2 + n[1] * 0.012], [L + 0.05, h, 0.024], [u[0], 0, u[1]]);
}

// Ограждение из массива: стойки через ≤ 0,12 м и поручень на 0,95 м над линией y0→y1 (марш или пол).
function railing(G, a, b, y0, y1, { h = 0.95 } = {}) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n = Math.max(1, Math.round(L / 0.12));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, y = y0 + (y1 - y0) * t;
    const post = i === 0 || i === n;
    box(G, 'stair', [x, y + h / 2, z], [h, post ? 0.06 : 0.032, post ? 0.06 : 0.032], [0, 1, 0], { up: [u[0], 0, u[1]] });
  }
  const dy = y1 - y0;
  const dir = [b[0] - a[0], dy, b[1] - a[1]];
  box(G, 'stair', [(a[0] + b[0]) / 2, (y0 + y1) / 2 + h + 0.02, (a[1] + b[1]) / 2], [Math.hypot(L, dy) + 0.06, 0.045, 0.07], dir);
}

// Ступени: блок из бетонных ступеней перед дверью (ширина w по направлению u, наружу n).
function steps(G, center, u, n, w, rise = 0.25, run = 0.32) {
  const k = Math.max(1, Math.round(rise / 0.13));
  const h = rise / k;
  for (let i = 0; i < k; i++) {
    const depth = run * (k - i) + 0.05;
    const c = [center[0] + n[0] * depth / 2, -h * (i + 0.5), center[1] + n[1] * depth / 2];
    box(G, 'concrete', c, [w, h, depth], [u[0], 0, u[1]], { uvScale: 1 });
  }
}

// ---------- Гостевой дом-баня ----------
function buildGuest(mats, quality) {
  const S = SRC.guest;
  const G = builder([2.1, mm(S.heights.main.floor2) + 1.3]);
  const T = mm(S.outerWall);
  const vol = Object.fromEntries(S.volumes.map((v) => [v.id, v.rect.map(mm)]));
  const H = S.heights;
  const thick = 0.3;
  const cosM = Math.cos(H.main.pitch * DEG), cosW = Math.cos(H.wing.pitch * DEG), cosL = Math.cos(H.link.pitch * DEG);
  const tanM = Math.tan(H.main.pitch * DEG), tanW = Math.tan(H.wing.pitch * DEG), tanL = Math.tan(H.link.pitch * DEG);
  const [mx0, mz0, mx1, mz1] = vol.main;
  const [wx0, wz0, wx1, wz1] = vol.wing;
  const [lx0, lz0, lx1, lz1] = vol.link;
  const mainRidge = mm(H.main.ridgeTop);
  const wingRidge = mm(H.wing.ridgeTop);
  const linkHalf = (lz1 - lz0) / 2;
  const linkRidge = mm(H.link.wall) + 0.05 + linkHalf * tanL + thick / cosL;
  const mainU = (dist) => mainRidge - dist * tanM - thick / cosM; // низ основы на расстоянии от конька
  const wingU = (dist) => wingRidge - dist * tanW - thick / cosW;
  const linkU = (dist) => linkRidge - dist * tanL - thick / cosL;
  const mHalf = (mx1 - mx0) / 2, wHalf = (wz1 - wz0) / 2;
  const mEave = mainU(mHalf), wEave = wingU(wHalf), lEave = linkU(linkHalf);
  const op = (vid, wall) => S.openings.filter((o) => o.volume === vid && o.wall === wall);
  const pas = (vid, wall) => S.passages.filter((o) => o.volume === vid && o.wall === wall);
  const W = {};
  const holeOf = (o, s0off, gableTop) => {
    if (o.high === 'gable') {
      const a = mm(o.from) - s0off, b = mm(o.to) - s0off;
      const pts = [[a, mm(o.low)], [b, mm(o.low)]];
      const top = (s) => gableTop(s) - 0.32;
      const c = (mHalf);
      pts.push([b, top(b)]);
      if (c > a && c < b) pts.push([c, top(c)]);
      pts.push([a, top(a)]);
      return { poly: pts, kind: 'glazing', id: o.id };
    }
    return { s0: mm(o.from) - s0off, s1: mm(o.to) - s0off, y0: mm(o.low), y1: mm(o.high), kind: o.type === 'glazing' ? 'glazing' : o.type, leaves: o.leaves, door: o.door ? o.door.map((v) => mm(v) - s0off) : null, transom: o.transomAt ? mm(o.transomAt) : null, id: o.id };
  };
  const addWall = (id, a, b, n, top, ops, s0off, passages = [], opts = {}) => {
    const items = ops.map((o) => ({ o, h: holeOf(o, s0off, opts.gableTop) }));
    const holes = items.map(({ h }) => h.poly ?? rectHole(h.s0, h.s1, h.y0, h.y1));
    for (const p of passages) holes.push(rectHole(mm(p.from) - s0off, mm(p.to) - s0off, 0, 2.1));
    // Верх наружной стены — на 0,2 м выше низа кровли на наружной грани: внутри стена доходит до
    // потолка по скату (без щели), снаружи излишек скрыт в толще кровли.
    const w = wallGeometry(G, { a, b, n, t: T, top: top.map(([sv, y]) => [sv, y + 0.2]), holes, ends: opts.ends ?? [false, false] });
    W[id] = w;
    const gaps = [];
    for (const { h } of items) { const g = openingAt(G, w, n, T, h); if (g) gaps.push(g); }
    for (const p of passages) gaps.push([mm(p.from) - s0off, mm(p.to) - s0off]);
    wallRecord(G, w, n, T, gaps);
    return w;
  };
  // Основной объём: фронтоны на востоке (z0) и западе (z1), карнизы — север (x0), юг (x1). Стены во всю
  // длину объёма закрывают торцами внешние углы (у штукатурки нет угловых досок).
  const full = { ends: [true, true] };
  const mGable = (s) => mainU(Math.abs(s - mHalf));
  const mTop = [[0, mEave], [mHalf, mainU(0)], [mx1 - mx0, mEave]];
  addWall('main-y0', [mx0, mz0], [mx1, mz0], [0, -1], mTop, op('main', 'y0'), 0, [], { gableTop: mGable, ...full });
  addWall('main-y1', [mx1, mz1], [mx0, mz1], [0, 1], mTop.map(([s, y]) => [s, y]), op('main', 'y1').map((o) => ({ ...o, from: mx1 * 1000 - o.to, to: mx1 * 1000 - o.from, door: o.door ? [mx1 * 1000 - o.door[1], mx1 * 1000 - o.door[0]] : null })), 0, [], { gableTop: mGable, ...full });
  addWall('main-x0', [mx0, mz1 - T], [mx0, mz0 + T], [-1, 0], [[0, mEave], [mz1 - mz0 - 2 * T, mEave]], op('main', 'x0').map((o) => ({ ...o, from: (mz1 - T) * 1000 - o.to, to: (mz1 - T) * 1000 - o.from })), 0);
  addWall('main-x1', [mx1, mz0 + T], [mx1, mz1 - T], [1, 0], [[0, mEave], [mz1 - mz0 - 2 * T, mEave]], op('main', 'x1'), T, pas('main', 'x1'));
  // Переход: стены на востоке (z0, к дворику) и западе (z1, вход).
  addWall('link-y0', [lx1, lz0], [lx0, lz0], [0, -1], [[0, lEave], [lx1 - lx0, lEave]], op('link', 'y0').map((o) => ({ ...o, from: lx1 * 1000 - o.to, to: lx1 * 1000 - o.from })), 0);
  addWall('link-y1', [lx0, lz1], [lx1, lz1], [0, 1], [[0, lEave], [lx1 - lx0, lEave]], op('link', 'y1'), lx0);
  // Баня: фронтоны на севере (x0) и юге (x1), карнизы — восток (z0), запад (z1).
  const wTop = [[0, wEave], [wHalf, wingU(0)], [wz1 - wz0, wEave]];
  addWall('wing-x0', [wx0, wz1], [wx0, wz0], [-1, 0], wTop, [], 0, pas('wing', 'x0').map((p) => ({ ...p, from: wz1 * 1000 - p.to, to: wz1 * 1000 - p.from })), full);
  addWall('wing-x1', [wx1, wz0], [wx1, wz1], [1, 0], wTop, op('wing', 'x1'), 0, [], full);
  addWall('wing-y0', [wx1 - T, wz0], [wx0 + T, wz0], [0, -1], [[0, wEave], [wx1 - wx0 - 2 * T, wEave]], op('wing', 'y0').map((o) => ({ ...o, from: (wx1 - T) * 1000 - o.to, to: (wx1 - T) * 1000 - o.from })), 0);
  addWall('wing-y1', [wx0 + T, wz1], [wx1 - T, wz1], [0, 1], [[0, wEave], [wx1 - wx0 - 2 * T, wEave]], op('wing', 'y1'), wx0 + T);
  // Участки наружных стен основного объёма и бани, обращённые в холл перехода: поверх фасада (на 1 см
  // в холл) — обшивка имитацией бруса до потолка перехода, с проходами в кухню-гостиную и комнату отдыха.
  const lzc = (lz0 + lz1) / 2;
  const linkSkin = (wid, zOf, passages) => {
    const w = W[wid];
    const ss = [zOf(lz0 + T), zOf(lz1 - T)].sort((p, q) => p - q);
    const a = w.P(ss[0], 0, -0.012), b = w.P(ss[1], 0, -0.012);
    const n = [w.P(0, 0, -1)[0] - w.P(0, 0, 0)[0], w.P(0, 0, -1)[2] - w.P(0, 0, 0)[2]];
    const k = 12;
    const top = Array.from({ length: k + 1 }, (_, i) => {
      const sv = ((ss[1] - ss[0]) * i) / k;
      return [sv, linkU(Math.abs(zOf.inv(ss[0] + sv) - lzc)) - 0.01];
    });
    const holes = passages.map(([p0, p1]) => rectHole(p0 - ss[0], p1 - ss[0], 0, 2.1));
    wallGeometry(G, { a: [a[0], a[2]], b: [b[0], b[2]], n, t: 0.006, top, holes, ends: [false, false], keyOut: 'inner', keyIn: 'inner', keyReveal: 'inner' });
  };
  const zMain = Object.assign((z) => z - (mz0 + T), { inv: (s) => s + mz0 + T });
  linkSkin('main-x1', zMain, pas('main', 'x1').map((p) => [mm(p.from) - T, mm(p.to) - T]));
  const zWing = Object.assign((z) => wz1 - z, { inv: (s) => wz1 - s });
  linkSkin('wing-x0', zWing, pas('wing', 'x0').map((p) => [wz1 - mm(p.to), wz1 - mm(p.from)]));
  // Потолки по скатам: низ обшивки над точкой плана (для перегородок).
  const vaults = [
    { rect: [mx0, mz0, mx1, mz1], acrossX: true, U: mainU },
    { rect: [mx1, lz0, wx0, lz1], acrossX: false, U: linkU },
    { rect: [wx0, wz0, wx1, wz1], acrossX: false, U: wingU },
  ];
  const ceilY = (x, z) => {
    for (const v of vaults) {
      const [x0, z0, x1, z1] = v.rect;
      if (x < x0 - 1e-6 || x > x1 + 1e-6 || z < z0 - 1e-6 || z > z1 + 1e-6) continue;
      return v.U(v.acrossX ? Math.abs(x - (x0 + x1) / 2) : Math.abs(z - (z0 + z1) / 2)) - 0.03;
    }
    return 2.7;
  };
  // Перегородки — до потолка по скату, с межкомнатными дверями (сауна — стеклянная).
  for (const p of S.partitions) {
    const a = p.a.map(mm), b = p.b.map(mm);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    const n = [-u[1], u[0]];
    const t = mm(p.t);
    const top = [];
    const k = Math.ceil(L / 0.2);
    for (let i = 0; i <= k; i++) {
      const sv = (L * i) / k;
      top.push([sv, ceilY(a[0] + u[0] * sv, a[1] + u[1] * sv)]);
    }
    const ops = (p.openings ?? []).map((o) => ({ ...o, s0: mm(o.from), s1: mm(o.to) }));
    const holes = ops.map((o) => rectHole(o.s0, o.s1, 0, 2.1));
    const w = wallGeometry(G, { a: [a[0] + n[0] * t / 2, a[1] + n[1] * t / 2], b: [b[0] + n[0] * t / 2, b[1] + n[1] * t / 2], n, t, top, holes, keyOut: 'inner', keyIn: 'inner', keyReveal: 'inner' });
    for (const o of ops) interiorDoor(G, w, n, t, o.s0, o.s1, { glass: o.leaf === 'glass', id: o.id });
    wallRecord(G, w, n, t, ops.map((o) => [o.s0, o.s1]));
  }
  // Полы: ламинат; санузел, душевая и сауна — керамогранит.
  const lam = ([x, z]) => [x / TILE.laminate, z / TILE.laminate];
  for (const [x0, z0, x1, z1] of [vol.main, vol.link, vol.wing]) planar(G, 'floor', [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], (x, z) => [x, 0.002, z], [0, 1, 0], lam);
  for (const r of S.rooms) {
    if (!['G04', 'G05', 'G06'].includes(r.id)) continue;
    const [x0, z0, x1, z1] = r.rect.map(mm);
    planar(G, 'tile', [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], (x, z) => [x, 0.005, z], [0, 1, 0], ([x, z]) => [x / TILE.tile, z / TILE.tile]);
  }
  // Мансарда: перекрытие над кухней (низ — потолок 2,70, верх — пол +2,925) с проёмом Г-образной лестницы.
  const f2 = mm(H.main.floor2);
  const st = S.stairs.rect.map(mm);
  const NR = 16, rise = f2 / NR, run = (st[3] - st[1]) / 8;
  const zIn = mz0 + T, slabEdge = mm(4550);
  const xEnd = st[0] - 6 * run; // край перекрытия = верхняя (16-я) ступень
  const slab = [[mx0 + T, zIn], [xEnd, zIn], [xEnd, st[1]], [st[0], st[1]], [st[0], st[3]], [mx1 - T, st[3]], [mx1 - T, slabEdge], [mx0 + T, slabEdge]];
  planar(G, 'floor', slab, (x, z) => [x, f2, z], [0, 1, 0], lam);
  planar(G, 'inner', slab, (x, z) => [x, f2 - 0.22, z], [0, -1, 0], ([x, z]) => [x / TILE.lining, z / TILE.lining]);
  const slabEdges = [[[xEnd, zIn], [xEnd, st[1]]], [[xEnd, st[1]], [st[0], st[1]]], [[st[0], st[1]], [st[0], st[3]]], [[st[0], st[3]], [mx1 - T, st[3]]], [[mx1 - T, slabEdge], [mx0 + T, slabEdge]]];
  for (const [p0, p1] of slabEdges) {
    const l = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    let nn = [(p1[1] - p0[1]) / l, -(p1[0] - p0[0]) / l];
    if (pointInPolygon((p0[0] + p1[0]) / 2 + nn[0] * 0.05, (p0[1] + p1[1]) / 2 + nn[1] * 0.05, slab)) nn = [-nn[0], -nn[1]];
    G.get('inner').quad([p0[0], f2 - 0.22, p0[1]], [p1[0], f2 - 0.22, p1[1]], [p1[0], f2, p1[1]], [p0[0], f2, p0[1]], [nn[0], 0, nn[1]], [0, 0], [l / TILE.lining, 0], [l / TILE.lining, 0.26], [0, 0.26]);
  }
  G.surfaces = [{ poly: slab, y: f2, level: 1 }];
  // Лестница: марш 1 вдоль южной стены кухни (8 подъёмов, массив, закрытый снизу), угловая площадка,
  // марш 2 вдоль восточной стены вверх (7 подъёмов, открыт снизу, подшит обшивкой).
  const sx = (st[0] + st[2]) / 2, sw = st[2] - st[0];
  for (let i = 1; i <= 8; i++) {
    const zA = st[3] - i * run, zB = st[3] - (i - 1) * run, y = i * rise;
    box(G, 'stair', [sx, y - 0.025, (zA + zB) / 2 + 0.01], [sw, 0.05, zB - zA + 0.02], [1, 0, 0]);
    box(G, 'inner', [sx, (y - 0.05) / 2, (zA + zB) / 2], [sw - 0.01, y - 0.05, zB - zA], [1, 0, 0], { uvScale: 1 / TILE.lining });
    G.surfaces.push({ poly: [[st[0], zA], [st[2], zA], [st[2], zB], [st[0], zB]], y, solid: true });
  }
  {
    const y = 9 * rise;
    box(G, 'stair', [sx, y - 0.025, (zIn + st[1]) / 2], [sw, 0.05, st[1] - zIn], [1, 0, 0]);
    box(G, 'inner', [sx, (y - 0.05) / 2, (zIn + st[1]) / 2], [sw - 0.01, y - 0.05, st[1] - zIn - 0.01], [1, 0, 0], { uvScale: 1 / TILE.lining });
    G.surfaces.push({ poly: [[st[0], zIn], [st[2], zIn], [st[2], st[1]], [st[0], st[1]]], y, solid: true });
  }
  const zw = st[1] - zIn, zc = (zIn + st[1]) / 2;
  for (let j = 1; j <= 7; j++) {
    const xA = st[0] - j * run, xB = st[0] - (j - 1) * run, y = (9 + j) * rise;
    if (j < 7) box(G, 'stair', [(xA + xB) / 2 - 0.01, y - 0.025, zc], [xB - xA + 0.02, 0.05, zw], [1, 0, 0]);
    box(G, 'stair', [xB - 0.01, y - rise / 2, zc], [0.02, rise, zw], [1, 0, 0]);
    if (j < 7) G.surfaces.push({ poly: [[xA, zIn], [xB, zIn], [xB, st[1]], [xA, st[1]]], y });
  }
  // Подшивка и косоур марша 2.
  const ys0 = 9 * rise - 0.3, ys1 = f2 - 0.22;
  planar(G, 'inner', [[st[0], zIn], [xEnd, zIn], [xEnd, st[1]], [st[0], st[1]]], (x, z) => [x, ys0 + ((st[0] - x) / (st[0] - xEnd)) * (ys1 - ys0), z], [0, -1, 0], ([x, z]) => [x / TILE.lining, z / TILE.lining]);
  for (const zz of [st[1] + 0.001]) {
    planar(G, 'stair', [[st[0], ys0], [xEnd, ys1], [xEnd, f2 + 0.05], [st[0], 9 * rise + 0.05]], (x, y) => [x, y, zz], [0, 0, 1], ([x, y]) => [x / 0.9, y / 0.9]);
  }
  // Ограждения: марши, проём лестницы и край второго света на мансарде.
  G.rails = [];
  const rail = (p0, p1, y0, y1, level) => { railing(G, p0, p1, y0, y1); G.rails.push({ a: p0, b: p1, y0, y1, level }); };
  rail([st[0] + 0.03, st[3] - 0.15], [st[0] + 0.03, st[1]], rise, 8 * rise, 0);
  rail([st[0], st[1] - 0.03], [xEnd + 0.1, st[1] - 0.03], 9 * rise, 15 * rise, 0);
  rail([xEnd, st[1] + 0.03], [st[0] - 0.03, st[1] + 0.03], f2, f2, 1);
  rail([st[0] - 0.03, st[1] + 0.03], [st[0] - 0.03, st[3] + 0.03], f2, f2, 1);
  rail([st[0] - 0.03, st[3] + 0.03], [mx1 - T, st[3] + 0.03], f2, f2, 1);
  rail([mx0 + T, slabEdge - 0.03], [mx1 - T, slabEdge - 0.03], f2, f2, 1);
  // Цоколь по общему контуру.
  const outline = [[mx0, mz0], [mx1, mz0], [mx1, lz0], [lx1, lz0], [wx0, wz0], [wx1, wz0], [wx1, wz1], [wx0, wz1], [wx0, lz1], [lx0, lz1], [mx1, mz1], [mx0, mz1]];
  plinth(G, outline, -0.45);
  // Угловые доски на наружных углах.
  const cb = (c, d1, d2, y1) => cornerBoards(G, c, d1, d2, 0, y1);
  cb([mx0, mz0], [1, 0], [0, 1], mEave); cb([mx1, mz0], [-1, 0], [0, 1], mEave);
  cb([mx0, mz1], [1, 0], [0, -1], mEave); cb([mx1, mz1], [-1, 0], [0, -1], mEave);
  cb([wx0, wz0], [1, 0], [0, 1], wEave); cb([wx1, wz0], [-1, 0], [0, 1], wEave);
  cb([wx1, wz1], [-1, 0], [0, -1], wEave); cb([wx0, wz1], [1, 0], [0, -1], wEave);
  frieze(G, [mx0, mz0], [mx0, mz1], [-1, 0], mEave);
  frieze(G, [mx1, mz0], [mx1, mz1], [1, 0], mEave);
  frieze(G, [wx0, wz0], [wx1, wz0], [0, -1], wEave);
  frieze(G, [wx0, wz1], [wx1, wz1], [0, 1], wEave);
  frieze(G, [mx1, lz0], [wx0, lz0], [0, -1], lEave);
  frieze(G, [mx1, lz1], [wx0, lz1], [0, 1], lEave);
  // Кровли.
  const mainRoof = gableRoof(G, { rect: vol.main, ridgeAxis: 'z', ridgeTop: mainRidge, pitch: H.main.pitch, over: mm(H.main.overhang), thick, quality });
  const wingRoof = gableRoof(G, { rect: vol.wing, ridgeAxis: 'x', ridgeTop: wingRidge, pitch: H.wing.pitch, over: mm(H.wing.overhang), thick, quality });
  const linkRoof = gableRoof(G, { rect: vol.link, ridgeAxis: 'x', ridgeTop: linkRidge, pitch: H.link.pitch, over: 0.3, eaveOver: [0.3, mm(H.link.overhang)], abut: [true, true], thick, quality, snow: false });
  const rectXZ = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  for (const pl of mainRoof.planes) ceilingUnder(G, 'ceiling', pl, rectXZ(mx0 + T, mz0 + T, mx1 - T, mz1 - T), thick);
  for (const pl of linkRoof.planes) ceilingUnder(G, 'ceiling', pl, rectXZ(mx1, lz0 + T, wx0, lz1 - T), thick);
  for (const pl of wingRoof.planes) ceilingUnder(G, 'ceiling', pl, rectXZ(wx0 + T, wz0 + T, wx1 - T, wz1 - T), thick);
  // Мансардные окна на северном скате над спальней.
  const north = mainRoof.planes[0];
  for (const sk of S.roofs[0].skylights) skylight(G, north, mm(sk.at), 1.7, mm(sk.size[0]), mm(sk.size[1]));
  // Трубы.
  for (const c of S.chimneys) {
    const [x, z] = c.at.map(mm);
    const inMain = x < mx1;
    const yRoof = inMain ? mainRidge - Math.abs(x - (mx0 + mx1) / 2) * tanM : wingRidge - Math.abs(z - (wz0 + wz1) / 2) * tanW;
    chimney(G, x, z, yRoof, (inMain ? mainRidge : wingRidge) + 0.6, mm(c.d));
  }
  pipesFor(G, outline, -0.25, 1);
  // Ступени у дверей (пол +0,25 над планировкой).
  const door = (wid, o, n) => { const w = W[wid]; const sc = (o.s0 + o.s1) / 2; const p = w.P(sc, 0, 0); steps(G, [p[0], p[2]], w.u, n, o.s1 - o.s0 + 0.5); };
  const entry = S.openings.find((o) => o.id === 'GD2');
  door('link-y1', { s0: mm(entry.from) - lx0, s1: mm(entry.to) - lx0 }, [0, 1]);
  const live = S.openings.find((o) => o.id === 'GD1');
  door('main-x1', { s0: mm(live.from) - T, s1: mm(live.to) - T }, [1, 0]);
  const rest = S.openings.find((o) => o.id === 'GG3');
  door('wing-y1', { s0: mm(rest.door[0]) - wx0 - T, s1: mm(rest.door[1]) - wx0 - T }, [0, 1]);
  const ceilAt = (x, z, level = 0) => (level === 0 && pointInPolygon(x, z, slab) ? f2 - 0.22 : ceilY(x, z));
  return { G, outline, heights: { mainRidge, wingRidge, linkRidge, floor2: f2 }, levels: [0, f2], ceilAt };
}

// ---------- Гриль-дом ----------
const FACES = ['NE', 'E', 'SE', 'SW', 'W', 'NW'];
function buildGrill(mats, quality) {
  const S = SRC.grill;
  const G = builder([2.1]);
  const R = mm(S.hexagon.vertexR);
  const t = mm(S.hexagon.wall);
  const F = R * Math.cos(30 * DEG);
  const over = mm(S.roof.overhang);
  const pitch = S.roof.pitch;
  const tan = Math.tan(pitch * DEG), cos = Math.cos(pitch * DEG);
  const thick = 0.3;
  const wallTop = mm(S.wallTop);
  const Htop = wallTop + thick / cos + F * tan; // верх покрытия в вершине
  const under = (d) => Htop - d * tan - thick / cos;
  const vtx = (r, k) => [r * Math.cos((-90 + 60 * k) * DEG), r * Math.sin((-90 + 60 * k) * DEG)];
  const nrm = (k) => [Math.cos((-60 + 60 * k) * DEG), Math.sin((-60 + 60 * k) * DEG)];
  const gables = S.roof.gables;
  const eaveU = under(F);
  const ridgeAtWall = under(F * 0.5);
  for (let k = 0; k < 6; k++) {
    const a = vtx(R, k), b = vtx(R, k + 1);
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const gable = gables.includes(FACES[k]);
    const top = gable ? [[0, eaveU], [L / 2, ridgeAtWall], [L, eaveU]] : [[0, eaveU], [L, eaveU]];
    const ops = S.openings.filter((o) => o.face === FACES[k]);
    const n = nrm(k);
    if (!gable) frieze(G, a, b, n, eaveU);
    const w = wallGeometry(G, { a, b, n, t, top: top.map(([sv, y]) => [sv, y + 0.15]), holes: ops.map((o) => rectHole(mm(o.from), mm(o.to), mm(o.low), mm(o.high))), ends: [false, false] });
    const gaps = [];
    for (const o of ops) { const g = openingAt(G, w, n, t, { s0: mm(o.from), s1: mm(o.to), y0: mm(o.low), y1: mm(o.high), kind: o.type, leaves: o.leaves, id: o.id }); if (g) gaps.push(g); }
    w.L = L;
    wallRecord(G, w, n, t, gaps);
    // Угловая доска на каждом углу (тупой угол 120°): две доски по граням.
    const nPrev = nrm((k + 5) % 6);
    cornerBoards(G, a, [(b[0] - a[0]) / L, (b[1] - a[1]) / L], [(vtx(R, k - 1)[0] - a[0]) / L, (vtx(R, k - 1)[1] - a[1]) / L], 0, eaveU, { w: 0.1 });
    void nPrev;
  }
  const outline = [0, 1, 2, 3, 4, 5].map((k) => vtx(R, k));
  const innerHex = [0, 1, 2, 3, 4, 5].map((k) => vtx(mm(S.hexagon.innerFace) / Math.cos(30 * DEG), k));
  planar(G, 'floor', innerHex, (x, z) => [x, 0.002, z], [0, 1, 0], ([x, z]) => [x / TILE.laminate, z / TILE.laminate]);
  plinth(G, outline, -0.45);
  // Кровля: три ската над гранями В, ЮЗ, СЗ; коньки — к серединам фронтонов З, СВ, ЮВ.
  const Fo = F + over;
  const Ro = Fo / Math.cos(30 * DEG);
  const planes = [];
  for (let k = 0; k < 6; k++) {
    if (gables.includes(FACES[k])) continue;
    const n = nrm(k);
    const A = [-n[1], 0, n[0]];
    const D = [n[0] * cos, -Math.sin(pitch * DEG), n[1] * cos];
    const toAS = ([x, z]) => [x * A[0] + z * A[2], (x * n[0] + z * n[1]) / cos];
    const mPrev = nrm(k - 1).map((v) => v * Fo), mNext = nrm(k + 1).map((v) => v * Fo);
    const poly = [[0, 0], toAS(mPrev), toAS(vtx(Ro, k)), toAS(vtx(Ro, k + 1)), toAS(mNext)];
    const pl = makePlane([0, Htop, 0], A, D, poly, ['ridge', 'rake', 'eave', 'rake', 'ridge'], Fo / cos);
    roofPlane(G, pl, { thick, quality, gutters: [2] });
    planes.push({ k, pl });
  }
  // Потолок по скатам (сводом до конька, как на разрезе) и центральная стойка 200 × 200.
  for (const { pl } of planes) ceilingUnder(G, 'ceiling', pl, innerHex, thick);
  const postTop = Htop - thick / cos - 0.03;
  box(G, 'stair', [0, postTop / 2, 0], [postTop, 0.2, 0.2], [0, 1, 0], { up: [1, 0, 0] });
  G.posts = [{ x: 0, z: 0, r: 0.16 }];
  for (const f of gables) {
    const k = FACES.indexOf(f);
    const m = nrm(k).map((v) => v * Fo);
    ridgeCap(G, [0, Htop, 0], [m[0], Htop - Fo * 0.5 * tan, m[1]]);
  }
  // Мансардные окна на СЗ скате, труба над очагом.
  const nw = planes.find((p) => FACES[p.k] === S.roof.skylights[0].face).pl;
  for (const a of [-0.65, 0.65]) skylight(G, nw, a, 2.0, mm(S.roof.skylights[0].size[0]), mm(S.roof.skylights[0].size[1]));
  const [cx, cz] = S.roof.chimney.at.map(mm);
  // Высота кровли над очагом: ближайшая плоскость — над гранью В.
  const yRoof = Math.min(...planes.map(({ k }) => Htop - (cx * nrm(k)[0] + cz * nrm(k)[1]) * tan));
  chimney(G, cx, cz, yRoof, Htop + 0.5, mm(S.roof.chimney.d));
  pipesFor(G, outline, -0.25, 2);
  // Ступени у двери ЮЗ; у ЮВ — обеденная площадка (настил на уровне −0,05).
  const sw = FACES.indexOf('SW');
  {
    const a = vtx(R, sw), b = vtx(R, sw + 1);
    const u = [(b[0] - a[0]) / R, (b[1] - a[1]) / R];
    steps(G, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], u, nrm(sw), 2.3);
  }
  const se = FACES.indexOf('SE');
  const n = nrm(se);
  const tdir = [-n[1], n[0]];
  const w2 = mm(S.dining.width) / 2, D = mm(S.dining.depth);
  const m0 = [n[0] * F, n[1] * F];
  const deck = [[m0[0] + tdir[0] * w2, m0[1] + tdir[1] * w2], [m0[0] - tdir[0] * w2, m0[1] - tdir[1] * w2], [m0[0] - tdir[0] * w2 + n[0] * D, m0[1] - tdir[1] * w2 + n[1] * D], [m0[0] + tdir[0] * w2 + n[0] * D, m0[1] + tdir[1] * w2 + n[1] * D]];
  // Настил из доски 140 мм поперёк площадки.
  for (let i = 0; i * 0.145 < D; i++) {
    const d = i * 0.145 + 0.07;
    if (d > D) break;
    const c = [m0[0] + n[0] * d, -0.06, m0[1] + n[1] * d];
    box(G, 'deck', c, [2 * w2, 0.035, 0.138], [tdir[0], 0, tdir[1]], { uvScale: 1 / 1.8 });
  }
  box(G, 'deck', [m0[0] + n[0] * D / 2 + tdir[0] * w2, -0.17, m0[1] + n[1] * D / 2 + tdir[1] * w2], [D, 0.2, 0.03], [n[0], 0, n[1]]);
  box(G, 'deck', [m0[0] + n[0] * D / 2 - tdir[0] * w2, -0.17, m0[1] + n[1] * D / 2 - tdir[1] * w2], [D, 0.2, 0.03], [n[0], 0, n[1]]);
  box(G, 'deck', [m0[0] + n[0] * D, -0.17, m0[1] + n[1] * D], [2 * w2, 0.2, 0.03], [tdir[0], 0, tdir[1]]);
  steps(G, [m0[0] + n[0] * D, m0[1] + n[1] * D], tdir, n, 1.6, 0.2);
  // Пергола: четыре стойки 120 мм, прогоны вдоль площадки, обрешётка поперёк.
  const pf = mm(S.dining.pergolaFrom) + 0.1;
  const postH = 2.45;
  for (const sd of [-1, 1]) for (const d of [pf, D - 0.12]) {
    const c = [m0[0] + n[0] * d + tdir[0] * sd * (w2 - 0.1), postH / 2 - 0.05, m0[1] + n[1] * d + tdir[1] * sd * (w2 - 0.1)];
    box(G, 'deck', c, [postH + 0.1, 0.12, 0.12], [0, 1, 0], { up: [n[0], 0, n[1]] });
  }
  for (const sd of [-1, 1]) box(G, 'deck', [m0[0] + n[0] * (pf + D) / 2 + tdir[0] * sd * (w2 - 0.1), postH + 0.08, m0[1] + n[1] * (pf + D) / 2 + tdir[1] * sd * (w2 - 0.1)], [D - pf + 0.5, 0.16, 0.06], [n[0], 0, n[1]]);
  for (let d = pf - 0.15; d <= D + 0.2; d += 0.4) box(G, 'deck', [m0[0] + n[0] * d, postH + 0.2, m0[1] + n[1] * d], [2 * w2 + 0.4, 0.12, 0.05], [tdir[0], 0, tdir[1]]);
  diningSet(G, [m0[0] + n[0] * (D * 0.55), m0[1] + n[1] * (D * 0.55)], n, tdir);
  const ceilAt = (x, z) => Math.min(...planes.map(({ k }) => Htop - (x * nrm(k)[0] + z * nrm(k)[1]) * tan)) - thick / cos - 0.03;
  return { G, outline, deck, heights: { top: Htop }, ceilAt };
}

// Обеденный стол на 8–10 мест (массив, 2,4 × 0,95 м) и две скамьи — вдоль площадки.
function diningSet(G, c, n, tdir) {
  const L = 2.4, Wd = 0.95, h = 0.75;
  box(G, 'deck', [c[0], h - 0.03 - 0.05, c[1]], [L, 0.05, Wd], [n[0], 0, n[1]]);
  for (const sl of [-1, 1]) for (const sw of [-1, 1]) box(G, 'deck', [c[0] + n[0] * sl * (L / 2 - 0.2) + tdir[0] * sw * (Wd / 2 - 0.12), (h - 0.05) / 2 - 0.05, c[1] + n[1] * sl * (L / 2 - 0.2) + tdir[1] * sw * (Wd / 2 - 0.12)], [h - 0.05, 0.08, 0.08], [0, 1, 0]);
  for (const sw of [-1, 1]) {
    const bc = [c[0] + tdir[0] * sw * (Wd / 2 + 0.38), c[1] + tdir[1] * sw * (Wd / 2 + 0.38)];
    box(G, 'deck', [bc[0], 0.42, bc[1]], [L, 0.045, 0.34], [n[0], 0, n[1]]);
    for (const sl of [-1, 1]) box(G, 'deck', [bc[0] + n[0] * sl * (L / 2 - 0.25), 0.2 - 0.05, bc[1] + n[1] * sl * (L / 2 - 0.25)], [0.04 + 0.4, 0.06, 0.3], [0, 1, 0], { up: [tdir[0], 0, tdir[1]] });
  }
}

// ---------- Хоз.блок и навес ----------
function buildGarage(mats, quality) {
  const S = SRC.garage;
  const G = builder([2.1]);
  const sh = S.shed;
  const [x0, z0, x1, z1] = sh.rect.map(mm);
  const T = mm(sh.wall);
  const tan = Math.tan(sh.pitch * DEG), cos = Math.cos(sh.pitch * DEG);
  const thick = 0.26;
  const half = (x1 - x0) / 2;
  const ridgeTop = mm(sh.wallTop) + thick / cos + half * tan;
  const under = (d) => ridgeTop - d * tan - thick / cos;
  const eave = under(half);
  const gTop = [[0, eave], [half, under(0)], [x1 - x0, eave]];
  const ops = (wall) => sh.openings.filter((o) => o.wall === wall);
  const mk = (o, off, flip = 0) => ({ s0: (flip ? flip - mm(o.to) : mm(o.from)) - off, s1: (flip ? flip - mm(o.from) : mm(o.to)) - off, y0: mm(o.low), y1: mm(o.high), kind: o.type === 'garageDoor' ? 'garage' : o.type, id: o.id });
  const wall = (a, b, n, top, list, ends = [false, false]) => {
    const hs = list;
    const w = wallGeometry(G, { a, b, n, t: T, top: top.map(([sv, y]) => [sv, y + 0.12]), holes: hs.map((h) => rectHole(h.s0, h.s1, h.y0, h.y1)), ends });
    const gaps = [];
    for (const h of hs) { const g = openingAt(G, w, n, T, h, { keystone: h.kind === 'garage' ? true : null }); if (g) gaps.push(g); }
    wallRecord(G, w, n, T, gaps);
    return w;
  };
  // Фронтоны во всю ширину закрывают торцами внешние углы.
  wall([x1, z0], [x0, z0], [0, -1], gTop, ops('y0').map((o) => mk(o, 0, x1)), [true, true]);
  const sWall = wall([x0, z1], [x1, z1], [0, 1], gTop, ops('y1').map((o) => mk(o, 0)), [true, true]);
  wall([x0, z1 - T], [x0, z0 + T], [-1, 0], [[0, eave], [z1 - z0 - 2 * T, eave]], ops('x0').map((o) => mk(o, 0, z1 - T)));
  wall([x1, z0 + T], [x1, z1 - T], [1, 0], [[0, eave], [z1 - z0 - 2 * T, eave]], ops('x1').map((o) => mk(o, T)));
  // Пол хоз.блока — керамогранит (под технику и инвентарь).
  planar(G, 'tile', [[x0, z0], [x1, z0], [x1, z1], [x0, z1]], (x, z) => [x, 0.002, z], [0, 1, 0], ([x, z]) => [x / TILE.tile, z / TILE.tile]);
  const outline = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  frieze(G, [x0, z0], [x0, z1], [-1, 0], eave);
  frieze(G, [x1, z0], [x1, z1], [1, 0], eave);
  plinth(G, outline, -0.45);
  for (const [c, d1, d2] of [[[x0, z0], [1, 0], [0, 1]], [[x1, z0], [-1, 0], [0, 1]], [[x1, z1], [-1, 0], [0, -1]], [[x0, z1], [1, 0], [0, -1]]]) cornerBoards(G, c, d1, d2, 0, eave);
  const shedRoof = gableRoof(G, { rect: [x0, z0, x1, z1], ridgeAxis: 'z', ridgeTop, pitch: sh.pitch, over: mm(sh.overhang), thick, quality });
  for (const pl of shedRoof.planes) ceilingUnder(G, 'ceiling', pl, [[x0 + T, z0 + T], [x1 - T, z0 + T], [x1 - T, z1 - T], [x0 + T, z1 - T]], thick);
  // Ступени у двери под навес и пандус у ворот.
  const door = sh.openings.find((o) => o.id === 'HD2');
  const dp = sWall.P((mm(door.from) + mm(door.to)) / 2, 0, 0);
  steps(G, [dp[0], dp[2]], [1, 0], [0, 1], mm(door.to - door.from) + 0.4);
  const gate = sh.openings.find((o) => o.id === 'HD1');
  {
    const gs0 = mm(gate.from), gs1 = mm(gate.to);
    const pts = [[gs0 - 0.2, z0], [gs1 + 0.2, z0], [gs1 + 0.2, z0 - 1.0], [gs0 - 0.2, z0 - 1.0]];
    const mb = G.get('concrete');
    const base = mb.vertexCount;
    const ys = [0, 0, -0.27, -0.27];
    pts.forEach(([x, z], i) => mb.vertex([x, ys[i], z], [0, 0.97, -0.24], [x / 0.8, z / 0.8], 1));
    mb.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  // Навес: опоры (пары стоек, обшитые как одна опора), обвязка, кровля, фронтоны.
  const cp = S.carport;
  const yPave = -0.25;
  const eaveTop = yPave + mm(cp.eave);
  const [cpx0, cpx1] = cp.piersX.map(mm);
  const axis = (cpx0 + cpx1) / 2;
  const span2 = (cpx1 - cpx0) / 2;
  const cTan = Math.tan(cp.roof.pitch * DEG), cCos = Math.cos(cp.roof.pitch * DEG);
  const cThick = 0.26;
  const cRidge = eaveTop + cThick / cCos + span2 * cTan;
  const pierW = 0.2, pierD = mm(cp.pierCladding[1]);
  // Над проёмами навеса — обшитый доской ригель до карниза (по рендеру), снизу белая планка.
  const hdr = 0.55;
  const yHdr = eaveTop - hdr;
  for (const x of [cpx0, cpx1]) {
    for (const y of cp.rowsY.map(mm)) {
      box(G, 'facade', [x, (yPave + yHdr) / 2, y], [yHdr - yPave, pierW, pierD], [0, 1, 0], { up: [1, 0, 0], uvScale: 1 / 0.96, uvSwap: true });
      box(G, 'plinth', [x, yPave + 0.15, y], [0.3, pierW + 0.03, pierD + 0.03], [0, 1, 0], { up: [1, 0, 0] });
    }
    const zA = mm(cp.rowsY[0]) - pierD / 2, zB = mm(cp.rowsY[3]) + pierD / 2;
    box(G, 'facade', [x, eaveTop - hdr / 2, (zA + zB) / 2], [zB - zA, hdr, pierW + 0.02], [0, 0, 1], { uvScale: 1 / 0.96 });
    box(G, 'trim', [x, yHdr + 0.02, (zA + zB) / 2], [zB - zA, 0.04, pierW + 0.06], [0, 0, 1]);
  }
  for (const x of cp.gablePostsX.map(mm)) {
    const z = mm(cp.rowsY[3]) + mm(cp.pairGap) / 2;
    box(G, 'facade', [x, (yPave + yHdr) / 2, z], [yHdr - yPave, 0.2, 0.2], [0, 1, 0], { uvScale: 1 / 0.96, uvSwap: true });
  }
  // Фронтоны навеса: обшивка вертикальной доской выше ригеля.
  const cHalf = span2 + pierW / 2;
  const cUnder = (d) => cRidge - d * cTan - cThick / cCos;
  for (const [z, n] of [[mm(cp.rowsY[3]) + pierD / 2 - 0.05, [0, 1]], [mm(cp.roof.y[0]) + 0.35, [0, -1]]]) {
    const a = n[1] > 0 ? [axis - cHalf, z] : [axis + cHalf, z];
    const b = n[1] > 0 ? [axis + cHalf, z] : [axis - cHalf, z];
    const L = 2 * cHalf;
    wallGeometry(G, { a, b, n, t: 0.08, top: [[0, cUnder(cHalf)], [cHalf, cUnder(0)], [L, cUnder(cHalf)]], y0: yHdr, holes: [], ends: [true, true] });
    box(G, 'trim', [axis, yHdr + 0.02, z - n[1] * 0.04], [L, 0.04, 0.16], [1, 0, 0]);
  }
  const cRect = [axis - span2 - 0.13, mm(cp.roof.y[0]), axis + span2 + 0.13, mm(cp.roof.y[1])];
  gableRoof(G, { rect: [axis - span2, cRect[1], axis + span2, cRect[3]], ridgeAxis: 'z', ridgeTop: cRidge, pitch: cp.roof.pitch, over: 0.15, barge: 0, thick: cThick, quality });
  pipesFor(G, outline, -0.25, 2);
  const ceilAt = (x) => under(Math.abs(x - (x0 + x1) / 2)) - 0.03;
  return { G, outline, heights: { ridgeTop, cRidge }, ceilAt };
}

// Данные для прогулки без материалов и мешей (стены с проёмами, поверхности, ограждения) — и для тестов.
export function walkData() {
  const out = {};
  for (const [id, fn] of [['guest', buildGuest], ['grill', buildGrill], ['garage', buildGarage]]) {
    const part = fn({}, 'low');
    out[id] = { walls: part.G.walls, surfaces: part.G.surfaces ?? [], rails: part.G.rails ?? [], posts: part.G.posts ?? [], levels: part.levels ?? [0] };
  }
  return out;
}

// Сцена построек: группы на участке (поворот и подъём на отметку пола).
export function buildSiteBuildings(lib, { quality = 'high' } = {}) {
  const mats = siteMaterials(lib);
  mats.deck = lib.deckWood('oak');
  mats.ceiling = mats.inner;
  mats.fascia = mats.trim;
  mats.casing = mats.inner;
  mats.stair = interiorLight(lib.furnitureWood('oak'));
  mats.doorWood = interiorLight(lib.furnitureWood('oak'));
  mats.saunaGlass = lib.glass('bronze');
  mats.gutter.side = THREE.DoubleSide;
  const root = new THREE.Group();
  root.name = 'buildings';
  const out = {};
  const parts = { guest: buildGuest(mats, quality), grill: buildGrill(mats, quality), garage: buildGarage(mats, quality) };
  for (const [id, part] of Object.entries(parts)) {
    const b = BUILDING[id];
    const g = emit(part.G, mats, id);
    const at = placer(b);
    g.position.set(b.origin[0], floorY(id), b.origin[1]);
    g.rotation.y = -at.theta;
    g.userData.building = id;
    root.add(g);
    const openings = part.G.openings.map((o) => {
      const [x, z] = at(o.c[0] * 1000, o.c[2] * 1000);
      const nn = [o.n[0] * at.dirU[0] + o.n[1] * at.dirV[0], o.n[0] * at.dirU[1] + o.n[1] * at.dirV[1]];
      return { x, z, n: nn, half: o.half, low: o.low, kind: o.kind, door: o.door, id: o.id };
    });
    out[id] = { group: g, outline: part.outline, heights: part.heights, openings, walls: part.G.walls, surfaces: part.G.surfaces ?? [], rails: part.G.rails ?? [], posts: part.G.posts ?? [], levels: part.levels ?? [0], doors: g.userData.doors, cutHeights: part.G.cutHeights, ceilAt: part.ceilAt };
  }
  root.userData.parts = out;
  root.userData.materials = mats;
  mats.board = mats.facade;
  mats.stucco = mats.plinth;
  // Вариант фасада: замена материалов стен и цоколя, угловые доски и капельник — только у доски.
  root.userData.setFacade = (kind) => {
    const plaster = kind === 'plaster';
    root.traverse((o) => {
      const slot = o.userData.slot;
      if (!o.isMesh || !slot) return;
      if (slot === 'facade') o.material = plaster ? mats.plaster : mats.board;
      else if (slot === 'plinth') o.material = plaster ? mats.brick : mats.stucco;
      else if (slot === 'corner' || slot === 'drip') o.visible = !plaster;
    });
    root.userData.facade = kind;
  };
  void SITE;
  return root;
}
