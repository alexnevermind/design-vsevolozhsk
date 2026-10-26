// Геометрическая допустимость размещения: напольные и настенные предметы, двери, окна,
// зоны доступа и симметричная проверка телевизора. Работает только с данными состояния.
import { ITEM_TYPES, isTall, isWallItem, roomAllowsType } from './catalog.js';
import {
  ROOMS, ROOM_BY_ID, WALLS, WALL_BY_ID, OPENINGS, SPEC, roomAt, faceRange, wallPoint, ceilingHeight, roomOfWallSide,
} from './plan.js';
import { obb, obbCorners, obbOverlap, pointInPolygonTol, rectToObb } from './geometry.js';

export const TV_MOUNT_GAP = 0.03; // кронштейн между стеной и задней панелью
const WINDOW_ZONE_DEPTH = 0.3;
const TV_FRONT_ZONE = 0.35;
const PASSAGE_DEPTH = 0.5;
const SLIDE_PASSAGE = 0.7;

export function itemObb(item) {
  const t = ITEM_TYPES[item.type];
  if (isWallItem(item.type)) {
    const p = wallItemPose(item);
    return obb(p.x, p.z, t.w, t.d + TV_MOUNT_GAP, p.ry);
  }
  return obb(item.x, item.z, t.w, t.d, item.ry);
}

// Поворот, при котором локальная +Z (перед) совпадает с нормалью грани в помещение.
export function facingRy(nx, nz) {
  return Math.atan2(nx, nz);
}

// Положение настенного предмета: начало стены + направление × u + нормаль × смещение.
export function wallItemPose(item) {
  const w = WALL_BY_ID[item.wall];
  const t = ITEM_TYPES[item.type];
  const off = w.t / 2 + TV_MOUNT_GAP + t.d / 2;
  const [x, z] = wallPoint(w, item.u, item.side, off);
  return { x, z, ry: facingRy(w.nx * item.side, w.nz * item.side), y: item.y, wall: w };
}

// Зоны прохода у дверей (по обе стороны) и полоса перед окнами.
function buildZones() {
  const doors = [];
  const windows = [];
  for (const o of OPENINGS) {
    const w = o.wall;
    for (const side of [1, -1]) {
      const roomId = roomOfWallSide(w, side);
      if (!roomId) continue;
      const nx = w.nx * side;
      const nz = w.nz * side;
      const face = w.t / 2;
      const mk = (u0, u1, depth) => {
        const um = (u0 + u1) / 2;
        const [cx, cz] = wallPoint(w, um, side, face + depth / 2);
        return obb(cx, cz, u1 - u0, depth, facingRy(nx, nz));
      };
      if (o.type === 'door' || o.type === 'entry') {
        const width = o.to - o.from;
        const depth = o.swing === side ? width : PASSAGE_DEPTH;
        doors.push({ id: o.id, room: roomId, obb: mk(o.from, o.to, depth) });
      } else if (o.type === 'glazing') {
        const half = (o.to - o.from) / 2;
        const [s0, s1] = o.slidingPart === 'from' ? [o.from, o.from + half] : [o.to - half, o.to];
        doors.push({ id: o.id, room: roomId, obb: mk(s0, s1, SLIDE_PASSAGE) });
        windows.push({ id: o.id, room: roomId, low: 0, obb: mk(o.from - 0.02, o.to + 0.02, WINDOW_ZONE_DEPTH) });
      } else if (o.type === 'window') {
        windows.push({ id: o.id, room: roomId, low: o.low, obb: mk(o.from - 0.02, o.to + 0.02, WINDOW_ZONE_DEPTH) });
      }
    }
  }
  return { doors, windows };
}
export const ZONES = buildZones();

export const BUILTIN_OBBS = SPEC.builtins.map((b) => ({ id: b.id, room: b.room, label: b.label, obb: rectToObb(b.rect) }));

// Зона доступа перед шкафом (глубина access по локальной +Z).
export function accessObb(item) {
  const t = ITEM_TYPES[item.type];
  if (!t?.access) return null;
  const s = Math.sin(item.ry);
  const c = Math.cos(item.ry);
  const off = t.d / 2 + t.access / 2;
  return obb(item.x + s * off, item.z + c * off, t.w, t.access, item.ry);
}

function fail(code, reason, extra = {}) {
  return { ok: false, code, reason, ...extra };
}

function insideRoom(o, room) {
  return obbCorners(o).every(([x, z]) => pointInPolygonTol(x, z, room.polygon, 0.003));
}

// Расстояние от прямоугольника до линии грани стены и перекрытие по u.
function tvConflictsFloor(tv, floorItem) {
  const t = ITEM_TYPES[floorItem.type];
  if (t.h <= tv.y + 0.01) return false;
  const w = WALL_BY_ID[tv.wall];
  const tvT = ITEM_TYPES[tv.type];
  const corners = obbCorners(itemObb(floorItem));
  const facePt = wallPoint(w, 0, tv.side, w.t / 2);
  const n = [w.nx * tv.side, w.nz * tv.side];
  let minDist = Infinity;
  let uMin = Infinity;
  let uMax = -Infinity;
  for (const [x, z] of corners) {
    const dx = x - facePt[0];
    const dz = z - facePt[1];
    minDist = Math.min(minDist, dx * n[0] + dz * n[1]);
    const u = dx * w.ux + dz * w.uz;
    uMin = Math.min(uMin, u);
    uMax = Math.max(uMax, u);
  }
  if (minDist > TV_FRONT_ZONE || minDist < -0.01) return false;
  return uMax > tv.u - tvT.w / 2 + 0.005 && uMin < tv.u + tvT.w / 2 - 0.005;
}

// Проверка положения напольного предмета. cand: {id?, type, x, z, ry}.
export function checkFloorPlacement(items, cand) {
  const t = ITEM_TYPES[cand.type];
  if (!t) return fail('type', 'Неизвестный тип предмета');
  if (![cand.x, cand.z, cand.ry].every(Number.isFinite)) return fail('nan', 'Некорректные координаты');
  const room = roomAt(cand.x, cand.z);
  if (!room) return fail('outside', 'Вне помещений дома и террасы');
  if (room.kind === 'entry') return fail('entry', 'Прихожая — входная зона и остаётся свободной', { room: room.id });
  if (room.kind === 'sauna') return fail('sauna', 'В парной только встроенные полки и печь', { room: room.id });
  if (!roomAllowsType(room, cand.type)) return fail('room-type', `${t.short} не ставится в помещение «${room.name}»`, { room: room.id });
  const o = obb(cand.x, cand.z, t.w, t.d, cand.ry);
  if (!insideRoom(o, room)) return fail('wall', 'Пересекает стену или выходит за контур помещения', { room: room.id });
  for (const z of ZONES.doors) {
    if (obbOverlap(o, z.obb) > 0) return fail('door', 'Перекрывает дверной проход', { room: room.id });
  }
  if (isTall(cand.type)) {
    for (const z of ZONES.windows) {
      if (t.h > z.low + 0.02 && obbOverlap(o, z.obb) > 0) return fail('window', 'Высокий предмет закрывает окно', { room: room.id });
    }
  }
  for (const b of BUILTIN_OBBS) {
    if (obbOverlap(o, b.obb) > 0) return fail('builtin', `Пересекает: ${b.label}`, { room: room.id });
  }
  const acc = accessObb(cand);
  if (acc) {
    if (!insideRoom(acc, room)) return fail('access', 'Перед шкафом нужен проход 0,6 м', { room: room.id });
    for (const z of ZONES.doors) if (obbOverlap(acc, z.obb) > 0.02) return fail('access', 'Дверца шкафа упирается в дверной проход', { room: room.id });
  }
  for (const other of items) {
    if (other.id === cand.id) continue;
    const ot = ITEM_TYPES[other.type];
    if (isWallItem(other.type)) {
      if (tvConflictsFloor(other, cand)) return fail('tv', `Высота предмета пересекает ${ot.short.toLowerCase()}`, { room: room.id });
      continue;
    }
    const oo = obb(other.x, other.z, ot.w, ot.d, other.ry);
    if (obbOverlap(o, oo) > 0) return fail('item', `Пересекает: ${ot.short.toLowerCase()}`, { room: room.id });
    if (acc && obbOverlap(acc, oo) > 0) return fail('access', `Перед шкафом стоит ${ot.short.toLowerCase()}`, { room: room.id });
    const oacc = accessObb(other);
    if (oacc && obbOverlap(o, oacc) > 0) return fail('access', 'Загораживает доступ к шкафу', { room: room.id });
  }
  return { ok: true, room: room.id };
}

// Проверка настенного предмета. cand: {id?, type, wall, side, u, y}.
export function checkWallPlacement(items, cand) {
  const t = ITEM_TYPES[cand.type];
  const w = WALL_BY_ID[cand.wall];
  if (!t || !w) return fail('type', 'Неизвестная стена или тип');
  if (![cand.u, cand.y].every(Number.isFinite) || (cand.side !== 1 && cand.side !== -1)) return fail('nan', 'Некорректные координаты');
  const roomId = roomOfWallSide(w, cand.side);
  const room = ROOM_BY_ID[roomId];
  if (!room) return fail('exterior', 'Наружная грань не является местом крепления');
  if (room.kind !== 'room') {
    const msg = room.kind === 'terrace' ? 'Терраса не является местом крепления' : `В помещении «${room.name}» телевизор не крепится`;
    return fail('room-type', msg, { room: room.id });
  }
  const range = faceRange(w, cand.side);
  const u0 = cand.u - t.w / 2;
  const u1 = cand.u + t.w / 2;
  if (!range || u0 < range[0] + 0.02 || u1 > range[1] - 0.02) return fail('range', 'Выходит за пределы стены помещения', { room: room.id });
  const [xa, za] = wallPoint(w, u0, cand.side, w.t / 2);
  const [xb, zb] = wallPoint(w, u1, cand.side, w.t / 2);
  const top = Math.min(ceilingHeight(za), ceilingHeight(zb)) - 0.03;
  if (cand.y < 0.15) return fail('height', 'Слишком низко над полом', { room: room.id });
  if (cand.y + t.h > top) return fail('height', 'Упирается в потолок', { room: room.id });
  for (const o of w.openings) {
    if (u1 > o.from - 0.03 && u0 < o.to + 0.03 && cand.y < o.high + 0.03 && cand.y + t.h > o.low - 0.03) {
      return fail('opening', 'Пересекает проём', { room: room.id });
    }
  }
  for (const other of items) {
    if (other.id === cand.id) continue;
    if (isWallItem(other.type)) {
      if (other.wall !== cand.wall || other.side !== cand.side) continue;
      const ot = ITEM_TYPES[other.type];
      if (u1 > other.u - ot.w / 2 && u0 < other.u + ot.w / 2 && cand.y < other.y + ot.h && cand.y + t.h > other.y) {
        return fail('item', `Пересекает: ${ot.short.toLowerCase()}`, { room: room.id });
      }
    } else if (tvConflictsFloor(cand, other)) {
      return fail('tall', `Место занимает ${ITEM_TYPES[other.type].short.toLowerCase()}`, { room: room.id });
    }
  }
  return { ok: true, room: room.id };
}

export function checkPlacement(items, cand) {
  return isWallItem(cand.type) ? checkWallPlacement(items, cand) : checkFloorPlacement(items, cand);
}

// Проверка всей расстановки (для загрузки, тестов и миграции).
export function validateLayout(items) {
  const problems = [];
  for (const it of items) {
    const r = checkPlacement(items, it);
    if (!r.ok) problems.push({ id: it.id, type: it.type, code: r.code, reason: r.reason });
  }
  return problems;
}

export { ROOMS, WALLS };
