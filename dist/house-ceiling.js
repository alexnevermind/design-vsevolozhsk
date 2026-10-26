// Потолок по двум скатам 2,30–2,70 м: имитация бруса (профиль вглубь конструкции кровли)
// или матовый натяжной. Наклонный потолок не заменяется горизонтальной плоскостью.
import PROFILES from './data/profiles.js';
import { ROOMS, SPEC, ceilingHeight } from './plan.js';
import { MeshBuilder, profileBreaks, profileAt, hash01 } from './mesh-builder.js';
import { hashString } from './geometry.js';

const BOARD = PROFILES.profiles.board145.points;
const BOARD_W = PROFILES.profiles.board145.period;

// Прямоугольники потолка: помещения дома и навес террасы между стенками-крыльями.
export function ceilingRects() {
  const list = [];
  for (const r of ROOMS) {
    if (r.kind === 'terrace') continue;
    for (const rc of r.rects) list.push({ room: r.id, rect: rc });
  }
  const t = SPEC.house;
  list.push({ room: '008', rect: [t.outer.x1, t.outer.z0 + 0.15, t.wingEndX, t.outer.z1 - 0.15] });
  return list;
}

// Разделение прямоугольника по коньку (z = ridgeZ).
function splitAtRidge([x0, z0, x1, z1]) {
  const rz = SPEC.heights.ridgeZ;
  if (z0 < rz && z1 > rz) return [[x0, z0, x1, rz], [x0, rz, x1, z1]];
  return [[x0, z0, x1, z1]];
}

function emitTimber(b, [x0, z0, x1, z1], seed, natural) {
  const zRef = Math.floor(z0 / BOARD_W) * BOARD_W;
  const breaks = profileBreaks(BOARD, BOARD_W, z0 - zRef, z1 - zRef).map((s) => s + zRef);
  for (let i = 0; i + 1 < breaks.length; i++) {
    const za = breaks[i];
    const zb = breaks[i + 1];
    const da = profileAt(BOARD, BOARD_W, za - zRef);
    const db = profileAt(BOARD, BOARD_W, zb - zRef);
    const ya = ceilingHeight(za) - da;
    const yb = ceilingHeight(zb) - db;
    const dz = zb - za;
    const dy = yb - ya;
    const l = Math.hypot(dz, dy) || 1;
    const n = [0, -dz / l, dy / l];
    const board = Math.floor((0.5 * (za + zb) - zRef) / BOARD_W);
    const rnd = hash01(seed + board * 7477);
    const tone = natural ? 0.9 + rnd * 0.18 : 0.985 + rnd * 0.03;
    const sa = za - zRef - board * BOARD_W;
    const sb = zb - zRef - board * BOARD_W;
    const uo = hash01(seed + board * 13) * 5.1;
    b.quad([x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb], n,
      [x0 / 2.4 + uo, sa / 0.6 + rnd * 3], [x1 / 2.4 + uo, sa / 0.6 + rnd * 3], [x1 / 2.4 + uo, sb / 0.6 + rnd * 3], [x0 / 2.4 + uo, sb / 0.6 + rnd * 3], tone);
  }
}

function emitStretch(b, [x0, z0, x1, z1]) {
  const y0 = ceilingHeight(z0);
  const y1 = ceilingHeight(z1);
  const dz = z1 - z0;
  const dy = y1 - y0;
  const l = Math.hypot(dz, dy) || 1;
  b.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1], [0, -dz / l, dy / l], [x0, z0], [x1, z0], [x1, z1], [x0, z1], 1);
}

// Возвращает { ceiling, sauna, soffit } — геометрии потолка помещений, парной и навеса террасы.
export function buildCeilings(type) {
  const main = new MeshBuilder();
  const sauna = new MeshBuilder();
  const soffit = new MeshBuilder();
  for (const { room, rect } of ceilingRects()) {
    for (const part of splitAtRidge(rect)) {
      const seed = hashString(room) + Math.round(part[1] * 1000);
      if (room === '007') emitTimber(sauna, part, seed, true);
      else if (room === '008') emitTimber(soffit, part, seed, false);
      else if (type === 'stretch') emitStretch(main, part);
      else emitTimber(main, part, seed, false);
    }
  }
  return { ceiling: main.build(), sauna: sauna.build(), soffit: soffit.build() };
}
