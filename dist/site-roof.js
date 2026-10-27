// Кровли построек участка: плоскости скатов с металлочерепицей (настоящая волна 183 мм и ряды 350 мм
// со ступенью — геометрия, как в базе), белые лобовые и ветровые доски, подшивка свесов, графитовый
// конёк и торцевые планки, полукруглые белые желоба с трубами, трубчатые снегозадержатели, мансардные
// окна, стальные трубы дымоходов. Двускатная кровля прямоугольного объёма и трёхфронтонная кровля
// шестигранного гриль-дома строятся из одних плоскостей.
import * as THREE from 'three';
import PROFILES from './data/profiles.js';
import { profileAt, clipPolygon } from './mesh-builder.js';
import { box } from './site-arch.js';

const WAVE = PROFILES.profiles.tileWave.points;
const WAVE_W = PROFILES.profiles.tileWave.period;
const ROW = PROFILES.profiles.tileRow.points;
const ROW_W = PROFILES.profiles.tileRow.period;
const DEG = Math.PI / 180;

const add = (o, ...terms) => terms.reduce((p, [v, k]) => [p[0] + v[0] * k, p[1] + v[1] * k, p[2] + v[2] * k], o);
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Плоскость ската: O — точка верха покрытия на коньке/вершине, A — горизонталь вдоль карниза, D — вниз по
// скату; poly — выпуклый контур в (a, s); edges[i] — тип ребра poly[i]→poly[i+1]:
// 'eave' | 'rake' | 'ridge' | 'wall'; sEave — s карниза (отсчёт рядов черепицы).
export function makePlane(O, A, D, poly, edges, sEave) {
  const N = norm(cross(D, A));
  const up = N[1] >= 0 ? N : N.map((v) => -v);
  return { O, A, D, N: up, poly, edges, sEave, P: (a, s, h = 0) => add(O, [A, a], [D, s], [up, h]) };
}

// Металлочерепица на плоскости: сетка по волне и рядам, обрезка выпуклым контуром.
function tileSurface(G, pl, quality) {
  const mb = G.get('roof');
  const aStep = WAVE_W / (quality === 'low' ? 2 : 4);
  const xs = pl.poly.map((p) => p[0]);
  const ss = pl.poly.map((p) => p[1]);
  const a0 = Math.min(...xs), a1 = Math.max(...xs);
  const s0 = Math.min(...ss), s1 = Math.max(...ss);
  const aRef = a0;
  // Ряды отсчитываются от карниза вверх: t — расстояние от карниза по скату.
  const hOf = (a, s) => {
    const tFromEave = pl.sEave - s;
    const t = ((tFromEave % ROW_W) + ROW_W) % ROW_W;
    const step = profileAt(ROW, ROW_W, ROW_W - t);
    const fade = Math.min(1, (ROW_W - t) / 0.05) * 0.85 + 0.15;
    return profileAt(WAVE, WAVE_W, a - aRef) * fade + step + 0.004;
  };
  const sBreaks = [];
  const sub = quality === 'low' ? [0, 0.012, 0.2] : [0, 0.012, 0.06, 0.18, 0.3];
  for (let r = Math.floor((pl.sEave - s1) / ROW_W) - 1; r <= Math.ceil((pl.sEave - s0) / ROW_W) + 1; r++) {
    for (const t of sub) {
      const s = pl.sEave - (r * ROW_W + t);
      if (s > s0 && s < s1) sBreaks.push(s);
    }
  }
  const sList = [s0, ...[...new Set(sBreaks.map((v) => Math.round(v * 1e5) / 1e5))].sort((p, q) => p - q), s1];
  const aList = [];
  for (let a = a0; a < a1 - 1e-6; a += aStep) aList.push(a);
  aList.push(a1);
  const vert = (a, s) => {
    const e = 0.004;
    const h = hOf(a, s);
    const dha = (hOf(a + e, s) - hOf(a - e, s)) / (2 * e);
    const dhs = (hOf(a, s + e) - hOf(a, s - e)) / (2 * e);
    const n = norm(add(pl.N, [pl.A, -dha], [pl.D, -dhs]));
    return mb.vertex(pl.P(a, s, h), n, [a / 0.5, s / 0.5], 1);
  };
  const halfPlanes = pl.poly.map((p, i) => {
    const q = pl.poly[(i + 1) % pl.poly.length];
    const cx = xs.reduce((m, v) => m + v, 0) / xs.length;
    const cy = ss.reduce((m, v) => m + v, 0) / ss.length;
    let nx = -(q[1] - p[1]), ny = q[0] - p[0];
    if ((cx - p[0]) * nx + (cy - p[1]) * ny > 0) { nx = -nx; ny = -ny; }
    return (pt) => (pt[0] - p[0]) * nx + (pt[1] - p[1]) * ny; // > 0 — снаружи
  });
  const flipFor = (i0, i1, i2) => {
    const p = (k) => [mb.pos[k * 3], mb.pos[k * 3 + 1], mb.pos[k * 3 + 2]];
    const a = p(i0), b = p(i1), c = p(i2);
    const cr = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    return cr[0] * pl.N[0] + cr[1] * pl.N[1] + cr[2] * pl.N[2] < 0;
  };
  for (let j = 0; j + 1 < sList.length; j++) {
    for (let i = 0; i + 1 < aList.length; i++) {
      let cell = [[aList[i], sList[j]], [aList[i + 1], sList[j]], [aList[i + 1], sList[j + 1]], [aList[i], sList[j + 1]]];
      const full = cell.every((p) => halfPlanes.every((f) => f(p) <= 1e-9));
      if (!full) {
        for (const f of halfPlanes) { cell = clipPolygon(cell, f); if (cell.length < 3) break; }
        if (cell.length < 3) continue;
      }
      const ids = cell.map(([a, s]) => vert(a, s));
      for (let k = 1; k + 1 < ids.length; k++) {
        if (flipFor(ids[0], ids[k], ids[k + 1])) mb.idx.push(ids[0], ids[k + 1], ids[k]);
        else mb.idx.push(ids[0], ids[k], ids[k + 1]);
      }
    }
  }
}

// Плоский многоугольник плоскости ската со смещением h по нормали (подшивка снизу — normal вниз).
function planeFace(G, key, pl, h, down = false) {
  const mb = G.get(key);
  const n = down ? pl.N.map((v) => -v) : pl.N;
  const base = mb.vertexCount;
  for (const [a, s] of pl.poly) mb.vertex(pl.P(a, s, h), n, [a / 0.96, s / 0.96], 1);
  for (let k = 1; k + 1 < pl.poly.length; k++) {
    const p = (i) => pl.P(...pl.poly[i], h);
    const a = p(0), b = p(k), c = p(k + 1);
    const cr = cross([b[0] - a[0], b[1] - a[1], b[2] - a[2]], [c[0] - a[0], c[1] - a[1], c[2] - a[2]]);
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) mb.idx.push(base, base + k, base + k + 1);
    else mb.idx.push(base, base + k + 1, base + k);
  }
}

// Плоскость кровли целиком: покрытие, основа, подшивка, обрамление рёбер. thick — толщина основы по нормали.
export function roofPlane(G, pl, { thick = 0.28, quality = 'high', gutters = [], snow = true } = {}) {
  tileSurface(G, pl, quality);
  planeFace(G, 'soffit', pl, -thick, true);
  const n = pl.poly.length;
  for (let i = 0; i < n; i++) {
    const p = pl.poly[i], q = pl.poly[(i + 1) % n];
    const kind = pl.edges[i];
    const A3 = pl.P(p[0], p[1]), B3 = pl.P(q[0], q[1]);
    const dir = [B3[0] - A3[0], B3[1] - A3[1], B3[2] - A3[2]];
    const L = Math.hypot(...dir);
    if (L < 1e-3) continue;
    const mid = [(A3[0] + B3[0]) / 2, (A3[1] + B3[1]) / 2, (A3[2] + B3[2]) / 2];
    // Наружу от контура в плоскости ската.
    const c = pl.poly.reduce((m, v) => [m[0] + v[0] / n, m[1] + v[1] / n], [0, 0]);
    const e2 = [q[0] - p[0], q[1] - p[1]];
    let m2 = [-e2[1], e2[0]];
    if ((c[0] - p[0]) * m2[0] + (c[1] - p[1]) * m2[1] > 0) m2 = [-m2[0], -m2[1]];
    const ml = Math.hypot(...m2);
    const out3 = norm(add([0, 0, 0], [pl.A, m2[0] / ml], [pl.D, m2[1] / ml]));
    if (kind === 'eave') {
      // Лобовая доска 200 мм (белая, слот fascia — материал наличников) под краем основы и капельник черепицы.
      const under = add(mid, [pl.N, -thick]);
      box(G, 'fascia', add(under, [[0, -1, 0], 0.09], [out3, 0.012]), [L, 0.2, 0.025], dir, { up: [0, 1, 0] });
      box(G, 'roof', add(mid, [pl.N, -0.01], [out3, 0.03]), [L, 0.05, 0.008], dir, { up: [0, 1, 0] });
      if (snow) {
        // Снегозадержатель: две трубки Ø 25 мм на кронштейнах в 0,4 м от карниза.
        const sMid = (p[1] + q[1]) / 2 - 0.45;
        const aA = Math.min(p[0], q[0]) + 0.15, aB = Math.max(p[0], q[0]) - 0.15;
        if (aB - aA > 0.6) {
          for (const dz of [0.06, 0.14]) {
            const c1 = pl.P(aA, sMid, dz), c2 = pl.P(aB, sMid, dz);
            const dd = [c2[0] - c1[0], c2[1] - c1[1], c2[2] - c1[2]];
            const tube = new THREE.CylinderGeometry(0.0125, 0.0125, Math.hypot(...dd), 8, 1, true);
            G.extra.push({ key: 'black', geo: orient(tube, c1, c2) });
          }
          for (let a = aA + 0.1; a <= aB - 0.05; a += 1.0) box(G, 'black', pl.P(a, sMid, 0.09), [0.02, 0.17, 0.05], pl.N, { up: pl.D });
        }
      }
      if (gutters.includes(i)) gutterRun(G, add(A3, [pl.N, -thick * 0.5], [out3, 0.08], [[0, 1, 0], -0.07]), add(B3, [pl.N, -thick * 0.5], [out3, 0.08], [[0, 1, 0], -0.07]));
    } else if (kind === 'rake') {
      // Ветровая доска (белая) по торцу основы и торцевая планка (графит) по краю покрытия.
      box(G, 'fascia', add(mid, [pl.N, -thick / 2 - 0.02], [out3, 0.012]), [L, thick + 0.18, 0.025], dir, { up: out3 });
      box(G, 'roof', add(mid, [pl.N, 0.03], [out3, -0.04]), [L, 0.07, 0.12], dir, { up: pl.N });
    } else if (kind === 'wall') {
      box(G, 'roof', add(mid, [pl.N, 0.04], [out3, -0.06]), [L, 0.02, 0.14], dir, { up: pl.N });
    }
  }
}

// Цилиндр между двумя точками.
export function orient(geo, a, b) {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  geo.applyQuaternion(q);
  geo.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return geo;
}

// Полутрубка вдоль a → b: верхняя (конёк) или нижняя (желоб) половина окружности радиуса r.
function halfTube(G, key, a, b, r, upper, seg = 10) {
  const mb = G.get(key);
  const d = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  let w = cross(d, [0, 1, 0]);
  if (Math.hypot(...w) < 1e-6) w = [1, 0, 0];
  w = norm(w);
  const up = norm(cross(w, d));
  const base = mb.vertexCount;
  for (let k = 0; k <= seg; k++) {
    const th = (upper ? 0 : Math.PI) + (Math.PI * k) / seg;
    const n = add([0, 0, 0], [w, Math.cos(th)], [up, Math.sin(th)]);
    for (const p of [a, b]) mb.vertex(add(p, [n, r]), n, [k / seg, p === a ? 0 : 1], 1);
  }
  for (let k = 0; k < seg; k++) {
    const i = base + k * 2;
    const p0 = [mb.pos[i * 3], mb.pos[i * 3 + 1], mb.pos[i * 3 + 2]];
    const p1 = [mb.pos[(i + 1) * 3], mb.pos[(i + 1) * 3 + 1], mb.pos[(i + 1) * 3 + 2]];
    const p2 = [mb.pos[(i + 2) * 3], mb.pos[(i + 2) * 3 + 1], mb.pos[(i + 2) * 3 + 2]];
    const nn = [mb.nrm[i * 3], mb.nrm[i * 3 + 1], mb.nrm[i * 3 + 2]];
    const cr = cross([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]);
    if (cr[0] * nn[0] + cr[1] * nn[1] + cr[2] * nn[2] >= 0) mb.idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    else mb.idx.push(i, i + 2, i + 1, i + 1, i + 2, i + 3);
  }
}

// Конёк: полукруглый графитовый колпак по линии a → b (верх покрытия).
export function ridgeCap(G, a, b, r = 0.11) {
  halfTube(G, 'roof', [a[0], a[1] - 0.03, a[2]], [b[0], b[1] - 0.03, b[2]], r, true);
}

// Желоб Ø 125 мм (полукруг, белый, двусторонний материал) с бортиком; концы — для водосточных труб.
export function gutterRun(G, a, b) {
  halfTube(G, 'gutter', a, b, 0.0625, false);
  const d = norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  let w = norm(cross(d, [0, 1, 0]));
  for (const sgn of [-1, 1]) {
    const lip = new THREE.CylinderGeometry(0.008, 0.008, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]), 6);
    G.extra.push({ key: 'gutter', geo: orient(lip, add(a, [w, sgn * 0.0625]), add(b, [w, sgn * 0.0625])) });
  }
  G.gutterEnds = (G.gutterEnds || []).concat([[a, b]]);
}

// Водосточная труба Ø 90 мм: от воронки у желоба с отводом к стене, вниз до земли, колено с отмётом.
export function downpipe(G, top, wallPt, yBottom, out) {
  const r = 0.045;
  const p1 = [top[0], top[1] - 0.12, top[2]];
  const p2 = [wallPt[0], top[1] - 0.45, wallPt[2]];
  const p3 = [wallPt[0], yBottom + 0.25, wallPt[2]];
  const p4 = [wallPt[0] + out[0] * 0.28, yBottom + 0.08, wallPt[2] + out[1] * 0.28];
  for (const [a, b] of [[top, p1], [p1, p2], [p2, p3], [p3, p4]]) {
    G.extra.push({ key: 'gutter', geo: orient(new THREE.CylinderGeometry(r, r, Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) + 0.02, 12), a, b) });
  }
  G.extra.push({ key: 'gutter', geo: orient(new THREE.CylinderGeometry(0.075, 0.05, 0.12, 12), [top[0], top[1] + 0.02, top[2]], [top[0], top[1] - 0.1, top[2]]) });
  for (let y = p3[1]; y < p2[1] - 0.3; y += 1.0) G.extra.push({ key: 'gutter', geo: orient(new THREE.CylinderGeometry(r + 0.008, r + 0.008, 0.03, 12), [p3[0], y, p3[2]], [p3[0], y + 0.03, p3[2]]) });
}

// Стальная труба дымохода с зонтом и фартуком на скате.
export function chimney(G, x, z, yRoof, yTop, d = 0.2) {
  G.extra.push({ key: 'steel', geo: orient(new THREE.CylinderGeometry(d / 2, d / 2, yTop - yRoof + 0.3, 20), [x, yRoof - 0.3, z], [x, yTop, z]) });
  G.extra.push({ key: 'steel', geo: orient(new THREE.ConeGeometry(d * 1.2, d * 0.6, 20), [x, yTop + 0.1, z], [x, yTop + 0.1 + d * 0.6, z]) });
  G.extra.push({ key: 'steel', geo: orient(new THREE.CylinderGeometry(d * 0.06, d * 0.06, 0.12, 6), [x, yTop, z], [x, yTop + 0.12, z]) });
  G.extra.push({ key: 'roof', geo: orient(new THREE.CylinderGeometry(d * 1.0, d * 1.6, 0.25, 20), [x, yRoof - 0.05, z], [x, yRoof + 0.2, z]) });
}

// Мансардное окно на плоскости ската: графитовая рама и тёмное стекло над покрытием.
export function skylight(G, pl, a, s, w, h) {
  const fr = 0.07;
  for (const [ca, cs, la, ls] of [[a, s - h / 2, w, fr], [a, s + h / 2, w, fr], [a - w / 2, s, fr, h], [a + w / 2, s, fr, h]]) {
    box(G, 'roof', pl.P(ca, cs, 0.09), [la, 0.1, ls], pl.A, { up: pl.N });
  }
  const mb = G.get('darkGlass');
  const base = mb.vertexCount;
  const pts = [[a - w / 2, s - h / 2], [a + w / 2, s - h / 2], [a + w / 2, s + h / 2], [a - w / 2, s + h / 2]];
  for (const [pa, ps] of pts) mb.vertex(pl.P(pa, ps, 0.12), pl.N, [pa, ps], 1);
  const p0 = pl.P(...pts[0]), p1 = pl.P(...pts[1]), p2 = pl.P(...pts[2]);
  const cr = cross([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]], [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]]);
  if (cr[0] * pl.N[0] + cr[1] * pl.N[1] + cr[2] * pl.N[2] >= 0) mb.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  else mb.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

// Двускатная кровля прямоугольного объёма. rect — [x0, z0, x1, z1] в м (локальные), ridgeAxis — 'x' | 'z'.
// ridgeTop — верх покрытия у конька; over — вынос карниза; barge — вынос фронтона; abut: [start, end] —
// торец примыкает к стене (без выноса и ветровой доски). Возвращает плоскости и высоту низа основы у стены.
export function gableRoof(G, { rect, ridgeAxis, ridgeTop, pitch, over, barge = over, abut = [false, false], thick = 0.28, quality, snow = true, gutters = true, eaveOver = null }) {
  const [x0, z0, x1, z1] = rect;
  const tan = Math.tan(pitch * DEG);
  const cos = Math.cos(pitch * DEG);
  const along = ridgeAxis === 'x' ? [x0, x1] : [z0, z1];
  const across = ridgeAxis === 'x' ? [z0, z1] : [x0, x1];
  const half = (across[1] - across[0]) / 2;
  const mid = (across[0] + across[1]) / 2;
  const ov = eaveOver ?? [over, over];
  const a0 = along[0] - (abut[0] ? 0 : barge);
  const a1 = along[1] + (abut[1] ? 0 : barge);
  const planes = [];
  for (const side of [-1, 1]) {
    const reach = half + ov[side < 0 ? 0 : 1];
    const sMax = reach / cos;
    const A = ridgeAxis === 'x' ? [1, 0, 0] : [0, 0, 1];
    const dH = ridgeAxis === 'x' ? [0, 0, side] : [side, 0, 0];
    const D = norm([dH[0] * cos, -Math.sin(pitch * DEG), dH[2] * cos]);
    const O = ridgeAxis === 'x' ? [0, ridgeTop, mid] : [mid, ridgeTop, 0];
    const poly = [[a0, 0], [a1, 0], [a1, sMax], [a0, sMax]];
    const edges = ['ridge', abut[1] ? 'wall' : 'rake', 'eave', abut[0] ? 'wall' : 'rake'];
    const pl = makePlane(O, A, D, poly, edges, sMax);
    roofPlane(G, pl, { thick, quality, gutters: gutters ? [2] : [], snow });
    planes.push(pl);
  }
  const r0 = ridgeAxis === 'x' ? [a0, ridgeTop, mid] : [mid, ridgeTop, a0];
  const r1 = ridgeAxis === 'x' ? [a1, ridgeTop, mid] : [mid, ridgeTop, a1];
  ridgeCap(G, r0, r1);
  // Низ основы на линии наружной грани стены (под карнизом) и над серединой.
  const underAt = (dist) => ridgeTop - dist * tan - thick / cos;
  return { planes, tan, underAt, mid, half, ridgeAxis, a0, a1 };
}

// Потолок под скатом (интерьер): контур помещения в плане (выпуклый, локальные XZ) отсекается проекцией
// ската; поверхность — на gap ниже низа основы кровли, обшивка ламелями вниз по скату.
export function ceilingUnder(G, key, pl, polyXZ, thick, { gap = 0.03, tile = 0.84 } = {}) {
  const proj = pl.poly.map(([a, s]) => { const p = pl.P(a, s, 0); return [p[0], p[2]]; });
  const cx = proj.reduce((m, p) => m + p[0], 0) / proj.length, cz = proj.reduce((m, p) => m + p[1], 0) / proj.length;
  let poly = polyXZ.map((p) => [...p]);
  for (let i = 0; i < proj.length && poly.length >= 3; i++) {
    const a = proj[i], b = proj[(i + 1) % proj.length];
    let ex = -(b[1] - a[1]), ez = b[0] - a[0];
    if (Math.hypot(ex, ez) < 1e-9) continue;
    if ((cx - a[0]) * ex + (cz - a[1]) * ez < 0) { ex = -ex; ez = -ez; }
    const f = (p) => (p[0] - a[0]) * ex + (p[1] - a[1]) * ez;
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const p = poly[k], q = poly[(k + 1) % poly.length];
      const fp = f(p), fq = f(q);
      if (fp >= -1e-9) out.push(p);
      if ((fp >= -1e-9) !== (fq >= -1e-9)) { const t = fp / (fp - fq); out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]); }
    }
    poly = out;
  }
  if (poly.length < 3) return;
  const N = pl.N;
  const yAt = (x, z) => pl.O[1] - (N[0] * (x - pl.O[0]) + N[2] * (z - pl.O[2])) / N[1] - (thick + gap) / N[1];
  const mb = G.get(key);
  const base = mb.vertexCount;
  const down = N.map((v) => -v);
  for (const [x, z] of poly) {
    const y = yAt(x, z);
    const d = [x - pl.O[0], y - pl.O[1], z - pl.O[2]];
    const a = d[0] * pl.A[0] + d[1] * pl.A[1] + d[2] * pl.A[2];
    const s = d[0] * pl.D[0] + d[1] * pl.D[1] + d[2] * pl.D[2];
    mb.vertex([x, y, z], down, [a / tile, s / tile], 1);
  }
  for (let k = 1; k + 1 < poly.length; k++) {
    const p0 = poly[0], p1 = poly[k], p2 = poly[k + 1];
    const cr = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    // Нормаль вниз: при взгляде снизу обход по часовой в XZ (y вверх) — проверяем знак.
    if (cr > 0) mb.idx.push(base, base + k, base + k + 1);
    else mb.idx.push(base, base + k + 1, base + k);
  }
}
