// Архитектурные элементы построек участка (по фотореалистичным рендерам владельца): стены с проёмами
// под вертикальной доской светло-серого тона, цоколь из штукатурки по свайному полю, белые угловые доски,
// наличники с замковым камнем, отливы, белые ПВХ-окна и остеклённые двери, секционные ворота.
// Координаты — локальные метры постройки (x, z — оси листа, y — от чистого пола); группы геометрии
// по ключам материалов собираются GroupBuilder'ом и превращаются в меши в site-buildings.js.
import * as THREE from 'three';
import MANIFEST from './data/texture-manifest.js';
import { srgbColor } from './materials.js';
import { pointInPolygon } from './geometry.js';

const gain = (name) => 1 / Math.pow(MANIFEST.maps[name]?.mean ?? 1, 2.2);
export const tinted = (hex, map) => srgbColor(hex).multiplyScalar(gain(map));

// Палитра отделки (по рендерам): тёплая светло-серая доска, белые детали, графитовая кровля, серый цоколь.
export const FINISH = {
  board: '#c9c5bd',
  trim: '#f1f0ea',
  roof: '#3a3d42',
  plinth: '#a3a19b',
  frame: '#f3f3ef',
  gutter: '#efefeb',
  door: '#efeee8',
  steel: '#9ea2a5',
  snow: '#1c1d1f',
};

// Материалы построек. UV задаются в метрах; масштаб тайла — в repeat не используется (UV = м / тайл).
export const TILE = { facade: 0.96, pavers: 0.8, stucco: 1.0, metal: 0.5, trim: 0.96 };

// Стекло окон: пропускание с заметным отражением окружения (на рендерах в стёклах — лес и небо).
function siteGlass(lib) {
  const low = lib.quality === 'low';
  return lib.make(`site|glass|${low ? 'low' : 'full'}`, () => {
    const m = low
      ? new THREE.MeshPhysicalMaterial({ color: srgbColor('#c9d3d1'), roughness: 0.03, transparent: true, opacity: 0.42, depthWrite: false, envMapIntensity: 1.6 })
      : new THREE.MeshPhysicalMaterial({ color: srgbColor('#dde5e2'), roughness: 0.02, transmission: 0.88, ior: 1.52, thickness: 0.008, specularIntensity: 1, envMapIntensity: 1.7 });
    m.userData.glass = true;
    return m;
  });
}

export function siteMaterials(lib) {
  const physical = (key, params, opts) => lib.make(`site|${key}`, () => new THREE.MeshPhysicalMaterial(params), opts);
  return {
    facade: physical('facade', {
      color: tinted(FINISH.board, 'facade_albedo'), map: lib.tex('facade_albedo', true), normalMap: lib.tex('facade_normal'),
      normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: lib.tex('facade_rough'), roughness: 1, clearcoat: 0.02, clearcoatRoughness: 0.7, envMapIntensity: 0.8,
    }),
    trim: physical('trim', {
      color: tinted(FINISH.trim, 'arch_paint_albedo'), map: lib.tex('arch_paint_albedo', true), normalMap: lib.tex('arch_normal'),
      normalScale: new THREE.Vector2(0.08, 0.08), roughness: 0.6, clearcoat: 0.08, clearcoatRoughness: 0.5, envMapIntensity: 0.8,
    }),
    plinth: physical('plinth', {
      color: tinted(FINISH.plinth, 'stucco_albedo'), map: lib.tex('stucco_albedo', true), normalMap: lib.tex('stucco_normal'),
      normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95, envMapIntensity: 0.5,
    }),
    roof: physical('roofTile', {
      color: srgbColor(FINISH.roof), normalMap: lib.tex('metal_normal'), normalScale: new THREE.Vector2(0.1, 0.1), roughnessMap: lib.tex('metal_rough'),
      roughness: 0.62 / 0.72, metalness: 0.25, clearcoat: 0.2, clearcoatRoughness: 0.5, envMapIntensity: 0.55,
    }),
    soffit: physical('soffit', {
      color: tinted(FINISH.trim, 'facade_albedo'), map: lib.tex('facade_albedo', true), normalMap: lib.tex('facade_normal'), normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.75, envMapIntensity: 0.6,
    }),
    frame: physical('pvc', { color: srgbColor(FINISH.frame), roughness: 0.32, clearcoat: 0.3, clearcoatRoughness: 0.25, envMapIntensity: 0.7 }),
    gutter: physical('gutter', { color: srgbColor(FINISH.gutter), roughness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.2, envMapIntensity: 0.8 }),
    door: physical('doorPanel', { color: srgbColor(FINISH.door), roughness: 0.4, clearcoat: 0.25, clearcoatRoughness: 0.3, normalMap: lib.tex('metal_normal'), normalScale: new THREE.Vector2(0.05, 0.05), envMapIntensity: 0.7 }),
    steel: physical('steelPipe', { color: srgbColor(FINISH.steel), metalness: 0.85, roughness: 0.42, envMapIntensity: 0.55 }),
    black: physical('blackMetal', { color: srgbColor(FINISH.snow), metalness: 0.5, roughness: 0.42, clearcoat: 0.2, envMapIntensity: 0.7 }),
    rubber: physical('seal', { color: srgbColor('#2a2b2d'), roughness: 0.8, envMapIntensity: 0.3 }),
    // Снаружи помещения видны сквозь стекло приглушёнными (как на рендере): тёмный тон, слабое окружение.
    inner: lib.make('site|innerWall', () => new THREE.MeshPhysicalMaterial({ color: srgbColor('#9d978d'), roughness: 0.9, envMapIntensity: 0.15 }), { interior: true }),
    floor: lib.make('site|innerFloor', () => new THREE.MeshPhysicalMaterial({
      color: tinted('#8c7a62', 'floor_albedo'), map: lib.tex('floor_albedo', true), normalMap: lib.tex('floor_normal'), normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.75, envMapIntensity: 0.15, vertexColors: true,
    }), { interior: true }),
    glass: siteGlass(lib),
    darkGlass: physical('skylightGlass', { color: srgbColor('#1b2228'), roughness: 0.04, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.3 }),
    concrete: physical('stepConcrete', {
      color: tinted('#a8a7a2', 'pavers_albedo'), map: lib.tex('pavers_albedo', true), normalMap: lib.tex('pavers_normal'), normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.92, envMapIntensity: 0.5,
    }),
  };
}

// ---------- геометрия ----------
const V2 = (p) => new THREE.Vector2(p[0], p[1]);

// Стена: наружная грань по линии a→b (локальные XZ), n — наружная нормаль, t — толщина;
// top — верхний контур [[s, y], ...] по возрастанию s; holes — многоугольники проёмов в (s, y).
// ends — закрывать ли торцы (по умолчанию да).
export function wallGeometry(G, { a, b, n, t, top, y0 = 0, holes = [], ends = [true, true], keyOut = 'facade', keyIn = 'inner', keyReveal = 'trim', inset = 0 }) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const P = (s, y, d) => [a[0] + u[0] * s - n[0] * d, y, a[1] + u[1] * s - n[1] * d];
  const outline = [[0, y0], [L, y0], ...[...top].reverse()];
  const contour = outline.map(V2);
  const hs = holes.map((h) => h.map(V2));
  const tris = THREE.ShapeUtils.triangulateShape(contour, hs);
  const all = [...outline, ...holes.flat()];
  const nOut = [n[0], 0, n[1]];
  const nIn = [-n[0], 0, -n[1]];
  for (const [side, key, d, nn] of [['out', keyOut, inset, nOut], ['in', keyIn, t, nIn]]) {
    const mb = G.get(key);
    const base = mb.vertexCount;
    for (const [s, y] of all) mb.vertex(P(s, y, d), nn, side === 'out' ? [s / TILE.facade, y / TILE.facade] : [s, y], 1);
    for (const [i, j, k] of tris) {
      // Обход выбирается по нормали грани.
      const p0 = P(...all[i], d), p1 = P(...all[j], d), p2 = P(...all[k], d);
      const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      if (cr[0] * nn[0] + cr[1] * nn[1] + cr[2] * nn[2] >= 0) mb.idx.push(base + i, base + j, base + k);
      else mb.idx.push(base + i, base + k, base + j);
    }
  }
  // Откосы проёмов.
  const rev = G.get(keyReveal);
  for (const h of holes) {
    const cx = h.reduce((s, p) => s + p[0], 0) / h.length;
    const cy = h.reduce((s, p) => s + p[1], 0) / h.length;
    for (let i = 0; i < h.length; i++) {
      const p = h[i];
      const q = h[(i + 1) % h.length];
      const e = [q[0] - p[0], q[1] - p[1]];
      const l = Math.hypot(...e);
      let m = [-e[1] / l, e[0] / l];
      const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
      if ((cx - mid[0]) * m[0] + (cy - mid[1]) * m[1] < 0) m = [-m[0], -m[1]];
      const nn = [u[0] * m[0], m[1], u[1] * m[0]];
      rev.quad(P(p[0], p[1], inset), P(q[0], q[1], inset), P(q[0], q[1], t), P(p[0], p[1], t), nn, [0, 0], [l, 0], [l, t], [0, t]);
    }
  }
  // Верх стены по контуру.
  const inner = G.get(keyIn);
  for (let i = 0; i + 1 < top.length; i++) {
    const [s0, y0t] = top[i];
    const [s1, y1t] = top[i + 1];
    const e = [s1 - s0, y1t - y0t];
    const l = Math.hypot(...e) || 1;
    const m = [-e[1] / l, e[0] / l];
    inner.quad(P(s0, y0t, 0), P(s1, y1t, 0), P(s1, y1t, t), P(s0, y0t, t), [u[0] * m[0], m[1], u[1] * m[0]], [0, 0], [1, 0], [1, 1], [0, 1]);
  }
  // Торцы.
  const outMb = G.get(keyOut);
  if (ends[0]) outMb.quad(P(0, y0, inset), P(0, top[0][1], inset), P(0, top[0][1], t), P(0, y0, t), [-u[0], 0, -u[1]], [0, 0], [0, top[0][1] / TILE.facade], [t / TILE.facade, top[0][1] / TILE.facade], [t / TILE.facade, 0]);
  const yl = top[top.length - 1][1];
  if (ends[1]) outMb.quad(P(L, y0, inset), P(L, yl, inset), P(L, yl, t), P(L, y0, t), [u[0], 0, u[1]], [0, 0], [0, yl / TILE.facade], [t / TILE.facade, yl / TILE.facade], [t / TILE.facade, 0]);
  return { L, u, P };
}

// Брус (короб) по двум точкам оси в плане, сечение w × h, низ на y0; key — материал.
export function beam(G, key, a, b, w, y0, h, { uvScale = 1, col = 1 } = {}) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], (b[2] ?? 0) - (a[2] ?? 0));
  const ax = [b[0] - a[0], (b[2] ?? 0) - (a[2] ?? 0), b[1] - a[1]];
  box(G, key, [(a[0] + b[0]) / 2, y0 + h / 2 + ((a[2] ?? 0) + (b[2] ?? 0)) / 2, (a[1] + b[1]) / 2], [L, h, w], ax, { uvScale, col });
}

// Ориентированный параллелепипед: центр c, размеры [длина, высота, ширина], ось длины dir (3D).
export function box(G, key, c, size, dir = [1, 0, 0], { uvScale = 1, col = 1, up = [0, 1, 0], uvSwap = false } = {}) {
  const mb = G.get(key);
  const d = new THREE.Vector3(...dir).normalize();
  let w = new THREE.Vector3().crossVectors(d, new THREE.Vector3(...up));
  if (w.lengthSq() < 1e-8) w = new THREE.Vector3(0, 0, 1);
  w.normalize();
  const h = new THREE.Vector3().crossVectors(w, d).normalize();
  const [L, H, W] = size;
  const C = new THREE.Vector3(...c);
  const pt = (sx, sy, sz) => C.clone().addScaledVector(d, sx * L / 2).addScaledVector(h, sy * H / 2).addScaledVector(w, sz * W / 2).toArray();
  const faces = [
    [d, [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]], [W, H]],
    [d.clone().negate(), [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]], [W, H]],
    [h, [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]], [W, L]],
    [h.clone().negate(), [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]], [W, L]],
    [w, [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], [L, H]],
    [w.clone().negate(), [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], [L, H]],
  ];
  for (const [nrm, corners, [su, sv]] of faces) {
    const p = corners.map(([x, y, z]) => pt(x, y, z));
    const k = uvScale;
    if (uvSwap) mb.quad(p[0], p[1], p[2], p[3], nrm.toArray(), [0, 0], [0, su * k], [sv * k, su * k], [sv * k, 0], col);
    else mb.quad(p[0], p[1], p[2], p[3], nrm.toArray(), [0, 0], [su * k, 0], [su * k, sv * k], [0, sv * k], col);
  }
}

// Многоугольная пластина (в плоскости, заданной функцией P(s, y)) толщиной 0 — лицевая сторона по n.
export function planar(G, key, pts2, P, n, uv = (p) => p) {
  const mb = G.get(key);
  const tris = THREE.ShapeUtils.triangulateShape(pts2.map(V2), []);
  const base = mb.vertexCount;
  for (const p of pts2) mb.vertex(P(...p), n, uv(p), 1);
  for (const [i, j, k] of tris) {
    const p0 = P(...pts2[i]), p1 = P(...pts2[j]), p2 = P(...pts2[k]);
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const cr = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    if (cr[0] * n[0] + cr[1] * n[1] + cr[2] * n[2] >= 0) mb.idx.push(base + i, base + j, base + k);
    else mb.idx.push(base + i, base + k, base + j);
  }
}

// Прямоугольник проёма [s0, s1] × [y0, y1] в координатах стены.
export const rectHole = (s0, s1, y0, y1) => [[s0, y0], [s1, y0], [s1, y1], [s0, y1]];

// Окно или дверь в проёме стены: коробка и створки белого ПВХ, стекло, наличник 120 мм с замковым камнем,
// отлив. W — объект стены из wallGeometry (P, u, L), n — наружная нормаль, t — толщина стены.
// o: { s0, s1, y0, y1, kind: 'window'|'door'|'glazing'|'garage', leaves, door: [s0, s1], transom, poly }
export function opening(G, W, n, t, o, { trim = true, keystone = null, sill = true } = {}) {
  const { P } = W;
  const d0 = 0.06; // плоскость коробки от наружной грани
  const fw = 0.068; // ширина профиля коробки
  const fd = 0.07; // глубина профиля
  const poly = o.poly ?? rectHole(o.s0, o.s1, o.y0, o.y1);
  const s0 = Math.min(...poly.map((p) => p[0])), s1 = Math.max(...poly.map((p) => p[0]));
  const y0 = Math.min(...poly.map((p) => p[1])), y1 = Math.max(...poly.map((p) => p[1]));
  const nOut = [n[0], 0, n[1]];
  // Коробка по контуру проёма: брусья по рёбрам многоугольника.
  const edgeBeam = (p, q, width, depth, key, dd = d0) => {
    const e = [q[0] - p[0], q[1] - p[1]];
    const l = Math.hypot(...e);
    if (l < 1e-4) return;
    const cx = (s0 + s1) / 2, cy = (y0 + y1) / 2;
    let m = [-e[1] / l, e[0] / l];
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if ((cx - mid[0]) * m[0] + (cy - mid[1]) * m[1] < 0) m = [-m[0], -m[1]];
    const c2 = [mid[0] + m[0] * width / 2, mid[1] + m[1] * width / 2];
    const c3 = P(c2[0], c2[1], dd + depth / 2);
    const a3 = P(p[0], p[1], dd), b3 = P(q[0], q[1], dd);
    box(G, key, c3, [l, depth, width], [b3[0] - a3[0], b3[1] - a3[1], b3[2] - a3[2]], { up: nOut, uvScale: 1 });
  };
  for (let i = 0; i < poly.length; i++) edgeBeam(poly[i], poly[(i + 1) % poly.length], fw, fd, 'frame');
  // Импосты: створки не шире 0,95 м (окна) / по числу створок (двери).
  const inner = [s0 + fw, s1 - fw];
  const span = inner[1] - inner[0];
  let cuts = [];
  if (o.kind === 'garage') cuts = [];
  else if (o.door) cuts = [o.door[0], o.door[1], ...(o.leaves === 2 ? [(o.door[0] + o.door[1]) / 2] : [])].filter((s) => s > inner[0] + 0.05 && s < inner[1] - 0.05);
  else {
    const k = o.kind === 'door' ? (o.leaves ?? 1) : Math.max(1, Math.round(span / 0.95));
    for (let i = 1; i < k; i++) cuts.push(inner[0] + (span * i) / k);
  }
  const topAt = (s) => {
    // Верх проёма над точкой s (для фронтонного остекления — наклонный).
    let best = -Infinity;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      if ((p[0] - s) * (q[0] - s) <= 0 && Math.abs(q[0] - p[0]) > 1e-6) best = Math.max(best, p[1] + (q[1] - p[1]) * (s - p[0]) / (q[0] - p[0]));
    }
    return best === -Infinity ? y1 : best;
  };
  for (const s of cuts) edgeBeam([s - fw / 2, y0 + fw], [s - fw / 2, topAt(s) - fw], fw, fd, 'frame');
  if (o.transom) for (let i = 0; i < 1; i++) edgeBeam([s0 + fw, o.transom], [s1 - fw, o.transom], fw * 1.6, fd, 'frame');
  // Створки дверей: рамка шире (полотно), ручка.
  if (o.kind === 'door' || o.door) {
    const [ds0, ds1] = o.door ?? [s0, s1];
    const leaves = o.leaves ?? (o.door ? 2 : 1);
    for (let k = 0; k < leaves; k++) {
      const a0 = ds0 + ((ds1 - ds0) * k) / leaves + fw, a1 = ds0 + ((ds1 - ds0) * (k + 1)) / leaves - (k + 1 < leaves ? 0 : fw);
      const lh = Math.min(y1, 2.25) - fw;
      const rect = rectHole(a0, a1, y0 + fw, lh);
      for (let i = 0; i < 4; i++) {
        const p = rect[i], q = rect[(i + 1) % 4];
        edgeBeam(p, q, i === 0 ? 0.12 : 0.085, 0.065, 'frame', d0 + 0.004);
      }
      const hx = k === 0 && leaves === 2 ? a1 - 0.07 : a0 + 0.07;
      box(G, 'steel', P(hx, 1.02, d0 - 0.03), [0.13, 0.02, 0.02], [W.u[0], 0, W.u[1]]);
    }
  }
  if (o.kind === 'garage') {
    // Секционные ворота: панели 0,5 м с горизонтальными швами.
    const P0 = (s, y) => P(s, y, d0 + 0.03);
    const panels = Math.max(3, Math.round((y1 - y0) / 0.52));
    for (let i = 0; i < panels; i++) {
      const ya = y0 + ((y1 - y0) * i) / panels + 0.004, yb = y0 + ((y1 - y0) * (i + 1)) / panels - 0.004;
      planar(G, 'door', [[s0 + 0.02, ya], [s1 - 0.02, ya], [s1 - 0.02, yb], [s0 + 0.02, yb]], P0, nOut);
      box(G, 'door', P((s0 + s1) / 2, (ya + yb) / 2, d0 + 0.028), [s1 - s0 - 0.12, 0.012, 0.012], [W.u[0], 0, W.u[1]]);
    }
    box(G, 'steel', P((s0 + s1) / 2, y0 + 0.08, d0 - 0.005), [0.2, 0.025, 0.03], [W.u[0], 0, W.u[1]]);
  } else {
    // Стекло — по контуру проёма за коробкой.
    const gpoly = poly.map(([s, y]) => [Math.min(Math.max(s, s0 + fw * 0.5), s1 - fw * 0.5), Math.min(Math.max(y, y0 + fw * 0.5), y1 - fw * 0.5)]);
    planar(G, 'glass', gpoly, (s, y) => P(s, y, d0 + fd * 0.55), nOut);
  }
  if (!trim) return;
  // Наличник 120 мм по сторонам и верху, отлив внизу (у дверей — без отлива).
  const tw = 0.12, tp = 0.025;
  const tr = (p, q) => {
    const e = [q[0] - p[0], q[1] - p[1]];
    const l = Math.hypot(...e);
    if (l < 1e-4) return;
    const cx = (s0 + s1) / 2, cy = (y0 + y1) / 2;
    let m = [-e[1] / l, e[0] / l];
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if ((cx - mid[0]) * m[0] + (cy - mid[1]) * m[1] > 0) m = [-m[0], -m[1]];
    const ext = tw;
    const pe = [p[0] - e[0] / l * ext, p[1] - e[1] / l * ext], qe = [q[0] + e[0] / l * ext, q[1] + e[1] / l * ext];
    const c2 = [(pe[0] + qe[0]) / 2 + m[0] * tw / 2, (pe[1] + qe[1]) / 2 + m[1] * tw / 2];
    const a3 = P(pe[0], pe[1], 0), b3 = P(qe[0], qe[1], 0);
    box(G, 'trim', P(c2[0], c2[1], -tp / 2), [l + 2 * ext, tp, tw], [b3[0] - a3[0], b3[1] - a3[1], b3[2] - a3[2]], { up: nOut });
  };
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const bottom = Math.abs(p[1] - y0) < 1e-6 && Math.abs(q[1] - y0) < 1e-6;
    if (bottom) continue;
    tr(p, q);
  }
  if (sill && y0 > 0.05) {
    // Отлив: белый металл, вынос 50 мм, уклон наружу.
    const a3 = P(s0 - 0.05, y0, 0), b3 = P(s1 + 0.05, y0, 0);
    box(G, 'trim', P((s0 + s1) / 2, y0 - 0.012, -0.03), [s1 - s0 + 0.1, 0.025, 0.1], [b3[0] - a3[0], 0, b3[2] - a3[2]], { up: [0, 1, 0] });
  }
  const ks = keystone ?? (s1 - s0 >= 1.4 || o.kind === 'door' || !!o.door);
  if (ks && !o.poly) {
    // Замковый камень: трапеция над верхним наличником.
    const sc = (s0 + s1) / 2;
    const yb = y1 + tw;
    const pts = [[sc - 0.09, yb - 0.02], [sc + 0.09, yb - 0.02], [sc + 0.13, yb + 0.15], [sc - 0.13, yb + 0.15]];
    const Pk = (s, y) => P(s, y, -tp - 0.012);
    planar(G, 'trim', pts, Pk, nOut);
    for (let i = 0; i < 4; i++) {
      const p = pts[i], q = pts[(i + 1) % 4];
      const e = [q[0] - p[0], q[1] - p[1]];
      const l = Math.hypot(...e);
      const m = [e[1] / l, -e[0] / l];
      const nn = [W.u[0] * m[0], m[1], W.u[1] * m[0]];
      G.get('trim').quad(P(p[0], p[1], -tp - 0.012), P(q[0], q[1], -tp - 0.012), P(q[0], q[1], -tp + 0.01), P(p[0], p[1], -tp + 0.01), nn, [0, 0], [l, 0], [l, 0.03], [0, 0.03]);
    }
  }
}

// Угловая доска (белая) на наружном углу: по доске 120 мм на каждой грани угла. d1, d2 — направления
// стен от угла; наружная нормаль грани вдоль d1 — от d2 (и наоборот), годится и для углов 120°.
export function cornerBoards(G, corner, d1, d2, y0, y1, { w = 0.12, tp = 0.025 } = {}) {
  for (const [d, o] of [[d1, d2], [d2, d1]]) {
    const k = o[0] * d[0] + o[1] * d[1];
    let nx = -(o[0] - d[0] * k), nz = -(o[1] - d[1] * k);
    const l = Math.hypot(nx, nz) || 1;
    nx /= l; nz /= l;
    const c = [corner[0] + d[0] * w / 2 + nx * tp / 2, (y0 + y1) / 2, corner[1] + d[1] * w / 2 + nz * tp / 2];
    box(G, 'trim', c, [y1 - y0, tp, w + tp], [0, 1, 0], { up: [nx, 0, nz] });
  }
}

// Цоколь: штукатурка по контуру (замкнутый многоугольник, обход любой) от yb до 0 с утоплением 15 мм,
// белый капельник по верху.
export function plinth(G, poly, yb = -0.4, { inset = 0.015, cut = [] } = {}) {
  const mb = G.get('plinth');
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    // Наружная нормаль: перпендикуляр, уводящий от многоугольника.
    let n = [u[1], -u[0]];
    if (pointInPolygon((a[0] + b[0]) / 2 + n[0] * 0.01, (a[1] + b[1]) / 2 + n[1] * 0.01, poly)) n = [-n[0], -n[1]];
    const A = [a[0] - n[0] * inset, a[1] - n[1] * inset];
    const Bp = [b[0] - n[0] * inset, b[1] - n[1] * inset];
    mb.quad([A[0], yb, A[1]], [Bp[0], yb, Bp[1]], [Bp[0], 0, Bp[1]], [A[0], 0, A[1]], [n[0], 0, n[1]], [0, yb], [L, yb], [L, 0], [0, 0]);
    // Капельник.
    box(G, 'trim', [(a[0] + b[0]) / 2 + n[0] * 0.012, -0.012, (a[1] + b[1]) / 2 + n[1] * 0.012], [L + 0.05, 0.03, 0.035], [u[0], 0, u[1]]);
  }
  void cut;
}
