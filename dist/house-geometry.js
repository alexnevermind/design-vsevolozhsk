// Стены, полы и плинтусы из единого плана. Верх каждой грани — по функции высоты потолка
// (внутри и под навесом террасы) или по низу кровли (снаружи); разрез редактора — геометрический.
import PROFILES from './data/profiles.js';
import {
  WALLS, ROOMS, ROOM_BY_ID, SPEC, ceilingHeight, roofUndersideY, faceRange, wallPoint, TERRACE_Y,
} from './plan.js';
import { GroupBuilder, MeshBuilder, clipPolygon, profileBreaks, profileAt, hash01 } from './mesh-builder.js';
import { hashString } from './geometry.js';

const P = PROFILES.profiles;
const BOARD = P.board145.points;
const BOARD_W = P.board145.period;
const FLOOR_PROFILE = P.floor180.points;
export const EXTERIOR_BOTTOM = -0.12;
const TILE_GRAIN = 2.4;
const TILE_ACROSS = 0.6;

// Слот материала грани стены.
export function faceSlot(w, side) {
  const roomId = side === 1 ? w.left : w.right;
  if (!roomId) return `facade:${w.facade}`;
  if (roomId === '008') return w.wing ? 'loggia' : 'facade:east';
  if (roomId === '007') return 'sauna';
  return `wall:${roomId}`;
}

function faceKind(w, side) {
  const roomId = side === 1 ? w.left : w.right;
  if (!roomId) return 'open';
  if (roomId === '008') return 'covered';
  return 'room';
}

function faceBottom(kind) {
  if (kind === 'open') return EXTERIOR_BOTTOM;
  if (kind === 'covered') return TERRACE_Y - 0.01;
  return -0.005;
}

function faceTopAt(kind, z) {
  return kind === 'open' ? roofUndersideY(z) : ceilingHeight(z);
}

// Облицовка фасада всегда вертикальная; внутренняя — по выбору (vertical | horizontal | smooth).
function layoutFor(slot, wallLayout) {
  if (slot.startsWith('facade:') || slot === 'loggia') return 'vertical';
  if (slot === 'sauna') return 'horizontal';
  return wallLayout;
}

function boardTone(seed, natural) {
  const r = hash01(seed);
  return natural ? 0.9 + r * 0.18 : 0.985 + r * 0.03;
}

// Поверхность грани [u0,u1]×[y0, top(u)] с профилем доски. frame — функции перевода в мир.
function emitFace(b, f, piece, layout, seedBase, natural) {
  const { u0, u1, y0 } = piece;
  const topAt = (u) => piece.t0 + ((piece.t1 - piece.t0) * (u - u0)) / Math.max(1e-9, u1 - u0);
  if (u1 - u0 < 1e-4) return;
  if (layout === 'vertical') {
    const breaks = profileBreaks(BOARD, BOARD_W, u0 - f.uRef, u1 - f.uRef).map((s) => s + f.uRef);
    for (let i = 0; i + 1 < breaks.length; i++) {
      const ua = breaks[i];
      const ub = breaks[i + 1];
      const da = profileAt(BOARD, BOARD_W, ua - f.uRef);
      const db = profileAt(BOARD, BOARD_W, ub - f.uRef);
      const ta = topAt(ua);
      const tb = topAt(ub);
      if (ta <= y0 + 1e-5 && tb <= y0 + 1e-5) continue;
      const board = Math.floor((0.5 * (ua + ub) - f.uRef) / BOARD_W);
      const rnd = hash01(seedBase + board * 7919);
      const tone = boardTone(seedBase + board, natural);
      const sa = (ua - f.uRef) - board * BOARD_W;
      const sb = (ub - f.uRef) - board * BOARD_W;
      const n = f.normal2(ub - ua, db - da);
      const vOff = rnd * 3.7;
      const uOff = hash01(seedBase + board * 31) * 5.3;
      b.quad(
        f.pt(ua, y0, da), f.pt(ub, y0, db), f.pt(ub, tb, db), f.pt(ua, ta, da), n,
        [y0 / TILE_GRAIN + uOff, sa / TILE_ACROSS + vOff], [y0 / TILE_GRAIN + uOff, sb / TILE_ACROSS + vOff],
        [tb / TILE_GRAIN + uOff, sb / TILE_ACROSS + vOff], [ta / TILE_GRAIN + uOff, sa / TILE_ACROSS + vOff], tone,
      );
    }
    return;
  }
  if (layout === 'horizontal') {
    const yTopMax = Math.max(piece.t0, piece.t1);
    const breaks = profileBreaks(BOARD, BOARD_W, y0 - f.yRef, yTopMax - f.yRef).map((s) => s + f.yRef);
    for (let i = 0; i + 1 < breaks.length; i++) {
      const ya = breaks[i];
      const yb = breaks[i + 1];
      const da = profileAt(BOARD, BOARD_W, ya - f.yRef);
      const db = profileAt(BOARD, BOARD_W, yb - f.yRef);
      let poly = [[u0, ya], [u1, ya], [u1, yb], [u0, yb]];
      poly = clipPolygon(poly, ([u, y]) => y - topAt(u));
      if (poly.length < 3) continue;
      const board = Math.floor((0.5 * (ya + yb) - f.yRef) / BOARD_W);
      const tone = boardTone(seedBase + board * 13, natural);
      const rnd = hash01(seedBase + board * 104729);
      const n = f.normal2v(yb - ya, db - da);
      const pts = poly.map(([u, y]) => {
        const t = yb - ya > 1e-9 ? (y - ya) / (yb - ya) : 0;
        return f.pt(u, y, da + (db - da) * t);
      });
      const uvs = poly.map(([u, y]) => [u / TILE_GRAIN + rnd * 4.1, (y - f.yRef - board * BOARD_W) / TILE_ACROSS + rnd * 2.9]);
      b.polygon(pts, n, uvs, tone);
    }
    return;
  }
  // Гладкая окраска.
  const n = f.normal2(1, 0);
  b.quad(f.pt(u0, y0, 0), f.pt(u1, y0, 0), f.pt(u1, piece.t1, 0), f.pt(u0, piece.t0, 0), n,
    [u0 / TILE_GRAIN, y0 / TILE_ACROSS], [u1 / TILE_GRAIN, y0 / TILE_ACROSS], [u1 / TILE_GRAIN, piece.t1 / TILE_ACROSS], [u0 / TILE_GRAIN, piece.t0 / TILE_ACROSS], 1);
}

// Локальная рамка грани: u вдоль стены, y вверх, d — смещение от плоскости грани наружу.
function faceFrame(w, side, uRef, yRef) {
  const nx = w.nx * side;
  const nz = w.nz * side;
  const off = w.t / 2;
  return {
    uRef,
    yRef,
    pt(u, y, d) {
      return [w.a[0] + w.ux * u + nx * (off + d), y, w.a[1] + w.uz * u + nz * (off + d)];
    },
    // Нормаль для излома по u: (Δu, Δd).
    normal2(du, dd) {
      const x = -dd * w.ux + du * nx;
      const z = -dd * w.uz + du * nz;
      const l = Math.hypot(x, z) || 1;
      return [x / l, 0, z / l];
    },
    // Нормаль для излома по y: (Δy, Δd).
    normal2v(dy, dd) {
      const y = -dd;
      const x = dy * nx;
      const z = dy * nz;
      const l = Math.hypot(x, y, z) || 1;
      return [x / l, y / l, z / l];
    },
  };
}

function zAt(w, u, side) {
  return w.a[1] + w.uz * u + w.nz * side * (w.t / 2);
}

// Интервалы, где стена сохраняется сплошной при разрезе (за кухней, телевизором, инсталляцией).
export function keepFullIntervals(wallId, keepZones) {
  return (keepZones || []).filter((k) => k.wall === wallId).map((k) => [k.u0, k.u1]);
}

// Построение стен. cutFor(wallId) → высота разреза или null; keepZones — [{wall,u0,u1}].
export function buildWalls({ wallLayout = 'vertical', cutFor = () => null, keepZones = [], shellOnly = false } = {}) {
  const groups = new GroupBuilder();
  const shell = new MeshBuilder();
  for (const w of WALLS) {
    const cut = shellOnly ? null : cutFor(w.id);
    const keep = cut != null ? keepFullIntervals(w.id, keepZones) : [];
    const breaks = new Set([0, w.len]);
    for (const o of w.openings) { breaks.add(o.from); breaks.add(o.to); }
    for (const [a, b] of keep) { if (a > 0 && a < w.len) breaks.add(a); if (b > 0 && b < w.len) breaks.add(b); }
    if (!w.horizontal) {
      // Пересечение конька (z = 0) — излом верха.
      for (const s of [1, -1]) {
        const za = zAt(w, 0, s);
        const zb = zAt(w, w.len, s);
        if (za * zb < 0) breaks.add((-za / (zb - za)) * w.len);
      }
    }
    const us = [...breaks].sort((a, b) => a - b);
    const sides = [1, -1].map((side) => {
      const kind = faceKind(w, side);
      const slot = faceSlot(w, side);
      const range = kind === 'room' ? faceRange(w, side) || [0, w.len] : [0, w.len];
      const uRef = range[0];
      return { side, kind, slot, range, frame: faceFrame(w, side, uRef, kind === 'room' ? 0 : EXTERIOR_BOTTOM), bottom: faceBottom(kind) };
    });
    const seed = hashString(w.id);
    for (let i = 0; i + 1 < us.length; i++) {
      const ua = us[i];
      const ub = us[i + 1];
      if (ub - ua < 1e-6) continue;
      const um = (ua + ub) / 2;
      const opening = w.openings.find((o) => um > o.from && um < o.to);
      const isKeep = keep.some(([a, b]) => um > a && um < b);
      const cutH = cut != null && !isKeep ? cut : null;
      for (const sd of sides) {
        const kind = sd.kind;
        let ta = faceTopAt(kind, zAt(w, ua, sd.side));
        let tb = faceTopAt(kind, zAt(w, ub, sd.side));
        if (cutH != null) { ta = Math.min(ta, cutH); tb = Math.min(tb, cutH); }
        const ranges = [];
        if (opening) {
          if (opening.low > sd.bottom + 1e-4) ranges.push({ y0: sd.bottom, t0: Math.min(opening.low, ta), t1: Math.min(opening.low, tb) });
          if (opening.high < Math.min(ta, tb) - 1e-4) ranges.push({ y0: opening.high, t0: ta, t1: tb });
        } else {
          ranges.push({ y0: sd.bottom, t0: ta, t1: tb });
        }
        // Грань помещения — только в пределах помещения.
        const fa = Math.max(ua, sd.range[0]);
        const fb = Math.min(ub, sd.range[1]);
        for (const r of ranges) {
          if (r.t0 <= r.y0 + 1e-5 && r.t1 <= r.y0 + 1e-5) continue;
          if (!shellOnly && fb > fa + 1e-6) {
            const lerp = (u) => r.t0 + ((r.t1 - r.t0) * (u - ua)) / (ub - ua);
            const piece = { u0: fa, u1: fb, y0: r.y0, t0: lerp(fa), t1: lerp(fb) };
            emitFace(groups.get(sd.slot), sd.frame, piece, layoutFor(sd.slot, wallLayout), seed + sd.side * 1013, sd.slot === 'sauna');
          }
          // Оболочка для теней: гладкая грань по всей длине.
          if (shellOnly) {
            const f = sd.frame;
            shell.quad(f.pt(ua, r.y0, 0), f.pt(ub, r.y0, 0), f.pt(ub, r.t1, 0), f.pt(ua, r.t0, 0), f.normal2(1, 0), [0, 0], [0, 0], [0, 0], [0, 0]);
          }
        }
      }
      // Верхний торец участка (виден в разрезе).
      const [s1, s2] = sides;
      const tA1 = Math.min(faceTopAt(s1.kind, zAt(w, ua, 1)), cutH ?? 99);
      const tB1 = Math.min(faceTopAt(s1.kind, zAt(w, ub, 1)), cutH ?? 99);
      const tA2 = Math.min(faceTopAt(s2.kind, zAt(w, ua, -1)), cutH ?? 99);
      const tB2 = Math.min(faceTopAt(s2.kind, zAt(w, ub, -1)), cutH ?? 99);
      const capTarget = shellOnly ? shell : groups.get(cutH != null ? 'section' : s1.slot);
      const p1a = s1.frame.pt(ua, tA1, 0);
      const p1b = s1.frame.pt(ub, tB1, 0);
      const p2b = s2.frame.pt(ub, tB2, 0);
      const p2a = s2.frame.pt(ua, tA2, 0);
      const hasCap = !opening || opening.high < Math.min(tA1, tA2) - 1e-4 || (cutH != null && cutH <= opening.low + 1e-4);
      if (hasCap) {
        capTarget.quad(p1a, p1b, p2b, p2a, [0, 1, 0], [ua / 2.4, 0], [ub / 2.4, 0], [ub / 2.4, 0.25], [ua / 2.4, 0.25]);
      }
    }
    // Откосы проёмов: внешняя половина — материал внешней грани, внутренняя — внутренней.
    for (const o of w.openings) {
      for (const sd of sides) {
        const target = shellOnly ? shell : groups.get(sd.slot);
        const f = sd.frame;
        const cutH = cut != null && !keep.some(([a, b]) => (o.from + o.to) / 2 > a && (o.from + o.to) / 2 < b) ? cut : null;
        const top = cutH != null ? Math.min(o.high, cutH) : o.high;
        const low = Math.max(o.low, sd.bottom);
        if (top <= low + 1e-4) continue;
        const half = -w.t / 2;
        // Боковые откосы: на u = from (нормаль +u) и u = to (нормаль −u).
        for (const [u, sign] of [[o.from, 1], [o.to, -1]]) {
          const n = [w.ux * sign, 0, w.uz * sign];
          target.quad(f.pt(u, low, 0), f.pt(u, low, half), f.pt(u, top, half), f.pt(u, top, 0), n,
            [0, low / 2.4], [0.1, low / 2.4], [0.1, top / 2.4], [0, top / 2.4]);
        }
        if (o.low > 0.01) {
          target.quad(f.pt(o.from, o.low, 0), f.pt(o.to, o.low, 0), f.pt(o.to, o.low, half), f.pt(o.from, o.low, half), [0, 1, 0],
            [o.from / 2.4, 0], [o.to / 2.4, 0], [o.to / 2.4, 0.1], [o.from / 2.4, 0.1]);
        }
        if (cutH == null || o.high < cutH) {
          target.quad(f.pt(o.from, o.high, 0), f.pt(o.to, o.high, 0), f.pt(o.to, o.high, half), f.pt(o.from, o.high, half), [0, -1, 0],
            [o.from / 2.4, 0], [o.to / 2.4, 0], [o.to / 2.4, 0.1], [o.from / 2.4, 0.1]);
        }
      }
    }
    // Торцы стены.
    for (const [u, sign] of [[0, -1], [w.len, 1]]) {
      const n = [w.ux * sign, 0, w.uz * sign];
      const opening = w.openings.find((o) => Math.abs(o.from - u) < 1e-6 || Math.abs(o.to - u) < 1e-6);
      if (opening) continue;
      const [s1, s2] = sides;
      const isKeep = keep.some(([a, b]) => u >= a - 1e-6 && u <= b + 1e-6);
      const cutH = cut != null && !isKeep ? cut : 99;
      const t1 = Math.min(faceTopAt(s1.kind, zAt(w, u, 1)), cutH);
      const t2 = Math.min(faceTopAt(s2.kind, zAt(w, u, -1)), cutH);
      const target = shellOnly ? shell : groups.get(w.wing ? 'loggia' : s1.slot);
      const b0 = Math.min(s1.bottom, s2.bottom);
      target.quad(s1.frame.pt(u, b0, 0), s2.frame.pt(u, b0, 0), s2.frame.pt(u, t2, 0), s1.frame.pt(u, t1, 0), n,
        [0, b0 / 2.4], [w.t / 0.6, b0 / 2.4], [w.t / 0.6, t2 / 2.4], [0, t1 / 2.4]);
    }
  }
  return { groups: groups.entries(), shell: shellOnly ? shell : null };
}

// ---------- Полы ----------
const FLOOR_W = SPEC.floors.board.width;
const FLOOR_L = SPEC.floors.board.length;
const SEAM = SPEC.floors.board.seam;
const TILE = SPEC.floors.tile.size;
const TILE_SEAM = SPEC.floors.tile.seam;

function rectsOf(room) {
  return room.rects;
}

// Доска пола: профиль поперёк (по z), торцевые швы по x. Обрезка — по прямоугольникам полигона помещения.
function emitFloorBoard(b, x0, x1, z0, z1, rowZ0, seed) {
  const len = x1 - x0;
  if (len < 0.02 || z1 - z0 < 0.004) return;
  const tone = 0.9 + hash01(seed) * 0.16;
  const uOff = hash01(seed * 3 + 1) * 7.0;
  const vOff = Math.floor(hash01(seed * 5 + 2) * 4) * 0.25;
  const sA = z0 - rowZ0;
  const sB = z1 - rowZ0;
  const breaks = profileBreaks(FLOOR_PROFILE, FLOOR_W, sA, sB);
  const xa = x0 + SEAM / 2;
  const xb = x1 - SEAM / 2;
  for (let i = 0; i + 1 < breaks.length; i++) {
    const sa = breaks[i];
    const sb = breaks[i + 1];
    const ya = profileAt(FLOOR_PROFILE, FLOOR_W, sa);
    const yb = profileAt(FLOOR_PROFILE, FLOOR_W, sb);
    const dz = sb - sa;
    const dy = yb - ya;
    const l = Math.hypot(dz, dy) || 1;
    const n = [0, dz / l, -dy / l];
    const za = rowZ0 + sa;
    const zb = rowZ0 + sb;
    const va = (sa % FLOOR_W) / 0.72 + vOff;
    const vb = va + dz / 0.72;
    b.quad([xa, ya, za], [xb, ya, za], [xb, yb, zb], [xa, yb, zb], n,
      [xa / FLOOR_L + uOff, va], [xb / FLOOR_L + uOff, va], [xb / FLOOR_L + uOff, vb], [xa / FLOOR_L + uOff, vb], tone);
  }
  // Торцевые фаски (шов 1,6 мм между досками).
  for (const [x, s] of [[xa, -1], [xb, 1]]) {
    b.quad([x, 0, z0], [x, 0, z1], [x + s * 0.0006, -0.004, z1], [x + s * 0.0006, -0.004, z0], [s * 0.99, 0.14, 0],
      [0, 0], [0.01, 0], [0.01, 0.01], [0, 0.01], tone * 0.8);
  }
}

export function buildWoodFloor(room) {
  const b = new MeshBuilder();
  const sub = new MeshBuilder();
  const rects = rectsOf(room);
  const zs = rects.flatMap((r) => [r[1], r[3]]);
  const xs = rects.flatMap((r) => [r[0], r[2]]);
  const zMin = Math.min(...zs);
  const xMin = Math.min(...xs);
  const zMax = Math.max(...zs);
  const xMax = Math.max(...xs);
  const seed0 = hashString(room.id);
  for (let row = 0; zMin + row * FLOOR_W < zMax - 1e-6; row++) {
    const rz0 = zMin + row * FLOOR_W;
    const rz1 = rz0 + FLOOR_W;
    const offset = (Math.floor(hash01(seed0 + row * 17) * 6) * 0.3 + hash01(seed0 + row * 23) * 0.12) % FLOOR_L;
    for (let k = -1; xMin - offset + k * FLOOR_L < xMax; k++) {
      const bx0 = xMin - offset + k * FLOOR_L;
      const bx1 = bx0 + FLOOR_L;
      for (const [rx0, rz0r, rx1, rz1r] of rects) {
        const x0 = Math.max(bx0, rx0);
        const x1 = Math.min(bx1, rx1);
        const z0 = Math.max(rz0, rz0r);
        const z1 = Math.min(rz1, rz1r);
        if (x1 - x0 > 1e-4 && z1 - z0 > 1e-4) emitFloorBoard(b, x0, x1, z0, z1, rz0, seed0 + row * 997 + k * 131);
      }
    }
  }
  // Черновое основание ниже дна пазов (−4 мм) с запасом: совпадение отметок давало z-конфликт на дальних ракурсах.
  for (const [x0, z0, x1, z1] of rects) {
    sub.quad([x0, -0.012, z0], [x1, -0.012, z0], [x1, -0.012, z1], [x0, -0.012, z1], [0, 1, 0], [0, 0], [1, 0], [1, 1], [0, 1], 1);
  }
  return { boards: b.build(), subfloor: sub.build() };
}

// Плитка 600 × 600 со швом 2,4 мм; раскладка от центра помещения, поворот рисунка на 90°.
export function buildTileFloor(room) {
  const b = new MeshBuilder();
  const grout = new MeshBuilder();
  const rects = rectsOf(room);
  const [cx, cz] = room.center;
  const seed0 = hashString(room.id) + 77;
  const bevel = 0.0008;
  for (const [rx0, rz0, rx1, rz1] of rects) {
    const i0 = Math.floor((rx0 - cx) / TILE) - 1;
    const i1 = Math.ceil((rx1 - cx) / TILE) + 1;
    const j0 = Math.floor((rz0 - cz) / TILE) - 1;
    const j1 = Math.ceil((rz1 - cz) / TILE) + 1;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const tx0 = Math.max(rx0, cx + i * TILE - TILE / 2 + TILE_SEAM / 2);
        const tx1 = Math.min(rx1, cx + i * TILE + TILE / 2 - TILE_SEAM / 2);
        const tz0 = Math.max(rz0, cz + j * TILE - TILE / 2 + TILE_SEAM / 2);
        const tz1 = Math.min(rz1, cz + j * TILE + TILE / 2 - TILE_SEAM / 2);
        if (tx1 - tx0 < 0.005 || tz1 - tz0 < 0.005) continue;
        const sd = seed0 + i * 7349 + j * 3571;
        const rot = Math.floor(hash01(sd) * 4);
        const ou = hash01(sd + 1);
        const ov = hash01(sd + 2);
        const tone = 0.96 + hash01(sd + 3) * 0.08;
        const uvOf = (x, z) => {
          let u = (x - (cx + i * TILE - TILE / 2)) / TILE;
          let v = (z - (cz + j * TILE - TILE / 2)) / TILE;
          for (let r = 0; r < rot; r++) [u, v] = [v, 1 - u];
          return [u + ou, v + ov];
        };
        const a = [tx0 + bevel, 0, tz0 + bevel];
        const c = [tx1 - bevel, 0, tz1 - bevel];
        b.quad(a, [c[0], 0, a[2]], c, [a[0], 0, c[2]], [0, 1, 0], uvOf(a[0], a[2]), uvOf(c[0], a[2]), uvOf(c[0], c[2]), uvOf(a[0], c[2]), tone);
        // Фаски по краям плитки.
        const y1 = -0.0015;
        b.quad([tx0, y1, tz0], [tx1, y1, tz0], [c[0], 0, a[2]], a, [0, 0.7, -0.7], uvOf(tx0, tz0), uvOf(tx1, tz0), uvOf(c[0], a[2]), uvOf(a[0], a[2]), tone * 0.95);
        b.quad([tx0, y1, tz1], [a[0], 0, c[2]], c, [tx1, y1, tz1], [0, 0.7, 0.7], uvOf(tx0, tz1), uvOf(a[0], c[2]), uvOf(c[0], c[2]), uvOf(tx1, tz1), tone * 0.95);
        b.quad([tx0, y1, tz0], a, [a[0], 0, c[2]], [tx0, y1, tz1], [-0.7, 0.7, 0], uvOf(tx0, tz0), uvOf(a[0], a[2]), uvOf(a[0], c[2]), uvOf(tx0, tz1), tone * 0.95);
        b.quad([tx1, y1, tz0], [tx1, y1, tz1], c, [c[0], 0, a[2]], [0.7, 0.7, 0], uvOf(tx1, tz0), uvOf(tx1, tz1), uvOf(c[0], c[2]), uvOf(c[0], a[2]), tone * 0.95);
      }
    }
    grout.quad([rx0, -0.0024, rz0], [rx1, -0.0024, rz0], [rx1, -0.0024, rz1], [rx0, -0.0024, rz1], [0, 1, 0], [0, 0], [1, 0], [1, 1], [0, 1], 1);
  }
  return { tiles: b.build(), grout: grout.build() };
}

// ---------- Плинтусы ----------
const BASE = P.baseboard.points;

export function buildBaseboards(roomId) {
  const room = ROOM_BY_ID[roomId];
  const b = new MeshBuilder();
  for (const w of WALLS) {
    for (const side of [1, -1]) {
      if ((side === 1 ? w.left : w.right) !== roomId) continue;
      const range = faceRange(w, side);
      if (!range) continue;
      const cuts = w.openings.filter((o) => o.low < 0.1).map((o) => [o.from - 0.002, o.to + 0.002]);
      let segs = [range];
      for (const [c0, c1] of cuts) {
        segs = segs.flatMap(([a, z]) => (c1 <= a || c0 >= z ? [[a, z]] : [[a, Math.max(a, c0)], [Math.min(z, c1), z]].filter(([p, q]) => q - p > 0.01)));
      }
      const nx = w.nx * side;
      const nz = w.nz * side;
      for (const [u0, u1] of segs) {
        for (let i = 0; i + 1 < BASE.length; i++) {
          const [da, ya] = BASE[i];
          const [db, yb] = BASE[i + 1];
          const off = w.t / 2;
          const pa0 = [w.a[0] + w.ux * u0 + nx * (off + da), ya, w.a[1] + w.uz * u0 + nz * (off + da)];
          const pa1 = [w.a[0] + w.ux * u1 + nx * (off + da), ya, w.a[1] + w.uz * u1 + nz * (off + da)];
          const pb1 = [w.a[0] + w.ux * u1 + nx * (off + db), yb, w.a[1] + w.uz * u1 + nz * (off + db)];
          const pb0 = [w.a[0] + w.ux * u0 + nx * (off + db), yb, w.a[1] + w.uz * u0 + nz * (off + db)];
          const dd = db - da;
          const dy = yb - ya;
          const l = Math.hypot(dd, dy) || 1;
          const n = [(nx * dy) / l, -dd / l, (nz * dy) / l];
          b.quad(pa0, pa1, pb1, pb0, n, [u0 / 2.4, ya], [u1 / 2.4, ya], [u1 / 2.4, yb], [u0 / 2.4, yb], 1);
        }
        // Торцы плинтуса у проёмов.
        for (const [u, s] of [[u0, -1], [u1, 1]]) {
          const pts = BASE.map(([d, y]) => [w.a[0] + w.ux * u + nx * (w.t / 2 + d), y, w.a[1] + w.uz * u + nz * (w.t / 2 + d)]);
          b.polygon(pts, [w.ux * s, 0, w.uz * s], pts.map(() => [0, 0]), 1);
        }
      }
    }
  }
  return room ? b.build() : null;
}

export const FLOOR_ROOMS = ROOMS;
