// Водосточная система по карнизам обоих скатов: полукруглый желоб Ø125 мм с завальцованной кромкой,
// крюки через 0,6 м, заглушки, воронки, трубы Ø90 мм с коленами к стене, хомуты и отмёты на гравий
// отмостки. Цвет — графит кровли; скрывается вместе с кровлей в режиме «Внутри».
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SPEC, GROUND_Y } from './plan.js';
import { ROOF_EXTENT, baseTopY } from './roof-covering.js';

const R = 0.0625;
const PIPE = 0.045;
const DOWNPIPES_X = [-5.78, 7.32];

// Ломаная со скруглёнными углами (колена труб).
function fillet(points, radius, segs = 6) {
  const out = [points[0].clone()];
  for (let i = 1; i + 1 < points.length; i++) {
    const p = points[i];
    const a = points[i - 1].clone().sub(p);
    const b = points[i + 1].clone().sub(p);
    const r = Math.min(radius, a.length() * 0.45, b.length() * 0.45);
    a.normalize();
    b.normalize();
    const p0 = p.clone().addScaledVector(a, r);
    const p1 = p.clone().addScaledVector(b, r);
    for (let k = 0; k <= segs; k++) {
      const t = k / segs;
      // Квадратичная кривая Безье через вершину угла.
      out.push(p0.clone().multiplyScalar((1 - t) * (1 - t)).addScaledVector(p, 2 * t * (1 - t)).addScaledVector(p1, t * t));
    }
  }
  out.push(points[points.length - 1].clone());
  return out;
}

function gutterProfile() {
  const s = new THREE.Shape();
  const t = 0.0012;
  // Полукольцо снизу (от внешней кромки к стене) и обратно по внутренней стороне.
  s.absarc(0, 0, R, 0, Math.PI, true);
  s.absarc(0, 0, R - t, Math.PI, 0, false);
  return s;
}

export function buildGutters() {
  const parts = [];
  const { x0, x1, zEave } = ROOF_EXTENT;
  const len = x1 - x0 + 0.04;
  for (const side of [-1, 1]) {
    const zE = side * (zEave + 0.02);
    const yTop = baseTopY(zE) - 0.035;
    const zc = side * (zEave + 0.02 + R + 0.004);
    // Желоб: выдавливание профиля вдоль X; кромка-валик по внешнему краю.
    const g = new THREE.ExtrudeGeometry(gutterProfile(), { depth: len, bevelEnabled: false, curveSegments: 18 });
    g.rotateY(Math.PI / 2);
    g.translate(x0 - 0.02, yTop, zc);
    parts.push(g);
    const bead = new THREE.CylinderGeometry(0.0055, 0.0055, len, 8).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, yTop, zc + side * R);
    parts.push(bead);
    // Заглушки на торцах.
    for (const x of [x0 - 0.02, x1 + 0.02]) {
      for (const a of [Math.PI / 2, -Math.PI / 2]) parts.push(new THREE.CircleGeometry(R, 18, Math.PI, Math.PI).rotateY(a).translate(x, yTop, zc));
    }
    // Крюки: полукольцо под желобом и полоса к основе кровли.
    for (let x = x0 + 0.15; x < x1 - 0.05; x += 0.6) {
      const hook = new THREE.TorusGeometry(R + 0.0025, 0.0022, 4, 14, Math.PI).rotateY(Math.PI / 2).rotateX(Math.PI).translate(x, yTop, zc);
      parts.push(hook);
      const strap = new THREE.BoxGeometry(0.022, 0.004, Math.abs(zc - zE) + 0.06).translate(x, yTop + 0.002, (zc + side * R + zE - side * 0.06) / 2);
      parts.push(strap);
    }
    // Воронки и водосточные трубы с коленами к стене, хомутами и отмётом на отмостку.
    for (const x of DOWNPIPES_X) {
      const funnel = new THREE.CylinderGeometry(0.06, PIPE + 0.004, 0.09, 18, 1, true).translate(x, yTop - R - 0.035, zc);
      parts.push(funnel);
      const zw = side * (SPEC.house.outer.z1 + 0.065);
      const yBottom = GROUND_Y + 0.12;
      const pts = [
        new THREE.Vector3(x, yTop - R - 0.06, zc),
        new THREE.Vector3(x, yTop - R - 0.16, zc),
        new THREE.Vector3(x, yTop - R - 0.16 - Math.abs(zc - zw), zw),
        new THREE.Vector3(x, GROUND_Y + 0.32, zw),
        new THREE.Vector3(x, yBottom, zw + side * 0.2),
      ];
      const path = new THREE.CatmullRomCurve3(fillet(pts, 0.1), false, 'catmullrom', 0);
      parts.push(new THREE.TubeGeometry(path, 80, PIPE, 16, false));
      for (let y = GROUND_Y + 0.6; y < pts[2].y - 0.2; y += 1.0) {
        parts.push(new THREE.TorusGeometry(PIPE + 0.003, 0.004, 6, 20).rotateX(Math.PI / 2).translate(x, y, zw));
        parts.push(new THREE.BoxGeometry(0.012, 0.02, 0.05).translate(x, y, zw - side * (PIPE + 0.02)));
      }
    }
  }
  const clean = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
    return n;
  });
  return mergeGeometries(clean);
}
