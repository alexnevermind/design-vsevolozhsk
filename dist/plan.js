// Геометрические данные дома и производные величины. Единственный источник размеров для
// рендера, обмерного плана, коллизий, прогулки и мебели — dist/data/project-spec.js.
import SPEC from './data/project-spec.js';
import { pointInPolygon, pointInPolygonTol, distToSegment, orthoPolygonToRects, subtractIntervals, mergeIntervals } from './geometry.js';

export { SPEC };

export const H = SPEC.heights;
export const ROOF = SPEC.roof;
export const FLOOR_Y = H.floorY;
export const GROUND_Y = H.groundY;
export const TERRACE_Y = SPEC.terrace.topY;

export const ROOMS = SPEC.rooms;
export const ROOM_BY_ID = Object.fromEntries(ROOMS.map((r) => [r.id, r]));
for (const r of ROOMS) r.rects = orthoPolygonToRects(r.polygon);

// Высота чистого потолка (и верха стен/облицовки) в точке z. Одна функция для всех частей.
export function ceilingHeight(z) {
  return H.ceilingRidge - H.slope * Math.abs(z - H.ridgeZ);
}

// Низ кровельной основы (над конструкцией кровли).
export function roofUndersideY(z) {
  return ceilingHeight(z) + ROOF.structureDepth;
}

// Рамка стены: направление, нормаль side=1, длина.
function frame(w) {
  const dx = w.b[0] - w.a[0];
  const dz = w.b[1] - w.a[1];
  const len = Math.hypot(dx, dz);
  return { len, ux: dx / len, uz: dz / len, nx: -dz / len, nz: dx / len };
}

export const WALLS = SPEC.wallList.map((w) => ({ ...w, ...frame(w), horizontal: Math.abs(w.b[1] - w.a[1]) < 1e-9 }));
export const WALL_BY_ID = Object.fromEntries(WALLS.map((w) => [w.id, w]));

export function wallPoint(w, u, side = 0, offset = 0) {
  return [w.a[0] + w.ux * u + w.nx * side * offset, w.a[1] + w.uz * u + w.nz * side * offset];
}

// Смещение рабочей грани стены от оси (половина толщины).
export function faceOffset(w) {
  return w.t / 2;
}

export function roomOfWallSide(w, side) {
  return side === 1 ? w.left : w.right;
}

export function wallNormal(w, side) {
  return [w.nx * side, w.nz * side];
}

// Помещение, содержащее точку (строго внутри полигона).
export function roomAt(x, z) {
  for (const r of ROOMS) if (pointInPolygon(x, z, r.polygon)) return r;
  return null;
}

export function roomAtTol(x, z, tol = 0.002) {
  for (const r of ROOMS) if (pointInPolygonTol(x, z, r.polygon, tol)) return r;
  return null;
}

export function isOutdoorRoom(r) {
  return r?.kind === 'terrace';
}

// Интервал оси стены, на котором грань side граничит с полигоном помещения.
const faceRangeCache = new Map();
export function faceRange(w, side) {
  const key = `${w.id}:${side}`;
  if (faceRangeCache.has(key)) return faceRangeCache.get(key);
  const roomId = roomOfWallSide(w, side);
  const room = ROOM_BY_ID[roomId];
  let result = null;
  if (room) {
    const off = w.t / 2 + 0.01;
    const step = 0.005;
    let start = null;
    let end = null;
    for (let u = step / 2; u < w.len; u += step) {
      const [x, z] = wallPoint(w, u, side, off);
      if (pointInPolygon(x, z, room.polygon)) {
        if (start === null) start = u - step / 2;
        end = u + step / 2;
      }
    }
    if (start !== null) result = [Math.max(0, start), Math.min(w.len, end)];
  }
  faceRangeCache.set(key, result);
  return result;
}

// Сплошные участки стены по длине для вертикального диапазона [y0, y1] (проёмы, пересекающие диапазон, исключаются).
export function solidIntervals(w, y0 = 0, y1 = 3) {
  const cuts = w.openings.filter((o) => o.low < y1 && o.high > y0).map((o) => [o.from, o.to]);
  return subtractIntervals([[0, w.len]], cuts);
}

// Соосные стены одной линии с одной стороны помещения образуют общую протяжённость (для привязки).
export function collinearRun(w, side) {
  const roomId = roomOfWallSide(w, side);
  const coord = w.horizontal ? w.a[1] : w.a[0];
  const faceCoord = coord + (w.horizontal ? w.nz : w.nx) * side * (w.t / 2);
  const group = WALLS.filter((o) => {
    if (o.horizontal !== w.horizontal) return false;
    for (const s of [1, -1]) {
      if (roomOfWallSide(o, s) !== roomId) continue;
      const oc = (o.horizontal ? o.a[1] : o.a[0]) + (o.horizontal ? o.nz : o.nx) * s * (o.t / 2);
      if (Math.abs(oc - faceCoord) < 1e-6) return true;
    }
    return false;
  });
  return { faceCoord, walls: group.map((o) => ({ wall: o, side: [1, -1].find((s) => roomOfWallSide(o, s) === roomId && Math.abs((o.horizontal ? o.a[1] : o.a[0]) + (o.horizontal ? o.nz : o.nx) * s * (o.t / 2) - faceCoord) < 1e-6) })) };
}

// Площадь для подписи: исходная подпись чертежа, а не вычисленная.
export function roomLabel(r) {
  return `${r.id} · ${r.name} · ${r.area.toFixed(1).replace('.', ',')} м²`;
}

export const HOUSE_AREA = SPEC.house.roomsArea;
export const TERRACE_AREA = SPEC.house.terraceArea;

// Все проёмы с привязкой к стене и мировыми координатами.
export const OPENINGS = WALLS.flatMap((w) => w.openings.map((o) => {
  const mid = (o.from + o.to) / 2;
  const [cx, cz] = wallPoint(w, mid);
  return { ...o, wall: w, cx, cz, width: o.to - o.from };
}));
export const OPENING_BY_ID = Object.fromEntries(OPENINGS.map((o) => [o.id, o]));

// Дверные проёмы (по ним можно пройти) и световые проёмы (окна, остекление, стеклянная входная дверь).
export const DOOR_OPENINGS = OPENINGS.filter((o) => o.type === 'door' || o.type === 'entry' || o.type === 'glazing');
export const LIGHT_OPENINGS = OPENINGS.filter((o) => o.type === 'window' || o.type === 'glazing' || o.type === 'entry');

// Ближайшая к точке стена (по оси) — для подсказок.
export function nearestWall(x, z) {
  let best = null;
  for (const w of WALLS) {
    const r = distToSegment(x, z, w.a[0], w.a[1], w.b[0], w.b[1]);
    if (!best || r.d < best.d) best = { wall: w, d: r.d, u: r.t * w.len };
  }
  return best;
}

export const HOUSE_RECT = [SPEC.house.outer.x0, SPEC.house.outer.z0, SPEC.house.outer.x1, SPEC.house.outer.z1];
export const TERRACE_RECT = [SPEC.house.terrace.x0, SPEC.house.terrace.z0, SPEC.house.terrace.x1, SPEC.house.terrace.z1];

export function platformOf(x, z) {
  if (x >= HOUSE_RECT[0] && x <= HOUSE_RECT[2] && z >= HOUSE_RECT[1] && z <= HOUSE_RECT[3]) return 'house';
  if (x >= TERRACE_RECT[0] && x <= TERRACE_RECT[2] && z >= TERRACE_RECT[1] && z <= TERRACE_RECT[3]) return 'terrace';
  return null;
}

export function floorYAt(x, z) {
  return platformOf(x, z) === 'terrace' ? TERRACE_Y : FLOOR_Y;
}

export { mergeIntervals };
