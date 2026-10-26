// Межкомнатные двери: коробка, наличники с обеих сторон, полотно 42 мм с филёнками,
// металлические ручки и петли, уплотнитель. Дверь парной — стеклянное полотно.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OPENINGS, SPEC, wallPoint } from './plan.js';
import { DOOR_BY_ID } from './walk-geometry.js';
import { poseHingedLeaf } from './exterior.js';

const D = SPEC.doors;
const geoCache = new Map();
function rbox(w, h, d, r = 0.003) {
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${r}`;
  if (!geoCache.has(key)) geoCache.set(key, new RoundedBoxGeometry(w, h, d, 2, r));
  return geoCache.get(key);
}

function mesh(geo, mat, x, y, z, slot) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  if (slot) m.userData.slot = slot;
  return m;
}

// Полотно в локальных координатах: x — от петли (0) к свободной кромке, y — вверх, z — толщина.
function buildLeaf(lib, width, glassLeaf) {
  const g = new THREE.Group();
  const t = D.leafThickness;
  const h = D.leafHeight;
  const paint = lib.doorPaint('door-light');
  if (glassLeaf) {
    const gl = mesh(rbox(width, h, 0.008, 0.002), lib.glass('bronze'), width / 2, 0.01 + h / 2, 0);
    gl.castShadow = false;
    gl.userData.excludeAO = true;
    gl.userData.glassPane = true;
    g.add(gl);
    // Деревянная ручка парной и петли.
    const wood = lib.naturalWood();
    g.add(mesh(rbox(0.04, 0.36, 0.035, 0.008), wood, width - 0.09, 1.0, 0.04));
    g.add(mesh(rbox(0.04, 0.36, 0.035, 0.008), wood, width - 0.09, 1.0, -0.04));
    for (const y of [0.25, h - 0.25]) g.add(mesh(rbox(0.06, 0.1, 0.02, 0.004), lib.brushed(), 0.03, y, 0));
    return g;
  }
  const slab = mesh(rbox(width, h, t, 0.0035), paint, width / 2, 0.01 + h / 2, 0, 'interiorDoors');
  g.add(slab);
  // Филёнки: по две на каждой стороне — рамка из тонких раскладок.
  const margin = 0.11;
  const split = 0.01 + h * 0.42;
  const panels = [[0.01 + margin, split - 0.05], [split + 0.05, 0.01 + h - margin]];
  for (const s of [1, -1]) {
    for (const [y0, y1] of panels) {
      const x0 = margin;
      const x1 = width - margin;
      const bead = 0.012;
      const z = s * (t / 2 + 0.002);
      const bars = [
        [(x0 + x1) / 2, y0, x1 - x0 + bead, bead],
        [(x0 + x1) / 2, y1, x1 - x0 + bead, bead],
        [x0, (y0 + y1) / 2, bead, y1 - y0],
        [x1, (y0 + y1) / 2, bead, y1 - y0],
      ];
      for (const [cx, cy, bw, bh] of bars) g.add(mesh(rbox(bw, bh, 0.005, 0.002), paint, cx, cy, z, 'interiorDoors'));
    }
  }
  // Ручки-нажимные с розетками, на высоте 1,0 м, 65 мм от кромки.
  const metal = lib.brushed();
  for (const s of [1, -1]) {
    const hx = width - 0.065;
    g.add(mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.01, 24).rotateX(Math.PI / 2), metal, hx, 1.0, s * (t / 2 + 0.005)));
    g.add(mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.05, 12).rotateX(Math.PI / 2), metal, hx, 1.0, s * (t / 2 + 0.03)));
    g.add(mesh(rbox(0.13, 0.018, 0.016, 0.007), metal, hx - 0.06, 1.0, s * (t / 2 + 0.055)));
    g.add(mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.008, 20).rotateX(Math.PI / 2), metal, hx, 0.86, s * (t / 2 + 0.004)));
  }
  // Петли.
  for (const y of [0.25, 1.05, h - 0.2]) g.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.1, 12), metal, -0.004, y, 0));
  return g;
}

// Коробка и наличники вокруг проёма; ось петли — по данным прогулки (единая геометрия).
export function buildInteriorDoors(lib) {
  const doors = [];
  for (const o of OPENINGS.filter((q) => q.type === 'door')) {
    const w = o.wall;
    const door = DOOR_BY_ID[o.id];
    const group = new THREE.Group();
    group.name = `door-${o.id}`;
    const glassLeaf = o.leaf === 'glass';
    const frameMat = lib.doorPaint('door-light');
    const width = o.to - o.from;
    const uDir = new THREE.Vector3(w.ux, 0, w.uz);
    const nDir = new THREE.Vector3(w.nx, 0, w.nz);
    const basis = new THREE.Matrix4().makeBasis(uDir, new THREE.Vector3(0, 1, 0), nDir);
    // Каркас в системе стены: x — вдоль стены от from, z — по нормали side=1.
    const frame = new THREE.Group();
    frame.quaternion.setFromRotationMatrix(basis);
    const [ox, oz] = wallPoint(w, o.from);
    frame.position.set(ox, 0, oz);
    const ft = 0.028; // толщина коробки
    const jambD = w.t + 0.012;
    frame.add(mesh(rbox(ft, o.high, jambD, 0.002), frameMat, ft / 2, o.high / 2, 0, 'interiorDoors'));
    frame.add(mesh(rbox(ft, o.high, jambD, 0.002), frameMat, width - ft / 2, o.high / 2, 0, 'interiorDoors'));
    frame.add(mesh(rbox(width, ft, jambD, 0.002), frameMat, width / 2, o.high - ft / 2, 0, 'interiorDoors'));
    // Притвор с уплотнителем (тёмная резина) со стороны открывания.
    const stopZ = o.swing * (w.t / 2 - D.leafThickness - 0.012);
    const seal = lib.rubber();
    frame.add(mesh(rbox(0.005, o.high - ft, 0.006, 0.001), seal, ft + 0.0025, (o.high - ft) / 2, stopZ));
    frame.add(mesh(rbox(0.005, o.high - ft, 0.006, 0.001), seal, width - ft - 0.0025, (o.high - ft) / 2, stopZ));
    frame.add(mesh(rbox(width - 2 * ft, 0.005, 0.006, 0.001), seal, width / 2, o.high - ft - 0.0025, stopZ));
    // Наличники 60 × 12 мм с обеих сторон (верх ≈ 2,16 м).
    const tw = 0.06;
    const tt = 0.012;
    for (const s of [1, -1]) {
      const z = s * (w.t / 2 + tt / 2);
      const trimTop = o.high - 0.012 + tw;
      frame.add(mesh(rbox(tw, trimTop, tt, 0.003), frameMat, -tw / 2 + 0.012, trimTop / 2, z, 'interiorDoors'));
      frame.add(mesh(rbox(tw, trimTop, tt, 0.003), frameMat, width + tw / 2 - 0.012, trimTop / 2, z, 'interiorDoors'));
      frame.add(mesh(rbox(width + 2 * tw - 0.024, tw, tt, 0.003), frameMat, width / 2, trimTop - tw / 2, z, 'interiorDoors'));
    }
    group.add(frame);
    const pivot = new THREE.Group();
    pivot.position.set(door.hinge[0], 0, door.hinge[1]);
    const leaf = buildLeaf(lib, door.width - (SPEC.doors.leafNarrower - 0.06), glassLeaf);
    pivot.add(leaf);
    group.add(pivot);
    group.userData = { door, pivot, opening: o, wallId: w.id };
    doors.push(group);
  }
  return doors;
}

export function poseDoor(group, angle) {
  poseHingedLeaf(group.userData.pivot, group.userData.door, angle);
}
