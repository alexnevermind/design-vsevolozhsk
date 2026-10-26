// Участок: рельеф (ровная площадка у дома, холмы к лесу), газон по фактуре лужайки с фотографии
// владельца + независимый мелкий рельеф, изменение оттенка в мировых координатах, переход в луговую
// траву и лесную подстилку под кронами (маска по положению деревьев); объёмная трава у дома;
// дорожка из плит со столбиками-светильниками; гравийная дорожка от ступеней к мангальной зоне,
// гравийная отмостка вокруг дома, стальной бордюр; кусты самшита и туя из карточек листвы (Blender);
// забор из горизонтальной доски. Процедурная запасная фактура работает и без загрузки карт.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GROUND_Y, SPEC } from './plan.js';
import { hash01 } from './mesh-builder.js';
import { rng } from './geometry.js';
import { terrainHeight, SITE } from './terrain.js';
import { forestLayout, farForestLayout, foliageMaterial } from './forest.js';
import { BBQ, bbqOccupied } from './bbq-zone.js';
import { addPointLight, applyPointLights } from './point-lights.js';
import { srgbColor } from './materials.js';

const NOISE = `
float lsHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float lsNoise(vec2 p){ vec2 i = floor(p); vec2 f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(lsHash(i), lsHash(i+vec2(1,0)), u.x), mix(lsHash(i+vec2(0,1)), lsHash(i+vec2(1,1)), u.x), u.y); }
float lsFbm(vec2 p){ float a = 0.5; float s = 0.0; for (int i = 0; i < 4; i++){ s += a * lsNoise(p); p *= 2.03; a *= 0.5; } return s; }
`;

// Маска леса: 1 под кронами деревьев, плавно к 0 на опушке (текстура 256² на 320 × 320 м).
const MASK = { size: 256, extent: 320 };
function forestMaskTexture(trees) {
  const n = MASK.size;
  const px = MASK.extent / n;
  const data = new Float32Array(n * n);
  const x0 = SITE.cx - MASK.extent / 2;
  const z0 = SITE.cz - MASK.extent / 2;
  for (const t of trees) {
    // Под одиночными деревьями у площадки — небольшой круг хвои; в сплошном лесу подстилка сплошная.
    const rad = t.far ? 6 + t.h * 0.18 : t.row ? 4.5 + t.h * 0.15 : 2.4 + t.h * 0.12;
    const ci = (t.x - x0) / px;
    const cj = (t.z - z0) / px;
    const rr = Math.ceil(rad / px) + 1;
    for (let j = Math.max(0, Math.floor(cj - rr)); j <= Math.min(n - 1, Math.ceil(cj + rr)); j++) {
      for (let i = Math.max(0, Math.floor(ci - rr)); i <= Math.min(n - 1, Math.ceil(ci + rr)); i++) {
        const d = Math.hypot(i - ci, j - cj) * px / rad;
        if (d < 1) data[j * n + i] += (1 - d * d) * 0.75;
      }
    }
  }
  const bytes = new Uint8Array(n * n * 4);
  for (let k = 0; k < n * n; k++) {
    const v = Math.min(1, data[k]);
    bytes[k * 4] = Math.round(v * 255);
    bytes[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(bytes, n, n, THREE.RGBAFormat);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export function makeGrassMaterial(lib, maskTex = null) {
  const m = lib.grass().clone();
  m.name = 'lawn';
  const floorMap = lib.tex('forest_floor_albedo', true);
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uForest = { value: maskTex };
    shader.uniforms.uFloor = { value: floorMap };
    shader.uniforms.uMaskRect = { value: new THREE.Vector3(SITE.cx - MASK.extent / 2, SITE.cz - MASK.extent / 2, MASK.extent) };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLsW;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLsW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vLsW;\nuniform sampler2D uForest;\nuniform sampler2D uFloor;\nuniform vec3 uMaskRect;\n${NOISE}`)
      .replace('#include <map_fragment>', `
        vec2 wp = vLsW.xz;
        float big = lsFbm(wp * 0.045);
        float mid = lsFbm(wp * 0.21 + 7.0);
        #ifdef USE_MAP
          // Два масштаба одной карты с поворотом, смешанные по шуму — повтор не читается.
          vec2 uvA = wp / 1.2;
          mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
          vec2 uvB = (r * wp) / 2.9 + 0.37;
          vec4 tA = texture2D( map, uvA );
          vec4 tB = texture2D( map, uvB );
          vec4 sampledDiffuseColor = mix( tA, tB, smoothstep(0.35, 0.65, mid) * 0.6 );
          diffuseColor *= sampledDiffuseColor;
        #else
          diffuseColor.rgb *= mix(vec3(0.20, 0.30, 0.10), vec3(0.32, 0.42, 0.16), lsFbm(wp * 3.1));
        #endif
        // Оттенок в мировых координатах: участки суше/сочнее.
        vec3 tint = mix(vec3(1.05, 1.0, 0.8), vec3(0.9, 1.0, 0.88), smoothstep(0.3, 0.7, big));
        diffuseColor.rgb *= tint * (0.93 + 0.14 * mid);
        // За площадкой — некошеная луговая трава: светлее, желтее, крупнее пятна.
        float dSite = length(vec2((wp.x - ${SITE.cx.toFixed(2)}) / 1.18, wp.y - ${SITE.cz.toFixed(2)}));
        float meadow = smoothstep(20.0, 42.0, dSite);
        vec3 dry = diffuseColor.rgb * vec3(1.06, 1.0, 0.72) * (0.78 + 0.32 * lsFbm(wp * 0.6 + 3.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, dry, meadow * (0.5 + 0.5 * smoothstep(0.4, 0.7, big)));
        // Под кронами — лесная подстилка (хвоя, мох), край опушки неровный.
        vec2 muv = (wp - uMaskRect.xy) / uMaskRect.z;
        float forest = texture2D(uForest, muv).r;
        forest = smoothstep(0.3, 0.8, forest + (lsFbm(wp * 0.22) - 0.5) * 0.5);
        vec3 litter = texture2D(uFloor, wp / 2.0).rgb * 1.1;
        // Тон газона по фотографии владельца: теплее и темнее голубоватого неба.
        diffuseColor.rgb *= vec3(0.9, 0.92, 0.7);
        diffuseColor.rgb = mix(diffuseColor.rgb, litter, forest);
      `);
  };
  m.customProgramCacheKey = () => 'lawn2';
  return applyPointLights(m);
}

// Земля по рельефу: сетка 1200 × 1200 м (шаг 5 м), край растворяется в дымке.
function buildGround(material) {
  const geo = new THREE.PlaneGeometry(1200, 1200, 240, 240).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, terrainHeight(pos.getX(i) + SITE.cx, pos.getZ(i) + SITE.cz));
  geo.translate(SITE.cx, 0, SITE.cz);
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, material);
  ground.receiveShadow = true;
  ground.userData.ground = true;
  ground.name = 'ground';
  return ground;
}

// Гравий: отмостка 0,55 м вокруг дома с террасой, площадка у ступеней и дорожка шириной 1,0 м
// к мангальной зоне (кривая Безье, входит на площадку с севера).
const BAND = { x0: -6.55, x1: 9.55, z0: -3.95, z1: 3.95 };
const APRON = { x0: 10.2, x1: 10.95, z0: -1.45, z1: 1.45 };
const PATH_W = 1.0;
const PATH_CTRL = [[10.6, 1.0], [10.78, 3.3], [10.85, 6.2], [BBQ.x + Math.cos(BBQ.entry) * (BBQ.r + 0.3), BBQ.z + Math.sin(BBQ.entry) * (BBQ.r + 0.3)]];
function bezier(c, t) {
  const u = 1 - t;
  const w = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
  return [w.reduce((a, k, i) => a + k * c[i][0], 0), w.reduce((a, k, i) => a + k * c[i][1], 0)];
}
export const PATH_PTS = Array.from({ length: 65 }, (_, i) => bezier(PATH_CTRL, i / 64));

function pathDistance(x, z) {
  let best = Infinity;
  for (let i = 0; i + 1 < PATH_PTS.length; i++) {
    const [ax, az] = PATH_PTS[i];
    const [bx, bz] = PATH_PTS[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

// Точный контур занятых мест для куртин: отмостка, ступени, гравий, плиты дорожки, мангальная зона.
function occupiedTight(x, z, slabs) {
  if (x > BAND.x0 - 0.03 && x < BAND.x1 + 0.03 && z > BAND.z0 - 0.03 && z < BAND.z1 + 0.03) return true;
  const st = SPEC.exteriorFixtures.terraceStair;
  if (x > 8.9 && x < st.x + st.treads * st.run + 0.05 && Math.abs(z - st.center) < st.width / 2 + 0.05) return true;
  if (x > APRON.x0 - 0.03 && x < APRON.x1 + 0.03 && z > APRON.z0 - 0.03 && z < APRON.z1 + 0.03) return true;
  if (pathDistance(x, z) < PATH_W / 2 + 0.04 || bbqOccupied(x, z)) return true;
  if (PLANTERS.some(([px, pz]) => Math.abs(x - px) < 0.32 && Math.abs(z - pz) < 0.32)) return true;
  return slabs.some((s) => Math.abs(x - s.x) < 0.3 && Math.abs(z - s.z) < 0.48);
}

// Тонкая стальная полоса бордюра вдоль ломаной (наружная и внутренняя грани, верх 4 мм).
function edgingGeometry(runs, y0, y1, t = 0.004) {
  const pos = [];
  const nrm = [];
  const quad = (a, b, c, d, n) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let k = 0; k < 6; k++) nrm.push(...n);
  };
  for (const pts of runs) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i];
      const [bx, bz] = pts[i + 1];
      const l = Math.hypot(bx - ax, bz - az);
      if (l < 1e-4) continue;
      const nx = -(bz - az) / l * t / 2;
      const nz = (bx - ax) / l * t / 2;
      const n = [nx / (t / 2), 0, nz / (t / 2)];
      quad([ax + nx, y0, az + nz], [bx + nx, y0, bz + nz], [bx + nx, y1, bz + nz], [ax + nx, y1, az + nz], n);
      quad([bx - nx, y0, bz - nz], [ax - nx, y0, az - nz], [ax - nx, y1, az - nz], [bx - nx, y1, bz - nz], n.map((v) => -v));
      quad([ax + nx, y1, az + nz], [bx + nx, y1, bz + nz], [bx - nx, y1, bz - nz], [ax - nx, y1, az - nz], [0, 1, 0]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return g;
}

function buildGravel(lib) {
  const group = new THREE.Group();
  group.name = 'paths';
  const Y = GROUND_Y + 0.006;
  const pos = [];
  const uv = [];
  const idx = [];
  const vtx = (x, z) => {
    pos.push(x, Y, z);
    uv.push(x / 0.8, z / 0.8);
    return pos.length / 3 - 1;
  };
  const rect = (x0, z0, x1, z1) => {
    const a = vtx(x0, z0);
    const b = vtx(x1, z0);
    const c = vtx(x1, z1);
    const d = vtx(x0, z1);
    idx.push(a, c, b, a, d, c);
  };
  rect(BAND.x0, BAND.z0, BAND.x1, -3.4);
  rect(BAND.x0, 3.4, BAND.x1, BAND.z1);
  rect(BAND.x0, -3.4, -6.0, 3.4);
  rect(9.0, -3.4, BAND.x1, 3.4);
  rect(APRON.x0, APRON.z0, APRON.x1, APRON.z1);
  // Лента дорожки; последнее сечение продлено по касательной под край площадки (шов под камнем).
  const sides = { l: [], r: [] };
  const n = PATH_PTS.length;
  for (let i = 0; i < n; i++) {
    const [x, z] = PATH_PTS[i];
    const [ax, az] = PATH_PTS[Math.max(0, i - 1)];
    const [bx, bz] = PATH_PTS[Math.min(n - 1, i + 1)];
    const l = Math.hypot(bx - ax, bz - az);
    const tx = (bx - ax) / l;
    const tz = (bz - az) / l;
    const ends = [[x - tz * PATH_W / 2, z + tx * PATH_W / 2], [x + tz * PATH_W / 2, z - tx * PATH_W / 2]];
    if (i === n - 1) {
      for (const e of ends) {
        for (let k = 0; k < 200 && Math.hypot(e[0] - BBQ.x, e[1] - BBQ.z) > BBQ.r - 0.06; k++) { e[0] += tx * 0.01; e[1] += tz * 0.01; }
      }
    }
    const a = vtx(...ends[0]);
    const b = vtx(...ends[1]);
    if (i > 0) idx.push(a - 2, a, b - 2, b - 2, a, b);
    sides.l.push(ends[0]);
    sides.r.push(ends[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const mat = lib.gravel('path', '#e2ddd3');
  mat.polygonOffset = true;
  mat.polygonOffsetFactor = -0.5;
  mat.polygonOffsetUnits = -0.5;
  const mesh = new THREE.Mesh(g, mat);
  mesh.receiveShadow = true;
  mesh.name = 'gravel';
  group.add(mesh);
  // Бордюр: по внешнему контуру отмостки (кроме ступеней), вокруг площадки у ступеней, по краям дорожки.
  const inApron = ([x, z]) => x > APRON.x0 - 0.02 && x < APRON.x1 + 0.02 && z > APRON.z0 - 0.02 && z < APRON.z1 + 0.02;
  const inPatio = ([x, z]) => Math.hypot(x - BBQ.x, z - BBQ.z) < BBQ.r + 0.02;
  const trim = (pts) => pts.filter((p) => !inApron(p) && !inPatio(p));
  const runs = [
    [[9.55, -1.32], [9.55, BAND.z0], [BAND.x0, BAND.z0], [BAND.x0, BAND.z1], [9.55, BAND.z1], [9.55, 1.32]],
    [[APRON.x0, APRON.z0], [APRON.x1, APRON.z0], [APRON.x1, APRON.z1]],
    trim(sides.l),
    trim(sides.r),
  ];
  const edge = new THREE.Mesh(edgingGeometry(runs, GROUND_Y - 0.01, GROUND_Y + 0.02), lib.plain('edging', { color: srgbColor('#2b2b2c'), roughness: 0.6, metalness: 0.5, envMapIntensity: 0.6 }));
  edge.castShadow = false;
  edge.receiveShadow = true;
  group.add(edge);
  return group;
}

// Объёмная трава: пучок из n изогнутых травинок высотой h0…h1 (цвета вершин от корня к кончику).
function grassTuft(seed, { blades = 5, h0 = 0.06, h1 = 0.14, spread = 0.06, root, tips }) {
  const r = rng(seed);
  const pos = [];
  const col = [];
  const nrm = [];
  const idx = [];
  for (let b = 0; b < blades; b++) {
    const ang = r() * Math.PI * 2;
    const ox = (r() - 0.5) * spread;
    const oz = (r() - 0.5) * spread;
    const h = h0 + r() * (h1 - h0);
    const bend = 0.2 + r() * 0.55;
    const w0 = 0.0035 + r() * 0.003;
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const tip = tips[Math.floor(r() * tips.length)];
    const base = pos.length / 3;
    const L = 4;
    for (let k = 0; k <= L; k++) {
      const t = k / L;
      const y = h * t;
      const off = bend * h * t * t;
      const w = w0 * (1 - t * 0.92);
      const cx = ox + dx * off;
      const cz = oz + dz * off;
      // Плоскость травинки поперёк направления изгиба.
      pos.push(cx - dz * w, y, cz + dx * w, cx + dz * w, y, cz - dx * w);
      const c = root.map((v, i) => v + (tip[i] - v) * Math.min(1, t * 1.2));
      col.push(...c, ...c);
      // Нормаль ближе к вертикали: трава освещается как газон под ней.
      const n = new THREE.Vector3(dx * 0.35, 1, dz * 0.35).normalize();
      nrm.push(n.x, n.y, n.z, n.x, n.y, n.z);
    }
    for (let k = 0; k < L; k++) {
      const a = base + k * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

function bladeMaterial() {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.92, envMapIntensity: 0.35 });
  mat.onBeforeCompile = (shader) => {
    // Без переворота нормали на изнанке: травинки освещаются одинаково с обеих сторон.
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''));
  };
  mat.customProgramCacheKey = () => 'grassBlade1';
  return applyPointLights(mat);
}

function scatter(geo, mat, points, name) {
  const im = new THREE.InstancedMesh(geo, mat, Math.max(1, points.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  points.forEach((p, i) => {
    q.setFromAxisAngle(up, p.rot);
    m.compose(new THREE.Vector3(p.x, terrainHeight(p.x, p.z) - 0.005, p.z), q, new THREE.Vector3(p.s, p.s * p.sy, p.s));
    im.setMatrixAt(i, m);
  });
  im.count = points.length;
  im.castShadow = false;
  im.receiveShadow = true;
  im.name = name;
  im.computeBoundingSphere();
  return im;
}

// Густые высокие куртины там, где не проходит косилка: вдоль цоколя и ступеней, у плит дорожки,
// кустов, забора и стволов.
function buildGrass(count, edges, slabsAt) {
  const r = rng(5151);
  const group = new THREE.Group();
  group.name = 'grass';
  const mat = bladeMaterial();
  // Стриженый газон даёт карта; объёмные куртины — только у препятствий (точки-источники с разбросом).
  const tallRoot = [0.045, 0.065, 0.02];
  const tallTips = [[0.16, 0.19, 0.06], [0.2, 0.21, 0.075], [0.13, 0.17, 0.05], [0.24, 0.22, 0.09]];
  const clump = mergeGeometries([0, 1, 2].map((k) => grassTuft(1200 + k, { blades: 12, h0: 0.12, h1: 0.3, spread: 0.14, root: tallRoot, tips: tallTips })));
  const tall = [];
  const nTall = Math.round(count * 0.35);
  for (let i = 0; i < nTall; i++) {
    const e = edges[Math.floor(r() * edges.length)];
    const p = e(r);
    if (!p || occupiedTight(p[0], p[1], slabsAt)) continue;
    tall.push({ x: p[0], z: p[1], rot: r() * 6.283, s: 0.7 + r() * 0.6, sy: 0.7 + r() * 0.7 });
  }
  group.add(scatter(clump, mat, tall, 'grass-clumps'));
  return group;
}

// Источники высокой травы: отрезки (цоколь, ступени, забор) и окрестности точек (плиты, кусты, стволы).
function grassEdges(slabs, shrubs, trees) {
  const edges = [];
  // Отрезок a–b, смещение вдоль нормали от o0 до o1 (знак — сторона).
  const seg = (a, b, o1, o0 = o1 * 0.15) => (r) => {
    const t = r();
    const x = a[0] + (b[0] - a[0]) * t;
    const z = a[1] + (b[1] - a[1]) * t;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / len;
    const nz = (b[0] - a[0]) / len;
    const o = o0 + (o1 - o0) * r();
    return [x + nx * o, z + nz * o];
  };
  const ring = (x, z, r0, r1) => (r) => {
    const a = r() * Math.PI * 2;
    const d = r0 + (r1 - r0) * Math.sqrt(r());
    return [x + Math.cos(a) * d, z + Math.sin(a) * d];
  };
  // Контур дома с террасой (обход по часовой — нормаль наружу при off > 0 для обхода против часовой).
  const outline = [[-6.0, -3.4], [6.0, -3.4], [9.0, -3.4], [9.0, 3.4], [6.0, 3.4], [-6.0, 3.4]];
  // Куртины — за краем гравийной отмостки (0,55 м от стены).
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    for (let k = 0; k < 3; k++) edges.push(seg(a, b, -0.85, -0.6));
  }
  // Вдоль гравийной дорожки (обе стороны) и по краю мангальной площадки.
  for (let i = 0; i + 4 < PATH_PTS.length; i += 4) {
    edges.push(seg(PATH_PTS[i], PATH_PTS[i + 4], 0.78, 0.54), seg(PATH_PTS[i], PATH_PTS[i + 4], -0.78, -0.54));
  }
  for (let k = 0; k < 3; k++) edges.push(ring(BBQ.x, BBQ.z, BBQ.r + 0.06, BBQ.r + 0.35));
  for (const s of slabs) edges.push(ring(s.x, s.z, 0.3, 0.6));
  for (const [x, z, rad] of shrubs) { edges.push(ring(x, z, rad * 0.8, rad * 1.5)); edges.push(ring(x, z, rad * 0.8, rad * 1.5)); }
  for (const t of trees) edges.push(ring(t.x, t.z, 0.25, 1.2));
  for (const [a, b] of FENCE_RUNS) for (let k = 0; k < 4; k++) edges.push(seg(a, b, 0.5), seg(a, b, -0.5));
  return edges;
}

// Куст из карточек листвы на эллипсоиде (лицом наружу) с тёмной сердцевиной против просветов.
function shrubGeometry(seed, rx, ry, rz, cardSize, density, coneTop = false) {
  const r = rng(seed);
  const cards = [];
  const area = 4 * Math.PI * Math.pow((rx * ry + ry * rz + rx * rz) / 3, 1);
  const n = Math.round(area * density);
  for (let i = 0; i < n; i++) {
    // Равномерно по сфере, затем растяжение в эллипсоид (у туи — сужение кверху).
    const u = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    let dir = new THREE.Vector3(s * Math.cos(a), u, s * Math.sin(a));
    if (dir.y < -0.55) dir.y = -0.55;
    const taper = coneTop ? Math.max(0.08, 1 - (dir.y * 0.5 + 0.5) ** 1.4) : 1;
    const depth = 0.8 + r() * 0.25;
    const p = new THREE.Vector3(dir.x * rx * taper * depth, dir.y * ry * depth, dir.z * rz * taper * depth);
    const outN = new THREE.Vector3(dir.x / rx, dir.y / ry * 0.8 + 0.25, dir.z / rz).normalize();
    const g = new THREE.PlaneGeometry(cardSize * (0.8 + r() * 0.4), cardSize * (0.8 + r() * 0.4));
    const look = new THREE.Matrix4().lookAt(new THREE.Vector3(), outN.clone().add(new THREE.Vector3((r() - 0.5) * 0.7, (r() - 0.5) * 0.7, (r() - 0.5) * 0.7)), new THREE.Vector3(0, 1, 0));
    g.applyMatrix4(new THREE.Matrix4().makeRotationZ(r() * Math.PI * 2));
    g.applyMatrix4(look);
    g.translate(p.x, p.y, p.z);
    const shade = (0.6 + 0.4 * (dir.y * 0.5 + 0.5)) * (0.85 + 0.3 * r());
    const nrm = g.attributes.normal;
    const col = [];
    for (let k = 0; k < nrm.count; k++) {
      nrm.setXYZ(k, outN.x, outN.y, outN.z);
      col.push(shade, shade, shade * 0.95);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    cards.push(g);
  }
  return mergeGeometries(cards);
}

const SHRUB_BALLS = [[-1.6, 4.7, 0.62], [-0.45, 5.0, 0.45], [4.4, 4.75, 0.55], [-7.25, 2.4, 0.6], [-7.3, -1.7, 0.5], [10.9, -4.1, 0.75], [12.35, 4.7, 0.5]];
const THUJAS = [[9.7, 4.65, 2.7, 0.48], [-7.6, -3.9, 2.3, 0.42], [-7.4, 4.6, 2.0, 0.38]];

function buildShrubs(lib) {
  const group = new THREE.Group();
  group.name = 'shrubs';
  const leaves = foliageMaterial(lib.leaves());
  const needles = foliageMaterial(lib.needles());
  const core = new THREE.MeshStandardMaterial({ color: new THREE.Color().setStyle('#1d2a14', THREE.SRGBColorSpace), roughness: 1 });
  const depthLeaves = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: leaves.map, alphaTest: 0.45, side: THREE.DoubleSide });
  // Самшитовые шары у южного фасада и у торцов (как на фотографии), разных размеров.
  const balls = SHRUB_BALLS;
  balls.forEach(([x, z, rad], k) => {
    const rx = rad * (0.95 + 0.1 * hash01(k));
    const ry = rad * 0.82;
    const geo = shrubGeometry(300 + k, rx, ry, rad, 0.2, 64);
    const m = new THREE.Mesh(geo, leaves);
    m.customDepthMaterial = depthLeaves;
    const y = terrainHeight(x, z) + ry * 0.78;
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.excludeAO = true;
    group.add(m);
    const c = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), core);
    c.scale.set(rx * 0.72, ry * 0.68, rad * 0.72);
    c.position.set(x, y - ry * 0.05, z);
    c.castShadow = true;
    group.add(c);
  });
  // Колоновидные туи у угла террасы и у западного торца.
  THUJAS.forEach(([x, z, h, rad], k) => {
    const geo = shrubGeometry(700 + k, rad, h / 2, rad, 0.28, 72, true);
    const m = new THREE.Mesh(geo, needles);
    const y = terrainHeight(x, z) + h / 2;
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    m.userData.excludeAO = true;
    group.add(m);
    const c = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.7, h * 0.9, 10), core);
    c.position.set(x, y - h * 0.02, z);
    group.add(c);
  });
  return group;
}

// Столбики-светильники вдоль дорожек (графит, матовый рассеиватель) — светятся вместе с фасадными
// и дают на газон и гравий тёплые пятна света (дешёвые точечные источники).
function buildBollards(lib, slabs) {
  const group = new THREE.Group();
  group.name = 'bollards';
  const body = lib.blackMetal(false);
  const glow = lib.lampGlow();
  const spots = slabs.filter((_, i) => i % 3 === 1).map((s, k) => [s.x + 0.25, s.z + (k % 2 ? 1 : -1) * 0.85]);
  for (const t of [0.3, 0.66]) {
    const i = Math.round(t * (PATH_PTS.length - 1));
    const [x, z] = PATH_PTS[i];
    const [bx, bz] = PATH_PTS[i + 1];
    const l = Math.hypot(bx - x, bz - z);
    spots.push([x + (bz - z) / l * -0.82, z + (bx - x) / l * 0.82]);
  }
  group.userData.lights = [];
  spots.forEach(([x, z]) => {
    const y = terrainHeight(x, z);
    group.userData.lights.push(addPointLight({ x, y: y + 0.55, z, color: new THREE.Color(1.0, 0.76, 0.5), radius: 3.2, intensity: 2.4 }));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.06, 0.55, 20), body);
    post.position.set(x, y + 0.275, z);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.1, 20, 1, true), glow);
    lens.position.set(x, y + 0.6, z);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.062, 0.03, 20), body);
    cap.position.set(x, y + 0.665, z);
    for (const m of [post, lens, cap]) { m.castShadow = m !== lens; m.receiveShadow = true; group.add(m); }
  });
  return group;
}

const PLANTERS = [[9.8, -1.8], [9.8, 1.8]];

// Кашпо по сторонам ступеней террасы: бетонный куб 0,5 × 0,6 м с декоративным злаком (мискантус) — высокие
// изогнутые листья из той же модели травинок, что и куртины.
function buildPlanters(lib) {
  const group = new THREE.Group();
  group.name = 'planters';
  const box = new THREE.BoxGeometry(0.5, 0.6, 0.5, 1, 1, 1);
  const concrete = lib.plain('planterConcrete', { color: srgbColor('#8e8a83'), roughness: 0.9, normalMap: lib.tex('stone_rough'), normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 0.5 });
  const soil = lib.plain('planterSoil', { color: srgbColor('#2b2119'), roughness: 1 });
  const root = [0.06, 0.08, 0.03];
  const tips = [[0.42, 0.4, 0.2], [0.5, 0.46, 0.26], [0.36, 0.38, 0.16], [0.56, 0.5, 0.3]];
  const grass = mergeGeometries([0, 1, 2, 3].map((k) => grassTuft(3100 + k, { blades: 22, h0: 0.55, h1: 0.95, spread: 0.3, root, tips })));
  const mat = bladeMaterial();
  for (const [x, z] of PLANTERS) {
    const y = GROUND_Y;
    const b = new THREE.Mesh(box, concrete);
    b.position.set(x, y + 0.3, z);
    b.castShadow = true;
    b.receiveShadow = true;
    const top = new THREE.Mesh(new THREE.PlaneGeometry(0.44, 0.44).rotateX(-Math.PI / 2), soil);
    top.position.set(x, y + 0.57, z);
    const g = new THREE.Mesh(grass, mat);
    g.position.set(x, y + 0.56, z);
    g.castShadow = true;
    g.receiveShadow = true;
    g.userData.excludeAO = true;
    group.add(b, top, g);
  }
  return group;
}

// Забор из горизонтальной доски на столбах по северной и боковым границам участка.
const FENCE_RUNS = [[[-23, -15], [26, -15]], [[-23, -15], [-23, 12]], [[26, -15], [26, 8]]];
function buildFence(lib) {
  const boards = [];
  const posts = [];
  const H = 1.5;
  const bh = 0.12;
  const gap = 0.022;
  for (const [a, b] of FENCE_RUNS) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bays = Math.ceil(len / 2.5);
    const ux = (b[0] - a[0]) / len;
    const uz = (b[1] - a[1]) / len;
    for (let i = 0; i <= bays; i++) {
      const x = a[0] + ux * len * (i / bays);
      const z = a[1] + uz * len * (i / bays);
      const y = terrainHeight(x, z);
      const p = new THREE.BoxGeometry(0.09, H + 0.4, 0.09);
      p.translate(x, y + (H + 0.4) / 2 - 0.35, z);
      posts.push(p);
      if (i === bays) continue;
      const x2 = a[0] + ux * len * ((i + 1) / bays);
      const z2 = a[1] + uz * len * ((i + 1) / bays);
      const y2 = terrainHeight(x2, z2);
      const bl = len / bays;
      for (let k = 0; k < Math.floor(H / (bh + gap)); k++) {
        const g = new THREE.BoxGeometry(bl + 0.02, bh, 0.022);
        g.rotateY(-Math.atan2(uz, ux));
        g.translate((x + x2) / 2 + uz * 0.055, (y + y2) / 2 + 0.06 + k * (bh + gap) + bh / 2, (z + z2) / 2 - ux * 0.055);
        boards.push(g);
      }
    }
  }
  const wood = lib.deckWood('smoked');
  const withColor = (g) => {
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(g.attributes.position.count * 3).fill(1), 3));
    return g;
  };
  const group = new THREE.Group();
  group.name = 'fence';
  for (const geo of [mergeGeometries(boards.map(withColor)), mergeGeometries(posts.map(withColor))]) {
    const m = new THREE.Mesh(geo, wood);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

// density: 'high' | 'medium' | 'low' — число травинок и деревьев дальнего леса задаёт app.js.
export function buildLandscape(lib, { grassCount = 9000, farCount = 360 } = {}) {
  const group = new THREE.Group();
  group.name = 'landscape';
  // Три ряда детальной группы — опушка с подстилкой; шесть боковых деревьев стоят на газоне.
  const mask = forestMaskTexture([...forestLayout().map((t, i) => ({ ...t, row: i < 33 })), ...farForestLayout(farCount).map((t) => ({ ...t, far: true }))]);
  group.add(buildGround(makeGrassMaterial(lib, mask)));
  // Дорожка из бетонных плит от ступеней террасы.
  const st = SPEC.exteriorFixtures.terraceStair;
  const slabMat = lib.concrete();
  const startX = st.x + st.treads * st.run + 0.35;
  const slabs = [];
  for (let i = 0; i < 9; i++) {
    const w = 0.9 - (i % 2) * 0.15;
    const slab = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.05, w), slabMat);
    slab.position.set(startX + i * 0.75, GROUND_Y + 0.012, st.center + Math.sin(i * 0.7) * 0.35 + i * 0.25);
    slab.rotation.y = (hash01(i + 3) - 0.5) * 0.15;
    slab.receiveShadow = true;
    slab.castShadow = true;
    slabs.push({ x: slab.position.x, z: slab.position.z });
    group.add(slab);
  }
  if (grassCount > 0) {
    const shrubs = [...SHRUB_BALLS, ...THUJAS.map(([x, z, , rad]) => [x, z, rad])];
    group.add(buildGrass(grassCount, grassEdges(slabs, shrubs, forestLayout()), slabs));
  }
  group.add(buildShrubs(lib));
  const bollards = buildBollards(lib, slabs);
  group.add(bollards);
  group.add(buildGravel(lib));
  group.add(buildPlanters(lib));
  group.add(buildFence(lib));
  group.userData.lights = bollards.userData.lights;
  return group;
}
