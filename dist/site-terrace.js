// Открытая терраса гостевого дома (решение владельца, этап 4) по логике террасы базы: продольные доски
// 140 мм с зазором 6 мм и стыками вразбежку, настил вровень с полом на ж/б сваях Ø 250, тёмный фальш-борт
// по открытым кромкам, ступени из того же настила к дорожке от кострища. Купель встроена в настил (борт
// на 0,45 м выше), сосна Т15 проходит сквозь настил; вокруг них — обвязка из доски поперёк настила.
// Цвет настила — на выбор (setColor).
import * as THREE from 'three';
import { MeshBuilder } from './mesh-builder.js';
import { SITE, TERRACE, TERRACE_Y, terraceSteps, groundY } from './site-data.js';
import { rng } from './geometry.js';
import { srgbColor } from './materials.js';
import { applyPointLights } from './point-lights.js';

export const TERRACE_COLORS = TERRACE.colors;
const BW = 0.14; // ширина доски
const GAP = 0.006;
const TH = 0.028; // толщина доски
const PITCH = BW + GAP;
const FASCIA = 0.13; // высота фальш-борта под настилом
const POOL_RIM = 0.45; // борт купели над настилом
const POOL_H = 1.1;

// Доска сверху с фасками и торцами; along — 'z' (доска вдоль Z) или 'x'.
function board(mb, x0, x1, z0, z1, y, seed, along = 'z') {
  const r = rng(seed);
  const tone = 0.9 + r() * 0.16;
  const uo = r() * 6, vo = Math.floor(r() * 4) * 0.25;
  const ch = 0.003;
  const uv = along === 'z' ? (x, z) => [z / 1.8 + uo, (x - x0) / 0.72 + vo] : (x, z) => [x / 1.8 + uo, (z - z0) / 0.72 + vo];
  const q = (a, b, c, d, n, k = 1) => mb.quad(a, b, c, d, n, uv(a[0], a[2]), uv(b[0], b[2]), uv(c[0], c[2]), uv(d[0], d[2]), tone * k);
  if (along === 'z') {
    q([x0 + ch, y, z0], [x1 - ch, y, z0], [x1 - ch, y, z1], [x0 + ch, y, z1], [0, 1, 0]);
    q([x0, y - ch, z0], [x0 + ch, y, z0], [x0 + ch, y, z1], [x0, y - ch, z1], [-0.7, 0.7, 0], 0.95);
    q([x1 - ch, y, z0], [x1, y - ch, z0], [x1, y - ch, z1], [x1 - ch, y, z1], [0.7, 0.7, 0], 0.95);
    q([x0, y - TH, z0], [x0, y - ch, z0], [x0, y - ch, z1], [x0, y - TH, z1], [-1, 0, 0], 0.8);
    q([x1, y - ch, z0], [x1, y - TH, z0], [x1, y - TH, z1], [x1, y - ch, z1], [1, 0, 0], 0.8);
    for (const [z, s] of [[z0, -1], [z1, 1]]) q([x0, y - TH, z], [x1, y - TH, z], [x1, y, z], [x0, y, z], [0, 0, s], 0.7);
  } else {
    q([x0, y, z0 + ch], [x1, y, z0 + ch], [x1, y, z1 - ch], [x0, y, z1 - ch], [0, 1, 0]);
    q([x0, y - ch, z0], [x1, y - ch, z0], [x1, y, z0 + ch], [x0, y, z0 + ch], [0, 0.7, -0.7], 0.95);
    q([x0, y, z1 - ch], [x1, y, z1 - ch], [x1, y - ch, z1], [x0, y - ch, z1], [0, 0.7, 0.7], 0.95);
    q([x0, y - TH, z0], [x1, y - TH, z0], [x1, y - ch, z0], [x0, y - ch, z0], [0, 0, -1], 0.8);
    q([x0, y - TH, z1], [x1, y - TH, z1], [x1, y - ch, z1], [x0, y - ch, z1], [0, 0, 1], 0.8);
    for (const [x, s] of [[x0, -1], [x1, 1]]) q([x, y - TH, z0], [x, y - TH, z1], [x, y, z1], [x, y, z0], [s, 0, 0], 0.7);
  }
}

// Вертикальная грань (фальш-борт, подступенок) между точками a, b в плане от y0 до y1.
function face(mb, a, b, y0, y1, n, col = 1) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  mb.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], n, [0, y0 / 0.6], [L / 0.6, y0 / 0.6], [L / 0.6, y1 / 0.6], [0, y1 / 0.6], col);
}

// Обвязка вокруг круглого выреза: прямоугольник [x0, x1] × [z0, z1] с круглой дырой; доски поперёк.
function collar(x0, x1, z0, z1, cx, cz, r, y) {
  const shape = new THREE.Shape([new THREE.Vector2(x0, z0), new THREE.Vector2(x1, z0), new THREE.Vector2(x1, z1), new THREE.Vector2(x0, z1)]);
  const hole = new THREE.Path();
  hole.absarc(cx, cz, r, 0, Math.PI * 2, true);
  shape.holes.push(hole);
  const g = new THREE.ShapeGeometry(shape, 40);
  // Shape в плоскости XY → настил: (x, y) → (x, Y, y); обход — так, чтобы нормаль смотрела вверх.
  const pos = g.attributes.position;
  const uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getY(i);
    pos.setXYZ(i, x, y, z);
    uv.setXY(i, x / 0.72, z / 1.8);
  }
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
  g.deleteAttribute('normal');
  g.computeVertexNormals();
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.count * 3).fill(0.96), 3));
  return g;
}

export function buildTerrace(lib, { quality = 'high' } = {}) {
  const group = new THREE.Group();
  group.name = 'terrace';
  const top = TERRACE_Y;
  const poly = TERRACE.poly;
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const X0 = Math.min(...xs), Z0 = Math.min(...zs), Z1 = Math.max(...zs);
  // Восточная кромка — по стене бани (до южного края) и, у входа, по стене перехода (на 0,3 м восточнее).
  const linkX = Math.max(...xs);
  const wingX = Math.max(...poly.filter((p) => Math.abs(p[1] - Z1) < 1e-6).map((p) => p[0]));
  const notchZ = Math.max(...poly.filter((p) => Math.abs(p[0] - linkX) < 1e-6).map((p) => p[1]));
  const pool = SITE.features.plungePool;
  const t15 = SITE.trees.find((t) => t.status === 'keep' && pointIn(t.pos, poly));
  const holes = [
    { c: pool.center, r: pool.r + 0.02, frame: 0.1, name: 'pool' },
    ...(t15 ? [{ c: t15.pos, r: t15.dbh / 200 + 0.05, frame: 0.16, name: 'tree', id: t15.id }] : []),
  ];

  // Доски вдоль Z от стены бани на запад; у перехода — две доски до стены перехода.
  const strips = [];
  for (let x1 = wingX - 0.01; x1 - BW > X0 - BW + 0.02; x1 -= PITCH) strips.push([Math.max(X0, x1 - BW), x1, Z1]);
  for (let x0 = wingX - 0.01 + GAP; x0 + 0.06 < linkX - 0.01; x0 += PITCH) strips.push([x0, Math.min(linkX - 0.01, x0 + BW), notchZ - 0.01]);
  // Вырезы под обвязку: границы по краям досок, которые задевает круг (без узких обрезков).
  for (const h of holes) {
    const [cx, cz] = h.c;
    const R = h.r + h.frame;
    const hit = strips.filter(([a, b]) => b > cx - R && a < cx + R);
    h.x0 = Math.min(...hit.map((s) => s[0])) - GAP / 2;
    h.x1 = Math.max(...hit.map((s) => s[1])) + GAP / 2;
    h.z0 = cz - R;
    h.z1 = cz + R;
  }
  const deck = new MeshBuilder();
  strips.forEach(([x0, x1, zEnd], i) => {
    const r = rng(5101 + i * 13);
    // Стык вразбежку: одна доска короче 6 м, второй кусок — до конца.
    let cuts = [[Z0 + 0.01, zEnd]];
    const j = Z0 + 3.2 + r() * 3.4;
    if (j < zEnd - 0.6) cuts = [[Z0 + 0.01, j - GAP / 2], [j + GAP / 2, zEnd]];
    for (const h of holes) {
      if (x1 <= h.x0 || x0 >= h.x1) continue;
      cuts = cuts.flatMap(([a, b]) => (b <= h.z0 || a >= h.z1 ? [[a, b]] : [[a, h.z0], [h.z1, b]]).filter(([p, q]) => q - p > 0.04));
    }
    cuts.forEach(([a, b], k) => board(deck, x0, x1, a, b, top, 900 + i * 7 + k));
  });
  // Подложка под зазорами (тёмная) и низ настила.
  deck.quad([X0, top - TH - 0.004, Z0], [linkX, top - TH - 0.004, Z0], [linkX, top - TH - 0.004, Z1], [X0, top - TH - 0.004, Z1], [0, 1, 0], [0, 0], [0, 0], [0, 0], [0, 0], 0.12);
  const deckGeo = deck.build();
  const collars = holes.map((h) => collar(h.x0, h.x1, h.z0, h.z1, h.c[0], h.c[1], h.r, top));
  // Ступени: проступи из той же доски (вдоль кромки), подступенки — доска на ребро.
  const steps = terraceSteps();
  const stairMb = new MeshBuilder();
  const dark = new MeshBuilder();
  const st = TERRACE.stair;
  steps.forEach((s, i) => {
    const sx = s.poly.map((p) => p[0]), sz = s.poly.map((p) => p[1]);
    const ax = Math.min(...sx), bx = Math.max(...sx), az = Math.min(...sz), bz = Math.max(...sz);
    const n = Math.max(1, Math.round((bx - ax + GAP) / PITCH));
    const w = (bx - ax - (n - 1) * GAP) / n;
    for (let k = 0; k < n; k++) board(stairMb, ax + k * (w + GAP), ax + k * (w + GAP) + w, az, bz, s.y, 7000 + i * 11 + k);
    // Подступенок над проступью (у внутренней кромки) — от проступи до уровня выше.
    const xi = st.out[0] < 0 ? bx : ax;
    face(stairMb, [xi + st.out[0] * 0.012, az], [xi + st.out[0] * 0.012, bz], s.y, s.y + s.rise, [st.out[0], 0, st.out[1]], 0.85);
    // Тело ступени до земли — тёмный короб.
    const gy = groundY((ax + bx) / 2, (az + bz) / 2) - 0.05;
    const xo = st.out[0] < 0 ? ax : bx;
    face(dark, [xo, az], [xo, bz], gy, s.y - TH, [st.out[0], 0, st.out[1]]);
    face(dark, [ax, az], [bx, az], gy, s.y - TH, [0, 0, -1]);
    face(dark, [ax, bz], [bx, bz], gy, s.y - TH, [0, 0, 1]);
    // Нижний подступенок — доска от земли до проступи.
    face(stairMb, [xo + st.out[0] * 0.002, az], [xo + st.out[0] * 0.002, bz], Math.max(gy, s.y - s.rise), s.y - TH, [st.out[0], 0, st.out[1]], 0.8);
  });
  // Фальш-борт по открытым кромкам (запад и юг), снаружи на 22 мм.
  const fb = top - TH - FASCIA;
  face(dark, [X0 - 0.022, Z0], [X0 - 0.022, Z1 + 0.022], fb, top + 0.002, [-1, 0, 0]);
  face(dark, [X0 - 0.022, Z1 + 0.022], [wingX, Z1 + 0.022], fb, top + 0.002, [0, 0, 1]);
  // Ж/б сваи Ø 250 под кромками через ≈1,6 м и внутри сеткой (видны в щели под бортом).
  const piles = new MeshBuilder();
  const pile = (x, z) => {
    const r = 0.125, seg = 12;
    const gy = groundY(x, z) - 0.08;
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      const p = (a, y) => [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
      const nn = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      piles.quad(p(a0, gy), p(a1, gy), p(a1, fb - 0.02), p(a0, fb - 0.02), nn, [0, 0], [1, 0], [1, 1], [0, 1]);
    }
  };
  const nx = Math.max(2, Math.round((wingX - X0) / 1.6));
  const nz = Math.max(2, Math.round((Z1 - Z0) / 1.6));
  for (let i = 0; i <= nx; i++) {
    for (let k = 0; k <= nz; k++) {
      const x = X0 + 0.2 + ((wingX - X0 - 0.45) * i) / nx, z = Z0 + 0.3 + ((Z1 - Z0 - 0.5) * k) / nz;
      if (holes.some((h) => Math.hypot(x - h.c[0], z - h.c[1]) < h.r + 0.2)) continue;
      pile(x, z);
    }
  }

  // Материалы: настил — дерево по выбору, борт и короба ступеней — тёмная окрашенная доска, сваи — бетон.
  const darkBoard = lib.paintedWood('#2b2b2c', { facade: true });
  const concrete = lib.concrete();
  const deckMeshes = [];
  const add = (geo, mat, name, opts = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.name = name;
    m.castShadow = opts.cast ?? true;
    m.receiveShadow = true;
    group.add(m);
    return m;
  };
  deckMeshes.push(add(deckGeo, null, 'terrace:deck'));
  collars.forEach((g, i) => deckMeshes.push(add(g, null, `terrace:collar${i}`)));
  deckMeshes.push(add(stairMb.build(), null, 'terrace:stair'));
  // Вставки в вырезы под стволами: видны, когда дерево скрыто на виде («Не заслонять постройки деревьями»).
  const caps = holes.filter((h) => h.name === 'tree').map((h) => {
    const g = new THREE.CircleGeometry(h.r + 0.005, 32).rotateX(-Math.PI / 2).translate(h.c[0], top - 0.001, h.c[1]);
    const uv = g.attributes.uv, pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 0.72, pos.getZ(i) / 1.8);
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(pos.count * 3).fill(0.96), 3));
    const m = add(g, null, 'terrace:treeCap', { cast: false });
    m.visible = false;
    deckMeshes.push(m);
    return { id: h.id, mesh: m };
  });
  group.userData.setHiddenTrees = (ids) => { for (const c of caps) c.mesh.visible = ids.has(c.id); };
  add(dark.build(), darkBoard, 'terrace:fascia');
  add(piles.build(), concrete, 'terrace:piles', { cast: false });

  // Купель: бочка из вертикальной доски Ø 1,8 м, утоплена в настил — борт на 0,45 м выше настила, два
  // стальных обруча, вода на 0,18 м ниже борта.
  {
    const [cx, cz] = pool.center;
    const r = pool.r;
    const rim = top + POOL_RIM;
    const yb = rim - POOL_H;
    const wood = lib.deckWood('oak');
    const staves = [];
    const n = 40;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      staves.push(new THREE.BoxGeometry(0.13, POOL_H, 0.045).rotateY(-a + Math.PI / 2).translate(cx + Math.cos(a) * (r - 0.025), yb + POOL_H / 2, cz + Math.sin(a) * (r - 0.025)));
    }
    const col = (g) => { g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3)); return g; };
    add(mergeStaves(staves.map(col)), wood, 'pool:staves');
    // Дно (внутри бочки).
    add(col(new THREE.CircleGeometry(r - 0.05, 40).rotateX(-Math.PI / 2).translate(cx, yb + 0.06, cz)), wood, 'pool:bottom', { cast: false });
    const steel = lib.blackMetal(false);
    for (const h of [POOL_RIM - 0.2, -0.3]) add(new THREE.TorusGeometry(r + 0.004, 0.012, 6, 64).rotateX(Math.PI / 2).translate(cx, top + h, cz), steel, 'pool:hoop');
    const water = add(new THREE.CircleGeometry(r - 0.05, 48).rotateX(-Math.PI / 2).translate(cx, rim - 0.18, cz), lib.make('site|poolWater', () => new THREE.MeshPhysicalMaterial({ color: srgbColor('#3d5a5c'), roughness: 0.03, clearcoat: 1, normalMap: lib.tex('water_normal'), normalScale: new THREE.Vector2(0.15, 0.15), envMapIntensity: 1.3 })), 'pool:water', { cast: false });
    water.receiveShadow = true;
  }

  // Цвет настила (обвязка и ступени — тот же).
  // Настил на улице под рассеянным светом неба и газона выглядит серее паркета — тон доски чуть насыщеннее
  // и теплее материала дерева базы (медовый дуб читается медовым).
  group.userData.setColor = (id) => {
    const key = TERRACE_COLORS.includes(id) ? id : TERRACE_COLORS[0];
    const m = lib.make(`terraceDeck|${key}`, () => {
      const c = lib.deckWood(key).clone();
      // Сдвиг к янтарному: зелёный отсвет газона и неба иначе уводит светлый дуб в оливковый.
      if (key !== 'ash') c.color.offsetHSL(-0.022, 0.16, -0.02);
      return c;
    });
    applyPointLights(m);
    for (const d of deckMeshes) d.material = m;
    group.userData.color = id;
  };
  group.userData.setColor(TERRACE_COLORS[0]);
  group.userData.deckMeshes = deckMeshes;
  void quality;
  return group;
}

function pointIn([x, z], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Склейка клёпок бочки в одну геометрию (одинаковые атрибуты, без индексов у BoxGeometry — с индексами).
function mergeStaves(list) {
  const pos = [], nrm = [], uv = [], col = [], idx = [];
  let off = 0;
  for (const g of list) {
    const a = g.attributes;
    pos.push(...a.position.array); nrm.push(...a.normal.array); uv.push(...a.uv.array); col.push(...a.color.array);
    for (const i of g.index.array) idx.push(i + off);
    off += a.position.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
