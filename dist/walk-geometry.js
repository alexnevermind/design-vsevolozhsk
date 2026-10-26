// Модель прогулки на тех же данных плана: стены и окна — преграды, двери вращаются
// вокруг петли, раздвижная створка остекления сдвигается, мебель и встроенное оборудование — препятствия.
import { ITEM_TYPES, isWallItem } from './catalog.js';
import { SPEC, WALLS, OPENINGS, ROOMS, roomAt, wallPoint } from './plan.js';
import { obb, obbOverlap, circleObbPush, obbContainsPoint, subtractIntervals, pointInPolygon } from './geometry.js';
import { itemObb, BUILTIN_OBBS } from './house-core.js';

export const WALK = SPEC.walk;
export const LEAF_THICKNESS = SPEC.doors.leafThickness;
const FRAME = 0.03;

// Описание дверей прогулки: распашные (петля) и раздвижная часть остекления.
export const DOORS = OPENINGS.filter((o) => o.type === 'door' || o.type === 'entry' || o.type === 'glazing').map((o) => {
  const w = o.wall;
  if (o.type === 'glazing') {
    const half = (o.to - o.from) / 2;
    const closed = o.slidingPart === 'from' ? [o.from, o.from + half] : [o.to - half, o.to];
    const dir = o.slidingPart === 'from' ? 1 : -1;
    return { id: o.id, kind: 'sliding', opening: o, wall: w, closed, travel: half - 0.06, dir, max: 1 };
  }
  const hingeU = o.hinge === 'from' ? o.from + FRAME : o.to - FRAME;
  const s = o.hinge === 'from' ? 1 : -1;
  const width = o.to - o.from - 2 * FRAME;
  const swing = o.swing;
  // Ось петли — у грани стены со стороны открывания.
  const faceOff = w.t / 2 - LEAF_THICKNESS / 2 - 0.004;
  const [hx, hz] = wallPoint(w, hingeU, swing, faceOff);
  const maxDeg = o.type === 'entry' ? Math.abs(WALK.initialEntryAngle) : Math.abs(WALK.initialInteriorAngle);
  return {
    id: o.id, kind: 'hinged', opening: o, wall: w, hinge: [hx, hz], along: [w.ux * s, w.uz * s], normal: [w.nx * swing, w.nz * swing],
    width, max: maxDeg, glass: o.leaf === 'glass' || o.type === 'entry',
  };
});
export const DOOR_BY_ID = Object.fromEntries(DOORS.map((d) => [d.id, d]));

// Начальное положение: межкомнатные открыты на 90°, входная — на 80°, раздвижная створка закрыта.
export function initialDoorStates() {
  const s = {};
  for (const d of DOORS) s[d.id] = d.kind === 'sliding' ? 0 : d.max;
  return s;
}

// Створка распашной двери как повёрнутый прямоугольник (угол в градусах, 0 — закрыта).
export function leafObb(door, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = door.along[0] * Math.cos(a) + door.normal[0] * Math.sin(a);
  const dz = door.along[1] * Math.cos(a) + door.normal[1] * Math.sin(a);
  const cx = door.hinge[0] + dx * (door.width / 2);
  const cz = door.hinge[1] + dz * (door.width / 2);
  // Поворот: локальная X вдоль створки.
  const ry = Math.atan2(-dz, dx);
  return obb(cx, cz, door.width, LEAF_THICKNESS, ry);
}

// Раздвижная створка: сдвиг вдоль стены на долю open (0…1).
export function slidingObb(door, open) {
  const w = door.wall;
  const shift = door.dir * door.travel * open;
  const u0 = door.closed[0] + shift;
  const u1 = door.closed[1] + shift;
  // Подвижная створка идёт по наружной направляющей (сторона террасы).
  const outer = w.left === '008' ? 1 : -1;
  const [cx, cz] = wallPoint(w, (u0 + u1) / 2, outer, 0.03);
  return obb(cx, cz, u1 - u0, 0.05, Math.atan2(-w.uz, w.ux));
}

function wallObb(w, u0, u1) {
  const [cx, cz] = wallPoint(w, (u0 + u1) / 2);
  return obb(cx, cz, u1 - u0, w.t, Math.atan2(-w.uz, w.ux));
}

// Статические преграды: стены (окна непроходимы — подоконник), неподвижная часть остекления, встроенное.
function buildStatic() {
  const list = [];
  for (const w of WALLS) {
    const passable = w.openings.filter((o) => o.type === 'door' || o.type === 'entry' || o.type === 'glazing');
    const solid = subtractIntervals([[0, w.len]], passable.map((o) => [o.from, o.to]));
    for (const [u0, u1] of solid) list.push({ kind: 'wall', id: w.id, obb: wallObb(w, u0, u1) });
    for (const o of passable) {
      if (o.type === 'glazing') {
        const half = (o.to - o.from) / 2;
        const fixed = o.slidingPart === 'from' ? [o.to - half, o.to] : [o.from, o.from + half];
        list.push({ kind: 'glass', id: `${o.id}-fixed`, obb: wallObb(w, fixed[0], fixed[1]) });
      }
    }
  }
  for (const b of BUILTIN_OBBS) {
    // Полки парной и вешалка — преграды; печь — тоже.
    list.push({ kind: 'builtin', id: b.id, obb: b.obb });
  }
  // Открытые края террасы: человек остаётся на настиле.
  const t = SPEC.house.terrace;
  const wingX = SPEC.house.wingEndX;
  const e = 0.2;
  list.push({ kind: 'edge', id: 'terrace-east', obb: obb(t.x1 + e / 2, 0, e, t.z1 - t.z0 + 2 * e, 0) });
  list.push({ kind: 'edge', id: 'terrace-north', obb: obb((wingX + t.x1) / 2, t.z0 - e / 2, t.x1 - wingX + e, e, 0) });
  list.push({ kind: 'edge', id: 'terrace-south', obb: obb((wingX + t.x1) / 2, t.z1 + e / 2, t.x1 - wingX + e, e, 0) });
  return list;
}
export const STATIC_OBSTACLES = buildStatic();

// Проёмы, через которые можно пройти (порог между помещениями).
const THRESHOLDS = DOORS.map((d) => {
  const o = d.opening;
  const range = d.kind === 'sliding' ? d.closed : [o.from, o.to];
  return { id: d.id, door: d, obb: wallObb(o.wall, range[0], range[1]) };
});

export class WalkWorld {
  constructor(items = [], doorStates = initialDoorStates()) {
    this.doorStates = { ...doorStates };
    this.setItems(items);
  }

  setItems(items) {
    this.itemObstacles = [];
    for (const it of items) {
      const t = ITEM_TYPES[it.type];
      if (!t) continue;
      if (isWallItem(it.type) && it.y > WALK.personHeight) continue;
      this.itemObstacles.push({ kind: 'item', id: it.id, obb: itemObb(it) });
    }
  }

  doorObstacles() {
    const list = [];
    for (const d of DOORS) {
      const v = this.doorStates[d.id] ?? 0;
      list.push({ kind: 'door', id: d.id, obb: d.kind === 'sliding' ? slidingObb(d, v) : leafObb(d, v) });
    }
    return list;
  }

  obstacles() {
    return [...STATIC_OBSTACLES, ...this.itemObstacles, ...this.doorObstacles()];
  }

  // Центр должен быть на полу помещения/террасы или в пороге проёма.
  walkable(x, z) {
    if (roomAt(x, z)) return true;
    return THRESHOLDS.some((t) => obbContainsPoint(t.obb, x, z, 0.001));
  }

  collides(x, z, r = WALK.radius) {
    for (const o of this.obstacles()) if (circleObbPush(x, z, r, o.obb).hit) return o;
    return null;
  }

  // Перемещение с шагами не более 4 см и скольжением вдоль преград.
  move(pos, dx, dz) {
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-9) return { x: pos.x, z: pos.z, blocked: false };
    const n = Math.max(1, Math.ceil(dist / WALK.maxStep));
    const sx = dx / n;
    const sz = dz / n;
    let x = pos.x;
    let z = pos.z;
    let blocked = false;
    const obs = this.obstacles();
    for (let i = 0; i < n; i++) {
      let nx = x + sx;
      let nz = z + sz;
      for (let iter = 0; iter < 4; iter++) {
        let pushed = false;
        for (const o of obs) {
          const p = circleObbPush(nx, nz, WALK.radius, o.obb);
          if (p.hit) {
            nx += p.nx * (p.depth + 1e-4);
            nz += p.nz * (p.depth + 1e-4);
            pushed = true;
            blocked = true;
          }
        }
        if (!pushed) break;
      }
      // Шаг не должен уводить дальше, чем запрошено (защита от «выстреливания»).
      const moved = Math.hypot(nx - x, nz - z);
      const limit = WALK.maxStep * 1.5;
      if (moved > limit) {
        nx = x + ((nx - x) / moved) * limit;
        nz = z + ((nz - z) / moved) * limit;
      }
      if (!this.walkable(nx, nz) || this.collides(nx, nz, WALK.radius - 0.002)) {
        blocked = true;
        // Скольжение по осям.
        if (this.walkable(x + sx, z) && !this.collides(x + sx, z, WALK.radius - 0.002)) { nx = x + sx; nz = z; } else if (this.walkable(x, z + sz) && !this.collides(x, z + sz, WALK.radius - 0.002)) { nx = x; nz = z + sz; } else { nx = x; nz = z; }
      }
      x = nx;
      z = nz;
    }
    return { x, z, blocked };
  }

  // Ближайшая безопасная точка (спираль) — для старта и предпросмотра потолка.
  safeSpot(x, z, roomId = null) {
    const ok = (px, pz) => this.walkable(px, pz) && !this.collides(px, pz) && (!roomId || roomAt(px, pz)?.id === roomId);
    if (ok(x, z)) return { x, z };
    for (let r = 0.05; r <= 4; r += 0.05) {
      const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.05));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (ok(px, pz)) return { x: px, z: pz };
      }
    }
    return null;
  }

  // Ближайшая дверь в пределах досягаемости с учётом направления взгляда.
  nearestDoor(x, z, fx, fz) {
    let best = null;
    for (const d of DOORS) {
      const o = d.opening;
      const range = d.kind === 'sliding' ? d.closed : [o.from, o.to];
      const [cx, cz] = wallPoint(o.wall, (range[0] + range[1]) / 2);
      const dx = cx - x;
      const dz = cz - z;
      const dist = Math.hypot(dx, dz);
      if (dist > WALK.doorReach) continue;
      const cos = dist > 1e-6 ? (dx * fx + dz * fz) / dist : 1;
      if (dist > 0.75 && cos < 0.35) continue;
      const score = dist - cos * 0.6;
      if (!best || score < best.score) best = { door: d, dist, score };
    }
    return best?.door || null;
  }

  // Можно ли поставить створку в положение value без пересечения с человеком.
  doorBlockedBy(door, value, x, z) {
    const o = door.kind === 'sliding' ? slidingObb(door, value) : leafObb(door, value);
    return circleObbPush(x, z, WALK.radius, o).hit;
  }

  // Анимация створки к цели: останавливается, не задевая человека.
  stepDoor(id, target, dt, person) {
    const d = DOOR_BY_ID[id];
    const cur = this.doorStates[id] ?? 0;
    const speed = d.kind === 'sliding' ? 1.4 : 140; // доля/с или град/с
    const delta = target - cur;
    if (Math.abs(delta) < 1e-6) return { done: true, value: cur };
    const step = Math.sign(delta) * Math.min(Math.abs(delta), speed * dt);
    const next = cur + step;
    if (person && this.doorBlockedBy(d, next, person.x, person.z)) return { done: true, value: cur, blocked: true };
    this.doorStates[id] = next;
    return { done: Math.abs(target - next) < 1e-6, value: next };
  }
}

// Помещение человека (на пороге — ближайшее по направлению).
export function roomOfPoint(x, z) {
  return roomAt(x, z);
}

export function startPose() {
  return { x: WALK.start.x, z: WALK.start.z, yaw: WALK.start.yaw, pitch: 0 };
}

export function roomCenterPose(roomId) {
  const r = ROOMS.find((q) => q.id === roomId);
  if (!r) return startPose();
  return { x: r.center[0], z: r.center[1], yaw: WALK.start.yaw, pitch: 0 };
}

export { obbOverlap, pointInPolygon };
