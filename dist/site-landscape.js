// Благоустройство участка: деревянный забор из горизонтальной доски по границе с откатными воротами и
// калиткой, дорожки и въезд из серой тротуарной плитки с бордюром, гравийная отмостка вокруг построек,
// пруд с каменным берегом, деревянная купель, спортплощадка из резиновой крошки, крышки ЛОС, кострище
// с живым огнём и гриль-зона (FireZone базы), хвойные кусты у фасадов, высокая трава у препятствий.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, pointInPolygon, distToSegment } from './geometry.js';
import { SITE, BUILDING, groundY, insideSite, POND_LEVEL } from './site-data.js';
import { MeshBuilder, hash01 } from './mesh-builder.js';
import { srgbColor } from './materials.js';
import { tinted } from './site-arch.js';
import { FireZone } from './bbq-zone.js';
import { foliageMaterial } from './forest.js';
import { shrubGeometry, grassTuft, bladeMaterial } from './landscape.js';

const F = SITE.features;
const BND = SITE.boundary;

// Сглаживание ломаной (Чайкин) с сохранением концов.
function chaikin(pts, iter = 2) {
  let p = pts;
  for (let k = 0; k < iter; k++) {
    const out = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const [a, b] = [p[i], p[i + 1]];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}

// Лента по ломаной: плитка вдоль направления, бордюр по краям; высота — по рельефу + lift.
function ribbon(mb, curb, pts, width, lift = 0.03) {
  const n = pts.length;
  let acc = 0;
  const L = [], R = [];
  for (let i = 0; i < n; i++) {
    const [x, z] = pts[i];
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l;
    if (i > 0) acc += Math.hypot(x - pts[i - 1][0], z - pts[i - 1][1]);
    const h = width / 2;
    const l3 = [x - tz * h, 0, z + tx * h];
    const r3 = [x + tz * h, 0, z - tx * h];
    l3[1] = groundY(l3[0], l3[2]) + lift;
    r3[1] = groundY(r3[0], r3[2]) + lift;
    const il = mb.vertex(l3, [0, 1, 0], [acc / 0.8, -h / 0.8], 1);
    const ir = mb.vertex(r3, [0, 1, 0], [acc / 0.8, h / 0.8], 1);
    if (i > 0) mb.idx.push(il - 2, il, ir - 2, ir - 2, il, ir);
    L.push(l3); R.push(r3);
  }
  // Бордюр 60 × 50 мм по обеим сторонам.
  for (const side of [L, R]) {
    for (let i = 0; i + 1 < side.length; i++) {
      const a = side[i], b = side[i + 1];
      const d = [b[0] - a[0], b[2] - a[2]];
      const l = Math.hypot(...d) || 1;
      const nx = -d[1] / l * 0.03, nz = d[0] / l * 0.03;
      const top = [[a[0] + nx, a[1] + 0.02, a[2] + nz], [b[0] + nx, b[1] + 0.02, b[2] + nz], [b[0] - nx, b[1] + 0.02, b[2] - nz], [a[0] - nx, a[1] + 0.02, a[2] - nz]];
      curb.quad(...top, [0, 1, 0], [0, 0], [l, 0], [l, 0.06], [0, 0.06]);
      for (const s of [1, -1]) {
        const p0 = [a[0] + nx * s, a[1] + 0.02, a[2] + nz * s], p1 = [b[0] + nx * s, b[1] + 0.02, b[2] + nz * s];
        curb.quad(p0, p1, [p1[0], p1[1] - 0.09, p1[2]], [p0[0], p0[1] - 0.09, p0[2]], [nx / 0.03 * s, 0, nz / 0.03 * s], [0, 0], [l, 0], [l, 0.09], [0, 0.09]);
      }
    }
  }
}

// Многоугольник по рельефу (плитка, крошка): триангуляция в плане, высота по рельефу + lift.
function draped(mb, poly, lift, uvTile = 0.8, step = 0.5) {
  // Разбиение на сетку внутри многоугольника — чтобы покрытие повторяло рельеф.
  const xs = poly.map((p) => p[0]), zs = poly.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
  const nx = Math.max(1, Math.ceil((x1 - x0) / step)), nz = Math.max(1, Math.ceil((z1 - z0) / step));
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const cell = [[x0 + (i * (x1 - x0)) / nx, z0 + (j * (z1 - z0)) / nz], [x0 + ((i + 1) * (x1 - x0)) / nx, z0 + (j * (z1 - z0)) / nz],
      [x0 + ((i + 1) * (x1 - x0)) / nx, z0 + ((j + 1) * (z1 - z0)) / nz], [x0 + (i * (x1 - x0)) / nx, z0 + ((j + 1) * (z1 - z0)) / nz]];
    let c = cell;
    for (let k = 0; k < poly.length && c.length >= 3; k++) {
      const a = poly[k], b = poly[(k + 1) % poly.length];
      // Полуплоскость внутренней стороны ребра (многоугольник выпуклый).
      const cx = xs.reduce((s, v) => s + v, 0) / xs.length, cz = zs.reduce((s, v) => s + v, 0) / zs.length;
      let ex = -(b[1] - a[1]), ez = b[0] - a[0];
      if ((cx - a[0]) * ex + (cz - a[1]) * ez < 0) { ex = -ex; ez = -ez; }
      const f = (p) => -((p[0] - a[0]) * ex + (p[1] - a[1]) * ez);
      const out = [];
      for (let q = 0; q < c.length; q++) {
        const p0 = c[q], p1 = c[(q + 1) % c.length];
        const f0 = f(p0), f1 = f(p1);
        if (f0 <= 0) out.push(p0);
        if ((f0 < 0 && f1 > 0) || (f0 > 0 && f1 < 0)) { const t = f0 / (f0 - f1); out.push([p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t]); }
      }
      c = out;
    }
    if (c.length < 3) continue;
    const base = mb.vertexCount;
    for (const [x, z] of c) mb.vertex([x, groundY(x, z) + lift, z], [0, 1, 0], [x / uvTile, z / uvTile], 1);
    for (let k = 1; k + 1 < c.length; k++) mb.idx.push(base, base + k + 1, base + k);
  }
}

function mesh(geo, mat, name, { cast = false, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.name = name;
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}

// ---------- забор ----------
function buildFence(lib, gates) {
  const wood = lib.deckWood('smoked');
  const steel = lib.plain('fenceSteel', { color: srgbColor('#2a2b2d'), roughness: 0.55, metalness: 0.5, envMapIntensity: 0.6 });
  const boards = [], posts = [], frames = [];
  const H = 1.8, bh = 0.12, gap = 0.02, inset = 0.06;
  const cpPosts = BUILDING.garage.carport.posts;
  const cut = (x) => (x > gates.gate.x0 && x < gates.gate.x1) || (x > gates.wicket.x0 - 0.05 && x < gates.wicket.x1 + 0.05);
  for (let e = 0; e < 4; e++) {
    const a = BND[e], b = BND[(e + 1) % 4];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const u = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    let n = [-u[1], u[0]];
    if (!insideSite((a[0] + b[0]) / 2 + n[0] * 0.5, (a[1] + b[1]) / 2 + n[1] * 0.5)) n = [-n[0], -n[1]];
    // Разбиение на пролёты ≤ 2,5 м; на южной стороне — разрывы под ворота и калитку.
    const marks = [0, len];
    if (e === 2) for (const g of [gates.gate, gates.wicket]) for (const x of [g.x0, g.x1]) marks.push((x - a[0]) / u[0]);
    marks.sort((p, q) => p - q);
    const stations = [];
    for (let i = 0; i + 1 < marks.length; i++) {
      const s0 = marks[i], s1 = marks[i + 1];
      const k = Math.max(1, Math.ceil((s1 - s0) / 2.5));
      for (let j = 0; j <= k; j++) stations.push(s0 + ((s1 - s0) * j) / k);
    }
    const uniq = [...new Set(stations.map((v) => Math.round(v * 1000) / 1000))].sort((p, q) => p - q);
    for (let i = 0; i < uniq.length; i++) {
      const s = uniq[i];
      const x = a[0] + u[0] * s + n[0] * inset, z = a[1] + u[1] * s + n[1] * inset;
      const nearPier = cpPosts.some((p) => Math.hypot(p[0] - x, p[1] - z) < 0.4);
      const y = groundY(x, z);
      if (!nearPier) posts.push(new THREE.BoxGeometry(0.1, H + 0.15, 0.1).translate(x, y + (H + 0.15) / 2 - 0.05, z));
      if (i + 1 === uniq.length) continue;
      const s2 = uniq[i + 1];
      const mx = a[0] + u[0] * (s + s2) / 2, mz = a[1] + u[1] * (s + s2) / 2;
      if (e === 2 && cut(mx)) continue;
      const x2 = a[0] + u[0] * s2 + n[0] * inset, z2 = a[1] + u[1] * s2 + n[1] * inset;
      const yb = Math.min(y, groundY(x2, z2)) + 0.05;
      const bl = s2 - s;
      for (let k = 0; k < Math.floor(H / (bh + gap)); k++) {
        const g = new THREE.BoxGeometry(bl + 0.02, bh, 0.022);
        g.rotateY(-Math.atan2(u[1], u[0]));
        g.translate((x + x2) / 2 + n[0] * 0.062, yb + k * (bh + gap) + bh / 2, (z + z2) / 2 + n[1] * 0.062);
        boards.push(g);
      }
    }
  }
  // Откатные ворота (полотно в закрытом положении) и калитка: та же доска в стальной раме, направляющая.
  const sx = (x) => [x, (BND[3][1] + (BND[2][1] - BND[3][1]) * (x - BND[3][0]) / (BND[2][0] - BND[3][0])) - 0.12];
  const leaf = (x0, x1, h, y0) => {
    const [ax, az] = sx(x0), [bx, bz] = sx(x1);
    const ang = -Math.atan2(bz - az, bx - ax);
    const w = Math.hypot(bx - ax, bz - az);
    const c = [(ax + bx) / 2, (az + bz) / 2];
    const yb = Math.min(groundY(ax, az), groundY(bx, bz)) + y0;
    for (let k = 0; k < Math.floor((h - 0.08) / (bh + gap)); k++) {
      boards.push(new THREE.BoxGeometry(w - 0.08, bh, 0.022).rotateY(ang).translate(c[0], yb + 0.05 + k * (bh + gap) + bh / 2, c[1]));
    }
    for (const [dx, dy, lw, lh] of [[0, 0.02, w, 0.04], [0, h - 0.02, w, 0.04], [-w / 2 + 0.02, h / 2, 0.04, h], [w / 2 - 0.02, h / 2, 0.04, h]]) {
      const g = new THREE.BoxGeometry(lw, lh, 0.04).translate(dx, 0, 0).rotateY(ang).translate(c[0], yb + dy, c[1]);
      frames.push(g);
    }
  };
  leaf(gates.gate.x0, gates.gate.x1, H - 0.05, 0.08);
  leaf(gates.wicket.x0, gates.wicket.x1, H - 0.05, 0.05);
  for (const x of [gates.gate.x0 - 0.06, gates.gate.x1 + 0.06, gates.wicket.x0 - 0.04, gates.wicket.x1 + 0.04]) {
    const [px, pz] = sx(x);
    frames.push(new THREE.BoxGeometry(0.1, H + 0.2, 0.1).translate(px, groundY(px, pz) + (H + 0.2) / 2 - 0.05, pz));
  }
  // Направляющая откатных ворот — вдоль забора внутрь до конца отката.
  {
    const [ax, az] = sx(gates.gate.x0), [bx, bz] = sx(gates.slideEnd);
    const w = Math.hypot(bx - ax, bz - az);
    frames.push(new THREE.BoxGeometry(w, 0.06, 0.06).rotateY(-Math.atan2(bz - az, bx - ax)).translate((ax + bx) / 2, groundY(ax, az) + 0.04, (az + bz) / 2));
  }
  const col = (g) => { g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3)); return g; };
  const group = new THREE.Group();
  group.name = 'fence';
  group.add(mesh(mergeGeometries(boards.map(col)), wood, 'fence:boards', { cast: true }));
  group.add(mesh(mergeGeometries(posts.map(col)), wood, 'fence:posts', { cast: true }));
  group.add(mesh(mergeGeometries(frames.map(col)), steel, 'fence:steel', { cast: true }));
  return group;
}

// ---------- мощение ----------
function buildPaving(lib) {
  const group = new THREE.Group();
  group.name = 'paving';
  const pavers = lib.make('site|pavers', () => new THREE.MeshPhysicalMaterial({
    map: lib.tex('pavers_albedo', true), normalMap: lib.tex('pavers_normal'), normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: lib.tex('pavers_rough'), roughness: 1, envMapIntensity: 0.5, color: tinted('#aeaaa3', 'pavers_albedo'),
  }));
  const curbMat = lib.plain('curb', { color: srgbColor('#a9a7a1'), roughness: 0.9, normalMap: lib.tex('stucco_normal'), normalScale: new THREE.Vector2(0.4, 0.4), envMapIntensity: 0.5 });
  const pmb = new MeshBuilder();
  const cmb = new MeshBuilder();
  for (const p of SITE.paths) ribbon(pmb, cmb, chaikin(p.pts, 3), p.width);
  // Въезд: от ворот до пола навеса; пол навеса.
  const cp = BUILDING.garage.carport;
  draped(pmb, cp.floor, 0.025, 0.8, 0.5);
  const g = SITE.gates.gate;
  const sz = (x) => BND[3][1] + (BND[2][1] - BND[3][1]) * (x - BND[3][0]) / (BND[2][0] - BND[3][0]);
  const floorS = Math.max(...cp.floor.map((q) => q[1]));
  draped(pmb, [[g.x0 - 0.3, floorS - 0.05], [g.x1 + 0.3, floorS - 0.05], [g.x1 + 0.3, sz(g.x1) - 0.08], [g.x0 - 0.3, sz(g.x0) - 0.08]], 0.025);
  group.add(mesh(pmb.build(), pavers, 'paving:pavers'));
  group.add(mesh(cmb.build(), curbMat, 'paving:curb'));
  // Гравийная отмостка 0,5 м вокруг построек (под ступенями и настилом — тоже гравий).
  const gmb = new MeshBuilder();
  for (const b of SITE.buildings) for (const poly of b.footprint) apron(gmb, poly, 0.03, 0.55);
  const gravel = lib.gravel('apron', '#d9d4ca');
  gravel.polygonOffset = true;
  gravel.polygonOffsetFactor = -1;
  gravel.polygonOffsetUnits = -1;
  group.add(mesh(gmb.build(), gravel, 'paving:apron'));
  return group;
}

// Полоса вокруг многоугольника (смещения d0…d1 наружу, с подрезкой углов).
function apron(mb, poly, d0, d1) {
  const n = poly.length;
  const off = (d) => poly.map((p, i) => {
    const a = poly[(i - 1 + n) % n], b = poly[(i + 1) % n];
    const e1 = norm2([p[0] - a[0], p[1] - a[1]]), e2 = norm2([b[0] - p[0], b[1] - p[1]]);
    let n1 = [e1[1], -e1[0]], n2 = [e2[1], -e2[0]];
    if (pointInPolygon(p[0] + (n1[0] + n2[0]) * 0.01, p[1] + (n1[1] + n2[1]) * 0.01, poly)) { n1 = [-n1[0], -n1[1]]; n2 = [-n2[0], -n2[1]]; }
    const m = norm2([n1[0] + n2[0], n1[1] + n2[1]]);
    const k = d / Math.max(0.35, m[0] * n1[0] + m[1] * n1[1]);
    return [p[0] + m[0] * k, p[1] + m[1] * k];
  });
  const A = off(d0), B = off(d1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const seg = Math.max(1, Math.ceil(Math.hypot(B[j][0] - B[i][0], B[j][1] - B[i][1]) / 0.6));
    for (let k = 0; k < seg; k++) {
      const t0 = k / seg, t1 = (k + 1) / seg;
      const P = (Q, t) => [Q[i][0] + (Q[j][0] - Q[i][0]) * t, Q[i][1] + (Q[j][1] - Q[i][1]) * t];
      const quad = [P(A, t0), P(A, t1), P(B, t1), P(B, t0)];
      const base = mb.vertexCount;
      for (const [x, z] of quad) mb.vertex([x, groundY(x, z) + 0.015, z], [0, 1, 0], [x / 0.8, z / 0.8], 1);
      // Обход по нормали вверх.
      const cr = (quad[1][0] - quad[0][0]) * (quad[2][1] - quad[0][1]) - (quad[1][1] - quad[0][1]) * (quad[2][0] - quad[0][0]);
      if (cr < 0) mb.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      else mb.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
}
const norm2 = (v) => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l]; };

// ---------- площадки ----------
function buildFeatures(lib, quality) {
  const group = new THREE.Group();
  group.name = 'features';
  const stoneMat = lib.fieldStone();
  // Пруд: чаша в рельефе (site-data.js), вода на уровне POND_LEVEL, валуны по берегу.
  {
    const { center: [cx, cz], r } = F.pond;
    const water = new THREE.Mesh(new THREE.CircleGeometry(r - 0.05, 64).rotateX(-Math.PI / 2).translate(cx, POND_LEVEL, cz), lib.make('site|water', () => new THREE.MeshPhysicalMaterial({
      color: srgbColor('#4a5a50'), roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, normalMap: lib.tex('water_normal'), normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 1.2,
    })));
    const wuv = water.geometry.attributes.uv;
    const wp = water.geometry.attributes.position;
    for (let i = 0; i < wp.count; i++) wuv.setXY(i, wp.getX(i) / 2, wp.getZ(i) / 2);
    water.name = 'pond:water';
    water.receiveShadow = true;
    group.add(water);
    // Берег: валуны разного размера с промежутками, мелкие камни во втором ряду у воды.
    const r0 = rng(4141);
    const rocks = [];
    const rock = (x, z, s, flat, y) => {
      const ico = new THREE.IcosahedronGeometry(1, 2);
      ico.deleteAttribute('normal');
      ico.deleteAttribute('uv');
      const g = mergeVertices(ico);
      const p = g.attributes.position;
      const seed = rocks.length * 131;
      for (let k = 0; k < p.count; k++) {
        const f = 0.78 + 0.4 * hash01(seed + k);
        p.setXYZ(k, p.getX(k) * f, p.getY(k) * f * flat, p.getZ(k) * f);
      }
      g.computeVertexNormals();
      const uv = new Float32Array(p.count * 2);
      for (let k = 0; k < p.count; k++) { uv[k * 2] = p.getX(k) + p.getY(k) * 0.5; uv[k * 2 + 1] = p.getZ(k); }
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      g.scale(s * (1 + r0() * 0.5), s, s).rotateY(r0() * 6.28).translate(x, y, z);
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(p.count * 3).fill(0.55 + r0() * 0.25), 3));
      rocks.push(g);
    };
    for (let a = 0; a < Math.PI * 2;) {
      const s = 0.12 + r0() ** 1.8 * 0.3;
      if (r0() > 0.1) {
        const rr = r + (r0() - 0.4) * 0.16;
        rock(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, s, 0.5 + r0() * 0.2, POND_LEVEL + 0.02 - s * 0.12);
      }
      a += (s * 1.5 + 0.06 + r0() * 0.18) / r;
    }
    for (let i = 0; i < 18; i++) {
      const a = r0() * Math.PI * 2;
      const rr = r - 0.25 - r0() * 0.15;
      rock(cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, 0.07 + r0() * 0.07, 0.45, POND_LEVEL - 0.03);
    }
    group.add(mesh(mergeGeometries(rocks), stoneMat, 'pond:stones', { cast: true }));
  }
  // Купель: бочка из вертикальной доски Ø 1,8 × 1,1 м, два стальных обруча, вода, ступени.
  {
    const { center: [cx, cz], r } = F.plungePool;
    const y = groundY(cx, cz);
    const wood = lib.deckWood('oak');
    const staves = [];
    const n = 40;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const g = new THREE.BoxGeometry(0.13, 1.1, 0.045).rotateY(-a + Math.PI / 2).translate(cx + Math.cos(a) * (r - 0.025), y + 0.55, cz + Math.sin(a) * (r - 0.025));
      staves.push(g);
    }
    const col = (g) => { g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3)); return g; };
    group.add(mesh(mergeGeometries(staves.map(col)), wood, 'pool:staves', { cast: true }));
    const steel = lib.blackMetal(false);
    for (const h of [0.22, 0.88]) group.add(mesh(new THREE.TorusGeometry(r + 0.004, 0.012, 6, 64).rotateX(Math.PI / 2).translate(cx, y + h, cz), steel, 'pool:hoop', { cast: true }));
    const water = new THREE.Mesh(new THREE.CircleGeometry(r - 0.05, 48).rotateX(-Math.PI / 2).translate(cx, y + 0.92, cz), lib.make('site|poolWater', () => new THREE.MeshPhysicalMaterial({ color: srgbColor('#3d5a5c'), roughness: 0.03, clearcoat: 1, normalMap: lib.tex('water_normal'), normalScale: new THREE.Vector2(0.15, 0.15), envMapIntensity: 1.3 })));
    water.name = 'pool:water';
    group.add(water);
    // Ступени со стороны бани (с востока).
    const toward = [0.9, -0.43];
    const l = Math.hypot(...toward);
    const d = [toward[0] / l, toward[1] / l];
    for (let k = 0; k < 2; k++) {
      const x = cx + d[0] * (r + 0.2 + (1 - k) * 0.3), z = cz + d[1] * (r + 0.2 + (1 - k) * 0.3);
      group.add(mesh(col(new THREE.BoxGeometry(0.6, 0.06, 0.32).rotateY(-Math.atan2(d[1], d[0]) + Math.PI / 2).translate(x, y + 0.38 + k * 0.38, z)), wood, 'pool:step', { cast: true }));
    }
  }
  // Спортплощадка: резиновая крошка 30 мм по рельефу с бетонным бортом.
  {
    const rubber = lib.make('site|rubber', () => new THREE.MeshStandardMaterial({ map: lib.tex('rubber_albedo', true), normalMap: lib.tex('rubber_normal'), normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.95, color: tinted('#8e8b85', 'rubber_albedo'), envMapIntensity: 0.3 }));
    const mb = new MeshBuilder();
    draped(mb, F.sport.poly, 0.035, 0.5, 0.5);
    group.add(mesh(mb.build(), rubber, 'sport:surface'));
    const cmb = new MeshBuilder();
    const curb = [];
    const P = F.sport.poly;
    for (let i = 0; i < 4; i++) {
      const a = P[i], b = P[(i + 1) % 4];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = Math.ceil(L / 0.5);
      for (let j = 0; j < k; j++) {
        const t0 = j / k, t1 = (j + 1) / k;
        const p0 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0], p1 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        curb.push([p0, p1]);
      }
    }
    for (const [p0, p1] of curb) {
      const y0 = groundY(...p0) + 0.06, y1 = groundY(...p1) + 0.06;
      const d = norm2([p1[0] - p0[0], p1[1] - p0[1]]);
      const nn = [-d[1] * 0.04, d[0] * 0.04];
      cmb.quad([p0[0] + nn[0], y0, p0[1] + nn[1]], [p1[0] + nn[0], y1, p1[1] + nn[1]], [p1[0] - nn[0], y1, p1[1] - nn[1]], [p0[0] - nn[0], y0, p0[1] - nn[1]], [0, 1, 0], [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
      for (const s of [1, -1]) cmb.quad([p0[0] + nn[0] * s, y0, p0[1] + nn[1] * s], [p1[0] + nn[0] * s, y1, p1[1] + nn[1] * s], [p1[0] + nn[0] * s, y1 - 0.1, p1[1] + nn[1] * s], [p0[0] + nn[0] * s, y0 - 0.1, p0[1] + nn[1] * s], [nn[0] * 25 * s, 0, nn[1] * 25 * s], [0, 0], [1, 0], [1, 0.1], [0, 0.1]);
    }
    group.add(mesh(cmb.build(), lib.plain('curb', { color: srgbColor('#a9a7a1'), roughness: 0.9 }), 'sport:curb', { cast: true }));
  }
  // ЛОС: две крышки в газоне и вентиляционная труба.
  {
    const P = F.septic.poly;
    const c = [(P[0][0] + P[2][0]) / 2, (P[0][1] + P[2][1]) / 2];
    const lid = lib.plain('septicLid', { color: srgbColor('#3f4a3a'), roughness: 0.7, envMapIntensity: 0.4 });
    for (const dx of [-0.65, 0.65]) {
      const x = c[0] + dx, z = c[1];
      const y = groundY(x, z);
      group.add(mesh(new THREE.CylinderGeometry(0.34, 0.37, 0.08, 32).translate(x, y + 0.03, z), lid, 'septic:lid', { cast: true }));
    }
    const y = groundY(c[0] + 1.2, c[1] - 0.6);
    group.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.6, 16).translate(c[0] + 1.2, y + 0.3, c[1] - 0.6), lid, 'septic:vent', { cast: true }));
  }
  void quality;
  return group;
}

// Кострище (живой огонь, две скамьи и пни) и гриль-зона (мангал на плитняке, скамья, поленница).
function buildFireZones(lib, quality) {
  const fp = F.firePit;
  const gz = F.grillZone;
  const fire = new FireZone(lib, {
    quality, name: 'fire-pit', radius: fp.r, center: { x: fp.center[0], y: groundY(...fp.center) + 0.01, z: fp.center[1] },
    layout: { benches: [{ deg: -150, r: fp.r + 0.38, len: 1.5 }, { deg: -30, r: fp.r + 0.38, len: 1.5 }, { deg: 122, r: fp.r + 0.38, len: 1.3 }], stumps: [{ deg: 50, r: fp.r + 0.3 }] },
  });
  const grill = new FireZone(lib, {
    quality, name: 'grill-zone', pit: false, radius: gz.r, patioSeed: 6464, center: { x: gz.center[0], y: groundY(...gz.center) + 0.01, z: gz.center[1] },
    layout: { benches: [{ deg: 120, r: 1.05, len: 1.4 }], stumps: [{ deg: 30, r: 1.1 }], grill: { deg: 225, r: 0.75 }, woodpile: { deg: 250, r: gz.r + 0.75 }, posts: [] },
  });
  return [fire, grill];
}

// ---------- кусты у фасадов ----------
// Низкие хвойные кусты в 0,95 м от стен; не перед дверями и остеклением до пола, не на дорожках,
// не у стволов, обеденной площадки и купели.
function shrubSpots(openings) {
  const spots = [];
  const r = rng(7171);
  const avoid = [];
  for (const p of SITE.paths) for (let i = 0; i + 1 < p.pts.length; i++) avoid.push({ a: p.pts[i], b: p.pts[i + 1], d: p.width / 2 + 0.6 });
  const low = openings.filter((o) => o.low < 0.9);
  const dining = BUILDING.grill.dining;
  for (const b of SITE.buildings) {
    for (const poly of b.footprint) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i], c = poly[(i + 1) % poly.length];
        const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (L < 1.5) continue;
        const u = [(c[0] - a[0]) / L, (c[1] - a[1]) / L];
        let n = [u[1], -u[0]];
        if (pointInPolygon((a[0] + c[0]) / 2 + n[0] * 0.05, (a[1] + c[1]) / 2 + n[1] * 0.05, poly)) n = [-n[0], -n[1]];
        for (let s = 0.7; s < L - 0.6; s += 1.25 + r() * 0.5) {
          const x = a[0] + u[0] * s + n[0] * 0.95, z = a[1] + u[1] * s + n[1] * 0.95;
          if (SITE.buildings.some((bb) => bb.footprint.some((pp) => pointInPolygon(x, z, pp)))) continue;
          if (!insideSite(x, z) || pointInPolygon(x, z, BUILDING.garage.carport.floor)) continue;
          if (avoid.some((q) => distToSegment(x, z, q.a[0], q.a[1], q.b[0], q.b[1]).d < q.d)) continue;
          if (pointInPolygon(x, z, dining) || Math.hypot(x - F.plungePool.center[0], z - F.plungePool.center[1]) < F.plungePool.r + 0.9) continue;
          if (low.some((o) => {
            const dx = x - o.x, dz = z - o.z;
            const along = Math.abs(dx * -o.n[1] + dz * o.n[0]);
            const out = dx * o.n[0] + dz * o.n[1];
            return out > -0.2 && out < 2.2 && along < o.half + 0.7;
          })) continue;
          if (SITE.trees.some((t) => t.status === 'keep' && Math.hypot(t.pos[0] - x, t.pos[1] - z) < 0.9)) continue;
          spots.push({ x, z, rad: 0.32 + r() * 0.2, h: 0.45 + r() * 0.35, seed: spots.length });
        }
      }
    }
  }
  return spots;
}

function buildShrubs(lib, openings) {
  const group = new THREE.Group();
  group.name = 'shrubs';
  const needles = foliageMaterial(lib.needles());
  needles.color = new THREE.Color(0.24, 0.32, 0.2);
  const core = new THREE.MeshStandardMaterial({ color: new THREE.Color().setStyle('#1b2614', THREE.SRGBColorSpace), roughness: 1 });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: needles.map, alphaTest: 0.42, side: THREE.DoubleSide });
  const ends = SITE.paths.map((p) => p.pts[p.pts.length - 1]);
  const spots = shrubSpots(openings).filter((s) => !ends.some((p) => Math.hypot(p[0] - s.x, p[1] - s.z) < 1.4));
  // Три варианта геометрии, экземпляры с масштабом.
  const variants = [0, 1, 2].map((k) => shrubGeometry(900 + k, 1, 0.75, 1, 0.42, 30));
  const coreGeo = new THREE.IcosahedronGeometry(1, 1);
  for (let v = 0; v < 3; v++) {
    const items = spots.filter((s) => s.seed % 3 === v);
    if (!items.length) continue;
    const im = new THREE.InstancedMesh(variants[v], needles, items.length);
    const ic = new THREE.InstancedMesh(coreGeo, core, items.length);
    const m = new THREE.Matrix4();
    items.forEach((s, i) => {
      const y = groundY(s.x, s.z);
      m.compose(new THREE.Vector3(s.x, y + s.h * 0.62, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.seed * 1.7), new THREE.Vector3(s.rad * 1.5, s.h, s.rad * 1.5));
      im.setMatrixAt(i, m);
      m.compose(new THREE.Vector3(s.x, y + s.h * 0.55, s.z), new THREE.Quaternion(), new THREE.Vector3(s.rad * 1.1, s.h * 0.55, s.rad * 1.1));
      ic.setMatrixAt(i, m);
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.customDepthMaterial = depth;
    im.userData.excludeAO = true;
    ic.castShadow = true;
    group.add(im, ic);
  }
  group.userData.spots = spots;
  return group;
}

// Высокая трава у забора, стволов, кустов и краёв мощения (стриженый газон даёт карта).
function buildTallGrass(count, shrubs) {
  const r = rng(5252);
  const pts = [];
  const tries = count * 3;
  const sources = [];
  for (let e = 0; e < 4; e++) sources.push({ kind: 'seg', a: BND[e], b: BND[(e + 1) % 4], off: [0.12, 0.6] });
  for (const t of SITE.trees.filter((q) => q.status === 'keep')) sources.push({ kind: 'ring', c: t.pos, r: [0.15, 0.9] });
  for (const s of shrubs) sources.push({ kind: 'ring', c: [s.x, s.z], r: [s.rad * 1.2, s.rad * 2.2] });
  for (let i = 0; i < tries && pts.length < count; i++) {
    const src = sources[Math.floor(r() * sources.length)];
    let x, z;
    if (src.kind === 'seg') {
      const t = r();
      const L = Math.hypot(src.b[0] - src.a[0], src.b[1] - src.a[1]);
      let n = [-(src.b[1] - src.a[1]) / L, (src.b[0] - src.a[0]) / L];
      const mx = src.a[0] + (src.b[0] - src.a[0]) * t, mz = src.a[1] + (src.b[1] - src.a[1]) * t;
      if (!insideSite(mx + n[0] * 0.5, mz + n[1] * 0.5)) n = [-n[0], -n[1]];
      const o = src.off[0] + (src.off[1] - src.off[0]) * r();
      x = mx + n[0] * o; z = mz + n[1] * o;
    } else {
      const a = r() * Math.PI * 2;
      const d = src.r[0] + (src.r[1] - src.r[0]) * Math.sqrt(r());
      x = src.c[0] + Math.cos(a) * d; z = src.c[1] + Math.sin(a) * d;
    }
    if (!insideSite(x, z)) continue;
    if (SITE.buildings.some((b) => b.footprint.some((p) => pointInPolygon(x, z, p)))) continue;
    if (SITE.paths.some((p) => p.pts.some((q, k) => k + 1 < p.pts.length && distToSegment(x, z, q[0], q[1], p.pts[k + 1][0], p.pts[k + 1][1]).d < p.width / 2 + 0.1))) continue;
    if (pointInPolygon(x, z, F.sport.poly) || Math.hypot(x - F.pond.center[0], z - F.pond.center[1]) < F.pond.r - 0.1) continue;
    pts.push({ x, z, rot: r() * 6.283, s: 0.7 + r() * 0.6, sy: 0.7 + r() * 0.7 });
  }
  const root = [0.045, 0.065, 0.02];
  const tips = [[0.16, 0.19, 0.06], [0.2, 0.21, 0.075], [0.13, 0.17, 0.05], [0.24, 0.22, 0.09]];
  const clump = mergeGeometries([0, 1, 2].map((k) => grassTuft(1300 + k, { blades: 12, h0: 0.12, h1: 0.3, spread: 0.14, root, tips })));
  const im = new THREE.InstancedMesh(clump, bladeMaterial(), Math.max(1, pts.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  pts.forEach((p, i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.rot);
    m.compose(new THREE.Vector3(p.x, groundY(p.x, p.z) - 0.005, p.z), q, new THREE.Vector3(p.s, p.s * p.sy, p.s));
    im.setMatrixAt(i, m);
  });
  im.count = pts.length;
  im.receiveShadow = true;
  im.name = 'grass';
  im.computeBoundingSphere();
  return im;
}

export function buildSiteLandscape(lib, { quality = 'high', grassCount = 6000, openings = [] } = {}) {
  const group = new THREE.Group();
  group.name = 'landscape';
  group.add(buildFence(lib, SITE.gates));
  group.add(buildPaving(lib));
  group.add(buildFeatures(lib, quality));
  const shrubs = buildShrubs(lib, openings);
  group.add(shrubs);
  if (grassCount > 0) group.add(buildTallGrass(grassCount, shrubs.userData.spots));
  const fires = buildFireZones(lib, quality);
  for (const f of fires) group.add(f.group);
  group.userData.fires = fires;
  return group;
}
