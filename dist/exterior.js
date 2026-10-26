// Наружная архитектура: окна (ступенчатые рамы, уплотнения, откосы, отливы, подоконники),
// раздвижное остекление 005, стеклянная входная дверь 004, терраса с настилом и ступенями,
// горизонтальная обвязка под поднятым домом, сваи, фасадные светильники, фронтон навеса.
import * as THREE from 'three';
import PROFILES from './data/profiles.js';
import { SPEC, WALLS, OPENINGS, TERRACE_Y, GROUND_Y, ceilingHeight, wallPoint } from './plan.js';
import { MeshBuilder, hash01 } from './mesh-builder.js';
import { baseUnderY } from './roof-covering.js';
import { DOOR_BY_ID } from './walk-geometry.js';

const FRAME = PROFILES.profiles.windowFrame.points;
const FRAME_W = Math.max(...FRAME.map((p) => p[0]));
const FRAME_D = Math.max(...FRAME.map((p) => p[1]));
const FRAME_OUT = 0.035; // отступ рамы от наружной плоскости стены

function outsideSide(w) {
  if (!w.left || w.left === '008') return 1;
  return -1;
}

// Прямой брус вдоль оси (u) с профилем (w — поперёк к центру проёма, d — по глубине).
function sweepProfile(b, origin, uDir, wDir, dDir, length, profile) {
  for (let i = 0; i < profile.length; i++) {
    const [wa, da] = profile[i];
    const [wb, db] = profile[(i + 1) % profile.length];
    const p = (wv, dv, uv) => [
      origin[0] + uDir[0] * uv + wDir[0] * wv + dDir[0] * dv,
      origin[1] + uDir[1] * uv + wDir[1] * wv + dDir[1] * dv,
      origin[2] + uDir[2] * uv + wDir[2] * wv + dDir[2] * dv,
    ];
    const ew = wb - wa;
    const ed = db - da;
    // Нормаль сечения: перпендикуляр к ребру (ew, ed) наружу контура.
    // Контур профиля обходится по часовой стрелке: внешняя нормаль (−ed, ew).
    const nw = -ed;
    const nd = ew;
    const l = Math.hypot(nw, nd) || 1;
    const n = [(wDir[0] * nw + dDir[0] * nd) / l, (wDir[1] * nw + dDir[1] * nd) / l, (wDir[2] * nw + dDir[2] * nd) / l];
    b.quad(p(wa, da, 0), p(wb, db, 0), p(wb, db, length), p(wa, da, length), n, [0, 0], [0.1, 0], [0.1, length], [0, length]);
  }
}

function boxInto(b, center, size, axes) {
  const [cx, cy, cz] = center;
  const [sx, sy, sz] = size.map((v) => v / 2);
  const [ax, ay, az] = axes;
  const P = (i, j, k) => [cx + ax[0] * sx * i + ay[0] * sy * j + az[0] * sz * k, cy + ax[1] * sx * i + ay[1] * sy * j + az[1] * sz * k, cz + ax[2] * sx * i + ay[2] * sy * j + az[2] * sz * k];
  const faces = [
    [ax, [P(1, -1, -1), P(1, 1, -1), P(1, 1, 1), P(1, -1, 1)]],
    [ax.map((v) => -v), [P(-1, -1, -1), P(-1, -1, 1), P(-1, 1, 1), P(-1, 1, -1)]],
    [ay, [P(-1, 1, -1), P(-1, 1, 1), P(1, 1, 1), P(1, 1, -1)]],
    [ay.map((v) => -v), [P(-1, -1, -1), P(1, -1, -1), P(1, -1, 1), P(-1, -1, 1)]],
    [az, [P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)]],
    [az.map((v) => -v), [P(-1, -1, -1), P(-1, 1, -1), P(1, 1, -1), P(1, -1, -1)]],
  ];
  for (const [n, q] of faces) b.quad(q[0], q[1], q[2], q[3], n, [0, 0], [1, 0], [1, 1], [0, 1]);
}

// Рама проёма: четыре бруса ступенчатого профиля; внешняя кромка на границе проёма.
function frameRing(b, w, o, outSide, low, high, depthStart) {
  const uDir = [w.ux, 0, w.uz];
  const inward = [-w.nx * outSide, 0, -w.nz * outSide];
  const up = [0, 1, 0];
  const at = (u, y) => {
    const [x, z] = wallPoint(w, u, outSide, w.t / 2 - depthStart);
    return [x, y, z];
  };
  const width = o.to - o.from;
  // Левый и правый брусья (вдоль y).
  sweepProfile(b, at(o.from, low), up, uDir, inward, high - low, FRAME);
  sweepProfile(b, at(o.to, high), up.map((v) => -v), uDir.map((v) => -v), inward, high - low, FRAME);
  // Верх и низ (вдоль u), сечение вниз/вверх.
  sweepProfile(b, at(o.to, high), uDir.map((v) => -v), up.map((v) => -v), inward, width, FRAME);
  if (low > 0.01) sweepProfile(b, at(o.from, low), uDir, up, inward, width, FRAME);
}

// Окна: рама, импост, стекло, уплотнитель, отлив снаружи, подоконник внутри.
export function buildWindows(lib) {
  const frame = new MeshBuilder();
  const seal = new MeshBuilder();
  const sill = new MeshBuilder();
  const flashing = new MeshBuilder();
  const glass = new MeshBuilder();
  const glow = new MeshBuilder();
  for (const o of OPENINGS.filter((q) => q.type === 'window')) {
    const w = o.wall;
    const out = outsideSide(w);
    frameRing(frame, w, o, out, o.low, o.high, FRAME_OUT);
    const uDir = [w.ux, 0, w.uz];
    const inward = [-w.nx * out, 0, -w.nz * out];
    const at = (u, y, depth) => {
      const [x, z] = wallPoint(w, u, out, w.t / 2 - depth);
      return [x, y, z];
    };
    const gIn = FRAME_W - 0.006;
    const mullions = o.mullions || 0;
    const panes = mullions + 1;
    const innerW = o.to - o.from - 2 * gIn;
    const mW = 0.07;
    const paneW = (innerW - mullions * mW) / panes;
    for (let k = 0; k < mullions; k++) {
      const uc = o.from + gIn + paneW * (k + 1) + mW * k + mW / 2;
      boxInto(frame, at(uc, (o.low + o.high) / 2, FRAME_OUT + FRAME_D / 2), [mW, o.high - o.low - 2 * gIn, FRAME_D * 0.85], [uDir, [0, 1, 0], inward]);
    }
    for (let k = 0; k < panes; k++) {
      const u0 = o.from + gIn + k * (paneW + mW);
      const u1 = u0 + paneW;
      const y0 = o.low + gIn;
      const y1 = o.high - gIn;
      const d = FRAME_OUT + 0.032;
      const n = [-inward[0], 0, -inward[2]];
      glass.quad(at(u0, y0, d), at(u1, y0, d), at(u1, y1, d), at(u0, y1, d), n, [0, 0], [1, 0], [1, 1], [0, 1]);
      glow.quad(at(u0, y0, d - 0.002), at(u1, y0, d - 0.002), at(u1, y1, d - 0.002), at(u0, y1, d - 0.002), n, [0, 0], [1, 0], [1, 1], [0, 1]);
      // Уплотнитель по периметру стеклопакета (тёмная резина).
      for (const [a, c] of [[[u0, y0], [u1, y0]], [[u1, y0], [u1, y1]], [[u1, y1], [u0, y1]], [[u0, y1], [u0, y0]]]) {
        const horiz = a[1] === c[1];
        const e = 0.006;
        const p = (uu, yy) => at(uu, yy, d - 0.003);
        if (horiz) seal.quad(p(a[0], a[1] - e * Math.sign(c[0] - a[0])), p(c[0], c[1] - e * Math.sign(c[0] - a[0])), p(c[0], c[1] + e * Math.sign(c[0] - a[0])), p(a[0], a[1] + e * Math.sign(c[0] - a[0])), n, [0, 0], [1, 0], [1, 1], [0, 1]);
        else seal.quad(p(a[0] - e, a[1]), p(a[0] + e, a[1]), p(c[0] + e, c[1]), p(c[0] - e, c[1]), n, [0, 0], [1, 0], [1, 1], [0, 1]);
      }
    }
    // Отлив: окрашенный металл с уклоном наружу и капельником.
    const fl0 = FRAME_OUT + 0.01;
    const outN = [-inward[0], 0, -inward[2]];
    const yS = o.low;
    const pA = (u) => at(u, yS - 0.004, fl0);
    const pB = (u) => at(u, yS - 0.03, -0.045);
    flashing.quad(pA(o.from - 0.02), pA(o.to + 0.02), pB(o.to + 0.02), pB(o.from - 0.02), [outN[0] * 0.5, 0.86, outN[2] * 0.5], [0, 0], [1, 0], [1, 1], [0, 1]);
    flashing.quad(pB(o.from - 0.02), pB(o.to + 0.02), at(o.to + 0.02, yS - 0.055, -0.045), at(o.from - 0.02, yS - 0.055, -0.045), outN, [0, 0], [1, 0], [1, 1], [0, 1]);
    // Подоконник внутри (только у окон с подоконником).
    if (o.low > 0.3) {
      const d0 = FRAME_OUT + FRAME_D - 0.005;
      const d1 = w.t + 0.045;
      const th = 0.022;
      const uc = (o.from + o.to) / 2;
      boxInto(sill, at(uc, o.low - th / 2, (d0 + d1) / 2), [o.to - o.from + 0.06, th, d1 - d0], [uDir, [0, 1, 0], inward]);
    }
  }
  return {
    frame: frame.build(), seal: seal.build(), sill: sill.build(), flashing: flashing.build(), glass: glass.build(), glow: glow.build(),
  };
}

// Раздвижное остекление 005: общая рама, неподвижная створка (внутренняя направляющая) и
// подвижная (наружная направляющая). Возвращает группы для обновления положения створки.
export function buildGlazing(lib) {
  const o = OPENINGS.find((q) => q.type === 'glazing');
  const w = o.wall;
  const out = outsideSide(w);
  const frameMat = lib.paintedMetal('#26282a', { key: 'frames' });
  const group = new THREE.Group();
  group.name = 'glazing';
  const fb = new MeshBuilder();
  frameRing(fb, w, o, out, 0, o.high, FRAME_OUT);
  // Порог.
  const uDir = [w.ux, 0, w.uz];
  const inward = [-w.nx * out, 0, -w.nz * out];
  const at = (u, y, depth) => {
    const [x, z] = wallPoint(w, u, out, w.t / 2 - depth);
    return [x, y, z];
  };
  boxInto(fb, at((o.from + o.to) / 2, 0.012, FRAME_OUT + FRAME_D / 2), [o.to - o.from, 0.024, FRAME_D + 0.02], [uDir, [0, 1, 0], inward]);
  const frameMesh = new THREE.Mesh(fb.build(), frameMat);
  frameMesh.castShadow = true;
  frameMesh.receiveShadow = true;
  group.add(frameMesh);
  const half = (o.to - o.from - 2 * (FRAME_W - 0.01)) / 2 + 0.03;
  const panelH = o.high - 0.024 - (FRAME_W - 0.01);
  const makePanel = (depth) => {
    const g = new THREE.Group();
    const pb = new MeshBuilder();
    const bar = 0.065;
    const ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    boxInto(pb, [half / 2, 0.024 + bar / 2, 0], [half, bar, 0.05], ax);
    boxInto(pb, [half / 2, 0.024 + panelH - bar / 2, 0], [half, bar, 0.05], ax);
    boxInto(pb, [bar / 2, 0.024 + panelH / 2, 0], [bar, panelH, 0.05], ax);
    boxInto(pb, [half - bar / 2, 0.024 + panelH / 2, 0], [bar, panelH, 0.05], ax);
    // Ручка-скоба.
    boxInto(pb, [half - bar / 2, 1.05, 0.04], [0.02, 0.32, 0.02], ax);
    const m = new THREE.Mesh(pb.build(), frameMat);
    m.castShadow = true;
    g.add(m);
    const gl = new THREE.Mesh(new THREE.PlaneGeometry(half - 2 * bar + 0.01, panelH - 2 * bar + 0.01), lib.glass('clear'));
    gl.position.set(half / 2, 0.024 + panelH / 2, 0);
    gl.userData.excludeAO = true;
    gl.userData.glassPane = true;
    g.add(gl);
    const glowMesh = new THREE.Mesh(gl.geometry, lib.windowGlow());
    glowMesh.position.copy(gl.position).add(new THREE.Vector3(0, 0, 0.004));
    glowMesh.userData.excludeAO = true;
    glowMesh.userData.windowGlow = true;
    glowMesh.renderOrder = 2;
    g.add(glowMesh);
    // Ориентация: локальная X — вдоль стены, Z — наружу.
    // Правый базис: X — вдоль стены, Y — вверх, Z = X × Y (знак детерминанта +1).
    const bx = new THREE.Vector3(...uDir);
    const by = new THREE.Vector3(0, 1, 0);
    const basis = new THREE.Matrix4().makeBasis(bx, by, new THREE.Vector3().crossVectors(bx, by));
    g.quaternion.setFromRotationMatrix(basis);
    g.userData.depth = depth;
    return g;
  };
  const door = DOOR_BY_ID[o.id];
  const fixedU0 = o.slidingPart === 'from' ? o.from + FRAME_W - 0.04 + half - 0.03 : o.from + FRAME_W - 0.01;
  const fixedPanel = makePanel(FRAME_OUT + 0.045);
  const fp = at(fixedU0, 0, FRAME_OUT + 0.045);
  fixedPanel.position.set(fp[0], 0, fp[2]);
  group.add(fixedPanel);
  const sliding = makePanel(FRAME_OUT + 0.012);
  const slideU0 = o.slidingPart === 'from' ? o.from + FRAME_W - 0.01 : o.to - FRAME_W + 0.01 - half;
  sliding.userData.base = at(slideU0, 0, FRAME_OUT + 0.012);
  sliding.userData.dir = uDir.map((v) => v * door.dir);
  sliding.userData.travel = door.travel;
  sliding.position.set(sliding.userData.base[0], 0, sliding.userData.base[2]);
  group.add(sliding);
  group.userData.update = (open) => {
    const s = sliding.userData;
    sliding.position.set(s.base[0] + s.dir[0] * s.travel * open, 0, s.base[2] + s.dir[2] * s.travel * open);
  };
  return group;
}

// Стеклянная входная дверь 004 (графитовый алюминий) — створка на петлях.
export function buildEntryDoor(lib) {
  const o = OPENINGS.find((q) => q.type === 'entry');
  const w = o.wall;
  const out = outsideSide(w);
  const frameMat = lib.paintedMetal('#26282a', { key: 'frames' });
  const group = new THREE.Group();
  group.name = 'entry-door';
  const fb = new MeshBuilder();
  frameRing(fb, w, o, out, 0, o.high, w.t / 2 - SPEC.doors.leafThickness / 2 - 0.035);
  const fm = new THREE.Mesh(fb.build(), frameMat);
  fm.castShadow = true;
  group.add(fm);
  const door = DOOR_BY_ID[o.id];
  const pivot = new THREE.Group();
  pivot.position.set(door.hinge[0], 0, door.hinge[1]);
  const leafH = 2.08;
  const width = door.width - 0.01;
  const lb = new MeshBuilder();
  const ax = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const bar = 0.07;
  const t = 0.05;
  boxInto(lb, [width / 2, 0.01 + bar / 2, 0], [width, bar * 1.6, t], ax);
  boxInto(lb, [width / 2, leafH - bar / 2, 0], [width, bar, t], ax);
  boxInto(lb, [bar / 2, leafH / 2, 0], [bar, leafH, t], ax);
  boxInto(lb, [width - bar / 2, leafH / 2, 0], [bar, leafH, t], ax);
  const leafMesh = new THREE.Mesh(lb.build(), frameMat);
  leafMesh.castShadow = true;
  pivot.add(leafMesh);
  const hb = new MeshBuilder();
  // Ручка-скоба снаружи и нажимная внутри.
  boxInto(hb, [width - 0.11, 1.05, 0.07], [0.025, 0.9, 0.025], ax);
  boxInto(hb, [width - 0.11, 0.65, 0.045], [0.02, 0.02, 0.05], ax);
  boxInto(hb, [width - 0.11, 1.45, 0.045], [0.02, 0.02, 0.05], ax);
  boxInto(hb, [width - 0.13, 1.0, -0.05], [0.12, 0.02, 0.02], ax);
  const handle = new THREE.Mesh(hb.build(), lib.brushed());
  handle.castShadow = true;
  pivot.add(handle);
  const gl = new THREE.Mesh(new THREE.PlaneGeometry(width - 2 * bar, leafH - bar * 2.6), lib.glass('clear'));
  gl.position.set(width / 2, 0.01 + bar * 1.6 + (leafH - bar * 2.6) / 2, 0);
  gl.userData.excludeAO = true;
  gl.userData.glassPane = true;
  pivot.add(gl);
  // Локальная Z створки смотрит в сторону открывания: дверь открывается наружу на террасу.
  group.add(pivot);
  group.userData.pivot = pivot;
  group.userData.door = door;
  return group;
}

// Поворот створки вокруг петли: локальная +X — от петли к свободной кромке.
export function poseHingedLeaf(pivot, door, angleDeg) {
  const a = (angleDeg * Math.PI) / 180;
  const dx = door.along[0] * Math.cos(a) + door.normal[0] * Math.sin(a);
  const dz = door.along[1] * Math.cos(a) + door.normal[1] * Math.sin(a);
  pivot.rotation.set(0, Math.atan2(-dz, dx), 0);
}

// Терраса: продольные доски с зазорами и стыками, фальш-борт, ступени из того же настила.
export function buildTerrace() {
  const deck = new MeshBuilder();
  const fascia = new MeshBuilder();
  const piles = new MeshBuilder();
  const t = SPEC.house.terrace;
  const top = TERRACE_Y;
  const bw = SPEC.terrace.boardWidth;
  const gap = 0.006;
  const th = 0.028;
  const ch = 0.003;
  const emitBoard = (b, x0, x1, z0, z1, y, seed, alongZ = true) => {
    const tone = 0.9 + hash01(seed) * 0.16;
    const uo = hash01(seed + 3) * 6;
    const vo = Math.floor(hash01(seed + 5) * 4) * 0.25;
    const uv = (x, z) => (alongZ ? [z / 1.8 + uo, (x - x0) / 0.72 + vo] : [x / 1.8 + uo, (z - z0) / 0.72 + vo]);
    // Верх с фасками.
    const a = [x0 + ch, y, z0 + (alongZ ? 0 : ch)];
    const c = [x1 - ch, y, z1 - (alongZ ? 0 : ch)];
    if (alongZ) {
      b.quad([a[0], y, z0], [c[0], y, z0], [c[0], y, z1], [a[0], y, z1], [0, 1, 0], uv(a[0], z0), uv(c[0], z0), uv(c[0], z1), uv(a[0], z1), tone);
      b.quad([x0, y - ch, z0], [a[0], y, z0], [a[0], y, z1], [x0, y - ch, z1], [-0.7, 0.7, 0], uv(x0, z0), uv(a[0], z0), uv(a[0], z1), uv(x0, z1), tone * 0.95);
      b.quad([c[0], y, z0], [x1, y - ch, z0], [x1, y - ch, z1], [c[0], y, z1], [0.7, 0.7, 0], uv(c[0], z0), uv(x1, z0), uv(x1, z1), uv(c[0], z1), tone * 0.95);
      b.quad([x0, y - th, z0], [x0, y - ch, z0], [x0, y - ch, z1], [x0, y - th, z1], [-1, 0, 0], uv(x0, z0), uv(x0, z0), uv(x0, z1), uv(x0, z1), tone * 0.8);
      b.quad([x1, y - ch, z0], [x1, y - th, z0], [x1, y - th, z1], [x1, y - ch, z1], [1, 0, 0], uv(x1, z0), uv(x1, z0), uv(x1, z1), uv(x1, z1), tone * 0.8);
      for (const [z, s] of [[z0, -1], [z1, 1]]) b.quad([x0, y - th, z], [x1, y - th, z], [x1, y, z], [x0, y, z], [0, 0, s], uv(x0, z), uv(x1, z), uv(x1, z), uv(x0, z), tone * 0.7);
    } else {
      b.quad([x0, y, a[2]], [x1, y, a[2]], [x1, y, c[2]], [x0, y, c[2]], [0, 1, 0], uv(x0, a[2]), uv(x1, a[2]), uv(x1, c[2]), uv(x0, c[2]), tone);
      b.quad([x0, y - ch, z0], [x1, y - ch, z0], [x1, y, a[2]], [x0, y, a[2]], [0, 0.7, -0.7], uv(x0, z0), uv(x1, z0), uv(x1, a[2]), uv(x0, a[2]), tone * 0.95);
      b.quad([x0, y, c[2]], [x1, y, c[2]], [x1, y - ch, z1], [x0, y - ch, z1], [0, 0.7, 0.7], uv(x0, c[2]), uv(x1, c[2]), uv(x1, z1), uv(x0, z1), tone * 0.95);
      b.quad([x0, y - th, z1], [x1, y - th, z1], [x1, y - ch, z1], [x0, y - ch, z1], [0, 0, 1], uv(x0, z1), uv(x1, z1), uv(x1, z1), uv(x0, z1), tone * 0.8);
      b.quad([x0, y - th, z0], [x0, y - ch, z0], [x1, y - ch, z0], [x1, y - th, z0], [0, 0, -1], uv(x0, z0), uv(x0, z0), uv(x1, z0), uv(x1, z0), tone * 0.8);
    }
  };
  // Настил: доски вдоль Z (продольные по длинной стороне террасы), стыки вразбежку.
  const n = Math.floor((t.x1 - t.x0 + gap) / (bw + gap));
  const pad = (t.x1 - t.x0 - (n * bw + (n - 1) * gap)) / 2;
  for (let i = 0; i < n; i++) {
    const x0 = t.x0 + pad + i * (bw + gap);
    const x1 = x0 + bw;
    const joint = (hash01(i * 37 + 5) - 0.5) * 2.4;
    emitBoard(deck, x0, x1, t.z0, joint - gap / 2, top, i * 11 + 1);
    emitBoard(deck, x0, x1, joint + gap / 2, t.z1, top, i * 11 + 2);
  }
  // Подложка под зазорами.
  deck.quad([t.x0, top - th - 0.002, t.z0], [t.x1, top - th - 0.002, t.z0], [t.x1, top - th - 0.002, t.z1], [t.x0, top - th - 0.002, t.z1], [0, 1, 0], [0, 0], [0, 0], [0, 0], [0, 0], 0.15);
  // Фальш-борт (тёмная окрашенная доска) по открытым краям.
  const fTop = top - th;
  const fBot = top - 0.26;
  const st = SPEC.exteriorFixtures.terraceStair;
  const z0s = st.center - st.width / 2;
  const z1s = st.center + st.width / 2;
  for (const [a, c, nrm] of [
    [[t.x0, t.z0], [t.x1, t.z0], [0, 0, -1]],
    [[t.x1, t.z0], [t.x1, z0s], [1, 0, 0]],
    [[t.x1, z1s], [t.x1, t.z1], [1, 0, 0]],
    [[t.x1, t.z1], [t.x0, t.z1], [0, 0, 1]],
  ]) {
    const o = [nrm[0] * 0.022, 0, nrm[2] * 0.022];
    fascia.quad([a[0] + o[0], fBot, a[1] + o[2]], [c[0] + o[0], fBot, c[1] + o[2]], [c[0] + o[0], top + 0.002, c[1] + o[2]], [a[0] + o[0], top + 0.002, a[1] + o[2]], nrm,
      [0, fBot / 2.4], [Math.hypot(c[0] - a[0], c[1] - a[1]) / 0.6, fBot / 2.4], [Math.hypot(c[0] - a[0], c[1] - a[1]) / 0.6, top / 2.4], [0, top / 2.4]);
  }
  // Ступени: 4 промежуточные проступи по 0,30 м, подступенок ≈0,14 м; нижняя грань — на земле −0,70.
  const rise = (top - GROUND_Y) / (st.treads + 1);
  for (let i = 1; i <= st.treads; i++) {
    const y = top - rise * i;
    const xa = st.x + (i - 1) * st.run;
    const xb = xa + st.run;
    const nb = Math.floor((st.run + gap) / (bw + gap));
    for (let k = 0; k < nb; k++) {
      const bx0 = xa + k * (bw + gap) + 0.01;
      emitBoard(deck, bx0, Math.min(xb - 0.005, bx0 + bw), z0s, z1s, y, 900 + i * 17 + k, true);
    }
    // Подступенок из той же доски.
    emitBoard(deck, xa, xb, z0s, z0s + 0.001, y, 990 + i, false);
    deck.quad([xa, y - th, z0s], [xa, y - th, z1s], [xa, y + rise - th, z1s], [xa, y + rise - th, z0s], [-1, 0, 0], [z0s / 1.8, 0], [z1s / 1.8, 0], [z1s / 1.8, rise / 0.72], [z0s / 1.8, rise / 0.72], 0.85);
    // Тело ступени до земли и боковые косоуры (тёмные).
    for (const [z, s] of [[z0s, -1], [z1s, 1]]) {
      fascia.quad([xa, GROUND_Y, z], [xb, GROUND_Y, z], [xb, y - th, z], [xa, y - th, z], [0, 0, s], [0, 0], [1, 0], [1, 1], [0, 1]);
    }
    fascia.quad([xb, GROUND_Y, z0s], [xb, GROUND_Y, z1s], [xb, y - th, z1s], [xb, y - th, z0s], [1, 0, 0], [0, 0], [1, 0], [1, 1], [0, 1]);
  }
  // Сваи под террасой (ж/б, Ø 200 мм).
  for (const x of [t.x0 + 0.5, (t.x0 + t.x1) / 2 + 0.2, t.x1 - 0.35]) {
    for (const z of [-3.1, -1.55, 0, 1.55, 3.1]) {
      const r = 0.1;
      const seg = 12;
      for (let k = 0; k < seg; k++) {
        const a0 = (k / seg) * Math.PI * 2;
        const a1 = ((k + 1) / seg) * Math.PI * 2;
        const p = (a, y) => [x + Math.cos(a) * r, y, z + Math.sin(a) * r];
        const nn = [Math.cos((a0 + a1) / 2), 0, Math.sin((a0 + a1) / 2)];
        piles.quad(p(a0, GROUND_Y - 0.05), p(a1, GROUND_Y - 0.05), p(a1, fBot - 0.04), p(a0, fBot - 0.04), nn, [0, 0], [1, 0], [1, 1], [0, 1]);
      }
    }
  }
  return { deck: deck.build(), fascia: fascia.build(), piles: piles.build() };
}

// Горизонтальный экран (обвязка) под поднятым домом: рейки 90 мм с зазором 15 мм, отступ 30 мм.
export function buildSkirt() {
  const b = new MeshBuilder();
  const o = SPEC.house.outer;
  const inset = 0.03;
  const yTop = -0.12;
  const slat = 0.09;
  const gapY = 0.015;
  const sides = [
    [[o.x0 + inset, o.z0 + inset], [o.x1 - inset, o.z0 + inset], [0, 0, -1]],
    [[o.x1 - inset, o.z1 - inset], [o.x0 + inset, o.z1 - inset], [0, 0, 1]],
    [[o.x0 + inset, o.z1 - inset], [o.x0 + inset, o.z0 + inset], [-1, 0, 0]],
  ];
  for (const [a, c, n] of sides) {
    const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
    let k = 0;
    for (let y = yTop; y - slat > GROUND_Y - 0.02; y -= slat + gapY, k++) {
      const y0 = Math.max(GROUND_Y - 0.02, y - slat);
      const tone = 0.95 + hash01(k * 7 + n[0] * 3 + n[2] * 5) * 0.1;
      b.quad([a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y, c[1]], [a[0], y, a[1]], n, [0, 0], [len / 2.4, 0], [len / 2.4, slat / 0.6], [0, slat / 0.6], tone);
      // Фаска верхней кромки рейки.
      b.quad([a[0], y, a[1]], [c[0], y, c[1]], [c[0] - n[0] * 0.02, y, c[1] - n[2] * 0.02], [a[0] - n[0] * 0.02, y, a[1] - n[2] * 0.02], [0, 1, 0], [0, 0], [1, 0], [1, 0.02], [0, 0.02], tone * 0.9);
    }
    // Тёмная подложка за рейками.
    const back = 0.04;
    b.quad([a[0] - n[0] * back, GROUND_Y - 0.02, a[1] - n[2] * back], [c[0] - n[0] * back, GROUND_Y - 0.02, c[1] - n[2] * back], [c[0] - n[0] * back, yTop, c[1] - n[2] * back], [a[0] - n[0] * back, yTop, a[1] - n[2] * back], n, [0, 0], [1, 0], [1, 1], [0, 1], 0.1);
  }
  return b.build();
}

// Фронтон навеса террасы: полоса от потолка навеса до низа кровли у открытого торца.
export function buildGableBand() {
  const b = new MeshBuilder();
  const x = SPEC.house.wingEndX;
  const z0 = SPEC.house.outer.z0 + 0.15;
  const z1 = SPEC.house.outer.z1 - 0.15;
  const steps = [z0, -1.6, 0, 1.6, z1];
  for (let i = 0; i + 1 < steps.length; i++) {
    const za = steps[i];
    const zb = steps[i + 1];
    b.quad([x, ceilingHeight(za), za], [x, ceilingHeight(zb), zb], [x, baseUnderY(zb) + 0.002, zb], [x, baseUnderY(za) + 0.002, za], [1, 0, 0],
      [za / 0.6, ceilingHeight(za) / 2.4], [zb / 0.6, ceilingHeight(zb) / 2.4], [zb / 0.6, baseUnderY(zb) / 2.4], [za / 0.6, baseUnderY(za) / 2.4], 1);
    // Нижняя кромка балки (шириной 0,1 м внутрь навеса).
    b.quad([x, ceilingHeight(za) - 0.0005, za], [x - 0.1, ceilingHeight(za) - 0.0005, za], [x - 0.1, ceilingHeight(zb) - 0.0005, zb], [x, ceilingHeight(zb) - 0.0005, zb], [0, -1, 0], [0, 0], [0.1, 0], [0.1, 1], [0, 1], 1);
  }
  return b.build();
}

// Три компактных настенных светильника на торце у террасы: корпус + светящийся рассеиватель + источник.
export function buildWallLamps(lib) {
  const group = new THREE.Group();
  group.name = 'facade-lamps';
  const body = new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setStyle('#e9e6df', THREE.SRGBColorSpace), roughness: 0.45, clearcoat: 0.3 });
  const lights = [];
  for (const l of SPEC.exteriorFixtures.wallLamps) {
    const w = WALLS.find((q) => q.id === l.wall);
    const [x, z] = wallPoint(w, l.u, l.side, w.t / 2 + 0.05);
    const g = new THREE.Group();
    g.position.set(x, l.y, z);
    g.rotation.y = Math.atan2(w.nx * l.side, w.nz * l.side);
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.2, 0.1), body);
    box.castShadow = true;
    g.add(box);
    const diffuser = new THREE.Mesh(new THREE.PlaneGeometry(0.084, 0.084), lib.lampGlow());
    diffuser.rotation.x = Math.PI / 2;
    diffuser.position.y = -0.101;
    g.add(diffuser);
    const top = diffuser.clone();
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.101;
    g.add(top);
    const light = new THREE.PointLight(0xffc98a, 0, 7, 2);
    light.position.set(0, -0.15, 0.08);
    g.add(light);
    lights.push(light);
    group.add(g);
  }
  group.userData.lights = lights;
  return group;
}

// Пороги во всех дверных проёмах: закрывают пол на толщину стены между помещениями.
// Межкомнатные — дуб 10 мм с заходом 12 мм на полы; вход и остекление — графитовый алюминий
// с выносом на террасу. Видны во всех режимах, в том числе при разрезе стен.
export function buildThresholds(lib) {
  const group = new THREE.Group();
  group.name = 'thresholds';
  const oak = lib.floorWood('oak');
  const metal = lib.paintedMetal('#26282a', { key: 'frames' });
  for (const o of OPENINGS) {
    if (o.type !== 'door' && o.type !== 'entry' && o.type !== 'glazing') continue;
    const w = o.wall;
    const exterior = o.type !== 'door';
    const out = outsideSide(w);
    const overIn = 0.012;
    const overOut = exterior ? 0.035 : 0.012;
    const top = exterior ? 0.018 : 0.01;
    const bottom = exterior ? TERRACE_Y - 0.012 : -0.012;
    const depth = w.t + overIn + overOut;
    // Заход 5 мм под стену с каждой стороны: стык с торцом стены без волосяной щели.
    const width = o.to - o.from + 0.01;
    const g = new THREE.BoxGeometry(width, top - bottom, depth);
    // Белый цвет вершин: материал пола умножает карту на цвет вершин.
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3));
    // Скос кромок по глубине: верхние вершины у лицевых граней опускаются на 4 мм.
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > 0 && Math.abs(Math.abs(pos.getZ(i)) - depth / 2) < 1e-6) pos.setY(i, pos.getY(i) - 0.004);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, exterior ? metal : oak);
    // Центр: середина проёма по оси стены, смещение наружу на половину разницы выносов.
    const [cx, cz] = wallPoint(w, (o.from + o.to) / 2, out, (overOut - overIn) / 2);
    m.position.set(cx, (top + bottom) / 2, cz);
    m.rotation.y = Math.atan2(-w.uz, w.ux);
    m.castShadow = false;
    m.receiveShadow = true;
    m.userData.threshold = o.id;
    group.add(m);
  }
  return group;
}
