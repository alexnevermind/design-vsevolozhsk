// Рельеф участка и окрестностей: прямоугольная сетка с переменным шагом (0,4 м на участке, к краю — до
// десятков метров), высоты — по отметкам съёмки с планировкой у построек (site-data.js). Газон на
// участке — карта лужайки с поворотом и шумом в мировых координатах; за забором — некошеный луг;
// под кронами — хвойная подстилка (маска по деревьям).
import * as THREE from 'three';
import { SITE, groundY, SITE_BOX } from './site-data.js';
import { applyPointLights } from './point-lights.js';

const NOISE = `
float sgHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sgNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(sgHash(i), sgHash(i+vec2(1,0)), u.x), mix(sgHash(i+vec2(0,1)), sgHash(i+vec2(1,1)), u.x), u.y); }
float sgFbm(vec2 p){ float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++){ s += a * sgNoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

// Маска подстилки: 1 под кронами, к краю — 0 (текстура 256² на квадрат extent м с центром center).
export const MASK = { size: 256, extent: 360 };
export function litterMask(trees, center) {
  const n = MASK.size;
  const px = MASK.extent / n;
  const data = new Float32Array(n * n);
  const x0 = center[0] - MASK.extent / 2;
  const z0 = center[1] - MASK.extent / 2;
  for (const t of trees) {
    const rad = t.rad;
    const ci = (t.x - x0) / px;
    const cj = (t.z - z0) / px;
    const rr = Math.ceil(rad / px) + 1;
    for (let j = Math.max(0, Math.floor(cj - rr)); j <= Math.min(n - 1, Math.ceil(cj + rr)); j++) {
      for (let i = Math.max(0, Math.floor(ci - rr)); i <= Math.min(n - 1, Math.ceil(ci + rr)); i++) {
        const d = Math.hypot(i - ci, j - cj) * px / rad;
        if (d < 1) data[j * n + i] += (1 - d * d) * (t.k ?? 0.75);
      }
    }
  }
  const bytes = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    bytes[k * 4] = Math.round(Math.min(1, data[k]) * 255);
    bytes[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(bytes, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function lawnMaterial(lib, maskTex, center) {
  const m = lib.grass().clone();
  m.name = 'site-lawn';
  const floorMap = lib.tex('forest_floor_albedo', true);
  const B = SITE.boundary;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uMask = { value: maskTex };
    shader.uniforms.uFloor = { value: floorMap };
    shader.uniforms.uMaskRect = { value: new THREE.Vector3(center[0] - MASK.extent / 2, center[1] - MASK.extent / 2, MASK.extent) };
    shader.uniforms.uB = { value: B.map(([x, z]) => new THREE.Vector2(x, z)) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSgW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSgW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vSgW;\nuniform sampler2D uMask;\nuniform sampler2D uFloor;\nuniform vec3 uMaskRect;\nuniform vec2 uB[4];\n${NOISE}
        // Расстояние наружу от границы участка (0 внутри).
        float sgOutside(vec2 p){
          float d = 0.0; bool inside = true;
          for (int i = 0; i < 4; i++){
            vec2 a = uB[i]; vec2 b = uB[(i + 1) % 4];
            vec2 e = b - a; vec2 q = p - a;
            float t = clamp(dot(q, e) / dot(e, e), 0.0, 1.0);
            float dist = length(q - e * t);
            float side = e.x * q.y - e.y * q.x;
            if (side < 0.0) inside = false;
            d = (i == 0) ? dist : min(d, dist);
          }
          return inside ? 0.0 : d;
        }`)
      .replace('#include <map_fragment>', `
        vec2 wp = vSgW.xz;
        float big = sgFbm(wp * 0.045);
        float mid = sgFbm(wp * 0.21 + 7.0);
        #ifdef USE_MAP
          vec2 uvA = wp / 1.2;
          mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
          vec2 uvB = (r * wp) / 2.9 + 0.37;
          vec4 sampledDiffuseColor = mix(texture2D(map, uvA), texture2D(map, uvB), smoothstep(0.35, 0.65, mid) * 0.6);
          diffuseColor *= sampledDiffuseColor;
        #else
          diffuseColor.rgb *= mix(vec3(0.20, 0.30, 0.10), vec3(0.32, 0.42, 0.16), sgFbm(wp * 3.1));
        #endif
        vec3 tint = mix(vec3(1.05, 1.0, 0.8), vec3(0.9, 1.0, 0.88), smoothstep(0.3, 0.7, big));
        diffuseColor.rgb *= tint * (0.93 + 0.14 * mid);
        // За забором — некошеный луг: суше, желтее, пятнами.
        float meadow = smoothstep(0.3, 2.5, sgOutside(wp));
        vec3 dry = diffuseColor.rgb * vec3(1.06, 1.0, 0.72) * (0.78 + 0.32 * sgFbm(wp * 0.6 + 3.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, dry, meadow * (0.55 + 0.45 * smoothstep(0.4, 0.7, big)));
        vec2 muv = (wp - uMaskRect.xy) / uMaskRect.z;
        float forest = texture2D(uMask, muv).r;
        forest = smoothstep(0.3, 0.8, forest + (sgFbm(wp * 0.22) - 0.5) * 0.5);
        vec3 litter = texture2D(uFloor, wp / 2.0).rgb * 1.1;
        diffuseColor.rgb *= vec3(0.9, 0.92, 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, litter, forest);
      `);
  };
  m.customProgramCacheKey = () => 'siteLawn1';
  return applyPointLights(m);
}

// Узлы сетки: плотные на участке с запасом, к краю — геометрическая прогрессия.
function axisNodes(a0, a1, step, far, n) {
  const xs = [];
  for (let x = a0; x <= a1 + 1e-6; x += step) xs.push(x);
  let d = step;
  let x = a0;
  const left = [];
  for (let i = 0; i < n && x > -far + a0; i++) { d *= 1.16; x -= d; left.unshift(x); }
  x = xs[xs.length - 1];
  d = step;
  const right = [];
  for (let i = 0; i < n && x < a1 + far; i++) { d *= 1.16; x += d; right.push(x); }
  return [...left, ...xs, ...right];
}

export function buildTerrain(material, { step = 0.4 } = {}) {
  const xs = axisNodes(SITE_BOX.x0 - 9, SITE_BOX.x1 + 9, step, 650, 60);
  const zs = axisNodes(SITE_BOX.z0 - 9, SITE_BOX.z1 + 9, step, 650, 60);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = (j * nx + i) * 3;
    pos[k] = xs[i];
    pos[k + 1] = groundY(xs[i], zs[j]);
    pos[k + 2] = zs[j];
  }
  const idx = [];
  for (let j = 0; j + 1 < nz; j++) for (let i = 0; i + 1 < nx; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(nx * nz > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'ground';
  mesh.receiveShadow = true;
  mesh.userData.ground = true;
  return mesh;
}
