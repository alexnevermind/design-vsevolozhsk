// Мебель и оборудование построек по листам владельца (расстановка — по планам, координаты в мм листа,
// разобраны в docs/ASSUMPTIONS.md, п. 9). Предметы переставляются и поворачиваются в режиме «Внутри»
// (не добавляются): положение хранится в состоянии участка (items: { id: [x, z, поворот°] }).
// Координаты предметов — локальные метры постройки (x, z — оси листа), y = 0 — чистый пол этажа.
import * as THREE from 'three';
import { buildFurniture, rbox, cyl, part } from './furniture-detail.js';
import { buildFixture } from './fixtures.js';
import { FireZone } from './bbq-zone.js';
import { applyPointLights } from './point-lights.js';
import { interiorLight } from './site-arch.js';
import { books, vase } from './decor.js';
import { SRC } from './site-data.js';

const DEG = Math.PI / 180;
const mm = (v) => v / 1000;

// Материалы слотов мебели (фиксированная отделка: светлый дуб, лён, акцент — терракота, столешница — сланец).
function slotMaterials(lib) {
  return {
    joinery: lib.furnitureWood('whiteoak'),
    upholstery: lib.fabric('linen'),
    accent: lib.fabric('rust'),
    bedding: lib.fabric('boucle'),
    counter: lib.stone('slate'),
    metal: lib.brushed(),
    ceramic: lib.ceramic(),
  };
}

// ---------- собственные предметы ----------
// Кресло: мягкое, с подлокотниками (габарит w × d).
function armchair(w = 0.82, d = 0.84) {
  const g = new THREE.Group();
  const legH = 0.1;
  for (const [x, z] of [[-w / 2 + 0.07, -d / 2 + 0.07], [w / 2 - 0.07, -d / 2 + 0.07], [-w / 2 + 0.07, d / 2 - 0.07], [w / 2 - 0.07, d / 2 - 0.07]]) part(g, cyl(0.016, 0.012, legH, 10), 'joinery', x, legH / 2, z);
  part(g, rbox(w, 0.2, d, 0.03, 3), 'upholstery', 0, legH + 0.1, 0);
  for (const s of [-1, 1]) part(g, rbox(0.15, 0.34, d, 0.06, 4), 'upholstery', s * (w / 2 - 0.075), legH + 0.37, 0);
  part(g, rbox(w - 0.28, 0.42, 0.17, 0.05, 3), 'upholstery', 0, legH + 0.41, -d / 2 + 0.085);
  part(g, rbox(w - 0.31, 0.14, d - 0.2, 0.05, 4), 'upholstery', 0, legH + 0.27, 0.07);
  part(g, rbox(w - 0.31, 0.42, 0.15, 0.07, 4), 'accent', 0, legH + 0.55, -d / 2 + 0.23, { rx: -0.15 });
  return g;
}

// Барный табурет: круглое сиденье на четырёх ножках с подножкой.
function barStool(h = 0.75) {
  const g = new THREE.Group();
  part(g, cyl(0.19, 0.18, 0.045, 24), 'joinery', 0, h - 0.022, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const leg = part(g, cyl(0.014, 0.017, h - 0.04, 8), 'metal', Math.cos(a) * 0.13, (h - 0.04) / 2, Math.sin(a) * 0.13);
    leg.rotation.set(Math.sin(a) * 0.08, 0, -Math.cos(a) * 0.08);
  }
  const ring = part(g, new THREE.TorusGeometry(0.15, 0.008, 6, 28), 'metal', 0, 0.28, 0);
  ring.rotation.x = Math.PI / 2;
  return g;
}

// Табурет-чурбак у очага (массив).
function lowStool(h = 0.44) {
  const g = new THREE.Group();
  part(g, cyl(0.2, 0.21, h, 20), 'joinery', 0, h / 2, 0);
  return g;
}

// Кухонный ряд вдоль стены: тумбы 600 мм, столешница, мойка и варочная панель, колонна с холодильником;
// открытые полки над столешницей там, где нет окна. len — длина вдоль локальной X, задняя грань — z = −0,3.
function kitchenRun(lib, len, { sinkAt = null, hobAt = null, fridge = 'start', shelves = [] } = {}) {
  const g = new THREE.Group();
  const back = -0.3;
  const ct = 0.04, cy = 0.9;
  const x0 = -len / 2;
  const fridgeW = fridge ? 0.6 : 0;
  const fx = fridge === 'start' ? x0 + 0.3 : len / 2 - 0.3;
  const runA = fridge === 'start' ? x0 + fridgeW : x0, runB = fridge === 'start' ? len / 2 : len / 2 - fridgeW;
  const runL = runB - runA, runC = (runA + runB) / 2;
  part(g, rbox(runL, 0.1, 0.54, 0.002), lib.blackMetal(), runC, 0.05, back + 0.27);
  part(g, rbox(runL - 0.004, cy - ct - 0.1, 0.58, 0.002), 'joinery', runC, 0.1 + (cy - ct - 0.1) / 2, back + 0.29);
  part(g, rbox(runL, ct, 0.62, 0.003), 'counter', runC, cy - ct / 2, back + 0.31);
  // Фасады ящиков: швы и ручки.
  const modules = Math.max(1, Math.round(runL / 0.6));
  for (let i = 0; i < modules; i++) {
    const cx = runA + (runL * (i + 0.5)) / modules;
    part(g, rbox(runL / modules - 0.006, cy - ct - 0.12, 0.018, 0.002), 'joinery', cx, 0.1 + (cy - ct - 0.1) / 2, back + 0.589);
    part(g, rbox(0.16, 0.012, 0.014, 0.005), 'metal', cx, cy - ct - 0.07, back + 0.605);
  }
  if (sinkAt !== null) {
    part(g, rbox(0.5, 0.012, 0.42, 0.02), lib.brushed(), runC + sinkAt, cy + 0.002, back + 0.32);
    part(g, rbox(0.44, 0.02, 0.36, 0.03), lib.blackMetal(), runC + sinkAt, cy - 0.004, back + 0.32);
    part(g, cyl(0.016, 0.02, 0.26, 12), lib.chrome(), runC + sinkAt, cy + 0.13, back + 0.08);
    part(g, cyl(0.011, 0.011, 0.2, 10), lib.chrome(), runC + sinkAt, cy + 0.25, back + 0.17, { rx: Math.PI / 2 });
  }
  if (hobAt !== null) {
    part(g, rbox(0.58, 0.008, 0.5, 0.01), lib.tvScreen(), runC + hobAt, cy + 0.004, back + 0.32);
    for (const [dx, dz, r] of [[-0.14, -0.1, 0.09], [0.14, -0.1, 0.07], [-0.14, 0.12, 0.07], [0.14, 0.12, 0.09]]) {
      const ring = part(g, new THREE.TorusGeometry(r, 0.003, 4, 32), lib.brushed(), runC + hobAt + dx, cy + 0.009, back + 0.32 + dz, { castShadow: false });
      ring.rotation.x = Math.PI / 2;
    }
  }
  if (fridge) {
    part(g, rbox(0.6, 2.05, 0.62, 0.004), 'joinery', fx, 1.025, back + 0.31);
    part(g, rbox(0.012, 0.6, 0.014, 0.005), 'metal', fx + 0.24, 1.2, back + 0.625);
    part(g, rbox(0.012, 0.3, 0.014, 0.005), 'metal', fx + 0.24, 0.55, back + 0.625);
    part(g, rbox(0.596, 0.004, 0.02, 0.001), lib.blackMetal(), fx, 0.86, back + 0.62);
  }
  for (const [a, b] of shelves) {
    for (const y of [1.45, 1.85]) part(g, rbox(b - a, 0.035, 0.26, 0.004), 'joinery', runC + (a + b) / 2, y, back + 0.13);
    const v = vase(lib, { h: 0.2 });
    v.position.set(runC + a + 0.2, 1.47, back + 0.13);
    g.add(v);
    const bk = books(lib, { count: 4, seed: 3, stand: true });
    bk.position.set(runC + b - 0.25, 1.87, back + 0.13);
    g.add(bk);
  }
  return g;
}

// Остров / барная стойка: тумба с фасадами и столешница со свесом под табуреты (+z).
function island(w, d) {
  const g = new THREE.Group();
  part(g, rbox(w - 0.3, 0.86, d, 0.004), 'joinery', 0, 0.43, -0.15);
  part(g, rbox(w + 0.04, 0.04, d + 0.04, 0.004), 'counter', 0, 0.9, 0);
  return g;
}

// Шкаф во всю нишу: распашные двери по 0,5 м, ручки.
function closet(w, d = 0.6, h = 2.2) {
  const g = new THREE.Group();
  part(g, rbox(w, h, d - 0.02, 0.003), 'joinery', 0, h / 2, -0.01);
  const n = Math.max(2, Math.round(w / 0.5));
  for (let i = 0; i < n; i++) {
    const cx = -w / 2 + (w * (i + 0.5)) / n;
    part(g, rbox(w / n - 0.006, h - 0.04, 0.02, 0.002), 'joinery', cx, h / 2, d / 2 - 0.01);
    part(g, rbox(0.012, 0.3, 0.014, 0.005), 'metal', cx + (i % 2 ? -1 : 1) * (w / n / 2 - 0.05), 1.05, d / 2 + 0.008);
  }
  return g;
}

// Скамья из массива (сиденье и опоры).
function bench(len, depth = 0.38, h = 0.45) {
  const g = new THREE.Group();
  part(g, rbox(len, 0.045, depth, 0.008), 'joinery', 0, h - 0.022, 0);
  for (const s of [-1, 1]) part(g, rbox(0.05, h - 0.045, depth - 0.04, 0.006), 'joinery', s * (len / 2 - 0.12), (h - 0.045) / 2, 0);
  return g;
}

// Прикроватная тумба с лампой.
function nightstand(lib) {
  const g = new THREE.Group();
  part(g, rbox(0.45, 0.5, 0.4, 0.004), 'joinery', 0, 0.25, 0);
  part(g, rbox(0.43, 0.012, 0.012, 0.004), 'metal', 0, 0.36, 0.205);
  part(g, cyl(0.07, 0.09, 0.03, 20), lib.ceramic(), 0, 0.515, 0);
  part(g, cyl(0.012, 0.012, 0.3, 8), lib.brushed(), 0, 0.68, 0);
  part(g, cyl(0.11, 0.15, 0.2, 24, true), 'bedding', 0, 0.86, 0);
  return g;
}

// Печь-камин гостиной: круглый стальной корпус с остеклённой топкой, дымоход до потолка.
function roundStove(lib, flueTop) {
  const g = new THREE.Group();
  part(g, cyl(0.3, 0.3, 0.06, 32), lib.blackMetal(), 0, 0.03, 0);
  part(g, cyl(0.27, 0.27, 1.0, 32), lib.blackMetal(), 0, 0.56, 0);
  part(g, cyl(0.3, 0.3, 0.04, 32), lib.blackMetal(), 0, 1.08, 0);
  const win = part(g, new THREE.CylinderGeometry(0.272, 0.272, 0.36, 24, 1, true, -0.65, 1.3), lib.make('stoveGlass', () => new THREE.MeshStandardMaterial({ color: 0x1b1714, emissive: 0xff7a2a, emissiveIntensity: 0, roughness: 0.15, metalness: 0.2 })), 0, 0.55, 0, { castShadow: false });
  win.rotation.y = 0;
  win.userData.stoveGlass = true;
  part(g, cyl(0.1, 0.1, flueTop - 1.1, 20), lib.blackMetal(), 0, 1.1 + (flueTop - 1.1) / 2, 0);
  // Каменная подложка перед топкой.
  part(g, rbox(0.9, 0.02, 0.9, 0.004), lib.stone('slate'), 0, 0.01, 0.15);
  return g;
}

// Печь сауны: стальной корпус, сетка-каменка с камнями, дымоход до потолка.
function saunaStove(lib, flueTop) {
  const g = new THREE.Group();
  part(g, rbox(0.46, 0.62, 0.5, 0.01), lib.blackMetal(), 0, 0.31, 0);
  const cage = lib.make('stoveCage', () => new THREE.MeshStandardMaterial({ color: 0x2b2c2e, metalness: 0.7, roughness: 0.45, wireframe: true }));
  part(g, new THREE.BoxGeometry(0.46, 0.34, 0.5, 6, 4, 6), cage, 0, 0.79, 0, { castShadow: false });
  const stones = new THREE.Group();
  const rnd = (i) => (Math.sin(i * 12.9898) * 43758.5453) % 1;
  for (let i = 0; i < 40; i++) {
    const s = part(stones, new THREE.IcosahedronGeometry(0.045 + Math.abs(rnd(i)) * 0.03, 0), lib.fieldStone(), (Math.abs(rnd(i + 1)) - 0.5) * 0.38, 0.66 + Math.abs(rnd(i + 2)) * 0.26, (Math.abs(rnd(i + 3)) - 0.5) * 0.42);
    s.rotation.set(rnd(i + 4) * 3, rnd(i + 5) * 3, 0);
  }
  g.add(stones);
  part(g, rbox(0.3, 0.12, 0.012, 0.003), lib.make('stoveGlass2', () => new THREE.MeshStandardMaterial({ color: 0x1b1714, emissive: 0xff7a2a, emissiveIntensity: 0, roughness: 0.15 })), 0, 0.32, 0.256, { castShadow: false }).userData.stoveGlass = true;
  part(g, cyl(0.075, 0.075, flueTop - 0.96, 16), lib.brushed(), 0, 0.96 + (flueTop - 0.96) / 2, 0);
  // Ограждение печи (рейки).
  for (const s of [-1, 1]) part(g, rbox(0.03, 0.9, 0.62, 0.004), lib.naturalWood(), s * 0.33, 0.45, 0);
  return g;
}

// Полок сауны: два яруса из реек на всю ширину помещения (длина вдоль локальной X).
function saunaBenches(lib, len) {
  const g = new THREE.Group();
  const wood = lib.naturalWood();
  const tier = (y, z0, z1) => {
    const n = Math.floor((z1 - z0) / 0.1);
    for (let i = 0; i < n; i++) part(g, rbox(len - 0.02, 0.028, 0.09, 0.006), wood, 0, y, z0 + 0.05 + i * 0.1);
    for (const x of [-len / 2 + 0.08, 0, len / 2 - 0.08]) part(g, rbox(0.045, y - 0.014, 0.045, 0.004), wood, x, (y - 0.014) / 2, z1 - 0.06);
    part(g, rbox(len - 0.02, 0.12, 0.02, 0.003), wood, 0, y - 0.08, z1 - 0.01);
  };
  tier(0.95, -0.45, 0.45);
  tier(0.5, 0.45, 0.95);
  // Подголовник.
  part(g, rbox(0.4, 0.06, 0.3, 0.02), wood, -len / 2 + 0.25, 0.99, -0.1, { rz: 0.15 });
  return g;
}

// Стеллаж металлический: стойки, полки, коробки.
function shelving(lib, len, depth = 0.5, h = 2.0, seed = 1) {
  const g = new THREE.Group();
  const steel = lib.paintedMetal('#5c6166', { key: 'shelf' });
  const n = Math.max(1, Math.round(len / 1.0));
  for (let i = 0; i <= n; i++) {
    const x = -len / 2 + (len * i) / n;
    for (const z of [-depth / 2 + 0.02, depth / 2 - 0.02]) part(g, rbox(0.035, h, 0.035, 0.003), steel, x, h / 2, z);
  }
  const box = lib.make('cardboard', () => new THREE.MeshStandardMaterial({ color: 0xb08a5c, roughness: 0.9 }));
  const bin = lib.make('storageBin', () => new THREE.MeshStandardMaterial({ color: 0x3c4a55, roughness: 0.6 }));
  let r = seed * 9.73;
  const rand = () => { r = (r * 16807) % 2147483647; return (r % 1000) / 1000; };
  for (const y of [0.12, 0.6, 1.08, 1.56, 1.98]) {
    part(g, rbox(len, 0.025, depth, 0.003), steel, 0, y, 0);
    if (y > 1.9) continue;
    for (let x = -len / 2 + 0.25; x < len / 2 - 0.2; x += 0.45 + rand() * 0.2) {
      if (rand() < 0.25) continue;
      const bh = 0.2 + rand() * 0.18;
      part(g, rbox(0.36 + rand() * 0.06, bh, depth - 0.1, 0.006), rand() < 0.5 ? box : bin, x, y + 0.012 + bh / 2, 0);
    }
  }
  return g;
}

// Верстак под окном: столешница из массива на стальной раме.
function workbench(lib, len, depth = 0.6) {
  const g = new THREE.Group();
  const steel = lib.paintedMetal('#5c6166', { key: 'shelf' });
  part(g, rbox(len, 0.04, depth, 0.004), 'joinery', 0, 0.88, 0);
  for (const x of [-len / 2 + 0.05, len / 2 - 0.05]) for (const z of [-depth / 2 + 0.05, depth / 2 - 0.05]) part(g, rbox(0.04, 0.86, 0.04, 0.003), steel, x, 0.43, z);
  part(g, rbox(len - 0.1, 0.02, depth - 0.1, 0.003), steel, 0, 0.18, 0);
  return g;
}

// Стол из массива с двумя скамьями (гриль-дом).
function tableWithBenches(len, w) {
  const g = new THREE.Group();
  part(g, rbox(len, 0.05, w, 0.01), 'joinery', 0, 0.75, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, rbox(0.07, 0.72, 0.07, 0.005), 'joinery', sx * (len / 2 - 0.12), 0.36, sz * (w / 2 - 0.1));
  for (const sz of [-1, 1]) {
    const b = bench(len - 0.1, 0.34);
    b.position.z = sz * (w / 2 + 0.33);
    g.add(b);
  }
  return g;
}

// Очаг гриль-дома: живой огонь в каменном кольце на плитняке, дымосборник и труба до кровли.
function hearthHood(lib, top) {
  const g = new THREE.Group();
  const hood = lib.make('hearthHood', () => new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.5, roughness: 0.45, side: THREE.DoubleSide }));
  part(g, new THREE.CylinderGeometry(0.16, 0.62, 0.5, 32, 1, true), hood, 0, 1.95, 0);
  part(g, cyl(0.125, 0.125, top - 2.2, 20), lib.blackMetal(), 0, 2.2 + (top - 2.2) / 2, 0);
  return g;
}

// ---------- расстановка по листам ----------
// x, z — центр предмета в мм листа; rot — поворот (°), 0 — перед к +z листа; level — этаж (0 / мансарда).
// face(x, z) — разворот «лицом к точке».
const faceTo = (x, z, tx, tz) => Math.atan2(tx - x, tz - z) / DEG;

export function layout() {
  const G = SRC.guest;
  const f2 = G.heights.main.floor2;
  const K = SRC.grill;
  const F = K.hexagon.vertexR * Math.cos(30 * DEG);
  const inner = F - K.hexagon.wall;
  // Грань гриль-дома k (0 — СВ): центр предмета глубиной d у внутренней грани, поворот лицом к центру.
  const atFace = (k, d, along = 0) => {
    const a = (-60 + 60 * k) * DEG;
    const nx = Math.cos(a), nz = Math.sin(a);
    const r = inner - d / 2;
    return { x: nx * r - nz * along, z: nz * r + nx * along, rot: faceTo(nx, nz, 0, 0) };
  };
  const ne = atFace(0, 620, 150), nw = atFace(5, 620, 0);
  const hx = K.hearth.at[0];
  return {
    guest: [
      { id: 'kitchen', type: 'kitchenRun', room: 'G01', x: 575, z: 2340, rot: 90, len: 4080, sinkAt: 0.5, hobAt: -0.75, fridge: 'start', shelves: [[-1.45, -0.55]], label: 'Кухня' },
      { id: 'island', type: 'island', room: 'G01', x: 2170, z: 2820, rot: 90, w: 1760, d: 780, label: 'Остров' },
      ...[2165, 2800, 3450].map((z, i) => ({ id: `stool${i + 1}`, type: 'barStool', room: 'G01', x: 3090, z, rot: -90, label: 'Табурет' })),
      { id: 'sofa', type: 'sofa', room: 'G02', x: 2135, z: 5265, rot: 0, label: 'Диван' },
      { id: 'stove', type: 'roundStove', room: 'G02', x: 1206, z: 7020, rot: 135, fixed: true, label: 'Печь-камин' },
      { id: 'armchair1', type: 'armchair', room: 'G02', x: 4120, z: 5880, rot: faceTo(4120, 5880, 1206, 7020), label: 'Кресло' },
      { id: 'armchair2', type: 'armchair', room: 'G02', x: 4120, z: 8150, rot: faceTo(4120, 8150, 1206, 7020), label: 'Кресло' },
      { id: 'coffee', type: 'coffee', room: 'G02', x: 2150, z: 6250, rot: 0, label: 'Журнальный стол' },
      { id: 'closet', type: 'closet', room: 'G03', x: 5905, z: 2280, rot: 0, w: 1400, d: 600, label: 'Шкаф' },
      { id: 'vanityWc', type: 'vanity', room: 'G04', x: 7030, z: 2460, rot: 90, label: 'Раковина' },
      { id: 'toiletWc', type: 'toilet', room: 'G04', x: 8380, z: 2550, rot: -90, label: 'Унитаз' },
      { id: 'shower', type: 'shower', room: 'G05', x: 9440, z: 745, rot: 0, label: 'Душ' },
      { id: 'toiletSh', type: 'toilet', room: 'G05', x: 11000, z: 600, rot: 0, label: 'Унитаз' },
      { id: 'benchSh', type: 'bench', room: 'G05', x: 10700, z: 2410, rot: 180, len: 1100, label: 'Скамья' },
      { id: 'saunaBench', type: 'saunaBenches', room: 'G06', x: 14240, z: 1450, rot: 90, len: 2300, fixed: true, label: 'Полок' },
      { id: 'saunaStove', type: 'saunaStove', room: 'G06', x: 11960, z: 2300, rot: 90, fixed: true, label: 'Печь сауны' },
      { id: 'restChair1', type: 'armchair', room: 'G07', x: 11010, z: 3330, rot: 0, label: 'Кресло' },
      { id: 'restChair2', type: 'armchair', room: 'G07', x: 12890, z: 3330, rot: 0, label: 'Кресло' },
      { id: 'restTable', type: 'coffee', room: 'G07', x: 11950, z: 3800, rot: 0, label: 'Столик' },
      { id: 'bed', type: 'bed2', room: 'G08', level: 1, x: 2530, z: 2240, rot: 0, label: 'Кровать 160 × 200' },
      { id: 'night1', type: 'nightstand', room: 'G08', level: 1, x: 1490, z: 1440, rot: 0, label: 'Тумба' },
      { id: 'night2', type: 'nightstand', room: 'G08', level: 1, x: 3570, z: 1440, rot: 0, label: 'Тумба' },
      { id: 'bedBench', type: 'bench', room: 'G08', level: 1, x: 2530, z: 3600, rot: 0, len: 1280, label: 'Банкетка' },
      { id: 'tv', type: 'tv', room: 'G08', level: 1, x: 320, z: 3330, rot: 90, y: 1.05, label: 'Телевизор' },
    ].map((o) => ({ ...o, yLevel: (o.level ? f2 : 0) / 1000 })),
    grill: [
      { id: 'kitchenG', type: 'kitchenRun', room: 'K01', x: ne.x, z: ne.z, rot: ne.rot + 180, len: 2600, sinkAt: 0.45, hobAt: null, fridge: null, label: 'Кухня' },
      { id: 'sideboard', type: 'kitchenRun', room: 'K01', x: nw.x, z: nw.z, rot: nw.rot + 180, len: 2400, sinkAt: null, hobAt: null, fridge: null, label: 'Тумбы' },
      { id: 'tableG', type: 'tableWithBenches', room: 'K01', x: -1580, z: 0, rot: 90, len: 1600, w: 800, label: 'Стол со скамьями' },
      { id: 'hearth', type: 'hearth', room: 'K01', x: hx, z: 0, rot: 0, fixed: true, label: 'Очаг' },
      ...[[979, -858], [2304, -858], [979, 753], [2304, 753]].map(([x, z], i) => ({ id: `seat${i + 1}`, type: 'lowStool', room: 'K01', x, z, rot: faceTo(x, z, hx, 0), label: 'Табурет' })),
    ].map((o) => ({ ...o, yLevel: 0 })),
    garage: [
      { id: 'shelfW', type: 'shelving', room: 'H01', x: 410, z: 800, rot: 90, len: 1000, label: 'Стеллаж' },
      { id: 'benchW', type: 'workbench', room: 'H01', x: 460, z: 2200, rot: 90, len: 1700, label: 'Верстак' },
      { id: 'shelfE', type: 'shelving', room: 'H01', x: 5090, z: 800, rot: -90, len: 1000, label: 'Стеллаж' },
      { id: 'benchE', type: 'workbench', room: 'H01', x: 5040, z: 2200, rot: -90, len: 1700, label: 'Верстак' },
      { id: 'shelfS1', type: 'shelving', room: 'H01', x: 1200, z: 3960, rot: 180, len: 2000, label: 'Стеллаж' },
      { id: 'shelfS2', type: 'shelving', room: 'H01', x: 4300, z: 3960, rot: 180, len: 2000, label: 'Стеллаж' },
    ].map((o) => ({ ...o, yLevel: 0 })),
  };
}

// Габарит предмета в плане (м) для прогулки и перетаскивания.
export function footprint(o) {
  switch (o.type) {
    case 'kitchenRun': return [mm(o.len), 0.62];
    case 'island': return [mm(o.w) + 0.04, mm(o.d) + 0.04];
    case 'barStool': return [0.38, 0.38];
    case 'sofa': return [1.9, 0.85];
    case 'armchair': return [0.82, 0.84];
    case 'coffee': return [0.8, 0.5];
    case 'roundStove': return [0.62, 0.62];
    case 'closet': return [mm(o.w), mm(o.d)];
    case 'vanity': return [0.72, 0.48];
    case 'toilet': return [0.4, 0.65];
    case 'shower': return [0.91, 0.93];
    case 'bench': return [mm(o.len), 0.38];
    case 'saunaBenches': return [mm(o.len), 1.4];
    case 'saunaStove': return [0.72, 0.62];
    case 'bed2': return [1.66, 2.1];
    case 'nightstand': return [0.45, 0.4];
    case 'tv': return [1.22, 0.06];
    case 'tableWithBenches': return [mm(o.len), mm(o.w) + 0.84];
    case 'hearth': return [1.2, 1.2];
    case 'lowStool': return [0.42, 0.42];
    case 'shelving': return [mm(o.len), 0.5];
    case 'workbench': return [mm(o.len), 0.6];
    default: return [0.5, 0.5];
  }
}

function buildItem(o, lib, ctx) {
  switch (o.type) {
    case 'kitchenRun': return kitchenRun(lib, mm(o.len), o);
    case 'island': return island(mm(o.w), mm(o.d));
    case 'barStool': return barStool();
    case 'sofa': return buildFurniture('sofa', lib);
    case 'armchair': return armchair();
    case 'coffee': return buildFurniture('coffee', lib);
    case 'roundStove': return roundStove(lib, ctx.ceilAt(o) - o.yLevel);
    case 'closet': return closet(mm(o.w), mm(o.d));
    case 'vanity': case 'toilet': case 'shower': return buildFixture(o.type, lib);
    case 'bench': return bench(mm(o.len));
    case 'saunaBenches': return saunaBenches(lib, mm(o.len));
    case 'saunaStove': return saunaStove(lib, ctx.ceilAt(o) - o.yLevel);
    case 'bed2': { const g = buildFurniture('bed', lib); g.scale.set(1.6 / 1.46, 1, 1); return g; }
    case 'nightstand': return nightstand(lib);
    case 'tv': return buildFurniture('tv', lib);
    case 'tableWithBenches': return tableWithBenches(mm(o.len), mm(o.w));
    case 'hearth': return hearthHood(lib, ctx.ceilAt(o) + 0.3);
    case 'lowStool': return lowStool();
    case 'shelving': return shelving(lib, mm(o.len), 0.5, 2.0, o.id.length);
    case 'workbench': return workbench(lib, mm(o.len));
    default: return new THREE.Group();
  }
}

// Сборка мебели в группы построек. parts — buildSiteBuildings().userData.parts; ceilAt(id, x, z) —
// высота потолка (локальная) для дымоходов. Возвращает предметы и огонь очага гриль-дома.
export function buildSiteFurniture(lib, parts, { ceilAt, quality = 'high' } = {}) {
  const slots = slotMaterials(lib);
  const items = [];
  const fires = [];
  const L = layout();
  for (const [bid, list] of Object.entries(L)) {
    const part0 = parts[bid];
    if (!part0) continue;
    const root = new THREE.Group();
    root.name = `${bid}:furniture`;
    part0.group.add(root);
    for (const o of list) {
      const g = buildItem(o, lib, { ceilAt: (it) => ceilAt(bid, mm(it.x), mm(it.z), it.level ?? 0) });
      g.traverse((m) => {
        if (!m.isMesh) return;
        if (!m.material && m.userData.slot) m.material = slots[m.userData.slot] ?? slots.joinery;
        if (!m.material) m.material = slots.joinery;
        m.castShadow = m.castShadow !== false;
        m.receiveShadow = true;
      });
      const holder = new THREE.Group();
      holder.name = `item:${bid}:${o.id}`;
      holder.add(g);
      holder.position.set(mm(o.x), o.yLevel + (o.y ?? 0), mm(o.z));
      holder.rotation.y = (o.rot ?? 0) * DEG;
      const [w, d] = footprint(o);
      holder.userData.item = { ...o, building: bid, w, d, base: [mm(o.x), mm(o.z), o.rot ?? 0] };
      root.add(holder);
      items.push(holder);
      if (o.type === 'hearth') {
        // Живой огонь очага: зона огня базы без скамей (в мировых координатах — свет огня считается в них),
        // площадка — плитняк по кругу очага.
        part0.group.updateMatrixWorld(true);
        const c = part0.group.localToWorld(new THREE.Vector3(mm(o.x), o.yLevel + 0.004, mm(o.z)));
        const fz = new FireZone(lib, { quality, name: 'grill-hearth', radius: mm(K_HEARTH_R), pit: true, layout: { benches: [], stumps: [] }, patioSeed: 7171, center: { x: c.x, y: c.y, z: c.z } });
        fires.push(fz);
      }
    }
  }
  // Свет помещений и приглушение рассеянного света — для всех материалов мебели.
  const seen = new Set();
  for (const it of items) it.traverse((m) => {
    if (!m.isMesh || !m.material || seen.has(m.material)) return;
    seen.add(m.material);
    if (m.material.isMeshStandardMaterial && !m.material.userData.glass) {
      applyPointLights(m.material);
      interiorLight(m.material);
    }
  });
  return { items, fires };
}
const K_HEARTH_R = SRC.grill.hearth.r + 80;
