// Деревья участка по плану съёмки: сосны (генератор базы), ели и берёзы (собственные генераторы),
// высота — по диаметру ствола (SITE_SPEC), положение — точка знака на плане. Деревья под вырубку не
// ставятся. Фон: редкий хвойный лес не ближе 20 м за забором и кромка леса на горизонте (деревья
// съёмки за забором не показываются — решение владельца).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './geometry.js';
import { SITE, SRC, BUILDING, groundY, floorY, insideSite, SITE_CENTER } from './site-data.js';
import { buildPineVariant, foliageMaterial, tube, foliageCard, buildTreeline } from './forest.js';

export const PINE_SEEDS = [7103, 7422, 7741];
export const SPRUCE_SEEDS = [8101, 8233, 8377];
export const BIRCH_SEEDS = [9103, 9241, 9377];

// Ель: прямой ствол до вершины, крона-конус от 0,1 высоты, мутовки через 0,4 м, ветви с провисом и
// приподнятыми концами, густые веточки-карточки. Шаблон высотой 10 м.
export function buildSpruceVariant(seed, detail = 'near') {
  const r = rng(seed);
  const far = detail === 'far';
  const H = 10;
  const N = far ? 6 : 14;
  const pts = [], radii = [], cols = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector3(Math.sin(t * 3 + seed) * 0.03 * t, t * H, Math.cos(t * 2.6 + seed) * 0.03 * t));
    radii.push(0.19 * (1 - t) ** 1.1 + 0.01 + 0.08 * Math.exp(-t * 30));
    const k = 0.62 + 0.1 * r();
    cols.push([k, k * 0.9, k * 0.82]);
  }
  const wood = [tube(pts, radii, far ? 5 : 9, cols)];
  const leaves = [];
  const crownR = 1.5;
  const crownC = new THREE.Vector3(0, H * 0.5, 0);
  const whorlStep = far ? 0.7 : 0.38;
  for (let y = H * 0.15; y < H - 0.2; y += whorlStep * (0.85 + 0.3 * r())) {
    const t = y / H;
    const L = 0.2 + 1.4 * (1 - t) ** 0.95;
    const nb = far ? 4 : 5 + Math.floor(r() * 3);
    const a0 = r() * Math.PI * 2;
    for (let b = 0; b < nb; b++) {
      const ang = a0 + (b / nb) * Math.PI * 2 + (r() - 0.5) * 0.4;
      const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
      const segs = far ? 2 : 4;
      const bp = [new THREE.Vector3(0, y, 0)];
      for (let k = 1; k <= segs; k++) {
        const s = k / segs;
        // Провис к середине, конец приподнят.
        const sag = -0.35 * L * Math.sin(s * Math.PI * 0.85) + 0.12 * L * s * s;
        bp.push(new THREE.Vector3(dir.x * L * s, y - 0.12 * L * s + sag * 0.6, dir.z * L * s));
      }
      if (!far) wood.push(tube(bp, bp.map((_, k) => 0.035 * (1 - k / (segs + 1)) + 0.006), 4, bp.map(() => [0.5, 0.42, 0.36])));
      const cards = far ? 3 : Math.max(3, Math.round(L * 5));
      for (let c = 0; c < cards; c++) {
        const s = 0.25 + 0.75 * (c / cards) + r() * 0.08;
        const k = Math.min(segs - 1, Math.floor(s * segs));
        const f = s * segs - k;
        const p = bp[k].clone().lerp(bp[k + 1], f);
        const d2 = dir.clone().multiplyScalar(0.6).add(new THREE.Vector3((r() - 0.5) * 0.6, 0.15 + r() * 0.3, (r() - 0.5) * 0.6)).normalize();
        foliageCard(leaves, p, d2, (far ? 0.9 : 0.55) * (0.8 + 0.4 * r()) * (0.75 + 0.5 * (1 - t)), r, crownC, crownR, 0.62 + 0.25 * r());
      }
    }
  }
  // Вершина: несколько вертикальных карточек.
  for (let k = 0; k < (far ? 2 : 4); k++) foliageCard(leaves, new THREE.Vector3(0, H - 0.9 + k * 0.2, 0), new THREE.Vector3((r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.3).normalize(), 0.7, r, crownC, crownR, 0.8);
  return { wood: mergeGeometries(wood), leaves: mergeGeometries(leaves) };
}

// Берёза: белый ствол с лёгким наклоном, крона-яйцо в верхних двух третях, восходящие ветви,
// листва карточками на концах побегов. Шаблон высотой 10 м.
export function buildBirchVariant(seed, detail = 'near') {
  const r = rng(seed);
  const far = detail === 'far';
  const H = 10;
  const N = far ? 6 : 14;
  const lean = new THREE.Vector2((r() - 0.5) * 0.6, (r() - 0.5) * 0.6);
  const pts = [], radii = [], cols = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    pts.push(new THREE.Vector3(lean.x * t * t + Math.sin(t * 6 + seed) * 0.05 * t, t * H, lean.y * t * t + Math.cos(t * 5 + seed) * 0.05 * t));
    radii.push(0.13 * (1 - t) ** 1.2 + 0.012 + 0.05 * Math.exp(-t * 25));
    // Низ ствола темнее (трещиноватая кора у комля).
    const k = t < 0.08 ? 0.55 + t * 5 : 1;
    cols.push([k, k, k * 0.98]);
  }
  const wood = [tube(pts, radii, far ? 5 : 9, cols, 1)];
  const leaves = [];
  const crownC = new THREE.Vector3(lean.x * 0.5, H * 0.66, lean.y * 0.5);
  const crownR = 2.4;
  const branches = far ? 7 : 16;
  for (let b = 0; b < branches; b++) {
    const t = 0.32 + 0.6 * (b / branches) + (r() - 0.5) * 0.05;
    const i = Math.min(N - 1, Math.floor(t * N));
    const base = pts[i].clone().lerp(pts[i + 1], t * N - i);
    const ang = b * 2.4 + r() * 0.6;
    const up = 0.9 + r() * 0.5 + t * 0.4;
    const dir = new THREE.Vector3(Math.cos(ang), up, Math.sin(ang)).normalize();
    const L = (1.0 + 2.0 * Math.sin(Math.PI * Math.min(1, (t - 0.25) / 0.75))) * (0.8 + 0.4 * r());
    const bp = [base];
    const segs = far ? 2 : 3;
    for (let k = 1; k <= segs; k++) {
      const s = k / segs;
      const p = base.clone().addScaledVector(dir, L * s);
      p.y -= 0.25 * L * s * s; // концы свисают
      bp.push(p);
    }
    if (!far) wood.push(tube(bp, bp.map((_, k) => 0.04 * (1 - k / (segs + 1)) + 0.005), 4, bp.map(() => [0.92, 0.9, 0.86])));
    const cards = far ? 4 : 9;
    for (let c = 0; c < cards; c++) {
      const s = 0.35 + 0.65 * (c / cards) + r() * 0.1;
      const k = Math.min(segs - 1, Math.floor(s * segs));
      const p = bp[k].clone().lerp(bp[k + 1], s * segs - k).add(new THREE.Vector3((r() - 0.5) * 0.5, (r() - 0.5) * 0.4, (r() - 0.5) * 0.5));
      const d2 = new THREE.Vector3(dir.x + (r() - 0.5), 0.2 + r() * 0.6 - 0.5, dir.z + (r() - 0.5)).normalize();
      foliageCard(leaves, p, d2, (far ? 1.4 : 0.85) * (0.8 + 0.4 * r()), r, crownC, crownR, 0.7 + 0.3 * r());
    }
  }
  return { wood: mergeGeometries(wood), leaves: mergeGeometries(leaves) };
}

// Радиус кроны шаблона: 90-й перцентиль удаления вершин листвы от оси ствола.
function crownRadius(geo) {
  const p = geo.attributes.position;
  const rs = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) rs[i] = Math.hypot(p.getX(i), p.getZ(i));
  rs.sort();
  return rs[Math.floor(rs.length * 0.9)];
}

function instanced(geo, mat, items, { shadows = true, depthMat = null, distMat = null } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  items.forEach((t, i) => {
    q.setFromAxisAngle(up, t.rot);
    m.compose(new THREE.Vector3(t.x, groundY(t.x, t.z) - 0.06, t.z), q, new THREE.Vector3(t.sxz, t.h / 10, t.sxz));
    im.setMatrixAt(i, m);
  });
  im.castShadow = shadows;
  im.receiveShadow = true;
  if (depthMat) im.customDepthMaterial = depthMat;
  if (distMat) im.customDistanceMaterial = distMat;
  im.computeBoundingSphere();
  return im;
}

// Список деревьев участка для сцены: позиция, высота, масштаб кроны и ствола, вариант.
export function plannedTrees() {
  return SITE.trees.filter((t) => t.status === 'keep').map((t, i) => {
    // Ширина: среднее между пропорциональным масштабом и масштабом по диаметру ствола.
    const dRef = t.species === 'birch' ? 0.2 : t.species === 'spruce' ? 0.3 : 0.32;
    const sxz = 0.5 * (t.height / 10) + 0.5 * ((t.dbh / 100) / dRef);
    return { id: t.id, species: t.species, x: t.pos[0], z: t.pos[1], h: t.height, sxz, rot: (i * 2.399) % (Math.PI * 2), variant: i % 3, crown: t.crown, dbh: t.dbh };
  });
}

// Фоновый лес: кольцо вокруг участка от 20 до 160 м за забором (сосна и ель вперемешку).
export function backdropTrees(count) {
  const r = rng(5151);
  const list = [];
  const [cx, cz] = SITE_CENTER;
  let tries = 0;
  while (list.length < count && tries < count * 50) {
    tries++;
    const ang = r() * Math.PI * 2;
    const rad = 42 + (r() ** 1.7) * 150;
    const x = cx + Math.cos(ang) * rad * 1.05;
    const z = cz + Math.sin(ang) * rad;
    if (insideSite(x, z)) continue;
    if (list.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 11)) continue;
    const species = r() < 0.6 ? 'pine' : 'spruce';
    const h = species === 'pine' ? 15 + r() * 9 : 12 + r() * 8;
    list.push({ x, z, h, sxz: h / 10 * (species === 'pine' ? 0.85 : 0.9), rot: r() * Math.PI * 2, variant: Math.floor(r() * 3), species });
  }
  return list;
}

// Объёмы построек под кровлей в мировых координатах: хвоя и ветви внутри не рисуются (ветки елей у стен
// не проходят в помещения; снаружи эта часть кроны и так скрыта стенами и кровлей).
// A — прямоугольник x0, z0, x1, z1 (у шестигранника — центр и апофема); B — низ, конёк, tg уклона, тип:
// 0 — конёк вдоль X (по середине z), 1 — вдоль Z, 2 — шестигранник (высота убывает от центра).
export function buildingVolumes() {
  const vols = [];
  const DEG = Math.PI / 180;
  const rect = (poly) => [Math.min(...poly.map((p) => p[0])), Math.min(...poly.map((p) => p[1])), Math.max(...poly.map((p) => p[0])), Math.max(...poly.map((p) => p[1]))];
  const gable = (poly, ridgeY, pitch, fy, alongX) => vols.push({ A: rect(poly), B: [fy - 0.5, ridgeY, Math.tan(pitch * DEG), alongX ? 0 : 1] });
  const G = SRC.guest.heights, gy = floorY('guest');
  const [main, link, wing] = BUILDING.guest.footprint;
  const ridgeAlongX = (r) => Math.abs(r.ridge[1][0] - r.ridge[0][0]) > Math.abs(r.ridge[1][1] - r.ridge[0][1]);
  const roof = (v) => BUILDING.guest.roofs.find((r) => r.volume === v);
  const linkHalf = (SRC.guest.volumes[1].rect[3] - SRC.guest.volumes[1].rect[1]) / 2000;
  gable(main, gy + G.main.ridgeTop / 1000, G.main.pitch, gy, ridgeAlongX(roof('main')));
  gable(wing, gy + G.wing.ridgeTop / 1000, G.wing.pitch, gy, ridgeAlongX(roof('wing')));
  gable(link, gy + G.link.wall / 1000 + linkHalf * Math.tan(G.link.pitch * DEG) + 0.4, G.link.pitch, gy, ridgeAlongX(roof('link')));
  const sh = SRC.garage.shed, ry = floorY('garage');
  gable(BUILDING.garage.footprint[0], ry + sh.wallTop / 1000 + (sh.rect[2] - sh.rect[0]) / 2000 * Math.tan(sh.pitch * DEG) + 0.3, sh.pitch, ry, ridgeAlongX(BUILDING.garage.roofs[0]));
  const K = SRC.grill, ky = floorY('grill');
  const F = (K.hexagon.vertexR / 1000) * Math.cos(30 * DEG);
  const o = BUILDING.grill.origin;
  vols.push({ A: [o[0], o[1], F, 0], B: [ky - 0.5, ky + K.wallTop / 1000 + F * Math.tan(K.roof.pitch * DEG) + 0.3, Math.tan(K.roof.pitch * DEG), 2] });
  return vols;
}
const VOLUMES = buildingVolumes();
const VOL_UNIFORMS = {
  uVolA: { value: VOLUMES.map((v) => new THREE.Vector4(...v.A)) },
  uVolB: { value: VOLUMES.map((v) => new THREE.Vector4(...v.B)) },
};
// Отбрасывание фрагментов дерева внутри объёмов построек (видимые материалы и материал глубины теней).
function clipToBuildings(m) {
  const prev = m.onBeforeCompile;
  const prevKey = m.customProgramCacheKey?.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev?.call(m, shader, renderer);
    Object.assign(shader.uniforms, VOL_UNIFORMS);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTreeW;')
      .replace('#include <project_vertex>', `#include <project_vertex>
        {
          vec4 tw = vec4( transformed, 1.0 );
          #ifdef USE_INSTANCING
            tw = instanceMatrix * tw;
          #endif
          vTreeW = ( modelMatrix * tw ).xyz;
        }`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTreeW;
        uniform vec4 uVolA[ ${VOLUMES.length} ];
        uniform vec4 uVolB[ ${VOLUMES.length} ];`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        for ( int i = 0; i < ${VOLUMES.length}; i ++ ) {
          vec4 a = uVolA[ i ], b = uVolB[ i ];
          if ( vTreeW.y < b.x ) continue;
          float d;
          if ( b.w > 1.5 ) {
            vec2 q = vTreeW.xz - a.xy;
            d = max( abs( q.x ), max( abs( dot( q, vec2( 0.5, 0.8660254 ) ) ), abs( dot( q, vec2( -0.5, 0.8660254 ) ) ) ) );
            if ( d > a.z ) continue;
          } else {
            if ( vTreeW.x < a.x || vTreeW.x > a.z || vTreeW.z < a.y || vTreeW.z > a.w ) continue;
            d = b.w < 0.5 ? abs( vTreeW.z - 0.5 * ( a.y + a.w ) ) : abs( vTreeW.x - 0.5 * ( a.x + a.z ) );
          }
          if ( vTreeW.y < b.y - d * b.z ) discard;
        }`);
  };
  m.customProgramCacheKey = () => `${prevKey ? prevKey() : ''}|bvol`;
  m.needsUpdate = true;
  return m;
}

export function buildSiteTrees(lib, { backdrop = 360, detail = 'near' } = {}) {
  const group = new THREE.Group();
  group.name = 'trees';
  const needles = foliageMaterial(lib.needles());
  const spruceNeedles = foliageMaterial(lib.needles());
  spruceNeedles.color = new THREE.Color(0.17, 0.25, 0.17);
  spruceNeedles.name = 'spruceNeedles';
  const birchLeaves = foliageMaterial(lib.leaves());
  birchLeaves.color = new THREE.Color(0.72, 0.86, 0.48);
  birchLeaves.name = 'birchLeaves';
  const bark = clipToBuildings(lib.make('treeBark', () => lib.bark().clone()));
  const spruceBark = clipToBuildings(lib.make('spruceBark', () => {
    const m = lib.bark().clone();
    m.color = new THREE.Color(1.15, 1.08, 1.05);
    return m;
  }));
  const birchBark = lib.birchBark().clone();
  birchBark.vertexColors = true;
  for (const m of [needles, spruceNeedles, birchLeaves, birchBark]) clipToBuildings(m);
  const depthOf = (m) => clipToBuildings(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: m.map, alphaTest: m.alphaTest, side: THREE.DoubleSide }));
  const kinds = {
    pine: { seeds: PINE_SEEDS, build: (seed, d) => buildPineVariant(seed, d, d === 'far' ? {} : { spread: 0.6, crownStart: 0.6 }), bark, leaves: needles },
    spruce: { seeds: SPRUCE_SEEDS, build: buildSpruceVariant, bark: spruceBark, leaves: spruceNeedles },
    birch: { seeds: BIRCH_SEEDS, build: buildBirchVariant, bark: birchBark, leaves: birchLeaves },
  };
  const planned = plannedTrees();
  const back = backdropTrees(backdrop);
  const woodDepth = clipToBuildings(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }));
  const shadowOnly = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
  shadowOnly.name = 'treeShadowOnly';
  const visible = [];
  for (const [sp, k] of Object.entries(kinds)) {
    const depth = depthOf(k.leaves);
    k.seeds.forEach((seed, v) => {
      const items = planned.filter((t) => t.species === sp && t.variant === v);
      if (items.length) {
        const g = k.build(seed, detail);
        // Ширина кроны по плану: шаблон (10 м) сжимается по горизонтали к диаметру с плана, не более ±30 %
        // от пропорции шаблона.
        const D = 2 * crownRadius(g.leaves);
        for (const t of items) t.sxz = Math.min(1.3, Math.max(0.75, t.crown / (D * t.h / 10))) * t.h / 10;
        // Видимые экземпляры без теней; тени — от невидимых копий, чтобы скрытие дерева перед камерой
        // не меняло освещение.
        const trunks = instanced(g.wood, k.bark, items, { shadows: false });
        trunks.name = `trees:${sp}:${v}:wood`;
        // Ветви ели и берёзы низко, у стен построек: в проходе затенения (AO) они рисуются без отсечения
        // объёмами построек и оставляли бы след на стенах внутри.
        if (sp !== 'pine') trunks.userData.excludeAO = true;
        const crowns = instanced(g.leaves, k.leaves, items, { shadows: false });
        crowns.name = `trees:${sp}:${v}:crown`;
        crowns.userData.excludeAO = true;
        const casters = [instanced(g.wood, shadowOnly, items, { depthMat: woodDepth }), instanced(g.leaves, shadowOnly, items, { depthMat: depth })];
        for (const c of casters) { c.userData.excludeAO = true; c.name = `trees:${sp}:${v}:shadow`; c.receiveShadow = false; }
        group.add(trunks, crowns, ...casters);
        for (const m of [trunks, crowns]) visible.push({ mesh: m, items, base: m.instanceMatrix.array.slice() });
      }
      const farItems = back.filter((t) => t.species === sp && t.variant === v);
      if (farItems.length) {
        const g = k.build(seed + 1, 'far');
        const trunks = instanced(g.wood, k.bark, farItems, { shadows: false });
        const crowns = instanced(g.leaves, k.leaves, farItems, { shadows: false });
        crowns.userData.excludeAO = true;
        for (const m of [trunks, crowns]) { m.userData.far = true; group.add(m); }
      }
    });
  }
  const line = buildTreeline(SITE_CENTER, groundY(SITE_CENTER[0], SITE_CENTER[1] + 330));
  if (line) { line.userData.far = true; group.add(line); }
  group.userData.planned = planned;
  group.userData.backdrop = back;
  // Скрытие деревьев по набору id (заслоняющие постройку на виде камеры): масштаб экземпляра 0.
  let hiddenKey = '';
  group.userData.setHidden = (ids) => {
    const key = [...ids].sort().join(',');
    if (key === hiddenKey) return false;
    hiddenKey = key;
    for (const { mesh, items, base } of visible) {
      const arr = mesh.instanceMatrix.array;
      items.forEach((t, i) => {
        if (ids.has(t.id)) arr.fill(0, i * 16, i * 16 + 15);
        else for (let k = 0; k < 16; k++) arr[i * 16 + k] = base[i * 16 + k];
        arr[i * 16 + 15] = 1;
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
    return true;
  };
  return group;
}
