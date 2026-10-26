// Предметный декор мебели (приёмы sael.net/interior): мягкие подушки с «защипом» по краям, растения из
// настоящих листьев (сгиб по центральной жилке, изгиб по длине, светлая жилка цветом вершин),
// вазы-тела вращения, книги с обложкой и блоком страниц, настольная лампа с абажуром, светящимся
// ночью, плетёная корзина. Всё строится процедурно и кэшируется по параметрам.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './geometry.js';

const cache = new Map();
const memo = (key, fn) => {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
};

function boxUV(g, tile = 0.24) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : az >= ax ? [p.getX(i), p.getY(i)] : [p.getZ(i), p.getY(i)];
    uv[i * 2] = u / tile;
    uv[i * 2 + 1] = v / tile;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function soft(g) {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  g.computeVertexNormals();
  return g;
}

// Подушка: толщина к краям сходит почти на нет, края слегка втянуты — набитая наволочка.
// w — ширина, h — высота (в плоскости подушки), t — толщина (по локальной Z).
export function pillowGeometry(w, h, t) {
  return memo(`pillow|${w}|${h}|${t}`, () => {
    const g = new THREE.BoxGeometry(w, h, t, 14, 14, 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const u = p.getX(i) / (w / 2);
      const v = p.getY(i) / (h / 2);
      const f = Math.pow(Math.max(0, 1 - u * u), 0.55) * Math.pow(Math.max(0, 1 - v * v), 0.55);
      p.setZ(i, p.getZ(i) * (0.16 + 0.84 * f));
      p.setX(i, p.getX(i) * (1 - 0.07 * v * v));
      p.setY(i, p.getY(i) * (1 - 0.07 * u * u));
    }
    return boxUV(soft(g));
  });
}

// Лист: контур по форме, сгиб по жилке (fold), изгиб вниз по длине (curl); лист растёт по +Z.
export function leafGeometry(len, wid, { fold = 0.3, curl = 0.6, shape = 'oval', seg = 9, tint = [1, 1, 1] } = {}) {
  const key = `leaf|${len}|${wid}|${fold}|${curl}|${shape}|${seg}|${tint.join()}`;
  return memo(key, () => {
    const pos = [];
    const col = [];
    const idx = [];
    let y = 0;
    let z = 0;
    const step = len / seg;
    for (let i = 0; i <= seg; i++) {
      const t = i / seg;
      let w;
      if (shape === 'fiddle') w = Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.95 + 0.03)), 0.6) * (0.5 + 0.5 * t) * (1 - 0.15 * Math.sin(t * Math.PI * 2));
      else if (shape === 'heart') w = Math.pow(Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)), 0.7) * (1.15 - 0.5 * t);
      else if (shape === 'round') w = Math.sqrt(Math.max(0, 1 - (2 * t - 1) ** 2));
      else if (shape === 'lance') w = Math.pow(Math.sin(Math.PI * t), 1.2) * 0.8;
      else w = Math.pow(Math.sin(Math.PI * t), 0.8);
      const half = (w * wid) / 2;
      const a = curl * t * t;
      if (i > 0) {
        y += -Math.sin(a) * step;
        z += Math.cos(a) * step;
      }
      const lift = fold * half;
      pos.push(-half, y + lift, z, 0, y, z, half, y + lift, z);
      const edge = [0.24 * tint[0], 0.4 * tint[1], 0.15 * tint[2]];
      const mid = [0.55 * tint[0], 0.68 * tint[1], 0.36 * tint[2]];
      const tip = 0.85 + 0.15 * t;
      col.push(...edge.map((c) => c * tip), ...mid, ...edge.map((c) => c * tip));
      if (i > 0) {
        const b = (i - 1) * 3;
        idx.push(b, b + 3, b + 1, b + 1, b + 3, b + 4, b + 1, b + 4, b + 2, b + 2, b + 4, b + 5);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  });
}

// Размещение листа: основание в точке p, направление dir (вектор), поворот вокруг оси листа roll.
function placeLeaf(g, p, dir, roll) {
  const f = dir.clone().normalize();
  const up = Math.abs(f.y) > 0.98 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
  const x = new THREE.Vector3().crossVectors(up, f).normalize();
  const y = new THREE.Vector3().crossVectors(f, x).normalize();
  const m = new THREE.Matrix4().makeBasis(x, y, f);
  m.premultiply(new THREE.Matrix4().makeTranslation(p.x, p.y, p.z));
  const r = new THREE.Matrix4().makeRotationZ(roll);
  return g.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(m, r));
}

function tube(points, r0, r1, seg = 6) {
  const curve = new THREE.CatmullRomCurve3(points);
  const g = new THREE.TubeGeometry(curve, Math.max(4, points.length * 3), r0, seg, false);
  // Утонение к концу.
  const p = g.attributes.position;
  const n = (Math.max(4, points.length * 3) + 1);
  for (let i = 0; i < p.count; i++) {
    const ring = Math.floor(i / (seg + 1));
    const t = ring / (n - 1);
    const c = curve.getPointAt(Math.min(1, t));
    const k = (r0 + (r1 - r0) * t) / r0;
    p.setXYZ(i, c.x + (p.getX(i) - c.x) * k, c.y + (p.getY(i) - c.y) * k, c.z + (p.getZ(i) - c.z) * k);
  }
  g.computeVertexNormals();
  return g;
}

function stripToColor(g, c) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color'].includes(k)) g.deleteAttribute(k);
  return g.index ? g.toNonIndexed() : g;
}

// Горшок: тело вращения со скруглённым бортиком.
function potGeometry(r, h, { taper = 0.82, rim = 0.012 } = {}) {
  return memo(`pot|${r}|${h}|${taper}|${rim}`, () => {
    const pts = [
      new THREE.Vector2(0.001, 0),
      new THREE.Vector2(r * taper, 0),
      new THREE.Vector2(r * taper + 0.004, 0.006),
      new THREE.Vector2(r - 0.002, h - rim * 1.6),
      new THREE.Vector2(r + rim * 0.4, h - rim * 0.6),
      new THREE.Vector2(r + rim * 0.35, h),
      new THREE.Vector2(r - rim * 0.8, h),
      new THREE.Vector2(r - rim * 0.9, h - rim * 2.2),
    ];
    const g = new THREE.LatheGeometry(pts, 32);
    return boxUV(g, 0.2);
  });
}

function materials(lib) {
  return {
    leaf: lib.plain('decorLeaf', { vertexColors: true, roughness: 0.42, side: THREE.DoubleSide, envMapIntensity: 0.6, clearcoat: 0.25, clearcoatRoughness: 0.35 }, { interior: true }),
    stem: lib.plain('decorStem', { vertexColors: true, roughness: 0.7 }, { interior: true }),
    soil: lib.plain('decorSoil', { color: new THREE.Color().setStyle('#2b2019', THREE.SRGBColorSpace), roughness: 1 }, { interior: true }),
    terracotta: lib.plain('terracotta', { color: new THREE.Color().setStyle('#b8694c', THREE.SRGBColorSpace), roughness: 0.88, envMapIntensity: 0.3 }, { interior: true }),
    stoneware: lib.plain('stoneware', { color: new THREE.Color().setStyle('#3a3836', THREE.SRGBColorSpace), roughness: 0.62, clearcoat: 0.15, envMapIntensity: 0.4 }, { interior: true }),
    books: lib.plain('books', { vertexColors: true, roughness: 0.72, envMapIntensity: 0.3 }, { interior: true }),
    rattan: lib.plain('rattan', { color: new THREE.Color().setStyle('#b48a58', THREE.SRGBColorSpace), map: lib.tex('fabric_albedo', true), normalMap: lib.tex('fabric_normal'), normalScale: new THREE.Vector2(1.6, 1.6), roughness: 0.85 }, { interior: true }),
    wax: lib.plain('candleWax', { color: new THREE.Color().setStyle('#f1ebe0', THREE.SRGBColorSpace), roughness: 0.5, sheen: 0.4, sheenColor: new THREE.Color(1, 0.95, 0.85), envMapIntensity: 0.3 }, { interior: true }),
  };
}

// Растение в горшке. kind: 'fiddle' (фикус лировидный), 'bush' (густой куст), 'herb' (базилик),
// 'branches' (ветки эвкалипта в вазе — без земли). radius ограничивает крону (не выходит за мебель).
export function plant(lib, kind, { seed = 1, height = 0.5, radius = 0.2, pot = 'terracotta', potR = 0.08, potH = 0.09 } = {}) {
  const M = materials(lib);
  const g = new THREE.Group();
  g.name = `plant-${kind}`;
  const r = rng(seed * 97 + 13);
  if (kind !== 'branches') {
    const p = new THREE.Mesh(potGeometry(potR, potH), M[pot]);
    p.castShadow = true;
    p.receiveShadow = true;
    g.add(p);
    const soil = new THREE.Mesh(new THREE.CircleGeometry(potR - 0.008, 24).rotateX(-Math.PI / 2), M.soil);
    soil.position.y = potH - 0.014;
    g.add(soil);
  }
  const leaves = [];
  const stems = [];
  const base = new THREE.Vector3(0, kind === 'branches' ? 0 : potH - 0.014, 0);
  const lim = (v) => {
    const l = Math.hypot(v.x, v.z);
    if (l > radius) { v.x *= radius / l; v.z *= radius / l; }
    return v;
  };
  if (kind === 'fiddle') {
    // Ствол с крупными листьями по спирали, верхние — меньше и круче вверх.
    const top = base.clone().add(new THREE.Vector3((r() - 0.5) * 0.03, height * 0.82, (r() - 0.5) * 0.03));
    stems.push(stripToColor(tube([base, base.clone().lerp(top, 0.5).add(new THREE.Vector3(0.01, 0, 0)), top], 0.009, 0.005), [0.32, 0.26, 0.18]));
    const n = 11;
    for (let i = 0; i < n; i++) {
      const t = 0.25 + (i / (n - 1)) * 0.75;
      const p = base.clone().lerp(top, t);
      const a = i * 2.4 + r() * 0.4;
      const out = 0.55 + 0.4 * (1 - t);
      const dir = new THREE.Vector3(Math.cos(a) * out, 0.55 + t * 0.5, Math.sin(a) * out);
      const s = 0.75 + 0.3 * (1 - Math.abs(t - 0.55));
      const L = Math.min(0.2 * s, radius * 0.95);
      leaves.push(placeLeaf(leafGeometry(+L.toFixed(3), +(L * 0.62).toFixed(3), { shape: 'fiddle', fold: 0.22, curl: 0.7, tint: [0.95, 1, 0.9] }), p, dir, (r() - 0.5) * 0.6));
    }
  } else if (kind === 'bush' || kind === 'herb') {
    const n = kind === 'herb' ? 9 : 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r() * 0.5;
      const lean = 0.25 + r() * 0.45;
      const h = height * (0.5 + r() * 0.5);
      const end = lim(new THREE.Vector3(Math.cos(a) * lean * radius, h, Math.sin(a) * lean * radius)).add(base);
      const mid = base.clone().lerp(end, 0.5).add(new THREE.Vector3(0, 0.02, 0));
      stems.push(stripToColor(tube([base.clone().add(new THREE.Vector3(Math.cos(a) * 0.01, 0, Math.sin(a) * 0.01)), mid, end], kind === 'herb' ? 0.0022 : 0.003, 0.0015, 4), [0.3, 0.42, 0.18]));
      const k = kind === 'herb' ? 3 : 4;
      for (let j = 0; j < k; j++) {
        const t = 0.45 + (j / k) * 0.55;
        const p = base.clone().lerp(end, t);
        const side = j % 2 ? 1 : -1;
        const dir = new THREE.Vector3(Math.cos(a + side * 0.9) * 0.8, 0.45 + r() * 0.3, Math.sin(a + side * 0.9) * 0.8);
        const L = kind === 'herb' ? 0.045 + r() * 0.015 : 0.08 + r() * 0.03;
        const shape = kind === 'herb' ? 'oval' : 'heart';
        leaves.push(placeLeaf(leafGeometry(+L.toFixed(3), +(L * (kind === 'herb' ? 0.62 : 0.8)).toFixed(3), { shape, fold: 0.35, curl: 0.9, seg: 6, tint: kind === 'herb' ? [1.1, 1.2, 0.9] : [0.9, 1, 0.95] }), p, dir, (r() - 0.5) * 0.8));
      }
    }
  } else if (kind === 'branches') {
    // Ветки эвкалипта: тонкие дуги с парами круглых сизых листьев.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + r();
      const end = lim(new THREE.Vector3(Math.cos(a) * radius * (0.5 + r() * 0.5), height * (0.7 + r() * 0.3), Math.sin(a) * radius * (0.5 + r() * 0.5)));
      const mid = new THREE.Vector3(end.x * 0.35, end.y * 0.6, end.z * 0.35);
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), mid, end]);
      stems.push(stripToColor(tube([new THREE.Vector3(0, 0, 0), mid, end], 0.0022, 0.0012, 4), [0.38, 0.3, 0.22]));
      for (let j = 3; j <= 12; j++) {
        const t = j / 12;
        const p = curve.getPoint(t);
        const tg = curve.getTangent(t);
        for (const s of [-1, 1]) {
          const out = new THREE.Vector3(-tg.z * s, 0.4, tg.x * s).add(tg.clone().multiplyScalar(0.4));
          const L = 0.03 + 0.012 * (1 - t);
          leaves.push(placeLeaf(leafGeometry(+L.toFixed(3), +(L * 0.95).toFixed(3), { shape: 'round', fold: 0.1, curl: 0.2, seg: 6, tint: [0.75, 0.95, 1.05] }), p, out, 0));
        }
      }
    }
  }
  const lm = new THREE.Mesh(mergeGeometries(leaves), M.leaf);
  lm.castShadow = true;
  lm.receiveShadow = true;
  lm.userData.excludeAO = true;
  g.add(lm);
  if (stems.length) {
    const sm = new THREE.Mesh(mergeGeometries(stems), M.stem);
    sm.castShadow = true;
    g.add(sm);
  }
  return g;
}

// Ваза — тело вращения по профилю (радиусы по высоте), с горлом и толщиной стенки.
export function vase(lib, { h = 0.24, profile = [0.035, 0.055, 0.06, 0.045, 0.026, 0.03], mat = 'stoneware' } = {}) {
  const M = materials(lib);
  const geo = memo(`vase|${h}|${profile.join()}`, () => {
    const pts = profile.map((rr, i) => new THREE.Vector2(rr, (i / (profile.length - 1)) * h));
    pts.unshift(new THREE.Vector2(0.001, 0));
    const inner = profile.slice(-2).reverse().map((rr, i) => new THREE.Vector2(rr - 0.004, h - 0.004 - i * h * 0.15));
    return boxUV(new THREE.LatheGeometry([...pts, ...inner], 32), 0.2);
  });
  const m = new THREE.Mesh(geo, M[mat]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Книги: стопка (лёжа) или ряд (стоя). Обложка — три пластины, блок страниц — светлый.
export function books(lib, { count = 3, stand = false, seed = 1, w = 0.17, d = 0.24 } = {}) {
  const M = materials(lib);
  const geo = memo(`books|${count}|${stand}|${seed}|${w}|${d}`, () => {
    const r = rng(seed * 31 + 7);
    const COVERS = [[0.55, 0.18, 0.12], [0.16, 0.24, 0.32], [0.82, 0.76, 0.62], [0.2, 0.32, 0.24], [0.12, 0.12, 0.13], [0.74, 0.52, 0.2], [0.62, 0.6, 0.56]];
    const parts = [];
    let off = 0;
    for (let i = 0; i < count; i++) {
      const bw = w * (0.85 + r() * 0.25);
      const bd = d * (0.85 + r() * 0.2);
      const th = 0.014 + r() * 0.022;
      const c = COVERS[Math.floor(r() * COVERS.length)];
      const page = [0.9, 0.87, 0.8];
      const ct = 0.0025;
      const pieces = [
        [new THREE.BoxGeometry(bw, ct, bd), [0, th / 2 - ct / 2, 0], c],
        [new THREE.BoxGeometry(bw, ct, bd), [0, -th / 2 + ct / 2, 0], c],
        [new THREE.BoxGeometry(ct, th, bd), [-bw / 2 + ct / 2, 0, 0], c],
        [new THREE.BoxGeometry(bw - ct - 0.004, th - 2 * ct, bd - 0.006), [ct / 2, 0, 0], page],
      ];
      const book = mergeGeometries(pieces.map(([g, t, col]) => stripToColor(g.translate(...t), col)));
      if (stand) {
        // Стоя: корешок к зрителю (+Z), высота книги — вдоль Y.
        book.rotateX(-Math.PI / 2).rotateY(Math.PI / 2);
        const lean = i === count - 1 ? 0.18 : 0;
        book.translate(0, bd / 2, 0);
        if (lean) book.rotateZ(-lean);
        book.translate(off + th / 2, 0, 0);
        off += th + 0.001;
      } else {
        book.rotateY((r() - 0.5) * 0.35);
        book.translate((r() - 0.5) * 0.01, off + th / 2, (r() - 0.5) * 0.01);
        off += th;
      }
      parts.push(book);
    }
    const g = mergeGeometries(parts);
    if (stand) g.translate(-off / 2, 0, 0);
    g.computeBoundingBox();
    return g;
  });
  const m = new THREE.Mesh(geo, M.books);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Настольная лампа: керамическое основание, латунный стержень, льняной абажур (светится ночью).
export function tableLamp(lib, { h = 0.42 } = {}) {
  const M = materials(lib);
  const g = new THREE.Group();
  g.name = 'table-lamp';
  const base = new THREE.Mesh(memo('lampBase', () => boxUV(new THREE.LatheGeometry([0.001, 0.06, 0.068, 0.062, 0.045, 0.018, 0.012].map((rr, i) => new THREE.Vector2(rr, [0, 0, 0.01, 0.05, 0.1, 0.14, 0.15][i])), 28), 0.2)), M.stoneware);
  base.castShadow = true;
  g.add(base);
  const brass = lib.plain('brass', { color: new THREE.Color(0.78, 0.6, 0.32), metalness: 1, roughness: 0.32, envMapIntensity: 0.7 }, { interior: true });
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, h - 0.2, 10), brass);
  rod.position.y = 0.15 + (h - 0.2) / 2;
  g.add(rod);
  const shade = new THREE.Mesh(memo('lampShade', () => new THREE.CylinderGeometry(0.085, 0.12, 0.17, 36, 1, true)), lib.lampGlow());
  shade.position.y = h - 0.085;
  shade.castShadow = true;
  shade.userData.excludeAO = true;
  g.add(shade);
  return g;
}

// Плетёная корзина (на шкаф).
export function basket(lib, { r = 0.17, h = 0.2 } = {}) {
  const M = materials(lib);
  const geo = memo(`basket|${r}|${h}`, () => {
    const pts = [new THREE.Vector2(0.001, 0), new THREE.Vector2(r * 0.85, 0), new THREE.Vector2(r, h * 0.85), new THREE.Vector2(r + 0.006, h), new THREE.Vector2(r - 0.008, h), new THREE.Vector2(r * 0.84, 0.01)];
    return boxUV(new THREE.LatheGeometry(pts, 36), 0.08);
  });
  const m = new THREE.Mesh(geo, M.rattan);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Свеча в стакане (тлеющий фитиль — без огня, чтобы не спорить со светом сцены).
export function candle(lib) {
  const M = materials(lib);
  const g = new THREE.Group();
  const glass = new THREE.Mesh(memo('candleGlass', () => new THREE.CylinderGeometry(0.036, 0.034, 0.08, 24, 1, true)), lib.glass('clear'));
  glass.position.y = 0.04;
  g.add(glass);
  const wax = new THREE.Mesh(memo('candleWax', () => new THREE.CylinderGeometry(0.032, 0.032, 0.05, 24)), M.wax);
  wax.position.y = 0.026;
  wax.castShadow = true;
  g.add(wax);
  return g;
}
