// Пристенная привязка, стыковка кухонных модулей, сетка 5 см и поиск ближайшего свободного места.
import { ITEM_TYPES, KITCHEN_DOCK_GAP, isWallItem } from './catalog.js';
import { WALLS, ROOM_BY_ID, roomAt, roomOfWallSide, faceRange } from './plan.js';
import { checkFloorPlacement, facingRy } from './house-core.js';
import { snapTo, normAngle } from './geometry.js';

export const GRID = 0.05;
export const SEARCH_RADIUS = 0.2;
const ALIGN_DISTANCE = 0.25;

// Линии граней: стены одной линии, обращённые в одно помещение, объединены (общая протяжённость).
function buildFaceLines() {
  const map = new Map();
  for (const w of WALLS) {
    for (const side of [1, -1]) {
      const roomId = roomOfWallSide(w, side);
      if (!roomId) continue;
      const range = faceRange(w, side);
      if (!range) continue;
      const nx = w.nx * side;
      const nz = w.nz * side;
      // Координата плоскости грани поперёк линии и интервал вдоль неё в мировых координатах.
      const faceCoord = w.horizontal ? w.a[1] + nz * (w.t / 2) : w.a[0] + nx * (w.t / 2);
      const along0 = w.horizontal ? w.a[0] + range[0] : w.a[1] + range[0];
      const along1 = w.horizontal ? w.a[0] + range[1] : w.a[1] + range[1];
      const key = `${roomId}|${w.horizontal ? 'h' : 'v'}|${nx.toFixed(0)}${nz.toFixed(0)}|${faceCoord.toFixed(4)}`;
      if (!map.has(key)) map.set(key, { room: roomId, horizontal: w.horizontal, nx, nz, faceCoord, parts: [] });
      map.get(key).parts.push({ wall: w, side, along: [along0, along1] });
    }
  }
  for (const line of map.values()) {
    line.parts.sort((p, q) => p.along[0] - q.along[0]);
    line.along = [Math.min(...line.parts.map((p) => p.along[0])), Math.max(...line.parts.map((p) => p.along[1]))];
  }
  return [...map.values()];
}
export const FACE_LINES = buildFaceLines();

export function faceLinesOfRoom(roomId) {
  return FACE_LINES.filter((l) => l.room === roomId);
}

function lineFrame(line) {
  // along — ось вдоль линии (X для горизонтальных, Z для вертикальных).
  return line.horizontal ? { along: [1, 0], across: [0, 1] } : { along: [0, 1], across: [1, 0] };
}

// Точка на линии грани и положение центра предмета, прижатого задней гранью.
export function backSnapPose(line, alongCoord, type) {
  const t = ITEM_TYPES[type];
  const ry = facingRy(line.nx, line.nz);
  const c = line.faceCoord + (line.horizontal ? line.nz : line.nx) * (t.d / 2);
  const x = line.horizontal ? alongCoord : c;
  const z = line.horizontal ? c : alongCoord;
  return { x, z, ry };
}

export function anchorFor(line, alongCoord) {
  const part = line.parts.find((p) => alongCoord >= p.along[0] - 1e-6 && alongCoord <= p.along[1] + 1e-6) || line.parts[0];
  return { wall: part.wall.id, side: part.side };
}

function alongOf(line, x, z) {
  return line.horizontal ? x : z;
}

function distToLine(line, x, z) {
  return Math.abs((line.horizontal ? z : x) - line.faceCoord);
}

function sameRy(a, b) {
  return Math.abs(normAngle(a - b)) < 1e-3;
}

// Ближайшее допустимое положение в радиусе поиска (спираль по сетке).
function searchNearby(items, cand, roomId, constrainAlong = null) {
  const r0 = checkFloorPlacement(items, cand);
  if (r0.ok && (!roomId || r0.room === roomId)) return { ...cand, ...r0 };
  const steps = Math.round(SEARCH_RADIUS / GRID);
  const options = [];
  for (let i = -steps; i <= steps; i++) {
    for (let j = -steps; j <= steps; j++) {
      if (constrainAlong && j !== 0) continue;
      if (i === 0 && j === 0) continue;
      let dx;
      let dz;
      if (constrainAlong) {
        dx = constrainAlong[0] * i * GRID;
        dz = constrainAlong[1] * i * GRID;
      } else {
        dx = i * GRID;
        dz = j * GRID;
      }
      const d = Math.hypot(dx, dz);
      if (d > SEARCH_RADIUS + 1e-9) continue;
      options.push({ dx, dz, d });
    }
  }
  options.sort((p, q) => p.d - q.d);
  for (const o of options) {
    const c = { ...cand, x: cand.x + o.dx, z: cand.z + o.dz };
    const r = checkFloorPlacement(items, c);
    if (r.ok && (!roomId || r.room === roomId)) return { ...c, ...r };
  }
  return { ...cand, ...r0, ok: false };
}

// Главная функция переноса: желаемый центр (px, pz) с учётом точки захвата и текущий угол.
export function placeFloorItem(items, item, px, pz, ry, opts = {}) {
  const t = ITEM_TYPES[item.type];
  const room = roomAt(px, pz);
  const roomId = room?.id || null;
  const base = { id: item.id, type: item.type, ry, mats: item.mats || {} };

  if (!room) {
    const c = { ...base, x: snapTo(px, GRID), z: snapTo(pz, GRID) };
    return { ...c, ...checkFloorPlacement(items, c), anchor: undefined };
  }

  if (t.snap === 'back') {
    const lines = faceLinesOfRoom(roomId)
      .filter((l) => {
        const a = alongOf(l, px, pz);
        return a >= l.along[0] - 0.3 && a <= l.along[1] + 0.3;
      })
      .sort((p, q) => distToLine(p, px, pz) - distToLine(q, px, pz));
    let fallback = null;
    for (const line of lines.slice(0, 4)) {
      const fr = lineFrame(line);
      const desired = alongOf(line, px, pz);
      const lo = line.along[0] + t.w / 2;
      const hi = line.along[1] - t.w / 2;
      if (hi < lo) continue;
      const candidates = [];
      // Стыковка кухонных модулей приоритетнее неточного положения указателя.
      if (t.dock) {
        const ryLine = facingRy(line.nx, line.nz);
        for (const other of items) {
          if (other.id === item.id || isWallItem(other.type)) continue;
          const ot = ITEM_TYPES[other.type];
          if (ot.dock !== t.dock || !sameRy(other.ry, ryLine)) continue;
          if (distToLine(line, other.x, other.z) > ot.d / 2 + 0.02) continue;
          const oa = alongOf(line, other.x, other.z);
          for (const s of [-1, 1]) {
            const a = oa + s * (ot.w / 2 + t.w / 2 + KITCHEN_DOCK_GAP);
            if (Math.abs(a - desired) <= t.w / 2 + 0.35) candidates.push({ a, dock: true, d: Math.abs(a - desired) });
          }
        }
        candidates.sort((p, q) => p.d - q.d);
      }
      candidates.push({ a: Math.min(hi, Math.max(lo, snapTo(desired, GRID))), dock: false });
      for (const cnd of candidates) {
        const pose = backSnapPose(line, cnd.a, item.type);
        const c = { ...base, ...pose };
        const r = cnd.dock ? { ...c, ...checkFloorPlacement(items, c) } : searchNearby(items, c, roomId, fr.along);
        if (r.ok) return { ...r, anchor: anchorFor(line, alongOf(line, r.x, r.z)), docked: cnd.dock };
        if (!fallback) fallback = { ...r, anchor: anchorFor(line, cnd.a) };
      }
    }
    if (fallback) return fallback;
    const c = { ...base, x: px, z: pz };
    return { ...c, ...checkFloorPlacement(items, c) };
  }

  let x = snapTo(px, GRID);
  let z = snapTo(pz, GRID);
  let anchor;
  if (t.snap === 'align') {
    // Выравнивание задней гранью, если стена рядом с задним краем предмета.
    const fx = Math.sin(ry);
    const fz = Math.cos(ry);
    for (const line of faceLinesOfRoom(roomId)) {
      if (Math.abs(fx + line.nx) > 1e-3 || Math.abs(fz + line.nz) > 1e-3) continue;
      const backCoord = (line.horizontal ? pz : px) - (line.horizontal ? fz : fx) * (t.d / 2);
      if (Math.abs(backCoord - line.faceCoord) > ALIGN_DISTANCE) continue;
      const a = alongOf(line, px, pz);
      if (a < line.along[0] - 0.05 || a > line.along[1] + 0.05) continue;
      const pose = backSnapPose(line, snapTo(a, GRID), item.type);
      x = pose.x;
      z = pose.z;
      anchor = anchorFor(line, a);
      break;
    }
  }
  const c = { ...base, x, z };
  const r = searchNearby(items, c, roomId, anchor ? (Math.abs(Math.sin(ry)) > 0.5 ? [0, 1] : [1, 0]) : null);
  return { ...r, anchor };
}

// Поворот на 90° кнопкой: пристенная мебель разворачивается к ближайшей подходящей стене.
export function rotateItem(items, item, dir) {
  const t = ITEM_TYPES[item.type];
  const ry = normAngle(item.ry + (dir * Math.PI) / 2);
  if (t.snap === 'back') {
    const room = ROOM_BY_ID[item.room];
    if (!room) return null;
    const fx = Math.sin(ry);
    const fz = Math.cos(ry);
    const line = faceLinesOfRoom(room.id).find((l) => Math.abs(l.nx - fx) < 1e-3 && Math.abs(l.nz - fz) < 1e-3 && (() => {
      const a = alongOf(l, item.x, item.z);
      return a >= l.along[0] && a <= l.along[1];
    })());
    if (!line) return null;
    const lo = line.along[0] + t.w / 2;
    const hi = line.along[1] - t.w / 2;
    const a = Math.min(hi, Math.max(lo, alongOf(line, item.x, item.z)));
    const pose = backSnapPose(line, a, item.type);
    const r = searchNearby(items, { ...item, ...pose }, room.id, lineFrame(line).along);
    return r.ok ? { ...r, anchor: anchorFor(line, alongOf(line, r.x, r.z)) } : null;
  }
  const r = searchNearby(items, { ...item, ry }, item.room);
  return r.ok ? { ...r, anchor: undefined } : null;
}

// Свободное место для нового предмета в выбранном помещении: ближе к центру помещения.
export function findSpotInRoom(items, type, roomId, preferRy = 0) {
  const room = ROOM_BY_ID[roomId];
  if (!room) return null;
  const t = ITEM_TYPES[type];
  const [cx, cz] = room.center;
  const xs = room.polygon.map((p) => p[0]);
  const zs = room.polygon.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  const cands = [];
  for (let x = x0; x <= x1 + 1e-9; x += 0.1) {
    for (let z = z0; z <= z1 + 1e-9; z += 0.1) cands.push([x, z, Math.hypot(x - cx, z - cz)]);
  }
  cands.sort((p, q) => p[2] - q[2]);
  const item = { id: -1, type, mats: {} };
  const rys = [preferRy, preferRy + Math.PI / 2, preferRy + Math.PI, preferRy - Math.PI / 2].map(normAngle);
  for (const [x, z] of cands) {
    if (roomAt(x, z)?.id !== roomId) continue;
    if (t.snap === 'back') {
      const r = placeFloorItem(items, item, x, z, preferRy);
      if (r.ok && r.room === roomId) return r;
      continue;
    }
    for (const ry of rys) {
      const r = checkFloorPlacement(items, { ...item, x: snapTo(x, GRID), z: snapTo(z, GRID), ry });
      if (r.ok && r.room === roomId) return { ...item, x: snapTo(x, GRID), z: snapTo(z, GRID), ry, room: r.room, ok: true };
    }
  }
  return null;
}
