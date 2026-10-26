// Мангальная зона отдыха с костром (≈8 м от террасы, на открытом газоне перед фасадом):
// площадка из природного плитняка с гравийными швами, кострище из колотого камня с копотью,
// берёзовые дрова с обугленными концами и тлеющими трещинами, живое пламя (процедурный шейдер,
// несколько плоскостей к камере), искры, дым, мангал с углями, шампурами и светящимися поддувалами,
// скамьи с подушками и пледом, пни, поленница, гирлянда на столбах. Свет костра, углей и гирлянды —
// дешёвые точечные источники (point-lights.js). Размеры — в метрах, локальные оси совпадают с мировыми.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { GROUND_Y } from './plan.js';
import { rng } from './geometry.js';
import { fbm } from './terrain.js';
import { addPointLight, applyPointLights } from './point-lights.js';
import { srgbColor } from './materials.js';

// Центр кострища и радиус площадки; вход с дорожки — с северной стороны (угол −98°).
export const BBQ = { x: 12.2, z: 11.0, r: 2.9, entry: -98 * Math.PI / 180 };

export function bbqOccupied(x, z, pad = 0) {
  return Math.hypot(x - BBQ.x, z - BBQ.z) < BBQ.r + 0.12 + pad || WOODPILE_AT.some(([px, pz]) => Math.hypot(x - px, z - pz) < 0.75 + pad);
}

const polar = (deg, r) => [Math.cos(deg * Math.PI / 180) * r, Math.sin(deg * Math.PI / 180) * r];
const LAYOUT = {
  benches: [{ deg: -150, r: 1.78, len: 1.6 }, { deg: -45, r: 1.78, len: 1.6 }, { deg: 22, r: 1.85, len: 1.4 }],
  stumps: [{ deg: 96, r: 1.62 }, { deg: 132, r: 1.72 }],
  grill: { deg: 178, r: 2.35 },
  woodpile: { deg: -132, r: 3.55 },
  posts: [-22, -114, 158],
};
const WOODPILE_AT = [polar(LAYOUT.woodpile.deg, LAYOUT.woodpile.r)].map(([x, z]) => [BBQ.x + x, BBQ.z + z]);

// Общие параметры огня: время, сила огня (0…1), ночь (0…1) — одни на все шейдеры зоны.
export const FIRE = { uTime: { value: 0 }, uFire: { value: 0 }, uNight: { value: 0 } };

const NOISE = `
float bqHash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float bqNoise(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(bqHash(i), bqHash(i + vec3(1,0,0)), f.x), mix(bqHash(i + vec3(0,1,0)), bqHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(bqHash(i + vec3(0,0,1)), bqHash(i + vec3(1,0,1)), f.x), mix(bqHash(i + vec3(0,1,1)), bqHash(i + vec3(1,1,1)), f.x), f.y), f.z); }
float bqFbm(vec3 p){ float s = 0.0; float a = 0.5; for (int i = 0; i < 4; i++){ s += a * bqNoise(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
`;

// ---------- вспомогательное ----------
function withColor(g, c = [1, 1, 1]) {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set(c, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// Метрические UV по преобладающей оси нормали (тайл tu × tv, древесина вдоль X).
function boxUV(g, tu, tv, ou = 0, ov = 0) {
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    let u;
    let v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); } else if (az >= ax) { u = p.getX(i); v = p.getY(i); } else { u = p.getZ(i); v = p.getY(i); }
    uv[i * 2] = u / tu + ou;
    uv[i * 2 + 1] = v / tv + ov;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Мягкая геометрия (подушки): общие вершины и сглаженные нормали — приём sael.net/interior.
function soft(g) {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  g = mergeVertices(g);
  g.computeVertexNormals();
  return g;
}

function cushion(w, h, d, r = 0.035, crown = 0.016) {
  const g = new RoundedBoxGeometry(w, h, d, 4, Math.min(r, Math.min(w, h, d) / 2.02));
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (w / 2);
    const z = p.getZ(i) / (d / 2);
    const y = p.getY(i);
    if (y > 0) p.setY(i, y + crown * Math.max(0, 1 - x * x) * Math.max(0, 1 - z * z) * (y / (h / 2)));
  }
  return boxUV(soft(g), 0.24, 0.24);
}

// Колотый камень: икосаэдр с шумом и несколькими плоскими сколами, плоское основание.
function boulder(seed, sx, sy, sz, detail = 2) {
  let g = new THREE.IcosahedronGeometry(1, detail);
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const r = rng(seed);
  const o = [r() * 9, r() * 9, r() * 9];
  const cuts = [];
  for (let k = 0; k < 9; k++) cuts.push([new THREE.Vector3(r() - 0.5, (r() - 0.5) * 0.9, r() - 0.5).normalize(), 0.62 + r() * 0.2]);
  cuts.push([new THREE.Vector3(0, -1, 0), 0.5], [new THREE.Vector3(0, 1, 0), 0.7 + r() * 0.15]);
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = 1 + 0.07 * Math.sin(v.x * 4.1 + o[0]) * Math.sin(v.y * 3.7 + o[1]) * Math.sin(v.z * 4.4 + o[2]) + 0.09 * fbm(v.x * 3.1 + o[0], v.z * 3.1 + v.y * 2.3 + o[1], 4);
    v.multiplyScalar(n);
    for (const [c, d] of cuts) {
      const t = v.dot(c);
      if (t > d) v.addScaledVector(c, d - t);
    }
    p.setXYZ(i, v.x * sx, v.y * sy, v.z * sz);
  }
  g.computeVertexNormals();
  return g;
}

function append(acc, g, matrix) {
  const c = g.clone().applyMatrix4(matrix);
  acc.push(c);
  return c;
}

// ---------- материалы огня ----------
// Угли, зола и обугленная древесина: шум в координатах объекта даёт тлеющие трещины, мерцающие во времени.
function emberMaterial(params, { charred = false, key }) {
  const m = new THREE.MeshStandardMaterial(params);
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FIRE);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHeat;\nvarying float vHeat;\nvarying vec3 vEmb;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeat = aHeat;\nvEmb = position;\n#ifdef USE_INSTANCING\nvEmb = (instanceMatrix * vec4(position, 1.0)).xyz;\n#endif');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform float uTime;\nuniform float uFire;\nvarying float vHeat;\nvarying vec3 vEmb;\n${NOISE}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        float embN = bqFbm(vEmb * 26.0);
        ${charred ? `
        float charK = smoothstep(0.3, 0.75, vHeat + (embN - 0.5) * 0.6);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.022, 0.02, 0.019) * (0.6 + 0.9 * embN), charK);` : 'float charK = vHeat;'}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float n2 = bqFbm(vEmb * 11.0 + vec3(0.0, -uTime * 0.12, uTime * 0.05));
          float crack = pow(1.0 - abs(embN * 2.0 - 1.0), 7.0);
          float hot = (crack * 0.9 + smoothstep(0.58, 0.78, n2) * 0.8) * (0.65 + 0.35 * sin(uTime * 2.1 + n2 * 19.0));
          totalEmissiveRadiance += vec3(2.6, 0.62, 0.11) * hot * charK * uFire;
        }`);
  };
  m.customProgramCacheKey = () => `ember|${charred}|${key}`;
  applyPointLights(m);
  return m;
}

function heat(g, fn) {
  const p = g.attributes.position;
  const a = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) a[i] = fn(p.getX(i), p.getY(i), p.getZ(i));
  g.setAttribute('aHeat', new THREE.BufferAttribute(a, 1));
  return g;
}

// Язык пламени: плоскость, повёрнутая к камере вокруг вертикали; форма и турбулентность — шум,
// поднимающийся во времени; цвет — от тёмно-красного края к почти белому ядру (HDR, аддитивно).
function flameMaterial(seed, w, h, gain) {
  return new THREE.ShaderMaterial({
    uniforms: { ...FIRE, uSeed: { value: seed }, uSize: { value: new THREE.Vector2(w, h) }, uGain: { value: gain } },
    vertexShader: `
      uniform float uFire;
      uniform vec2 uSize;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 toCam = cameraPosition - c;
        toCam.y = 0.0;
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
        float hk = 0.3 + 0.7 * uFire;
        vec3 wp = c + right * position.x * uSize.x * (0.6 + 0.4 * uFire) + vec3(0.0, position.y * uSize.y * hk, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uFire;
      uniform float uSeed;
      uniform float uGain;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        float y = vUv.y;
        float t = uTime * 1.15 + uSeed;
        float n1 = bqFbm(vec3(vUv.x * 2.6 + uSeed, y * 2.8 - t * 2.3, t * 0.5));
        float n2 = bqFbm(vec3(vUv.x * 6.5 - uSeed, y * 5.5 - t * 3.6, t * 0.8));
        float x = (vUv.x - 0.5) * 2.0;
        x += (n1 - 0.5) * 1.0 * y + sin(y * 7.0 - t * 5.0) * 0.07 * y;
        float w = pow(clamp(y * 4.0, 0.0, 1.0), 0.45) * pow(clamp(1.0 - y, 0.0, 1.0), 0.9);
        // Чёткий край языка и разрывы между языками: пламя читается формой, а не сплошным маревом.
        float body = 1.0 - smoothstep(w * 0.55, w + 0.01, abs(x));
        float lick = smoothstep(0.4, 0.53, n2 + (1.0 - y) * 0.82 - 0.33);
        float a = body * lick * smoothstep(0.0, 0.05, y);
        float heat = a * (1.05 - y * 0.6) * (0.75 + 0.5 * n2);
        float core = (1.0 - smoothstep(0.0, w * 0.45 + 0.01, abs(x))) * (1.0 - smoothstep(0.15, 0.6, y));
        vec3 col = mix(vec3(0.7, 0.07, 0.005), vec3(1.6, 0.42, 0.04), smoothstep(0.15, 0.55, heat));
        col = mix(col, vec3(2.1, 1.05, 0.26), core);
        col += vec3(0.03, 0.07, 0.35) * smoothstep(0.1, 0.0, y) * body;
        gl_FragColor = vec4(col * a * uGain * smoothstep(0.0, 0.08, uFire), 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
}

// ---------- площадка из плитняка ----------
function clip(poly, nx, nz, d) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = nx * a[0] + nz * a[1] - d;
    const db = nx * b[0] + nz * b[1] - d;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  return out;
}

// Взвешенная диаграмма Вороного (степенная) в круге минус кострище: плиты разного размера —
// крупные вперемешку с мелкими, швы 12–22 мм, скруглённые неровные кромки, фаска сверху,
// небольшие уклоны и купол каждой плиты; UV — со случайным сдвигом и поворотом, тон — по плите.
function patioGeometry(R, holeR, seed) {
  const r = rng(seed);
  const pts = [];
  for (let tries = 0; tries < 9000 && pts.length < 400; tries++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * (R + 0.3);
    if (d < holeR - 0.25) continue;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    const rr = 0.15 + r() * r() * 0.32;
    if (pts.some((p) => Math.hypot(p[0] - x, p[1] - z) < (p[2] + rr) * 0.92)) continue;
    pts.push([x, z, rr]);
  }
  const pos = [];
  const nrm = [];
  const uv = [];
  const col = [];
  const idx = [];
  let stones = 0;
  for (const p of pts) {
    let poly = [[p[0] - 1, p[1] - 1], [p[0] + 1, p[1] - 1], [p[0] + 1, p[1] + 1], [p[0] - 1, p[1] + 1]];
    for (const q of pts) {
      if (q === p) continue;
      const dx = q[0] - p[0];
      const dz = q[1] - p[1];
      const l = Math.hypot(dx, dz);
      if (l > 1.6) continue;
      const nx = dx / l;
      const nz = dz / l;
      const joint = 0.012 + r() * 0.01;
      const plane = (q[0] * q[0] + q[1] * q[1] - p[0] * p[0] - p[1] * p[1] + p[2] * p[2] - q[2] * q[2]) / (2 * l);
      poly = clip(poly, nx, nz, plane - joint / 2);
      if (poly.length < 3) break;
    }
    for (let k = 0; k < 40 && poly.length >= 3; k++) {
      const a = (k / 40) * Math.PI * 2;
      poly = clip(poly, Math.cos(a), Math.sin(a), R);
    }
    if (poly.length < 3) continue;
    let cx = 0;
    let cz = 0;
    for (const v of poly) { cx += v[0]; cz += v[1]; }
    cx /= poly.length;
    cz /= poly.length;
    if (Math.hypot(cx, cz) < holeR) continue;
    // Площадь: обрезки меньше 0,02 м² не кладутся (шов засыпан гравием).
    let area = 0;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      area += a[0] * b[1] - b[0] * a[1];
    }
    if (Math.abs(area) / 2 < 0.02) continue;
    if (area < 0) poly.reverse();
    // Неровная кромка: срез углов и прогиб середины рёбер внутрь.
    const rough = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (l < 0.02) continue;
      const c = Math.min(0.3, (0.025 + r() * 0.02) / l);
      const lerp = (t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      rough.push(lerp(c));
      for (const t of l > 0.22 ? [0.35, 0.65] : [0.5]) {
        const m = lerp(t);
        const ix = cx - m[0];
        const iz = cz - m[1];
        const il = Math.hypot(ix, iz) || 1;
        const k = r() * 0.012;
        rough.push([m[0] + ix / il * k, m[1] + iz / il * k]);
      }
      rough.push(lerp(1 - c));
    }
    const top = 0.026 + r() * 0.01;
    const tx = (r() - 0.5) * 0.016;
    const tz = (r() - 0.5) * 0.016;
    let maxD = 0;
    for (const v of rough) maxD = Math.max(maxD, Math.hypot(v[0] - cx, v[1] - cz));
    const yAt = (x, z, drop = 0) => top + tx * (x - cx) + tz * (z - cz) + 0.004 * (1 - (Math.hypot(x - cx, z - cz) / maxD) ** 2) - drop;
    const TINTS = [[1.0, 0.93, 0.82], [0.88, 0.88, 0.87], [1.02, 0.86, 0.72], [0.85, 0.87, 0.89], [0.96, 0.9, 0.8]];
    const tint = TINTS[Math.floor(r() * TINTS.length)];
    const tone = 0.68 + r() * 0.34;
    const base = tint.map((t) => t * tone);
    const rot = r() * Math.PI * 2;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    const ou = r() * 7;
    const ov = r() * 7;
    const uvOf = (x, z) => [(x * cr - z * sr) + ou, (x * sr + z * cr) + ov];
    const b0 = pos.length / 3;
    const add = (x, y, z, shade) => {
      pos.push(x, y, z);
      nrm.push(0, 1, 0);
      uv.push(...uvOf(x, z));
      col.push(base[0] * shade, base[1] * shade, base[2] * shade);
    };
    add(cx, yAt(cx, cz), cz, 1);
    const n = rough.length;
    // Кольца: верх (внутрь на 10 мм), кромка фаски, низ боковины.
    for (const v of rough) {
      const dx = v[0] - cx;
      const dz = v[1] - cz;
      const l = Math.hypot(dx, dz) || 1;
      const ix = v[0] - dx / l * 0.01;
      const iz = v[1] - dz / l * 0.01;
      add(ix, yAt(ix, iz), iz, 1);
    }
    for (const v of rough) add(v[0], yAt(v[0], v[1], 0.008), v[1], 0.86);
    for (const v of rough) add(v[0], -0.02, v[1], 0.62);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      idx.push(b0, b0 + 1 + j, b0 + 1 + i);
      const t0 = b0 + 1;
      const e0 = b0 + 1 + n;
      const s0 = b0 + 1 + 2 * n;
      idx.push(t0 + i, t0 + j, e0 + j, t0 + i, e0 + j, e0 + i);
      idx.push(e0 + i, e0 + j, s0 + j, e0 + i, s0 + j, s0 + i);
    }
    stones++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.userData.stones = stones;
  return g;
}

// ---------- кострище ----------
function firePit(lib, detail) {
  const group = new THREE.Group();
  group.name = 'fire-pit';
  const parts = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const r = rng(6262);
  const courses = [{ n: 12, R: 0.64, s: [0.17, 0.105, 0.13], y: 0.06, a0: 0 }, { n: 11, R: 0.61, s: [0.155, 0.085, 0.115], y: 0.19, a0: 0.5 }];
  let seed = 100;
  for (const c of courses) {
    for (let i = 0; i < c.n; i++) {
      const th = ((i + c.a0) / c.n) * Math.PI * 2 + (r() - 0.5) * 0.08;
      const k = 0.88 + r() * 0.24;
      const g = boulder(seed++, c.s[0] * k, c.s[1] * (1.05 + r() * 0.3), c.s[2] * k, detail);
      q.setFromAxisAngle(up, -th - Math.PI / 2 + (r() - 0.5) * 0.3);
      const R = c.R + (r() - 0.5) * 0.03;
      m.compose(new THREE.Vector3(Math.cos(th) * R, c.y + (r() - 0.5) * 0.015, Math.sin(th) * R), q, new THREE.Vector3(1, 1, 1));
      // Тон камня: серый гранит, розоватый, тёмный — как в природной россыпи.
      const tint = [[0.62, 0.62, 0.61], [0.72, 0.62, 0.57], [0.44, 0.44, 0.45], [0.66, 0.64, 0.58]][Math.floor(r() * 4)].map((v) => v * (0.85 + r() * 0.3));
      parts.push(withColor(g.applyMatrix4(m), tint));
    }
  }
  const ring = mergeGeometries(parts);
  // Копоть на внутренних гранях и на верхней кромке, неравномерный тон камней.
  const p = ring.attributes.position;
  const nn = ring.attributes.normal;
  const col = ring.attributes.color.array;
  const uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const l = Math.hypot(x, z) || 1;
    const inward = Math.max(0, -(nn.getX(i) * x + nn.getZ(i) * z) / l);
    const soot = Math.min(1, inward * 1.4 * (0.4 + 0.6 * Math.min(1, y / 0.25)) + Math.max(0, nn.getY(i)) * Math.max(0, 0.66 - l) * 4);
    const t = 0.85 + 0.25 * (fbm(x * 9, z * 9 + y * 5, 2) * 0.5 + 0.5);
    const k = t * (1 - 0.85 * soot);
    col[i * 3] *= k;
    col[i * 3 + 1] *= k * 0.97;
    col[i * 3 + 2] *= k * 0.93;
    const ax = Math.abs(nn.getX(i));
    const ay = Math.abs(nn.getY(i));
    const az = Math.abs(nn.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [x, z] : az >= ax ? [x, y] : [z, y];
    uv[i * 2] = u * 1.6;
    uv[i * 2 + 1] = v * 1.6;
  }
  ring.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  const ringMesh = new THREE.Mesh(ring, lib.fieldStone());
  ringMesh.castShadow = true;
  ringMesh.receiveShadow = true;
  group.add(ringMesh);

  // Зола (купол) и угли с тлеющими трещинами.
  const ash = emberMaterial({ color: srgbColor('#55524d'), roughness: 1, envMapIntensity: 0.2 }, { key: 'ash' });
  const mound = heat(new THREE.SphereGeometry(1, 36, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.5, 0.055, 0.5), (x, y, z) => Math.max(0, 1 - Math.hypot(x, z) / 0.5) * 0.55);
  const ashMesh = new THREE.Mesh(mound, ash);
  ashMesh.position.y = 0.015;
  ashMesh.receiveShadow = true;
  group.add(ashMesh);
  const coals = [];
  for (let i = 0; i < 46; i++) {
    const a = r() * Math.PI * 2;
    const d = Math.sqrt(r()) * 0.34;
    const s = 0.018 + r() * 0.022;
    const g = boulder(900 + i, s * 1.3, s * 0.8, s, 0);
    q.setFromAxisAngle(up, r() * 6.28);
    const y = 0.015 + 0.055 * (1 - (d / 0.5) ** 2) + s * 0.3;
    m.compose(new THREE.Vector3(Math.cos(a) * d, y, Math.sin(a) * d), q, new THREE.Vector3(1, 1, 1));
    coals.push(heat(g.applyMatrix4(m), () => 0.85 + r() * 0.15));
  }
  const coalMat = emberMaterial({ color: srgbColor('#141312'), roughness: 0.85, envMapIntensity: 0.25 }, { key: 'coal' });
  group.add(new THREE.Mesh(mergeGeometries(coals), coalMat));

  // Берёзовые дрова шалашом и два поперечных полена; обугленный низ.
  const logs = [];
  const barkMat = emberMaterial({ map: lib.birchBark().map, normalMap: lib.birchBark().normalMap, roughness: 0.8, envMapIntensity: 0.3 }, { charred: true, key: 'birch' });
  const endMat = emberMaterial({ map: lib.endGrain().map, normalMap: lib.endGrain().normalMap, roughness: 0.92, envMapIntensity: 0.3 }, { charred: true, key: 'end' });
  const logGeo = (rad, len, charFn) => {
    const g = new THREE.CylinderGeometry(rad, rad * 0.96, len, 14, 5);
    const uvA = g.attributes.uv;
    for (let i = 0; i < (14 + 1) * (5 + 1); i++) uvA.setXY(i, uvA.getX(i) * (2 * Math.PI * rad) / 0.5, uvA.getY(i) * len / 0.5);
    return heat(g, (x, y) => charFn((y + len / 2) / len));
  };
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4 + (r() - 0.5) * 0.3;
    const len = 0.5 + r() * 0.1;
    const rad = 0.038 + r() * 0.018;
    const tilt = 0.6 + r() * 0.12;
    const g = logGeo(rad, len, (t) => 1 - Math.min(1, Math.max(0, (t - 0.35) / 0.5)));
    g.translate(0, len / 2, 0);
    const rot = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(-Math.sin(a), 0, Math.cos(a)), tilt);
    const tr = new THREE.Matrix4().makeTranslation(Math.cos(a) * 0.3, 0.04, Math.sin(a) * 0.3);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(tr, rot));
    logs.push(g);
  }
  for (const [a, len] of [[0.3, 0.62], [1.9, 0.56]]) {
    const g = logGeo(0.05, len, (t) => 0.55 + 0.45 * (1 - Math.abs(t - 0.5) * 2));
    g.rotateZ(Math.PI / 2).rotateY(a).translate(0, 0.075, 0);
    logs.push(g);
  }
  const merged = mergeGeometries(logs);
  // Группы цилиндров: бок (0), торцы (1, 2) → два материала.
  const groups = [];
  let off = 0;
  for (const g of logs) {
    const n = g.index.count;
    for (const gr of g.groups) groups.push({ start: off + gr.start, count: gr.count, materialIndex: gr.materialIndex === 0 ? 0 : 1 });
    off += n;
  }
  merged.clearGroups();
  for (const gr of groups) merged.addGroup(gr.start, gr.count, gr.materialIndex);
  const logMesh = new THREE.Mesh(merged, [barkMat, endMat]);
  logMesh.castShadow = true;
  logMesh.receiveShadow = true;
  group.add(logMesh);

  // Пламя: четыре языка разного размера и фазы.
  const flames = new THREE.Group();
  flames.name = 'flames';
  for (const [x, z, w, h, seed, gain] of [[0, 0, 0.82, 1.3, 0.0, 0.8], [0.1, -0.06, 0.56, 0.98, 3.1, 0.6], [-0.11, 0.06, 0.58, 1.02, 7.7, 0.6], [0.03, 0.11, 0.46, 0.78, 11.3, 0.7], [-0.06, -0.1, 0.42, 0.7, 15.9, 0.7]]) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0), flameMaterial(seed, w, h, gain));
    f.position.set(x, 0.06, z);
    f.frustumCulled = false;
    f.renderOrder = 10;
    f.userData.excludeAO = true;
    flames.add(f);
  }
  group.add(flames);

  // Искры: точки, поднимающиеся с завихрением; жизнь и размер — из времени и номера.
  const N = 90;
  const seeds = new Float32Array(N);
  for (let i = 0; i < N; i++) seeds[i] = r();
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  sg.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  const sparkMat = new THREE.ShaderMaterial({
    uniforms: { ...FIRE, uPx: { value: 800 } },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime;
      uniform float uFire;
      uniform float uPx;
      varying float vA;
      void main() {
        float sp = 0.28 + 0.3 * fract(aSeed * 7.13);
        float life = fract(uTime * sp + aSeed * 13.0);
        float ang = aSeed * 43.0 + uTime * (0.8 + fract(aSeed * 3.3));
        float rad = 0.05 + 0.32 * life * fract(aSeed * 5.7);
        vec3 p = vec3(cos(ang) * rad + sin(uTime * 1.7 + aSeed * 20.0) * 0.1 * life, 0.25 + life * (1.1 + 1.6 * fract(aSeed * 11.1)) * uFire, sin(ang) * rad);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = max(1.0, 0.016 * (1.0 - life * 0.6) * uPx / -mv.z);
        vA = (1.0 - life) * smoothstep(0.0, 0.06, life) * step(fract(aSeed * 17.7), uFire * 0.9);
      }`,
    fragmentShader: `
      varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5;
        float a = smoothstep(0.25, 0.0, dot(c, c)) * vA;
        gl_FragColor = vec4(vec3(3.2, 1.25, 0.28) * a, 1.0);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const sparks = new THREE.Points(sg, sparkMat);
  sparks.frustumCulled = false;
  sparks.renderOrder = 11;
  sparks.userData.excludeAO = true;
  group.add(sparks);

  // Дым: столб с шумовой прозрачностью, ночью подсвечен огнём снизу.
  const smokeMat = new THREE.ShaderMaterial({
    uniforms: { ...FIRE },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 c = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        vec3 toCam = cameraPosition - c;
        toCam.y = 0.0;
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-5, 0.0, 0.0));
        vec3 wp = c + right * position.x * (0.5 + uv.y * 1.6) + vec3(0.0, position.y, 0.0);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform float uFire;
      uniform float uNight;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        float t = uTime;
        vec2 p = vUv;
        p.x += (bqFbm(vec3(p.y * 2.0, t * 0.15, 0.0)) - 0.5) * 0.5 * p.y;
        float n = bqFbm(vec3(p.x * 3.0, p.y * 2.2 - t * 0.35, t * 0.1));
        float shape = smoothstep(0.5, 0.1, abs(p.x - 0.5)) * smoothstep(0.0, 0.25, p.y) * smoothstep(1.0, 0.45, p.y);
        float a = shape * smoothstep(0.35, 0.8, n) * 0.22 * uFire;
        vec3 col = mix(vec3(0.62, 0.62, 0.64), vec3(0.9, 0.42, 0.14) * 0.6, uNight * smoothstep(0.6, 0.0, p.y));
        col *= mix(1.0, 0.18, uNight);
        gl_FragColor = vec4(col, a);
      }`,
    transparent: true,
    depthWrite: false,
  });
  const smoke = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.6, 1, 1).translate(0, 1.3, 0), smokeMat);
  smoke.position.y = 0.55;
  smoke.frustumCulled = false;
  smoke.renderOrder = 9;
  smoke.userData.excludeAO = true;
  group.add(smoke);

  // Ореол: мягкое свечение воздуха вокруг огня ночью.
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTexture(), color: new THREE.Color(0, 0, 0), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  halo.scale.set(2.4, 2.0, 1);
  halo.position.y = 0.55;
  halo.renderOrder = 8;
  halo.userData.excludeAO = true;
  group.add(halo);
  return { group, flames, sparks, smoke, halo, sparkMat };
}

let radialTex = null;
function radialTexture() {
  if (radialTex) return radialTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  gr.addColorStop(0.6, 'rgba(255,255,255,0.1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  radialTex = new THREE.CanvasTexture(c);
  radialTex.colorSpace = THREE.SRGBColorSpace;
  return radialTex;
}

// Плед в клетку: холст 256² (шотландка), sRGB.
function tartanTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#7d2a22';
  g.fillRect(0, 0, 256, 256);
  const bands = [[0, 40, '#3a2620', 0.85], [56, 12, '#c9a46a', 0.7], [96, 50, '#2f3b33', 0.75], [170, 8, '#e8dcc4', 0.8], [200, 30, '#3a2620', 0.6]];
  for (const [o, w, color, a] of bands) {
    g.globalAlpha = a;
    g.fillStyle = color;
    g.fillRect(o, 0, w, 256);
    g.globalAlpha = a * 0.75;
    g.fillRect(0, o, 256, w);
  }
  g.globalAlpha = 0.12;
  g.fillStyle = '#000';
  for (let i = 0; i < 256; i += 2) g.fillRect(0, i, 256, 1);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// ---------- мебель зоны ----------
function bench(lib, len) {
  const g = new THREE.Group();
  const wood = lib.deckWood('walnut');
  const steel = lib.plain('outdoorSteel', { color: srgbColor('#202123'), roughness: 0.55, metalness: 0.5, envMapIntensity: 0.6 });
  const planks = [];
  for (let k = 0; k < 3; k++) {
    const p = new RoundedBoxGeometry(len, 0.045, 0.135, 2, 0.008);
    boxUV(p, 1.8, 0.72, k * 0.31, k * 0.27);
    p.translate(0, 0.4325, (k - 1) * 0.145);
    planks.push(withColor(p));
  }
  const seat = new THREE.Mesh(mergeGeometries(planks), wood);
  seat.castShadow = true;
  seat.receiveShadow = true;
  g.add(seat);
  const bars = [];
  for (const sx of [-1, 1]) {
    const x = sx * (len / 2 - 0.2);
    bars.push(new THREE.BoxGeometry(0.05, 0.4, 0.012).translate(x, 0.2, -0.19), new THREE.BoxGeometry(0.05, 0.4, 0.012).translate(x, 0.2, 0.19));
    bars.push(new THREE.BoxGeometry(0.05, 0.012, 0.392).translate(x, 0.404, 0), new THREE.BoxGeometry(0.05, 0.012, 0.392).translate(x, 0.006, 0));
  }
  const frame = new THREE.Mesh(mergeGeometries(bars), steel);
  frame.castShadow = true;
  g.add(frame);
  return g;
}

function stump(lib, seed) {
  const r = rng(seed);
  const rad = 0.19 + r() * 0.04;
  const h = 0.4 + r() * 0.05;
  const g = new THREE.CylinderGeometry(rad, rad * 1.12, h, 22, 4);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    const a = Math.atan2(z, x);
    const k = 1 + 0.05 * Math.sin(a * 5 + seed) + 0.03 * Math.sin(a * 11 + seed * 2);
    if (Math.hypot(x, z) > 0.01) { p.setX(i, x * k); p.setZ(i, z * k); }
  }
  g.computeVertexNormals();
  const uvA = g.attributes.uv;
  const side = (22 + 1) * (4 + 1);
  for (let i = 0; i < side; i++) uvA.setXY(i, uvA.getX(i) * (2 * Math.PI * rad) / 0.3, uvA.getY(i) * h / 0.6);
  withColor(g, [0.34, 0.33, 0.32]);
  g.translate(0, h / 2, 0);
  const m = new THREE.Mesh(g, [lib.bark(), lib.endGrain(), lib.endGrain()]);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

// Колотое полено: сектор цилиндра (кора — береста, торцы — годичные кольца, сколы — волокна).
function splitLogGeometry(R, L, a0, a1, seg = 7) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const idx = [[], [], []];
  const v = (x, y, z, nx, ny, nz, u, w) => { pos.push(x, y, z); nrm.push(nx, ny, nz); uv.push(u, w); return pos.length / 3 - 1; };
  // Кора.
  for (let i = 0; i <= seg; i++) {
    const a = a0 + (a1 - a0) * (i / seg);
    const c = Math.cos(a);
    const s = Math.sin(a);
    v(c * R, s * R, -L / 2, c, s, 0, (a * R) / 0.5, 0);
    v(c * R, s * R, L / 2, c, s, 0, (a * R) / 0.5, L / 0.5);
  }
  for (let i = 0; i < seg; i++) { const b = i * 2; idx[0].push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
  // Торцы: UV по сечению — кольца центрированы на оси бревна.
  for (const [z, nz] of [[-L / 2, -1], [L / 2, 1]]) {
    const c0 = v(0, 0, z, 0, 0, nz, 0.5, 0.5);
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (a1 - a0) * (i / seg);
      v(Math.cos(a) * R, Math.sin(a) * R, z, 0, 0, nz, 0.5 + Math.cos(a) * 0.5 * 0.88, 0.5 + Math.sin(a) * 0.5 * 0.88);
    }
    for (let i = 0; i < seg; i++) {
      if (nz > 0) idx[1].push(c0, c0 + 1 + i, c0 + 2 + i);
      else idx[1].push(c0, c0 + 2 + i, c0 + 1 + i);
    }
  }
  // Сколы: две радиальные плоскости.
  for (const [a, sign] of [[a0, -1], [a1, 1]]) {
    const c = Math.cos(a);
    const s = Math.sin(a);
    const nx = -s * sign;
    const ny = c * sign;
    const b = pos.length / 3;
    v(0, 0, -L / 2, nx, ny, 0, 0, 0);
    v(c * R, s * R, -L / 2, nx, ny, 0, 0, R / 0.4);
    v(0, 0, L / 2, nx, ny, 0, L / 1.6, 0);
    v(c * R, s * R, L / 2, nx, ny, 0, L / 1.6, R / 0.4);
    if (sign > 0) idx[2].push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
    else idx[2].push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex([...idx[0], ...idx[1], ...idx[2]]);
  g.addGroup(0, idx[0].length, 0);
  g.addGroup(idx[0].length, idx[1].length, 1);
  g.addGroup(idx[0].length + idx[1].length, idx[2].length, 2);
  return g;
}

function woodpile(lib) {
  const g = new THREE.Group();
  g.name = 'woodpile';
  const steel = lib.plain('outdoorSteel', { color: srgbColor('#202123'), roughness: 0.55, metalness: 0.5, envMapIntensity: 0.6 });
  const W = 1.0;
  const H = 1.05;
  const D = 0.36;
  const t = 0.025;
  const bars = [];
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) bars.push(new THREE.BoxGeometry(t, H, t).translate(sx * W / 2, H / 2 + 0.04, sz * D / 2));
    bars.push(new THREE.BoxGeometry(t, t, D).translate(sx * W / 2, H + 0.04, 0), new THREE.BoxGeometry(t, t, D).translate(sx * W / 2, 0.06, 0));
  }
  for (const sz of [-1, 1]) bars.push(new THREE.BoxGeometry(W, t, t).translate(0, 0.06, sz * D / 2));
  const roof = new THREE.BoxGeometry(W + 0.12, 0.012, D + 0.14).translate(0, H + 0.06, 0.02);
  const frame = new THREE.Mesh(mergeGeometries([...bars, roof]), steel);
  frame.castShadow = true;
  frame.receiveShadow = true;
  g.add(frame);
  // Задняя стенка из доски: между поленьями не просвечивает газон.
  const boards = [];
  for (let k = 0; k < 7; k++) boards.push(withColor(boxUV(new RoundedBoxGeometry(W - 0.02, 0.14, 0.018, 1, 0.003), 1.8, 0.72, k * 0.37, k * 0.21).translate(0, 0.13 + k * 0.143, -D / 2 - 0.012), [0.62, 0.6, 0.58]));
  const back = new THREE.Mesh(mergeGeometries(boards), lib.deckWood('smoked'));
  back.castShadow = true;
  back.receiveShadow = true;
  g.add(back);
  const mats = [lib.birchBark(), lib.endGrain(), lib.splitWood()];
  const r = rng(4747);
  const items = [];
  const R = 0.062;
  // Плотная укладка рядами: колотые половинки и трети, сколом вниз/вбок, ряды со сдвигом.
  let y = 0.075 + R * 0.7;
  let row = 0;
  while (y < H - 0.03) {
    let x = -W / 2 + 0.06 + (row % 2) * R * 0.7 + r() * 0.02;
    while (x < W / 2 - 0.05) {
      const rr = R * (0.85 + r() * 0.35);
      const half = r() < 0.55;
      const rot = half ? (r() < 0.5 ? 0 : Math.PI) + (r() - 0.5) * 0.5 : r() * Math.PI * 2;
      items.push({ x, y: y + (r() - 0.5) * 0.015, rr, rot, half, dz: (r() - 0.5) * 0.03, tone: 0.72 + r() * 0.36 });
      x += rr * 1.45 + r() * 0.01;
    }
    y += R * 1.28;
    row++;
  }
  const L = 0.33;
  for (const half of [true, false]) {
    const list = items.filter((i) => i.half === half);
    const geo = splitLogGeometry(1, L, 0, half ? Math.PI : Math.PI * 0.62);
    const im = new THREE.InstancedMesh(geo, mats, list.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    list.forEach((it, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), it.rot);
      m.compose(new THREE.Vector3(it.x, it.y, it.dz), q, new THREE.Vector3(it.rr, it.rr, 1));
      im.setMatrixAt(i, m);
      im.setColorAt(i, c.setRGB(it.tone, it.tone * 0.97, it.tone * 0.92));
    });
    im.castShadow = true;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    g.add(im);
  }
  return g;
}

function grill(lib, r) {
  const g = new THREE.Group();
  g.name = 'grill';
  const steel = lib.plain('grillSteel', { color: srgbColor('#19191a'), roughness: 0.68, metalness: 0.35, normalMap: lib.tex('metal_normal'), normalScale: new THREE.Vector2(0.3, 0.3), envMapIntensity: 0.5 });
  const bright = lib.plain('skewerSteel', { color: new THREE.Color(0.72, 0.72, 0.7), roughness: 0.28, metalness: 1, envMapIntensity: 0.8 });
  const Lx = 0.8;
  const Wz = 0.32;
  const Hb = 0.18;
  const y0 = 0.62;
  const th = 0.003;
  const parts = [
    new THREE.BoxGeometry(Lx, th, Wz).translate(0, y0, 0),
    new THREE.BoxGeometry(Lx, Hb, th).translate(0, y0 + Hb / 2, -Wz / 2),
    new THREE.BoxGeometry(Lx, Hb, th).translate(0, y0 + Hb / 2, Wz / 2),
    new THREE.BoxGeometry(th, Hb, Wz).translate(-Lx / 2, y0 + Hb / 2, 0),
    new THREE.BoxGeometry(th, Hb, Wz).translate(Lx / 2, y0 + Hb / 2, 0),
  ];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(new THREE.BoxGeometry(0.022, y0 + 0.01, 0.022).translate(sx * (Lx / 2 - 0.02), (y0 + 0.01) / 2, sz * (Wz / 2 - 0.02)));
  for (const sz of [-1, 1]) parts.push(new THREE.BoxGeometry(Lx - 0.04, 0.016, 0.016).translate(0, 0.12, sz * (Wz / 2 - 0.02)));
  // Кронштейн полки.
  parts.push(new THREE.BoxGeometry(0.3, 0.012, 0.02).translate(Lx / 2 + 0.15, y0 + Hb - 0.03, -Wz / 2 + 0.02), new THREE.BoxGeometry(0.3, 0.012, 0.02).translate(Lx / 2 + 0.15, y0 + Hb - 0.03, Wz / 2 - 0.02));
  const body = new THREE.Mesh(mergeGeometries(parts), steel);
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  // Полка из реек.
  const slats = [];
  for (let k = 0; k < 4; k++) slats.push(withColor(boxUV(new RoundedBoxGeometry(0.3, 0.02, 0.07, 1, 0.004), 1.8, 0.72, k * 0.2, 0.1).translate(Lx / 2 + 0.16, y0 + Hb - 0.014, (k - 1.5) * 0.078)));
  const shelf = new THREE.Mesh(mergeGeometries(slats), lib.deckWood('walnut'));
  shelf.castShadow = true;
  g.add(shelf);
  // Поддувала: ряд отверстий на длинных стенках, светятся от углей.
  const holeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.01, 0.01, 0.01) });
  const holes = [];
  for (const sz of [-1, 1]) {
    for (let k = 0; k < 8; k++) {
      const c = new THREE.CircleGeometry(0.009, 12);
      if (sz < 0) c.rotateY(Math.PI);
      holes.push(c.translate(-Lx / 2 + 0.08 + k * 0.091, y0 + 0.035, sz * (Wz / 2 + 0.0018)));
    }
  }
  g.add(new THREE.Mesh(mergeGeometries(holes), holeMat));
  // Угли в коробе.
  const coals = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  for (let i = 0; i < 120; i++) {
    const s = 0.016 + r() * 0.018;
    const gg = boulder(1200 + i, s * 1.3, s * 0.8, s, 0);
    q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
    m.compose(new THREE.Vector3((r() - 0.5) * (Lx - 0.06), y0 + 0.012 + r() * 0.04, (r() - 0.5) * (Wz - 0.05)), q, new THREE.Vector3(1, 1, 1));
    coals.push(heat(gg.applyMatrix4(m), () => 0.6 + r() * 0.4));
  }
  g.add(new THREE.Mesh(mergeGeometries(coals), emberMaterial({ color: srgbColor('#121110'), roughness: 0.85, envMapIntensity: 0.25 }, { key: 'grillCoal' })));
  // Шампуры поперёк короба с мясом (появляется, когда мангал разожжён).
  const sk = [];
  const meat = [];
  for (let k = 0; k < 6; k++) {
    const x = -Lx / 2 + 0.12 + k * 0.112;
    sk.push(new THREE.BoxGeometry(0.009, 0.0025, 0.64).translate(x, y0 + Hb + 0.004, 0.06));
    sk.push(new THREE.TorusGeometry(0.022, 0.0028, 6, 20).rotateY(Math.PI / 2).translate(x, y0 + Hb + 0.004, 0.06 + 0.32 + 0.02));
    if (k === 0 || k === 5) continue;
    for (let j = 0; j < 6; j++) {
      const s = 0.026 + r() * 0.01;
      const gg = boulder(1500 + k * 10 + j, s * 0.95, s * 1.05, s * 1.15, 1);
      q.setFromEuler(new THREE.Euler(r() * 3, r() * 3, r() * 3));
      m.compose(new THREE.Vector3(x, y0 + Hb + 0.004, -0.09 + j * 0.047), q, new THREE.Vector3(1, 1, 1));
      const mg = gg.applyMatrix4(m);
      const cc = new Float32Array(mg.attributes.position.count * 3);
      const nn = mg.attributes.normal;
      for (let i = 0; i < nn.count; i++) {
        const sear = Math.max(0, -nn.getY(i)) * 0.6 + r() * 0.15;
        cc.set([0.36 - 0.24 * sear, 0.15 - 0.1 * sear, 0.07 - 0.05 * sear], i * 3);
      }
      mg.setAttribute('color', new THREE.BufferAttribute(cc, 3));
      meat.push(mg);
    }
  }
  const skewers = new THREE.Mesh(mergeGeometries(sk), bright);
  skewers.castShadow = true;
  g.add(skewers);
  const meatMesh = new THREE.Mesh(mergeGeometries(meat), lib.plain('roast', { vertexColors: true, roughness: 0.48, clearcoat: 0.35, clearcoatRoughness: 0.3, envMapIntensity: 0.4 }));
  meatMesh.castShadow = true;
  meatMesh.name = 'shashlik';
  g.add(meatMesh);
  return { group: g, holeMat, meatMesh, skewers };
}

// Гирлянда: столбы, провод цепной линией, лампы-шары через 0,45 м и ореолы ночью.
function stringLights(lib, postsXZ) {
  const g = new THREE.Group();
  g.name = 'string-lights';
  const wood = lib.deckWood('smoked');
  const steel = lib.plain('outdoorSteel', { color: srgbColor('#202123'), roughness: 0.55, metalness: 0.5, envMapIntensity: 0.6 });
  const H = 2.45;
  const posts = [];
  const caps = [];
  for (const [x, z] of postsXZ) {
    posts.push(withColor(boxUV(new RoundedBoxGeometry(0.09, H, 0.09, 1, 0.006), 1.8, 0.72).translate(x, H / 2, z)));
    caps.push(new THREE.BoxGeometry(0.1, 0.012, 0.1).translate(x, H + 0.006, z), new THREE.CylinderGeometry(0.004, 0.004, 0.12, 6).rotateX(Math.PI / 2).translate(x, H - 0.1, z));
  }
  const pm = new THREE.Mesh(mergeGeometries(posts), wood);
  pm.castShadow = true;
  pm.receiveShadow = true;
  g.add(pm);
  g.add(new THREE.Mesh(mergeGeometries(caps), steel));
  const cable = [];
  const bulbsAt = [];
  const spans = [];
  for (let i = 0; i + 1 < postsXZ.length; i++) {
    const a = new THREE.Vector3(postsXZ[i][0], H - 0.1, postsXZ[i][1]);
    const b = new THREE.Vector3(postsXZ[i + 1][0], H - 0.1, postsXZ[i + 1][1]);
    const len = a.distanceTo(b);
    const sag = 0.08 * len;
    const pts = [];
    for (let k = 0; k <= 24; k++) {
      const t = k / 24;
      const p = a.clone().lerp(b, t);
      p.y -= sag * 4 * t * (1 - t);
      pts.push(p);
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    cable.push(new THREE.TubeGeometry(curve, 32, 0.0035, 5, false));
    const n = Math.floor(len / 0.45);
    for (let k = 1; k < n; k++) bulbsAt.push(curve.getPoint(k / n));
    spans.push(curve.getPoint(0.5));
  }
  g.add(new THREE.Mesh(mergeGeometries(cable), steel));
  const socketGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.04, 10).translate(0, -0.03, 0);
  const sock = new THREE.InstancedMesh(socketGeo, steel, bulbsAt.length);
  const bulbMat = new THREE.MeshStandardMaterial({ color: srgbColor('#f6efe2'), emissive: srgbColor('#ffb066'), emissiveIntensity: 0, roughness: 0.25, envMapIntensity: 0.6 });
  applyPointLights(bulbMat);
  const bulbGeo = new THREE.SphereGeometry(0.026, 14, 10).scale(1, 1.2, 1).translate(0, -0.075, 0);
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, bulbsAt.length);
  const m = new THREE.Matrix4();
  bulbsAt.forEach((p, i) => {
    m.makeTranslation(p.x, p.y, p.z);
    sock.setMatrixAt(i, m);
    bulbs.setMatrixAt(i, m);
  });
  sock.computeBoundingSphere();
  bulbs.computeBoundingSphere();
  g.add(sock, bulbs);
  // Ореолы ламп (точки с мягким краем, аддитивно).
  const gg = new THREE.BufferGeometry();
  gg.setAttribute('position', new THREE.Float32BufferAttribute(bulbsAt.flatMap((p) => [p.x, p.y - 0.075, p.z]), 3));
  const glowMat = new THREE.ShaderMaterial({
    uniforms: { uK: { value: 0 }, uPx: { value: 800 } },
    vertexShader: 'uniform float uPx; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = max(1.0, 0.3 * uPx / -mv.z); }',
    fragmentShader: 'uniform float uK; void main(){ vec2 c = gl_PointCoord - 0.5; float d = length(c) * 2.0; float a = exp(-d * d * 7.0) * 0.55 + exp(-d * d * 40.0) * 1.2; gl_FragColor = vec4(vec3(1.0, 0.62, 0.3) * a * uK * (1.0 - smoothstep(0.85, 1.0, d)), 1.0); }',
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const glow = new THREE.Points(gg, glowMat);
  glow.renderOrder = 12;
  glow.userData.excludeAO = true;
  g.add(glow);
  return { group: g, bulbMat, glowMat, spans };
}

// ---------- зона целиком ----------
export class FireZone {
  constructor(lib, { quality = 'high' } = {}) {
    const detail = quality === 'low' ? 1 : 2;
    const root = new THREE.Group();
    root.name = 'bbq-zone';
    root.position.set(BBQ.x, GROUND_Y, BBQ.z);
    this.group = root;
    const r = rng(8181);

    // Площадка и подсыпка швов.
    const patio = patioGeometry(BBQ.r, 0.84, 5353);
    this.stoneCount = patio.userData.stones;
    const pm = new THREE.Mesh(patio, lib.flagstone());
    pm.receiveShadow = true;
    pm.name = 'patio';
    root.add(pm);
    const bed = new THREE.CircleGeometry(BBQ.r + 0.04, 72).rotateX(-Math.PI / 2);
    const bp = bed.attributes.position;
    const buv = bed.attributes.uv;
    for (let i = 0; i < bp.count; i++) buv.setXY(i, bp.getX(i) / 0.45, bp.getZ(i) / 0.45);
    const bedMesh = new THREE.Mesh(bed, lib.gravel('joint', '#a39a8a'));
    bedMesh.position.y = 0.007;
    bedMesh.receiveShadow = true;
    bedMesh.material.polygonOffset = true;
    bedMesh.material.polygonOffsetFactor = -1;
    bedMesh.material.polygonOffsetUnits = -1;
    root.add(bedMesh);

    const pit = firePit(lib, detail);
    root.add(pit.group);
    this.pit = pit;

    for (const b of LAYOUT.benches) {
      const [x, z] = polar(b.deg, b.r);
      const m = bench(lib, b.len);
      m.position.set(x, 0.03, z);
      m.rotation.y = -Math.atan2(z, x) + Math.PI / 2;
      root.add(m);
      this.benches = (this.benches || []).concat(m);
    }
    // Подушки на северо-восточной скамье и плед на северо-западной.
    const cushionMat = lib.make('outFabric|sand', () => new THREE.MeshPhysicalMaterial({
      color: srgbColor('#cdbb9c'), map: lib.tex('fabric_albedo', true), normalMap: lib.tex('fabric_normal'), normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.92, sheen: 0.5, sheenRoughness: 0.7, sheenColor: srgbColor('#efe4cf'), envMapIntensity: 0.3,
    }));
    const terracotta = lib.make('outFabric|rust', () => new THREE.MeshPhysicalMaterial({
      color: srgbColor('#a4583c'), map: lib.tex('fabric_albedo', true), normalMap: lib.tex('fabric_normal'), normalScale: new THREE.Vector2(0.7, 0.7),
      roughness: 0.9, sheen: 0.6, sheenRoughness: 0.6, sheenColor: srgbColor('#e2a088'), envMapIntensity: 0.3,
    }));
    const ne = this.benches[1];
    for (const [x, mat] of [[-0.42, cushionMat], [0.12, terracotta]]) {
      const c = new THREE.Mesh(cushion(0.5, 0.07, 0.4), mat);
      c.position.set(x, 0.49, 0);
      c.rotation.y = (r() - 0.5) * 0.12;
      c.castShadow = true;
      c.receiveShadow = true;
      ne.add(c);
    }
    const plaidMat = lib.make('outFabric|plaid', () => new THREE.MeshPhysicalMaterial({
      map: tartanTexture(), normalMap: lib.tex('fabric_normal'), normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.95, sheen: 0.7, sheenRoughness: 0.5, sheenColor: srgbColor('#d9a48c'), envMapIntensity: 0.25,
    }));
    const plaidGeo = cushion(0.46, 0.05, 0.34, 0.022, 0.008);
    const pu = plaidGeo.attributes.position;
    const uvp = new Float32Array(pu.count * 2);
    for (let i = 0; i < pu.count; i++) { uvp[i * 2] = pu.getX(i) / 0.3 + pu.getY(i) * 2; uvp[i * 2 + 1] = pu.getZ(i) / 0.3; }
    plaidGeo.setAttribute('uv', new THREE.BufferAttribute(uvp, 2));
    const plaid = new THREE.Mesh(plaidGeo, plaidMat);
    plaid.position.set(0.38, 0.48, 0.02);
    plaid.rotation.y = 0.18;
    plaid.castShadow = true;
    plaid.receiveShadow = true;
    this.benches[0].add(plaid);

    LAYOUT.stumps.forEach((s, i) => {
      const [x, z] = polar(s.deg, s.r);
      const m = stump(lib, 31 + i * 7);
      m.position.set(x, 0.0, z);
      m.rotation.y = r() * 6.28;
      root.add(m);
    });

    const gr = grill(lib, r);
    {
      const [x, z] = polar(LAYOUT.grill.deg, LAYOUT.grill.r);
      gr.group.position.set(x, 0.03, z);
      gr.group.rotation.y = -Math.atan2(z, x) + Math.PI / 2;
      root.add(gr.group);
    }
    this.grill = gr;

    const wp = woodpile(lib);
    {
      const [x, z] = polar(LAYOUT.woodpile.deg, LAYOUT.woodpile.r);
      wp.position.set(x, 0, z);
      wp.rotation.y = -Math.atan2(z, x) - Math.PI / 2;
      root.add(wp);
    }

    const posts = LAYOUT.posts.map((d) => polar(d, 3.2));
    const sl = stringLights(lib, posts);
    root.add(sl.group);
    this.strings = sl;

    // Свет: огонь, угли мангала, середины пролётов гирлянды (мировые координаты).
    const W = (x, y, z) => ({ x: BBQ.x + x, y: GROUND_Y + y, z: BBQ.z + z });
    const [gx, gz] = polar(LAYOUT.grill.deg, LAYOUT.grill.r);
    this.lights = {
      fire: addPointLight({ ...W(0, 0.55, 0), color: new THREE.Color(1.0, 0.46, 0.15), radius: 10, intensity: 18, flicker: 1 }),
      grill: addPointLight({ ...W(gx, 0.9, gz), color: new THREE.Color(1.0, 0.4, 0.12), radius: 2.6, intensity: 3.2, flicker: 0.6 }),
      spans: sl.spans.map((p) => addPointLight({ ...W(p.x, p.y - 0.1, p.z), color: new THREE.Color(1.0, 0.7, 0.4), radius: 5, intensity: 3.2 })),
    };
    this.center = new THREE.Vector3(BBQ.x, GROUND_Y + 0.6, BBQ.z);
    this.bounds = new THREE.Sphere(new THREE.Vector3(BBQ.x, GROUND_Y + 1, BBQ.z), 4.2);
    this.fire = 0;
  }

  // fire — сила огня (0…1), lamp — гирлянда, day — дневной свет (ореолы и дым).
  setLight({ fire, lamp, day }) {
    this.fire = fire;
    FIRE.uFire.value = fire;
    FIRE.uNight.value = 1 - day;
    this.lights.fire.k = fire;
    this.lights.grill.k = fire;
    for (const s of this.lights.spans) s.k = lamp;
    this.pit.flames.visible = fire > 0.01;
    this.pit.sparks.visible = fire > 0.01;
    this.pit.smoke.visible = fire > 0.01;
    this.pit.halo.material.color.setRGB(1.0, 0.42, 0.12).multiplyScalar(fire * (0.04 + 0.28 * (1 - day)));
    this.pit.halo.visible = fire > 0.01;
    this.grill.holeMat.color.setRGB(0.01 + 2.2 * fire, 0.01 + 0.55 * fire, 0.01 + 0.1 * fire);
    this.grill.meatMesh.visible = fire > 0.05;
    this.strings.bulbMat.emissiveIntensity = lamp * 3.2;
    this.strings.glowMat.uniforms.uK.value = lamp * (0.15 + 0.85 * (1 - day));
  }

  // Огонь живой — нужен непрерывный рендер, пока зона в кадре.
  animating(camera) {
    if (this.fire <= 0.01) return false;
    const f = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    return f.intersectsSphere(this.bounds) && camera.position.distanceTo(this.bounds.center) < 120;
  }

  update(t, camera, renderer) {
    FIRE.uTime.value = t;
    const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
    const px = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    this.pit.sparkMat.uniforms.uPx.value = px;
    this.strings.glowMat.uniforms.uPx.value = px;
  }
}
