// Чистая 2D-геометрия плана (X, Z в метрах): полигоны, повёрнутые прямоугольники, интервалы.
// Модуль не зависит от Three.js и DOM — используется браузером и тестами Node.

export const EPS = 1e-6;

export function polygonArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, z1] = poly[i];
    const [x2, z2] = poly[(i + 1) % poly.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

export function pointInPolygon(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

// Расстояние от точки до отрезка.
export function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + dx * t;
  const cz = az + dz * t;
  return { d: Math.hypot(px - cx, pz - cz), cx, cz, t };
}

// Точка внутри полигона с допуском: внутри либо ближе eps к границе.
export function pointInPolygonTol(x, z, poly, tol = 0.002) {
  if (pointInPolygon(x, z, poly)) return true;
  for (let i = 0; i < poly.length; i++) {
    const [ax, az] = poly[i];
    const [bx, bz] = poly[(i + 1) % poly.length];
    if (distToSegment(x, z, ax, az, bx, bz).d <= tol) return true;
  }
  return false;
}

// Повёрнутый прямоугольник: центр, полуразмеры по локальным осям, угол поворота ry (как у Object3D.rotation.y).
// Локальная +X → мир (cos, −sin), локальная +Z → мир (sin, cos).
export function obb(cx, cz, w, d, ry) {
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  return { cx, cz, hw: w / 2, hd: d / 2, ax: [c, -s], az: [s, c] };
}

export function obbCorners(o) {
  const { cx, cz, hw, hd, ax, az } = o;
  return [
    [cx - ax[0] * hw - az[0] * hd, cz - ax[1] * hw - az[1] * hd],
    [cx + ax[0] * hw - az[0] * hd, cz + ax[1] * hw - az[1] * hd],
    [cx + ax[0] * hw + az[0] * hd, cz + ax[1] * hw + az[1] * hd],
    [cx - ax[0] * hw + az[0] * hd, cz - ax[1] * hw + az[1] * hd],
  ];
}

export function rectToObb([x0, z0, x1, z1]) {
  return obb((x0 + x1) / 2, (z0 + z1) / 2, x1 - x0, z1 - z0, 0);
}

function project(corners, axis) {
  let min = Infinity;
  let max = -Infinity;
  for (const [x, z] of corners) {
    const p = x * axis[0] + z * axis[1];
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return [min, max];
}

// Метод разделяющих осей. Возвращает глубину проникновения (>0 — пересечение), касание не считается.
export function obbOverlap(a, b, tol = 0.001) {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  let minDepth = Infinity;
  for (const axis of [a.ax, a.az, b.ax, b.az]) {
    const [a0, a1] = project(ca, axis);
    const [b0, b1] = project(cb, axis);
    const depth = Math.min(a1, b1) - Math.max(a0, b0);
    if (depth <= tol) return 0;
    minDepth = Math.min(minDepth, depth);
  }
  return minDepth;
}

// Ближайшая точка прямоугольника к окружности: выталкивание окружности радиуса r из OBB.
export function circleObbPush(px, pz, r, o) {
  const dx = px - o.cx;
  const dz = pz - o.cz;
  const lx = dx * o.ax[0] + dz * o.ax[1];
  const lz = dx * o.az[0] + dz * o.az[1];
  const qx = Math.max(-o.hw, Math.min(o.hw, lx));
  const qz = Math.max(-o.hd, Math.min(o.hd, lz));
  const inside = qx === lx && qz === lz;
  if (inside) {
    // Центр внутри: выталкиваем по ближайшей грани.
    const ex = o.hw - Math.abs(lx);
    const ez = o.hd - Math.abs(lz);
    let nlx = 0;
    let nlz = 0;
    let depth;
    if (ex < ez) { nlx = Math.sign(lx) || 1; depth = ex + r; } else { nlz = Math.sign(lz) || 1; depth = ez + r; }
    const nx = nlx * o.ax[0] + nlz * o.az[0];
    const nz = nlx * o.ax[1] + nlz * o.az[1];
    return { hit: true, nx, nz, depth };
  }
  const ddx = lx - qx;
  const ddz = lz - qz;
  const dist = Math.hypot(ddx, ddz);
  if (dist >= r) return { hit: false };
  const nlx = ddx / dist;
  const nlz = ddz / dist;
  return {
    hit: true,
    nx: nlx * o.ax[0] + nlz * o.az[0],
    nz: nlx * o.ax[1] + nlz * o.az[1],
    depth: r - dist,
  };
}

export function obbContainsPoint(o, x, z, tol = 0) {
  const dx = x - o.cx;
  const dz = z - o.cz;
  const lx = dx * o.ax[0] + dz * o.ax[1];
  const lz = dx * o.az[0] + dz * o.az[1];
  return Math.abs(lx) <= o.hw + tol && Math.abs(lz) <= o.hd + tol;
}

// Интервалы [a, b] на прямой.
export function subtractIntervals(base, cuts) {
  let out = base.map((i) => [...i]);
  for (const [c0, c1] of cuts) {
    const next = [];
    for (const [a, b] of out) {
      if (c1 <= a || c0 >= b) { next.push([a, b]); continue; }
      if (c0 > a) next.push([a, c0]);
      if (c1 < b) next.push([c1, b]);
    }
    out = next;
  }
  return out.filter(([a, b]) => b - a > EPS);
}

export function mergeIntervals(list, gap = 1e-4) {
  const s = [...list].sort((p, q) => p[0] - q[0]);
  const out = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function snapTo(v, step) {
  return Math.round(v / step) * step;
}

export function normAngle(a) {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r <= -Math.PI) r += Math.PI * 2;
  return r;
}

// Детерминированный генератор псевдослучайных чисел (mulberry32).
export function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Хеш строки → 32-битное целое для воспроизводимых вариаций.
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Разбиение ортогонального полигона на прямоугольники горизонтальными полосами.
export function orthoPolygonToRects(poly) {
  const zs = [...new Set(poly.map((p) => p[1]))].sort((a, b) => a - b);
  const rects = [];
  for (let i = 0; i < zs.length - 1; i++) {
    const z0 = zs[i];
    const z1 = zs[i + 1];
    const zm = (z0 + z1) / 2;
    // Пересечения горизонтали zm с вертикальными рёбрами.
    const xs = [];
    for (let k = 0; k < poly.length; k++) {
      const [ax, az] = poly[k];
      const [bx, bz] = poly[(k + 1) % poly.length];
      if (ax === bx && (az - zm) * (bz - zm) < 0) xs.push(ax);
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) rects.push([xs[k], z0, xs[k + 1], z1]);
  }
  // Слить соседние полосы с одинаковыми X.
  const merged = [];
  for (const r of rects) {
    const m = merged.find((q) => Math.abs(q[0] - r[0]) < EPS && Math.abs(q[2] - r[2]) < EPS && Math.abs(q[3] - r[1]) < EPS);
    if (m) m[3] = r[3];
    else merged.push([...r]);
  }
  return merged;
}

export function rectIntersect(a, b) {
  const x0 = Math.max(a[0], b[0]);
  const z0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[2], b[2]);
  const z1 = Math.min(a[3], b[3]);
  return x1 > x0 + EPS && z1 > z0 + EPS ? [x0, z0, x1, z1] : null;
}
