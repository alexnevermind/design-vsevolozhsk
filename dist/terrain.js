// Рельеф участка: ровная площадка вокруг дома (отметка земли −0,70 м), за ней плавные холмы
// к лесу; поляна перед фасадом в сторону обзорной камеры остаётся открытой. Один источник высоты
// для сетки земли, деревьев, травы и кустов.
import { GROUND_Y } from './plan.js';

function hash2(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return (a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz) * 2 - 1;
}

export function fbm(x, z, octaves = 4) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < octaves; i++) {
    s += a * valueNoise(x * f + i * 17.3, z * f - i * 9.1);
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

const smooth = (e0, e1, x) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

// Центр участка и направление на обзорную камеру фасада.
export const SITE = { cx: 1.5, cz: 0, camAngle: Math.atan2(27, 20.5) };

// Расстояние от площадки дома (эллипс 26 × 22 м вокруг центра).
function siteDistance(x, z) {
  return Math.hypot((x - SITE.cx) / 1.18, z - SITE.cz);
}

export function terrainHeight(x, z) {
  const d = siteDistance(x, z);
  const k = smooth(22, 48, d);
  if (k <= 0) return GROUND_Y;
  const hills = fbm(x * 0.016, z * 0.016) * 2.2 + fbm(x * 0.05 + 4, z * 0.05 - 2, 3) * 0.45;
  const rise = Math.max(0, d - 48) * 0.012;
  return GROUND_Y + k * (hills + rise + 0.4);
}

// Поляна без деревьев: площадка дома и сектор перед фасадом до ~80 м.
export function insideMeadow(x, z) {
  const dx = x - SITE.cx;
  const dz = z - SITE.cz;
  const d = Math.hypot(dx, dz);
  if (d < 28) return true;
  let da = Math.atan2(dz, dx) - SITE.camAngle;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  const half = 0.75 - Math.min(0.35, d / 300);
  return Math.abs(da) < half && d < 82;
}
