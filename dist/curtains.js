// Льняные шторы в жилых комнатах (приём sael.net/interior): две собранные панели по сторонам окна
// с синусоидальными складками, нижний край чуть расходится; карниз — тонкая штанга с кольцами
// и наконечниками. Детали настенные: при разрезе стен в редакторе скрываются вместе с верхом стены.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { OPENINGS, ROOM_BY_ID, ceilingHeight, wallPoint, roomOfWallSide } from './plan.js';
import { srgbColor } from './materials.js';

const ROOMS_WITH_CURTAINS = new Set(['room']);
const GAP = 0.085; // от лица стены до плоскости шторы

function panelGeometry(width, height, seed) {
  const nu = 34;
  const nv = 10;
  const g = new THREE.PlaneGeometry(width, height, nu, nv);
  const p = g.attributes.position;
  const folds = Math.max(4, Math.round(width / 0.055));
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) / width + 0.5;
    const v = p.getY(i) / height + 0.5;
    // Складки глубже у пола, верх собран на кольцах ровнее.
    const amp = 0.022 + 0.012 * (1 - v);
    const z = Math.sin(u * Math.PI * folds + seed) * amp + Math.sin(u * Math.PI * folds * 0.5 + seed * 1.7) * amp * 0.25;
    const flare = (1 - v) * (1 - v) * 0.035 * (u - 0.5);
    p.setXYZ(i, p.getX(i) + flare, p.getY(i), z);
  }
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width / 0.24, uv.getY(i) * height / 0.24);
  return g;
}

export function buildCurtains(lib) {
  const group = new THREE.Group();
  group.name = 'curtains';
  const linen = lib.make('curtainLinen', () => new THREE.MeshPhysicalMaterial({
    color: srgbColor('#d9cdb6'), map: lib.tex('fabric_albedo', true), normalMap: lib.tex('fabric_normal'), normalScale: new THREE.Vector2(0.5, 0.5),
    roughness: 0.92, sheen: 0.6, sheenRoughness: 0.6, sheenColor: srgbColor('#fff8ec'), side: THREE.DoubleSide, envMapIntensity: 0.3,
  }), { interior: true });
  const rodMat = lib.blackMetal(true);
  const panels = [];
  const rods = [];
  for (const o of OPENINGS.filter((q) => q.type === 'window')) {
    const w = o.wall;
    const out = !w.left || w.left === '008' ? 1 : -1;
    const room = ROOM_BY_ID[roomOfWallSide(w, -out)];
    if (!room || !ROOMS_WITH_CURTAINS.has(room.kind)) continue;
    const off = w.t / 2 + GAP;
    const [x0, z0] = wallPoint(w, o.from, -out, off);
    const [x1, z1] = wallPoint(w, o.to, -out, off);
    const ceil = Math.min(ceilingHeight(z0), ceilingHeight(z1));
    const rodY = Math.min(o.high + 0.12, ceil - 0.05);
    const H = rodY - 0.035;
    const yaw = Math.atan2(-w.uz, w.ux);
    // Плоскость панели (XY) поворачивается вдоль стены (правая тройка — без зеркального отражения).
    const ax3 = new THREE.Vector3(w.ux, 0, w.uz);
    const basis = new THREE.Matrix4().makeBasis(ax3, new THREE.Vector3(0, 1, 0), ax3.clone().cross(new THREE.Vector3(0, 1, 0)));
    for (const [u, side] of [[o.from, -1], [o.to, 1]]) {
      const pw = 0.3 + (o.to - o.from) * 0.05;
      const uc = u + side * (pw / 2 - 0.12);
      const [cx, cz] = wallPoint(w, uc, -out, off);
      const g = panelGeometry(pw, H, (o.from * 7 + side) % 6.28);
      g.applyMatrix4(basis);
      g.translate(cx, H / 2 + 0.012, cz);
      panels.push(g);
    }
    // Карниз: штанга Ø16 мм за пределы проёма на 0,25 м, кронштейны и наконечники.
    const ua = o.from - 0.25;
    const ub = o.to + 0.25;
    const [ax, az] = wallPoint(w, ua, -out, off);
    const [bx, bz] = wallPoint(w, ub, -out, off);
    const len = Math.hypot(bx - ax, bz - az);
    const rod = new THREE.CylinderGeometry(0.008, 0.008, len, 12).rotateZ(Math.PI / 2).rotateY(yaw).translate((ax + bx) / 2, rodY, (az + bz) / 2);
    rods.push(rod);
    for (const [ex, ez] of [[ax, az], [bx, bz]]) rods.push(new THREE.SphereGeometry(0.016, 14, 10).translate(ex, rodY, ez));
    for (const uu of [o.from - 0.12, o.to + 0.12]) {
      const [bx0, bz0] = wallPoint(w, uu, -out, w.t / 2 + GAP / 2);
      rods.push(new THREE.BoxGeometry(0.012, 0.012, GAP).applyMatrix4(new THREE.Matrix4().makeRotationY(yaw)).translate(bx0, rodY, bz0));
    }
  }
  const strip = (gs) => gs.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k);
    return n;
  });
  const pm = new THREE.Mesh(mergeGeometries(strip(panels)), linen);
  pm.castShadow = true;
  pm.receiveShadow = true;
  pm.userData.wallMounted = true;
  pm.name = 'curtain-panels';
  const rm = new THREE.Mesh(mergeGeometries(strip(rods)), rodMat);
  rm.castShadow = true;
  rm.userData.wallMounted = true;
  group.add(pm, rm);
  return group;
}
