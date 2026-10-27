// Хвойное окружение: сосна обыкновенная в трёх воспроизводимых вариантах (seed 7103, 7422, 7741).
// Ствол с сужением и прикорневым расширением, серо-бурая трещиноватая кора внизу и рыжая тонкая
// вверху; крона в верхней трети из мутовок, ветви с подъёмом к концу и боковыми побегами; хвоя —
// пучки карточек с RGBA-текстурой из Blender на концах побегов, затенение внутри кроны,
// просвечивание против солнца; сухие сучья ниже кроны. Instancing: 39 детальных деревьев
// (3 ряда по 11 + 6 боковых) и кольцо упрощённых деревьев дальнего леса по рельефу.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng } from './geometry.js';
import { terrainHeight, insideMeadow } from './terrain.js';

export const PINE_SEEDS = [7103, 7422, 7741];

// Солнце для просвечивания хвои (обновляет OutdoorEnvironment).
export const FOLIAGE = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunCol: { value: new THREE.Color(1, 1, 1) },
  uSunK: { value: 1 },
};

// Трубка вдоль полилинии: кольца по seg вершин, цвет вершин по кольцам (кора меняется по высоте).
export function tube(points, radii, seg, colors, uvScale = 1) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const col = [];
  const idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  let vAcc = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next = points[Math.min(i + 1, points.length - 1)];
    const prev = points[Math.max(i - 1, 0)];
    const t = next.clone().sub(prev).normalize();
    const a = Math.abs(t.dot(up)) > 0.9 ? new THREE.Vector3(1, 0, 0) : up;
    const b1 = new THREE.Vector3().crossVectors(t, a).normalize();
    const b2 = new THREE.Vector3().crossVectors(t, b1).normalize();
    if (i > 0) vAcc += p.distanceTo(points[i - 1]);
    const c = colors[i];
    for (let k = 0; k <= seg; k++) {
      const ang = (k / seg) * Math.PI * 2;
      const n = b1.clone().multiplyScalar(Math.cos(ang)).add(b2.clone().multiplyScalar(Math.sin(ang)));
      pos.push(p.x + n.x * radii[i], p.y + n.y * radii[i], p.z + n.z * radii[i]);
      nrm.push(n.x, n.y, n.z);
      uv.push((k / seg) * Math.max(1, Math.round(radii[0] * 14)) * uvScale, (vAcc / 1.2) * uvScale);
      col.push(c[0], c[1], c[2]);
    }
  }
  for (let i = 0; i + 1 < points.length; i++) {
    for (let k = 0; k < seg; k++) {
      const a = i * (seg + 1) + k;
      const b = a + seg + 1;
      // Обход против часовой стрелки снаружи: лицевая сторона совпадает с нормалью.
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

// Цвет коры по относительной высоте: серо-бурая внизу, переход к рыжей «зеркальной» коре вверху.
function barkColor(t, r) {
  const low = [0.7, 0.67, 0.64];
  const high = [1.06, 0.8, 0.62];
  const k = THREE.MathUtils.smoothstep(t, 0.3, 0.58);
  const j = 0.94 + 0.12 * r();
  return low.map((v, i) => (v + (high[i] - v) * k) * j);
}

// Карточка хвои: одна плоскость (двусторонняя), основание у побега; нормаль — от центра кроны и вверх.
export function foliageCard(out, center, dir, size, rnd, crownC, crownR, tone) {
  const g = new THREE.PlaneGeometry(size, size);
  g.translate(0, size * 0.42, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  const spin = new THREE.Quaternion().setFromAxisAngle(dir, rnd() * Math.PI * 2);
  g.applyQuaternion(q.premultiply(spin));
  g.translate(center.x, center.y, center.z);
  const rel = center.clone().sub(crownC);
  const outN = rel.clone().multiplyScalar(1 / Math.max(0.3, crownR)).add(new THREE.Vector3(0, 0.55, 0)).normalize();
  // Затенение внутри кроны: ближе к оси и ниже — темнее.
  const radial = Math.min(1, Math.hypot(rel.x, rel.z) / Math.max(0.3, crownR));
  const shade = (0.38 + 0.62 * radial ** 1.3) * (0.75 + 0.25 * THREE.MathUtils.clamp(rel.y / crownR + 0.5, 0, 1)) * tone;
  const nrm = g.attributes.normal;
  const col = [];
  for (let i = 0; i < nrm.count; i++) {
    nrm.setXYZ(i, outN.x, outN.y, outN.z);
    col.push(shade, shade * (0.98 + 0.06 * rnd()), shade * 0.95);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.push(g);
}

// Одна сосна высотой 10 м (масштаб задаётся экземпляром). detail: 'near' | 'far'; spread — ширина кроны
// (1 — опушка, меньше — сосна в древостое), crownStart — низ кроны в долях высоты.
export function buildPineVariant(seed, detail = 'near', { spread = 1, crownStart: cs = 0.56 } = {}) {
  const r = rng(seed);
  const far = detail === 'far';
  const H = 10;
  const N = far ? 8 : 18;
  const trunkPts = [];
  const trunkR = [];
  const trunkC = [];
  const lean = new THREE.Vector2((r() - 0.5) * 0.45, (r() - 0.5) * 0.45);
  const wob = [r() * 6.28, r() * 6.28];
  const R0 = 0.17 + r() * 0.04;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const sx = Math.sin(t * 5.1 + wob[0]) * 0.07 * t;
    const sz = Math.sin(t * 4.3 + wob[1]) * 0.07 * t;
    trunkPts.push(new THREE.Vector3(lean.x * t * t + sx, t * H, lean.y * t * t + sz));
    trunkR.push(R0 * (1 - t) ** 1.25 + 0.014 + R0 * 0.45 * Math.exp(-t * 32));
    trunkC.push(barkColor(t, r));
  }
  const wood = [tube(trunkPts, trunkR, far ? 5 : 11, trunkC)];
  const leaves = [];
  const at = (t) => {
    const f = t * N;
    const i = Math.min(N - 1, Math.floor(f));
    return trunkPts[i].clone().lerp(trunkPts[i + 1], f - i);
  };
  const radAt = (t) => {
    const f = t * N;
    const i = Math.min(N - 1, Math.floor(f));
    return trunkR[i] + (trunkR[i + 1] - trunkR[i]) * (f - i);
  };
  const crownStart = cs + r() * 0.08;
  const crownC = at((crownStart + 1) / 2);
  const crownR = (2.3 + r() * 0.6) * spread;
  // Пучок хвои: несколько карточек вокруг конца побега, направленных наружу и вверх.
  const cluster = (tip, dir, n, size) => {
    for (let k = 0; k < n; k++) {
      const p = tip.clone().add(new THREE.Vector3((r() - 0.5) * 0.5, (r() - 0.35) * 0.36, (r() - 0.5) * 0.5).multiplyScalar(size / 0.6));
      const d = dir.clone().multiplyScalar(0.7).add(new THREE.Vector3((r() - 0.5) * 1.7, 0.3 + r() * 0.95, (r() - 0.5) * 1.7)).normalize();
      foliageCard(leaves, p, d, size * (0.8 + r() * 0.45), r, crownC, crownR, 0.85 + r() * 0.3);
    }
  };
  const levels = far ? 7 : 11 + Math.floor(r() * 3);
  for (let lv = 0; lv < levels; lv++) {
    const u = lv / levels;
    const t = crownStart + (0.97 - crownStart) * u * (0.94 + r() * 0.06);
    const base = at(t);
    const count = far ? 3 : 3 + Math.floor(r() * 3);
    for (let b = 0; b < count; b++) {
      // Часть ветвей в мутовке отмерла — крона неровная, с просветами.
      if (r() < 0.22 && lv > 0) continue;
      const ang = (b / count) * Math.PI * 2 + r() * 1.3 + lv * 2.4;
      // Нижние ветви почти горизонтальны, верхние восходящие; у всех конец загибается вверх.
      const len = ((1 - u) ** 0.7 * (2.0 + r() * 1.3) + 0.45) * (0.65 + r() * 0.55) * spread;
      const elev = -0.12 + u * 0.95 + (r() - 0.5) * 0.4;
      const dir = new THREE.Vector3(Math.cos(ang), elev, Math.sin(ang)).normalize();
      const pts = [];
      const rad = [];
      const cols = [];
      const segs = far ? 3 : 6;
      for (let k = 0; k <= segs; k++) {
        const s = k / segs;
        const lift = (s * s * 0.3 - Math.sin(s * Math.PI) * 0.1) * len;
        const kink = k > 0 && k < segs ? new THREE.Vector3((r() - 0.5) * 0.18, (r() - 0.5) * 0.12, (r() - 0.5) * 0.18).multiplyScalar(len * 0.35) : new THREE.Vector3();
        pts.push(base.clone().addScaledVector(dir, len * s).add(new THREE.Vector3(0, lift, 0)).add(kink));
        rad.push(Math.min(radAt(t) * 0.4, 0.04) * (1 - s * 0.85) + 0.005);
        cols.push(barkColor(0.45 + 0.3 * s, r));
      }
      wood.push(tube(pts, rad, far ? 3 : 5, cols));
      const tip = pts[segs];
      const tipDir = tip.clone().sub(pts[segs - 1]).normalize();
      cluster(tip, tipDir, far ? 3 : 8 + Math.floor(r() * 4), far ? 1.15 : 0.6);
      // Хвоя вдоль внешних двух третей ветви — сама ветвь почти скрыта.
      const along = far ? 1 : 2 + Math.floor(len * 0.8);
      for (let k = 0; k < along; k++) {
        const s = 0.38 + 0.55 * ((k + r() * 0.6) / along);
        const i0 = Math.min(segs - 1, Math.floor(s * segs));
        const p0 = pts[i0].clone().lerp(pts[i0 + 1], s * segs - i0);
        cluster(p0, dir, far ? 2 : 4, far ? 1.0 : 0.55);
      }
      // Боковые побеги во внешней половине ветви, тоже с пучком хвои.
      const subs = far ? (len > 1.6 ? 1 : 0) : 1 + Math.floor(len * 0.9);
      for (let k = 0; k < subs; k++) {
        const s = 0.45 + 0.45 * ((k + r() * 0.5) / Math.max(1, subs));
        const i0 = Math.min(segs - 1, Math.floor(s * segs));
        const p0 = pts[i0].clone().lerp(pts[i0 + 1], s * segs - i0);
        const side = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(r() < 0.5 ? -1 : 1);
        const sd = dir.clone().multiplyScalar(0.6).add(side.multiplyScalar(0.8)).add(new THREE.Vector3(0, 0.25 + r() * 0.3, 0)).normalize();
        const sl = 0.35 + r() * 0.5 * (1 - u * 0.5);
        const p1 = p0.clone().addScaledVector(sd, sl);
        if (!far) wood.push(tube([p0, p1], [0.012, 0.005], 3, [barkColor(0.8, r), barkColor(0.8, r)]));
        cluster(p1, sd, far ? 2 : 4 + Math.floor(r() * 3), far ? 1.0 : 0.5);
      }
    }
  }
  // Вершина: лидер и плотная шапка хвои.
  cluster(trunkPts[N].clone().add(new THREE.Vector3(0, -0.2, 0)), new THREE.Vector3(0, 1, 0), far ? 3 : 12, far ? 1.0 : 0.55);
  // Сухие сучья ниже кроны.
  if (!far) {
    for (let k = 0; k < 14; k++) {
      const t = 0.22 + r() * (crownStart - 0.26);
      const base = at(t);
      const ang = r() * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(ang), -0.15 + r() * 0.35, Math.sin(ang)).normalize();
      const L = 0.25 + r() * 0.55 * (t / crownStart);
      const grey = [0.62, 0.58, 0.54];
      wood.push(tube([base, base.clone().addScaledVector(dir, L)], [0.022, 0.005], 4, [grey, grey]));
    }
  }
  return { wood: mergeGeometries(wood), leaves: mergeGeometries(leaves) };
}

// Детальная группа: три ряда по 11 за домом и шесть боковых деревьев, высоты 8–13 м.
export function forestLayout() {
  const r = rng(39);
  const list = [];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 11; i++) {
      const x = -30 + i * 6.0 + (r() - 0.5) * 3.2 + row * 2.0;
      const z = -19 - row * 5.5 + (r() - 0.5) * 3.0;
      list.push({ x, z, h: 8 + r() * 5, rot: r() * Math.PI * 2, variant: (i + row * 2) % 3 });
    }
  }
  for (const [x, z] of [[-19, -7], [-21.5, 1.5], [-18.5, 9.5], [23, -8.5], [25, 0.5], [22.5, 9]]) {
    list.push({ x: x + (r() - 0.5) * 1.5, z: z + (r() - 0.5) * 1.5, h: 8 + r() * 5, rot: r() * Math.PI * 2, variant: Math.floor(r() * 3) });
  }
  return list;
}

// Дальний лес: кольцо вокруг участка (за детальной группой и по сторонам), поляна перед фасадом.
export function farForestLayout(count) {
  const r = rng(4242);
  const list = [];
  const near = forestLayout();
  let tries = 0;
  while (list.length < count && tries < count * 60) {
    tries++;
    const ang = r() * Math.PI * 2;
    // Густая опушка у края поляны (30–60 м), дальше реже — там лес держат кромка горизонта и дымка.
    const rad = 30 + (r() ** 1.9) * 120;
    const x = 1.5 + Math.cos(ang) * rad;
    const z = Math.sin(ang) * rad;
    if (insideMeadow(x, z)) continue;
    // Не ближе 3,2 м к соседям (и к детальным деревьям).
    if (list.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 10.2)) continue;
    if (near.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < 16)) continue;
    list.push({ x, z, h: 11 + r() * 8, rot: r() * Math.PI * 2, variant: Math.floor(r() * 3) });
  }
  return list;
}

// Хвоя: без переворота нормали на изнанке (крона освещается объёмно) и с просвечиванием против солнца.
export function foliageMaterial(base) {
  const m = base.clone();
  m.vertexColors = true;
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, FOLIAGE);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uSunDir;\nuniform vec3 uSunCol;\nuniform float uSunK;')
      .replace('#include <normal_fragment_begin>', THREE.ShaderChunk.normal_fragment_begin.replace('normal *= faceDirection;', ''))
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        {
          // Свет, прошедший сквозь хвою: сильнее, когда камера смотрит на солнце через крону.
          vec3 vSun = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );
          float back = pow( clamp( dot( normalize( vViewPosition ), vSun ), 0.0, 1.0 ), 3.0 );
          reflectedLight.indirectDiffuse += diffuseColor.rgb * uSunCol * uSunK * ( 0.02 + 0.4 * back );
        }`);
  };
  m.customProgramCacheKey = () => 'foliage2';
  m.userData.foliage = true;
  return m;
}

export function instanced(geo, mat, items, { shadows = true, depthMat = null, distMat = null } = {}) {
  const im = new THREE.InstancedMesh(geo, mat, items.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  items.forEach((t, i) => {
    const s = t.h / 10;
    q.setFromAxisAngle(up, t.rot);
    m.compose(new THREE.Vector3(t.x, terrainHeight(t.x, t.z) - 0.08, t.z), q, new THREE.Vector3(s, s, s));
    im.setMatrixAt(i, m);
  });
  im.castShadow = shadows;
  im.receiveShadow = true;
  if (depthMat) im.customDepthMaterial = depthMat;
  if (distMat) im.customDistanceMaterial = distMat;
  im.computeBoundingSphere();
  return im;
}

// Дальняя кромка леса по кругу (≈330 м): силуэты крон на цилиндре, растворённые в дымке —
// горизонт читается как лесной массив, а не как край плоскости. Текстура процедурная.
function treelineTexture() {
  const W = 2048;
  const H = 128;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const r = rng(9090);
  g.fillStyle = '#fff';
  for (let layer = 0; layer < 3; layer++) {
    let x = -20;
    while (x < W + 20) {
      const w = 10 + r() * 18;
      const h = H * (0.45 + r() * 0.35 + layer * 0.06);
      // Крона сосны: неровная шапка на стволе.
      g.beginPath();
      g.moveTo(x - w * 0.6, H);
      g.lineTo(x - w * 0.6, H - h * 0.55);
      for (let k = 0; k <= 6; k++) {
        const a = Math.PI * (1 - k / 6);
        g.lineTo(x + Math.cos(a) * w * (0.8 + r() * 0.4), H - h * 0.55 - Math.sin(a) * h * (0.35 + r() * 0.2) - h * 0.05);
      }
      g.lineTo(x + w * 0.6, H - h * 0.55);
      g.lineTo(x + w * 0.6, H);
      g.closePath();
      g.fill();
      x += w * (0.7 + r() * 0.6);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(3, 1);
  tex.anisotropy = 4;
  return tex;
}

export function buildTreeline(center = [1.5, 0], baseY = terrainHeight(1.5, 330)) {
  if (typeof document === 'undefined') return null;
  const geo = new THREE.CylinderGeometry(330, 330, 34, 160, 1, true);
  const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.05, 0.075, 0.045), alphaMap: treelineTexture(), alphaTest: 0.5, side: THREE.BackSide });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(center[0], baseY + 17 - 2.5, center[1]);
  m.name = 'treeline';
  m.userData.excludeAO = true;
  m.renderOrder = -0.5;
  return m;
}

export function buildForest(lib, { farCount = 360, nearDetail = 'near' } = {}) {
  const group = new THREE.Group();
  group.name = 'forest';
  const layout = forestLayout();
  const farLayout = farForestLayout(farCount);
  const needles = foliageMaterial(lib.needles());
  const bark = lib.bark();
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: needles.map, alphaTest: 0.42, side: THREE.DoubleSide });
  const distMat = new THREE.MeshDistanceMaterial({ map: needles.map, alphaTest: 0.42 });
  PINE_SEEDS.forEach((seed, v) => {
    const items = layout.filter((t) => t.variant === v);
    if (items.length) {
      const { wood, leaves } = buildPineVariant(seed, nearDetail);
      group.add(instanced(wood, bark, items));
      const crowns = instanced(leaves, needles, items, { depthMat, distMat });
      crowns.userData.excludeAO = true;
      group.add(crowns);
    }
    // Дальний лес по секторам (8 × 45°): камера с узким полем зрения рисует только видимые сектора.
    const farGeo = buildPineVariant(seed + 1, 'far');
    for (let k = 0; k < 8; k++) {
      const farItems = farLayout.filter((t) => t.variant === v && Math.floor(((Math.atan2(t.z, t.x - 1.5) + Math.PI) / (Math.PI * 2)) * 8) % 8 === k);
      if (!farItems.length) continue;
      const trunks = instanced(farGeo.wood, bark, farItems, { shadows: false });
      const crowns = instanced(farGeo.leaves, needles, farItems, { shadows: false });
      crowns.userData.excludeAO = true;
      for (const m of [trunks, crowns]) { m.userData.far = true; group.add(m); }
    }
  });
  const line = buildTreeline();
  if (line) { line.userData.far = true; group.add(line); }
  group.userData.count = layout.length;
  group.userData.farCount = farLayout.length;
  return group;
}
