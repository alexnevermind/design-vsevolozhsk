// Низкая двускатная кровля: общая непрозрачная замкнутая основа 75 мм со свесом 230 мм и два
// покрытия одного графитового цвета — кликфальц (настоящие складчатые фальцы) и металлочерепица
// (объёмная волна + ступени рядов). Переключение меняет геометрию покрытия.
import PROFILES from './data/profiles.js';
import { SPEC, ROOF, H, ceilingHeight } from './plan.js';
import { MeshBuilder, profileBreaks, profileAt } from './mesh-builder.js';

const SEAM = PROFILES.profiles.seam430.points;
const SEAM_W = PROFILES.profiles.seam430.period;
const WAVE = PROFILES.profiles.tileWave.points;
const WAVE_W = PROFILES.profiles.tileWave.period;
const ROW = PROFILES.profiles.tileRow.points;
const ROW_W = PROFILES.profiles.tileRow.period;

const COS = 1 / Math.sqrt(1 + H.slope * H.slope);
export const ROOF_EXTENT = {
  x0: ROOF.x0 - ROOF.overhang,
  x1: ROOF.x1 + ROOF.overhang,
  zEave: SPEC.house.outer.z1 + ROOF.overhang,
};

// Низ основы (продолжение плоскости над потолком) и верх основы.
export function baseUnderY(z) {
  return ceilingHeight(z) + ROOF.structureDepth;
}
export function baseTopY(z) {
  return baseUnderY(z) + ROOF.baseThickness / COS;
}

// Нормаль ската (вверх) для половины side: −1 — северная (z<0), 1 — южная.
function slopeNormal(side) {
  const n = [0, 1, side * H.slope];
  const l = Math.hypot(...n);
  return n.map((v) => v / l);
}

// Замкнутая основа кровли: скаты сверху и снизу, свесы, торцы и коньковое соединение.
export function buildRoofBase() {
  const b = new MeshBuilder();
  const { x0, x1, zEave } = ROOF_EXTENT;
  const uvs = (a) => a.map(([x, z]) => [x / 0.5, z / 0.5]);
  for (const side of [-1, 1]) {
    const zE = side * zEave;
    const nUp = slopeNormal(side);
    const nDown = nUp.map((v) => -v);
    // Верх и низ ската.
    b.quad([x0, baseTopY(0), 0], [x1, baseTopY(0), 0], [x1, baseTopY(zE), zE], [x0, baseTopY(zE), zE], nUp, ...uvs([[x0, 0], [x1, 0], [x1, zE], [x0, zE]]));
    b.quad([x0, baseUnderY(0), 0], [x1, baseUnderY(0), 0], [x1, baseUnderY(zE), zE], [x0, baseUnderY(zE), zE], nDown, ...uvs([[x0, 0], [x1, 0], [x1, zE], [x0, zE]]));
    // Карниз (торец свеса).
    b.quad([x0, baseUnderY(zE), zE], [x1, baseUnderY(zE), zE], [x1, baseTopY(zE), zE], [x0, baseTopY(zE), zE], [0, 0, side], [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
    // Фронтонные торцы.
    for (const [x, s] of [[x0, -1], [x1, 1]]) {
      b.quad([x, baseUnderY(0), 0], [x, baseUnderY(zE), zE], [x, baseTopY(zE), zE], [x, baseTopY(0), 0], [s, 0, 0], [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
    }
  }
  return b.build();
}

// Кликфальц: поля между фальцами, фальцы 25 мм с шагом 430 мм, складчатый конёк.
export function buildStandingSeam() {
  const b = new MeshBuilder();
  const { x0, x1, zEave } = ROOF_EXTENT;
  const xRef = x0 + 0.06;
  const breaks = profileBreaks(SEAM, SEAM_W, x0 - xRef, x1 - xRef).map((s) => s + xRef);
  for (const side of [-1, 1]) {
    const nUp = slopeNormal(side);
    const zR = side * 0.09;
    const zE = side * (zEave + 0.02);
    for (let i = 0; i + 1 < breaks.length; i++) {
      const xa = breaks[i];
      const xb = breaks[i + 1];
      const ha = profileAt(SEAM, SEAM_W, xa - xRef);
      const hb = profileAt(SEAM, SEAM_W, xb - xRef);
      const dx = xb - xa;
      const dh = hb - ha;
      const l = Math.hypot(dx, dh) || 1;
      const n = [-dh / l, (dx / l) * nUp[1], (dx / l) * nUp[2]];
      const y = (z, h) => baseTopY(z) + 0.001 + h / COS;
      b.quad([xa, y(zR, ha), zR], [xb, y(zR, hb), zR], [xb, y(zE, hb), zE], [xa, y(zE, ha), zE], n,
        [xa / 0.5, zR / 0.5], [xb / 0.5, zR / 0.5], [xb / 0.5, zE / 0.5], [xa / 0.5, zE / 0.5]);
    }
    // Капельник по карнизу: загиб полотна вниз.
    const yE = baseTopY(zE) + 0.001;
    b.quad([x0, yE, zE], [x1, yE, zE], [x1, yE - 0.06, zE + side * 0.012], [x0, yE - 0.06, zE + side * 0.012], [0, 0, side], [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
  }
  emitRidge(b, 'seam');
  emitGableTrims(b, 0.03);
  return b.build();
}

// Металлочерепица: волна поперёк ската (шаг 183 мм, размах 36 мм), ряды 350 мм со ступенью 12 мм.
export function buildMetalTile() {
  const b = new MeshBuilder();
  const { x0, x1, zEave } = ROOF_EXTENT;
  const xs = [];
  const xStep = WAVE_W / 8;
  for (let x = x0; x <= x1 + 1e-9; x += xStep) xs.push(x);
  if (xs[xs.length - 1] < x1) xs.push(x1);
  for (const side of [-1, 1]) {
    const nUp = slopeNormal(side);
    const len = (zEave - 0.1) / COS; // длина ската по уклону от конька до карниза
    // Узлы вдоль ската: ряды от карниза, внутри ряда — изломы профиля ступени.
    const ss = [];
    for (let r = 0; r * ROW_W < len + 1e-6; r++) {
      for (const [t] of ROW) {
        const s = r * ROW_W + t;
        if (s <= len) ss.push(s);
      }
      for (const t of [0.1, 0.15, 0.2, 0.25]) if (r * ROW_W + t <= len) ss.push(r * ROW_W + t);
    }
    ss.push(len);
    const sList = [...new Set(ss.map((v) => Math.round(v * 1e5) / 1e5))].sort((a, c) => a - c);
    const zOf = (s) => side * (zEave - s * COS);
    const hOf = (x, s) => {
      const t = ((s % ROW_W) + ROW_W) % ROW_W;
      const step = profileAt(ROW, ROW_W, t);
      // Волна затухает в зоне ступени, чтобы ряд «ложился» на нижний.
      const fade = Math.min(1, t / 0.05) * 0.85 + 0.15;
      return profileAt(WAVE, WAVE_W, x - x0) * fade + step;
    };
    const grid = [];
    for (const s of sList) {
      const row = [];
      for (const x of xs) {
        const z = zOf(s);
        const h = hOf(x, s);
        row.push([x, baseTopY(z) + 0.002 + h / COS, z, h]);
      }
      grid.push(row);
    }
    const base = b.vertexCount;
    for (let j = 0; j < sList.length; j++) {
      for (let i = 0; i < xs.length; i++) {
        const s = sList[j];
        const x = xs[i];
        const e = 0.004;
        const dhdx = (hOf(x + e, s) - hOf(x - e, s)) / (2 * e);
        const dhds = (hOf(x, s + e) - hOf(x, Math.max(0, s - e))) / (s - e < 0 ? e : 2 * e);
        // Касательные: по x и вниз по скату (−s).
        const tx = [1, dhdx * nUp[1], dhdx * nUp[2]];
        const sDir = [0, H.slope * COS, -side * COS];
        const ts = [sDir[0] + dhds * nUp[0], sDir[1] + dhds * nUp[1], sDir[2] + dhds * nUp[2]];
        let n = [tx[1] * ts[2] - tx[2] * ts[1], tx[2] * ts[0] - tx[0] * ts[2], tx[0] * ts[1] - tx[1] * ts[0]];
        if (n[1] < 0) n = n.map((v) => -v);
        const l = Math.hypot(...n) || 1;
        const p = grid[j][i];
        b.vertex([p[0], p[1], p[2]], n.map((v) => v / l), [p[0] / 0.5, s / 0.5], 1);
      }
    }
    const W = xs.length;
    for (let j = 0; j + 1 < sList.length; j++) {
      for (let i = 0; i + 1 < W; i++) {
        const a = base + j * W + i;
        const c = base + (j + 1) * W + i;
        if (side > 0) b.idx.push(a, a + 1, c, a + 1, c + 1, c);
        else b.idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    // Нижняя кромка волны над карнизом.
    const zE = zOf(0);
    const yE = baseTopY(zE);
    b.quad([x0, yE, zE], [x1, yE, zE], [x1, yE + 0.02, zE], [x0, yE + 0.02, zE], [0, 0, side], [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
  }
  emitRidge(b, 'tile');
  emitGableTrims(b, 0.05);
  return b.build();
}

// Коньковый элемент: складчатый для фальца, полукруглый для черепицы.
function emitRidge(b, kind) {
  const { x0, x1 } = ROOF_EXTENT;
  const y0 = baseTopY(0);
  const pts = [];
  if (kind === 'seam') {
    const w = 0.2;
    for (const [z, h] of [[-w, 0.0], [-w + 0.012, 0.03], [-0.03, 0.055], [0, 0.07], [0.03, 0.055], [w - 0.012, 0.03], [w, 0.0]]) pts.push([z, baseTopY(z) + h]);
  } else {
    const r = 0.12;
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * (i / 12);
      pts.push([-Math.cos(a) * r, y0 + 0.02 + Math.sin(a) * r * 0.75]);
    }
  }
  for (let i = 0; i + 1 < pts.length; i++) {
    const [za, ya] = pts[i];
    const [zb, yb] = pts[i + 1];
    const dz = zb - za;
    const dy = yb - ya;
    const l = Math.hypot(dz, dy) || 1;
    const n = [0, dz / l, -dy / l];
    b.quad([x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb], n, [0, za], [x1 - x0, za], [x1 - x0, zb], [0, zb]);
  }
  // Заглушки конька.
  for (const [x, s] of [[x0, -1], [x1, 1]]) {
    b.polygon(pts.map(([z, y]) => [x + s * 0.001, y, z]), [s, 0, 0], pts.map(() => [0, 0]));
  }
}

// Ветровые планки фронтонов: L-профиль, закрывающий торец основы и покрытия.
function emitGableTrims(b, coverH) {
  const { x0, x1, zEave } = ROOF_EXTENT;
  for (const [x, s] of [[x0, -1], [x1, 1]]) {
    for (const side of [-1, 1]) {
      const zE = side * zEave;
      const xo = x + s * 0.015;
      const top = (z) => baseTopY(z) + coverH + 0.01;
      const bot = (z) => baseUnderY(z) - 0.06;
      b.quad([xo, bot(0), 0], [xo, bot(zE), zE], [xo, top(zE), zE], [xo, top(0), 0], [s, 0, 0], [0, 0], [1, 0], [1, 0.2], [0, 0.2]);
      b.quad([x, top(0), 0], [x, top(zE), zE], [xo, top(zE), zE], [xo, top(0), 0], slopeNormal(side), [0, 0], [1, 0], [1, 0.05], [0, 0.05]);
      b.quad([x, bot(0), 0], [xo, bot(0), 0], [xo, bot(zE), zE], [x, bot(zE), zE], [0, -1, 0], [0, 0], [1, 0], [1, 0.05], [0, 0.05]);
      b.quad([x, bot(zE), zE], [xo, bot(zE), zE], [xo, top(zE), zE], [x, top(zE), zE], [0, 0, side], [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
    }
  }
}

// Два коротких вентиляционных вывода на северном скате.
export function buildRoofVents() {
  const b = new MeshBuilder();
  for (const v of SPEC.exteriorFixtures.roofVents) {
    const r = v.d / 2 + 0.02;
    const yb = baseTopY(v.z) - 0.02;
    const yt = baseTopY(v.z) + 0.48;
    const seg = 20;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const p = (a, y, rr = r) => [v.x + Math.cos(a) * rr, y, v.z + Math.sin(a) * rr];
      const n = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
      b.quad(p(a0, yb), p(a1, yb), p(a1, yt), p(a0, yt), n, [i / seg, 0], [(i + 1) / seg, 0], [(i + 1) / seg, 1], [i / seg, 1]);
      // Колпак.
      b.quad(p(a0, yt + 0.06, r * 1.7), p(a1, yt + 0.06, r * 1.7), p(a1, yt + 0.1, r * 0.2), p(a0, yt + 0.1, r * 0.2), [n[0] * 0.4, 0.9, n[2] * 0.4], [0, 0], [1, 0], [1, 1], [0, 1]);
      b.quad(p(a0, yt + 0.06, r * 1.7), p(a1, yt + 0.06, r * 1.7), p(a1, yt + 0.035, r * 1.7), p(a0, yt + 0.035, r * 1.7), n, [0, 0], [1, 0], [1, 1], [0, 1]);
      // Уплотнитель-проходка у основания.
      b.quad(p(a0, yb + 0.02, r * 1.6), p(a1, yb + 0.02, r * 1.6), p(a1, yb + 0.08, r), p(a0, yb + 0.08, r), [n[0] * 0.6, 0.8, n[2] * 0.6], [0, 0], [1, 0], [1, 1], [0, 1]);
    }
    // Стойки колпака.
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const x = v.x + Math.cos(a) * r * 0.8;
      const z = v.z + Math.sin(a) * r * 0.8;
      b.quad([x - 0.006, yt, z], [x + 0.006, yt, z], [x + 0.006, yt + 0.06, z], [x - 0.006, yt + 0.06, z], [0, 0, 1], [0, 0], [1, 0], [1, 1], [0, 1]);
    }
  }
  return b.build();
}
