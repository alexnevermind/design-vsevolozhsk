// Солнечные лучи в окнах (приём sael.net/interior): от внутренней грани каждого светового проёма
// призма тянется против направления солнца до пола — туда, где лежит солнечное пятно. Грани
// рисуются аддитивно с затуханием к полу и мягкими краями; без света солнца лучи гаснут.
// Видны только в прогулке: в редакторе стены срезаны, снаружи свет внутри дома не читается.
import * as THREE from 'three';
import { LIGHT_OPENINGS, wallPoint } from './plan.js';
import { ROOF_EXTENT, baseUnderY } from './roof-covering.js';

const MAX_LEN = 6;

// Точка в тени свеса кровли: луч к солнцу упирается в низ кровельной основы (шаг 5 см до 8 м).
function roofShades(p, d) {
  const q = new THREE.Vector3();
  for (let t = 0.05; t < 8; t += 0.05) {
    q.copy(p).addScaledVector(d, t);
    if (q.y > 6) return false;
    if (q.x > ROOF_EXTENT.x0 && q.x < ROOF_EXTENT.x1 && Math.abs(q.z) < ROOF_EXTENT.zEave && q.y > baseUnderY(q.z) - 0.02) return true;
  }
  return false;
}

export class SunBeams {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'sun-beams';
    this.group.visible = false;
    this.group.userData.excludeAO = true;
    this.uniforms = { uColor: { value: new THREE.Color() }, uK: { value: 0 } };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: 'attribute vec2 sw; varying vec2 vSw; void main(){ vSw = sw; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        uniform vec3 uColor; uniform float uK; varying vec2 vSw;
        void main() {
          // s — поперёк грани (мягкие края), w — вдоль луча (затухание к полу).
          float edge = pow(sin(3.14159 * clamp(vSw.x, 0.0, 1.0)), 0.8);
          float w = vSw.y;
          float fade = (1.0 - w) * (1.0 - w) * smoothstep(0.0, 0.06, w) + 0.12 * (1.0 - w);
          gl_FragColor = vec4(uColor * uK * edge * fade, 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.openings = LIGHT_OPENINGS.map((o) => {
      const w = o.wall;
      const out = !w.left || w.left === '008' ? 1 : -1;
      const n = new THREE.Vector3(w.nx * out, 0, w.nz * out);
      // Углы проёма на внутренней грани стены (немного внутрь, без z-конфликта со стеклом).
      const at = (u, y) => { const [x, z] = wallPoint(w, u, -out, w.t / 2 + 0.01); return new THREE.Vector3(x, y, z); };
      const inset = 0.06;
      return { n, at, u0: o.from + inset, u1: o.to - inset, y0: o.low + inset, y1: o.high - inset };
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.userData.excludeAO = true;
    this.group.add(this.mesh);
    scene.add(this.group);
  }

  // dir — направление на солнце (мировое), k — сила (0…1).
  update(dir, color, k) {
    const d = new THREE.Vector3(...dir);
    const pos = [];
    const sw = [];
    const idx = [];
    if (k > 0.01 && d.y > 0.02) {
      for (const o of this.openings) {
        if (o.n.dot(d) <= 0.05) continue;
        // Свес кровли и навес террасы срезают верх луча: ищем самую высокую освещённую отметку проёма.
        const um = (o.u0 + o.u1) / 2;
        if (roofShades(o.at(um, o.y0), d)) continue;
        let lo = o.y0;
        let hi = o.y1;
        if (roofShades(o.at(um, hi), d)) {
          for (let k = 0; k < 10; k++) {
            const mid = (lo + hi) / 2;
            if (roofShades(o.at(um, mid), d)) hi = mid; else lo = mid;
          }
          hi = lo;
        }
        if (hi - o.y0 < 0.08) continue;
        const corners = [o.at(o.u0, o.y0), o.at(o.u1, o.y0), o.at(o.u1, hi), o.at(o.u0, hi)];
        // Ближние вершины в проёме, дальние — на полу (или на предельной длине); у каждой грани свои вершины.
        const far = corners.map((c) => c.clone().addScaledVector(d, -Math.min(MAX_LEN, (c.y - 0.003) / d.y)));
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          const base = pos.length / 3;
          for (const [p, sv, wv] of [[corners[i], 0, 0], [corners[j], 1, 0], [far[j], 1, 1], [far[i], 0, 1]]) {
            pos.push(p.x, p.y, p.z);
            sw.push(sv, wv);
          }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('sw', new THREE.Float32BufferAttribute(sw, 2));
    g.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = g;
    this.uniforms.uColor.value.copy(color);
    this.uniforms.uK.value = k * 0.32;
  }
}
