// Логические плоскости стен для настенных предметов (телевизор): наведение лучом,
// перенос по стене и по высоте, выбор места при клике по карточке.
import { ITEM_TYPES } from './catalog.js';
import { WALLS, WALL_BY_ID, ROOM_BY_ID, roomOfWallSide, faceRange, wallPoint, ceilingHeight } from './plan.js';
import { checkWallPlacement } from './house-core.js';
import { snapTo } from './geometry.js';

export const WALL_GRID = 0.025;

// Грани, на которые допускается крепление (жилые помещения, внутренняя сторона).
export const MOUNT_FACES = WALLS.flatMap((w) => [1, -1].map((side) => {
  const room = ROOM_BY_ID[roomOfWallSide(w, side)];
  if (!room || room.kind !== 'room') return null;
  const range = faceRange(w, side);
  if (!range) return null;
  return { wall: w, side, room: room.id, range };
}).filter(Boolean));

// Пересечение луча с математической плоскостью грани (даже если верх стены скрыт разрезом).
export function hitMountFace(origin, dir, opts = {}) {
  let best = null;
  for (const f of opts.faces || MOUNT_FACES) {
    const w = f.wall;
    const nx = w.nx * f.side;
    const nz = w.nz * f.side;
    const denom = dir[0] * nx + dir[2] * nz;
    if (denom >= -1e-4) continue; // грань должна смотреть на камеру
    const [px, pz] = wallPoint(w, 0, f.side, w.t / 2);
    const tHit = ((px - origin[0]) * nx + (pz - origin[2]) * nz) / denom;
    if (tHit <= 0.05 || tHit > 80) continue;
    const hx = origin[0] + dir[0] * tHit;
    const hy = origin[1] + dir[1] * tHit;
    const hz = origin[2] + dir[2] * tHit;
    const u = (hx - w.a[0]) * w.ux + (hz - w.a[1]) * w.uz;
    if (u < f.range[0] - 0.05 || u > f.range[1] + 0.05) continue;
    if (hy < -0.05 || hy > ceilingHeight(hz) + 0.05) continue;
    if (!best || tHit < best.t) best = { t: tHit, wall: w.id, side: f.side, room: f.room, u, y: hy, point: [hx, hy, hz] };
  }
  return best;
}

// Перевод точки наведения в положение предмета (u — центр, y — нижняя кромка) с захватом.
export function wallPoseFromHit(type, hit, grab = { du: 0, dy: 0 }) {
  const t = ITEM_TYPES[type];
  const f = MOUNT_FACES.find((m) => m.wall.id === hit.wall && m.side === hit.side);
  const lo = f.range[0] + t.w / 2 + 0.03;
  const hi = f.range[1] - t.w / 2 - 0.03;
  const u = Math.min(hi, Math.max(lo, snapTo(hit.u + grab.du, WALL_GRID)));
  const y = snapTo(hit.y + grab.dy, WALL_GRID);
  return { wall: hit.wall, side: hit.side, u, y, room: f.room };
}

// Поиск допустимого места рядом с желаемым (по стене ±0,4 м и по высоте ±0,3 м).
export function nearestValidWallPose(items, cand) {
  const r0 = checkWallPlacement(items, cand);
  if (r0.ok) return { ...cand, ...r0 };
  const opts = [];
  for (let i = -16; i <= 16; i++) {
    for (let j = -12; j <= 12; j++) {
      if (!i && !j) continue;
      opts.push({ du: i * WALL_GRID, dy: j * WALL_GRID, d: Math.hypot(i, j * 1.5) });
    }
  }
  opts.sort((a, b) => a.d - b.d);
  for (const o of opts) {
    const c = { ...cand, u: cand.u + o.du, y: cand.y + o.dy };
    const r = checkWallPlacement(items, c);
    if (r.ok) return { ...c, ...r };
  }
  return { ...cand, ...r0 };
}

// Место для нового телевизора в помещении: допустимый участок ближе к центру помещения.
export function defaultWallSpot(items, type, roomId) {
  const room = ROOM_BY_ID[roomId];
  if (!room || room.kind !== 'room') return null;
  const t = ITEM_TYPES[type];
  const y = t.defaultY ?? 1.05;
  let best = null;
  for (const f of MOUNT_FACES.filter((m) => m.room === roomId)) {
    for (let u = f.range[0] + t.w / 2 + 0.05; u <= f.range[1] - t.w / 2 - 0.05 + 1e-9; u += 0.05) {
      const cand = { id: -1, type, wall: f.wall.id, side: f.side, u: snapTo(u, WALL_GRID), y };
      if (!checkWallPlacement(items, cand).ok) continue;
      const [x, z] = wallPoint(f.wall, cand.u, f.side, f.wall.t / 2);
      // Предпочтение: ближе к центру помещения, затем более длинные стены.
      const score = Math.hypot(x - room.center[0], z - room.center[1]) - 0.15 * (f.range[1] - f.range[0]);
      if (!best || score < best.score) best = { ...cand, room: roomId, score };
    }
  }
  if (!best) return null;
  delete best.score;
  return best;
}

export function wallItemWorld(item) {
  const w = WALL_BY_ID[item.wall];
  const [x, z] = wallPoint(w, item.u, item.side, w.t / 2);
  return { x, z, nx: w.nx * item.side, nz: w.nz * item.side };
}
