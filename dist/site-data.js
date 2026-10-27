// Данные участка для сцены (dist/data/site-spec.js из scripts/build-site.mjs): метры участка
// (X — восток, Z — юг), Y = H − datum; постройки в мм своих листов → координаты участка; рельеф по
// отметкам с планировкой у построек и спокойным фоном за забором. Модуль без Three.js и DOM —
// используется сценой, прогулкой и тестами Node.
import SITE from './data/site-spec.js';
import { terrainAt } from './site-terrain.js';
import { pointInPolygon, distToSegment } from './geometry.js';
import { fbm } from './terrain.js';

export { SITE };
export const DATUM = SITE.datum;
export const BUILDING = Object.fromEntries(SITE.buildings.map((b) => [b.id, b]));
export const SRC = SITE.sources;
const DEG = Math.PI / 180;

// Локальные мм листа постройки (x вправо, y вниз по листу) → метры участка.
export function placer(b) {
  const t = b.rotation * DEG;
  const c = Math.cos(t);
  const s = Math.sin(t);
  const [ox, oz] = b.origin;
  const f = (u, v) => [ox + (u / 1000) * c - (v / 1000) * s, oz + (u / 1000) * s + (v / 1000) * c];
  f.dirU = [c, s];
  f.dirV = [-s, c];
  f.theta = t;
  return f;
}

export const floorY = (id) => SITE.levels[id].floor - DATUM;
export const padY = (id) => SITE.levels[id].pad - DATUM;

const BND = SITE.boundary;
export function insideSite(x, z) {
  return pointInPolygon(x, z, BND);
}

function polyDist(x, z, poly) {
  if (pointInPolygon(x, z, poly)) return 0;
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    d = Math.min(d, distToSegment(x, z, a[0], a[1], b[0], b[1]).d);
  }
  return d;
}

function nearestOnBoundary(x, z) {
  let best = null;
  for (let i = 0; i < BND.length; i++) {
    const a = BND[i];
    const b = BND[(i + 1) % BND.length];
    const r = distToSegment(x, z, a[0], a[1], b[0], b[1]);
    if (!best || r.d < best.d) best = r;
  }
  return best;
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Площадки планировки: постройки — «пол − 0,25» (ровно 0,6 м от стен, переход до 2,5 м); пол навеса —
// на уровне планировки хоз.блока (дверь хоз.блока — ступень 0,25 с плитки).
export const PADS = [
  ...SITE.buildings.map((b) => ({ id: b.id, polys: b.footprint, h: SITE.levels[b.id].pad, flat: SITE.levels[b.id].grade.flat, blend: SITE.levels[b.id].grade.blend })),
  { id: 'carport', polys: [BUILDING.garage.carport.floor], h: SITE.levels.garage.pad, flat: 0.3, blend: 2.2 },
];

const BG = 24.32; // средняя отметка участка — фон за забором
// Естественный рельеф: сплайн внутри участка, за забором — значение у границы, переходящее в фон,
// дальше пологие холмы к лесу (горизонт).
export function naturalH(x, z) {
  if (insideSite(x, z)) return terrainAt(SITE.terrain, x, z);
  const nb = nearestOnBoundary(x, z);
  const hb = terrainAt(SITE.terrain, nb.cx, nb.cz);
  const k = smooth(1, 18, nb.d);
  const far = smooth(45, 140, nb.d);
  const hills = fbm(x * 0.012, z * 0.012) * 3.2 + fbm(x * 0.05 + 4, z * 0.05 - 2, 3) * 0.35;
  return hb + (BG - hb) * k + far * (hills + 0.8) + Math.max(0, nb.d - 140) * 0.015;
}

// Пруд: уровень воды — на 0,12 ниже самой низкой точки берега; дно — чаша до 0,65 м от уровня, у берега
// рельеф плавно спускается к воде (кромка воды — по окружности пруда с плана).
const POND = SITE.features.pond;
const POND_H = (() => {
  let m = Infinity;
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    m = Math.min(m, naturalH(POND.center[0] + Math.cos(a) * POND.r, POND.center[1] + Math.sin(a) * POND.r));
  }
  return m - 0.12;
})();
export const POND_LEVEL = POND_H - SITE.datum;
function pondShape(x, z, h) {
  const d = Math.hypot(x - POND.center[0], z - POND.center[1]);
  if (d >= POND.r + 0.7) return h;
  if (d < POND.r) return POND_H - 0.05 - 0.6 * smooth(POND.r - 0.1, POND.r - 1.4, d);
  return POND_H + 0.03 + (h - POND_H - 0.03) * smooth(POND.r, POND.r + 0.7, d);
}

export function groundH(x, z) {
  let h = pondShape(x, z, naturalH(x, z));
  for (const p of PADS) {
    const d = Math.min(...p.polys.map((poly) => polyDist(x, z, poly)));
    if (d >= p.blend) continue;
    const w = 1 - smooth(p.flat, p.blend, d);
    h += (p.h - h) * w;
  }
  return h;
}

export const groundY = (x, z) => groundH(x, z) - DATUM;

// Центр участка (для камеры и окружения) и его габарит.
const xs = BND.map((p) => p[0]);
const zs = BND.map((p) => p[1]);
export const SITE_BOX = { x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) };
export const SITE_CENTER = [(SITE_BOX.x0 + SITE_BOX.x1) / 2, (SITE_BOX.z0 + SITE_BOX.z1) / 2];
