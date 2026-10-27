// Ночной свет участка (решение владельца): настенные фонари у наружных дверей построек, низкие столбики
// вдоль дорожек, светильники помещений. Всё горит вместе со «Светильники» в сумерках и ночью
// (коэффициент lamp из расчёта солнца); источники — дешёвые точечные (point-lights.js), без теней.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SITE, SRC, groundY, floorY, placer, BUILDING } from './site-data.js';
import { addPointLight } from './point-lights.js';
import { distToSegment } from './geometry.js';

const WARM = new THREE.Color(1.0, 0.74, 0.46);
const col = (g) => { g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3)); return g; };

// Точки дорожек через шаг step с чередованием сторон (отступ от края 0,25 м); пропуск у стволов и концов.
function bollardSpots(step = 4.2) {
  const spots = [];
  for (const p of SITE.paths) {
    let acc = step * 0.4, side = 1;
    for (let i = 0; i + 1 < p.pts.length; i++) {
      const a = p.pts[i], b = p.pts[i + 1];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
      for (; acc < L; acc += step) {
        const o = p.width / 2 + 0.25;
        const x = a[0] + u[0] * acc - u[1] * o * side, z = a[1] + u[1] * acc + u[0] * o * side;
        side = -side;
        if (SITE.trees.some((t) => t.status === 'keep' && Math.hypot(t.pos[0] - x, t.pos[1] - z) < 0.6)) continue;
        if (SITE.paths.some((q) => q.pts.some((c, k) => k + 1 < q.pts.length && distToSegment(x, z, c[0], c[1], q.pts[k + 1][0], q.pts[k + 1][1]).d < q.width / 2 + 0.1))) continue;
        if (spots.some((s) => Math.hypot(s.x - x, s.z - z) < 2.2)) continue;
        spots.push({ x, z });
      }
      acc -= L;
    }
  }
  return spots;
}

export function buildSiteLights(lib, parts) {
  const group = new THREE.Group();
  group.name = 'site-lights';
  const lights = [];
  const black = lib.plain('lampBlack', { color: new THREE.Color(0.03, 0.03, 0.035), roughness: 0.5, metalness: 0.4 });
  const glow = lib.make('lampGlowSite', () => new THREE.MeshStandardMaterial({ color: 0xf4efe6, emissive: 0xffd29a, emissiveIntensity: 0, roughness: 0.4 }));
  const bodies = [], lenses = [];
  // Столбики 0,55 м вдоль дорожек.
  for (const s of bollardSpots()) {
    const y = groundY(s.x, s.z);
    bodies.push(col(new THREE.CylinderGeometry(0.055, 0.06, 0.5, 14).translate(s.x, y + 0.25, s.z)));
    bodies.push(col(new THREE.CylinderGeometry(0.075, 0.075, 0.03, 14).translate(s.x, y + 0.565, s.z)));
    lenses.push(col(new THREE.CylinderGeometry(0.06, 0.06, 0.06, 14, 1, true).translate(s.x, y + 0.52, s.z)));
    lights.push(addPointLight({ x: s.x, y: y + 0.45, z: s.z, color: WARM, radius: 3.6, intensity: 2.2 }));
  }
  // Настенные фонари у наружных дверей: сбоку от проёма на 1,9 м, свет на крыльцо.
  for (const [id, part] of Object.entries(parts)) {
    const at = placer(BUILDING[id]);
    const fy = floorY(id);
    for (const o of part.openings) {
      if (!(o.kind === 'door' || o.door)) continue;
      const u = [-o.n[1], o.n[0]];
      const off = o.half + 0.28;
      const x = o.x + u[0] * off + o.n[0] * 0.07, z = o.z + u[1] * off + o.n[1] * 0.07;
      const ang = Math.atan2(o.n[0], o.n[1]);
      const box = new THREE.BoxGeometry(0.12, 0.22, 0.1).rotateY(ang).translate(x, fy + 1.95, z);
      bodies.push(col(box));
      lenses.push(col(new THREE.BoxGeometry(0.09, 0.15, 0.04).rotateY(ang).translate(x + o.n[0] * 0.04, fy + 1.93, z + o.n[1] * 0.04)));
      lights.push(addPointLight({ x: x + o.n[0] * 0.3, y: fy + 1.9, z: z + o.n[1] * 0.3, color: WARM, radius: 5.5, intensity: 3.2 }));
    }
    void at;
  }
  group.add(new THREE.Mesh(mergeGeometries(bodies), black));
  const lens = new THREE.Mesh(mergeGeometries(lenses), glow);
  lens.userData.excludeAO = true;
  group.add(lens);
  group.children.forEach((m) => { m.castShadow = false; m.receiveShadow = true; });
  // Светильники помещений: по одному на помещение (по центру, под потолком); гостиная и комната отдыха — два.
  const roomLights = [];
  const G = SRC.guest;
  const gp = parts.guest;
  const addRoom = (bid, x, z, level, k = 1) => {
    const p = parts[bid];
    const yl = level ? G.heights.main.floor2 / 1000 : 0;
    const ceil = p.ceilAt(x, z, level);
    const yLamp = Math.min(ceil - 0.25, yl + 2.35);
    const w = p.group.localToWorld(new THREE.Vector3(x, yLamp, z));
    const L = addPointLight({ x: w.x, y: w.y, z: w.z, color: new THREE.Color(1.0, 0.8, 0.58), radius: 6.5, intensity: 4.2 * k });
    roomLights.push(L);
  };
  for (const p of Object.values(parts)) p.group.updateMatrixWorld(true);
  for (const r of G.rooms) {
    const pts = r.rect ? [[r.rect[0], r.rect[1]], [r.rect[2], r.rect[3]]] : r.polygon;
    const xs = pts.map((q) => q[0] / 1000), zs = pts.map((q) => q[1] / 1000);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    addRoom('guest', cx, cz, r.level === 2 ? 1 : 0, ['G02', 'G07'].includes(r.id) ? 1.3 : 1);
  }
  addRoom('grill', -1.2, 0.3, 0, 1.2);
  addRoom('grill', 1.2, -1.6, 0, 1);
  const sh = SRC.garage.shed.rect;
  addRoom('garage', (sh[0] + sh[2]) / 2000, (sh[1] + sh[3]) / 2000, 0);
  void gp;
  return { group, lights: [...lights, ...roomLights], glow };
}
