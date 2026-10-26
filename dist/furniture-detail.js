// Мебель: локальное основание у пола, центр footprint в XZ = (0, 0), перед — локальная +Z.
// Габариты в плане (с выступающими частями) совпадают с каталогом. Части помечены слотами
// материалов (joinery, upholstery, accent, bedding, counter) для смены отделки без пересборки.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ITEM_TYPES } from './catalog.js';
import { pillowGeometry, plant, vase, books, tableLamp, basket, candle } from './decor.js';

const cache = new Map();
export function rbox(w, h, d, r = 0.004, seg = 2) {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4, d / 2 - 1e-4);
  const key = `rb|${w.toFixed(4)}|${h.toFixed(4)}|${d.toFixed(4)}|${rr.toFixed(4)}|${seg}`;
  if (!cache.has(key)) cache.set(key, new RoundedBoxGeometry(w, h, d, seg, rr));
  return cache.get(key);
}

export function cyl(rt, rb, h, seg = 16) {
  const key = `cy|${rt}|${rb}|${h}|${seg}`;
  if (!cache.has(key)) cache.set(key, new THREE.CylinderGeometry(rt, rb, h, seg));
  return cache.get(key);
}

// Деталь: геометрия, слот или материал, положение (центр).
export function part(parent, geo, slotOrMat, x, y, z, opts = {}) {
  const m = new THREE.Mesh(geo, typeof slotOrMat === 'string' ? null : slotOrMat);
  if (typeof slotOrMat === 'string') m.userData.slot = slotOrMat;
  m.position.set(x, y, z);
  if (opts.rx) m.rotation.x = opts.rx;
  if (opts.ry) m.rotation.y = opts.ry;
  if (opts.rz) m.rotation.z = opts.rz;
  if (opts.scale) m.scale.set(...opts.scale);
  m.castShadow = opts.castShadow ?? true;
  m.receiveShadow = true;
  // Навесная деталь на стене выше разреза: в редакторе с разрезом скрывается вместе с верхом стены.
  if (opts.wallMounted) m.userData.wallMounted = true;
  parent.add(m);
  return m;
}

// Одеяло: ровный верх с мягкими складками и свисающий край по трём сторонам.
function duvetGeometry(w, d, hang, seed = 1) {
  const nu = 48;
  const nv = 40;
  const pos = [];
  const uv = [];
  const idx = [];
  const half = w / 2;
  const edgeR = 0.025;
  const L = half + edgeR * Math.PI / 2 + hang;
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    const z = -d / 2 + v * (d + hang * 0.0);
    for (let i = 0; i <= nu; i++) {
      const s = -L + (2 * L * i) / nu;
      const a = Math.abs(s);
      const sg = Math.sign(s) || 1;
      let x;
      let y;
      if (a <= half) { x = s; y = 0; } else if (a <= half + edgeR * Math.PI / 2) {
        const th = (a - half) / edgeR;
        x = sg * (half + Math.sin(th) * edgeR);
        y = -(1 - Math.cos(th)) * edgeR;
      } else {
        x = sg * (half + edgeR);
        y = -edgeR - (a - half - edgeR * Math.PI / 2);
      }
      // Складки: мягкая волна по длине и поперёк, сильнее на свисающей части.
      const hangK = a > half ? 1 : 0.35;
      const wr = Math.sin(z * 9.0 + s * 3.1 + seed) * 0.006 + Math.sin(z * 23.0 - s * 5.0 + seed * 2) * 0.0025;
      if (a > half) x += sg * wr * 1.5 * hangK;
      else y += wr;
      pos.push(x, y, z);
      uv.push((x + L) / 0.24, z / 0.24);
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + nu + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Подушка на кровати: наволочка с «защипом» (толщина h сходит к краям), лежит с наклоном tilt.
function pillow(parent, slot, w, h, d, x, y, z, tilt = 0) {
  return part(parent, pillowGeometry(w, d, h * 1.25), slot, x, y, z, { rx: -Math.PI / 2 - tilt });
}

function add(parent, obj, x, y, z, ry = 0) {
  obj.position.set(x, y, z);
  obj.rotation.y = ry;
  parent.add(obj);
  return obj;
}

// Кровать: каркас 1,46 × 2,08 м, матрас 1,40 × 2,00, изголовье, подушки, одеяло с краем.
function bed(t, single = false) {
  const g = new THREE.Group();
  const W = t.w;
  const D = t.d;
  const frameT = 0.03;
  const matW = W - 2 * frameT;
  const matD = D - 0.08;
  // Царги и цоколь.
  part(g, rbox(W, 0.26, D - 0.06, 0.006), 'joinery', 0, 0.06 + 0.13, 0.03);
  part(g, rbox(W - 0.1, 0.06, D - 0.2, 0.004), 'joinery', 0, 0.03, 0.04);
  // Изголовье с мягкой панелью.
  part(g, rbox(W, t.h, 0.06, 0.008), 'joinery', 0, t.h / 2, -D / 2 + 0.03);
  part(g, rbox(W - 0.12, t.h - 0.42, 0.05, 0.02, 3), 'upholstery', 0, 0.42 + (t.h - 0.42) / 2 - 0.04, -D / 2 + 0.075);
  // Матрас с кантом.
  const matTop = 0.56;
  part(g, rbox(matW, 0.2, matD, 0.035, 3), 'bedding', 0, matTop - 0.1, 0.037);
  part(g, rbox(matW + 0.006, 0.012, matD + 0.006, 0.005), 'accent', 0, matTop - 0.012, 0.037);
  // Подушки.
  const pw = single ? 0.62 : 0.6;
  const xs = single ? [0] : [-0.33, 0.33];
  for (const x of xs) pillow(g, 'bedding', pw, 0.14, 0.38, x, matTop + 0.075, -D / 2 + 0.3, -0.35);
  if (!single) pillow(g, 'accent', 0.42, 0.12, 0.3, 0.12, matTop + 0.09, -D / 2 + 0.5, -0.5);
  // Одеяло с покрывалом от середины до изножья.
  const duv = new THREE.Mesh(duvetGeometry(matW - 0.06, matD * 0.66, 0.2, single ? 3 : 1), null);
  duv.userData.slot = 'bedding';
  duv.position.set(0, matTop + 0.035, 0.04 + matD / 2 - matD * 0.66 / 2);
  duv.castShadow = true;
  duv.receiveShadow = true;
  g.add(duv);
  // Покрывало шире одеяла и выше его складок — не прорастает сквозь одеяло (и не выходит за кровать).
  const throwG = duvetGeometry(matW - 0.03, 0.5, 0.24, 7);
  const thr = new THREE.Mesh(throwG, null);
  thr.userData.slot = 'accent';
  thr.position.set(0, matTop + 0.062, D / 2 - 0.36);
  thr.castShadow = true;
  g.add(thr);
  return g;
}

// Шкаф 0,80 × 0,60 × 2,0: панели 18 мм, две двери с зазорами, ручки, опоры.
function wardrobe(t, lib) {
  const g = new THREE.Group();
  const W = t.w;
  const D = t.d;
  const H = t.h;
  const p = 0.018;
  const plinth = 0.06;
  const handleD = 0.028;
  const bodyD = D - p - handleD;
  const zBody = -D / 2 + bodyD / 2;
  part(g, rbox(p, H - plinth, bodyD, 0.002), 'joinery', -W / 2 + p / 2, plinth + (H - plinth) / 2, zBody);
  part(g, rbox(p, H - plinth, bodyD, 0.002), 'joinery', W / 2 - p / 2, plinth + (H - plinth) / 2, zBody);
  part(g, rbox(W, p, bodyD, 0.002), 'joinery', 0, H - p / 2, zBody);
  part(g, rbox(W - 2 * p, p, bodyD, 0.002), 'joinery', 0, plinth + p / 2, zBody);
  part(g, rbox(W - 2 * p, H - plinth - 2 * p, 0.006, 0.001), 'joinery', 0, plinth + (H - plinth) / 2, -D / 2 + 0.003);
  // Цоколь, утопленный на 30 мм, и регулируемые опоры.
  part(g, rbox(W - 0.06, plinth - 0.01, bodyD - 0.06, 0.002), new THREE.MeshStandardMaterial({ color: 0x2a2826, roughness: 0.8 }), 0, (plinth - 0.01) / 2 + 0.01, zBody - 0.02);
  // Двери с зазором 3 мм.
  const gap = 0.003;
  const dw = (W - 3 * gap) / 2;
  const doorZ = -D / 2 + bodyD + p / 2;
  for (const s of [-1, 1]) {
    const x = s * (dw / 2 + gap / 2);
    part(g, rbox(dw, H - plinth - gap * 2, p, 0.0025), 'joinery', x, plinth + gap + (H - plinth - 2 * gap) / 2, doorZ);
    // Вертикальные ручки-скобы.
    const hx = x - s * (dw / 2 - 0.045);
    part(g, rbox(0.012, 0.32, 0.012, 0.005), 'metal', hx, 1.05, D / 2 - 0.006);
    part(g, rbox(0.01, 0.01, handleD - 0.006, 0.003), 'metal', hx, 0.92, doorZ + p / 2 + (handleD - 0.006) / 2);
    part(g, rbox(0.01, 0.01, handleD - 0.006, 0.003), 'metal', hx, 1.18, doorZ + p / 2 + (handleD - 0.006) / 2);
  }
  if (lib) add(g, basket(lib, { r: 0.15, h: 0.18 }), 0.14, H, -0.04);
  return g;
}

// Диван 1,90 × 0,85: каркас, две подушки сиденья, отдельные спинки, мягкие подлокотники, ножки, декор.
function sofa(t) {
  const g = new THREE.Group();
  const W = t.w;
  const D = t.d;
  const armW = 0.16;
  const legH = 0.1;
  const legs = [[-W / 2 + 0.08, -D / 2 + 0.08], [W / 2 - 0.08, -D / 2 + 0.08], [-W / 2 + 0.08, D / 2 - 0.08], [W / 2 - 0.08, D / 2 - 0.08]];
  for (const [x, z] of legs) part(g, cyl(0.018, 0.013, legH, 12), 'joinery', x, legH / 2, z);
  part(g, rbox(W, 0.2, D, 0.03, 3), 'upholstery', 0, legH + 0.1, 0);
  // Подлокотники.
  for (const s of [-1, 1]) part(g, rbox(armW, 0.36, D, 0.06, 4), 'upholstery', s * (W / 2 - armW / 2), legH + 0.2 + 0.16, 0);
  // Спинка-основа.
  part(g, rbox(W - 2 * armW + 0.02, 0.42, 0.18, 0.05, 3), 'upholstery', 0, legH + 0.2 + 0.21, -D / 2 + 0.09);
  // Подушки сиденья.
  const cw = (W - 2 * armW) / 2 - 0.006;
  for (const s of [-1, 1]) {
    part(g, rbox(cw, 0.14, D - 0.2, 0.05, 4), 'upholstery', s * (cw / 2 + 0.003), legH + 0.2 + 0.07, 0.07);
    part(g, rbox(cw, 0.44, 0.16, 0.07, 4), 'upholstery', s * (cw / 2 + 0.003), legH + 0.34 + 0.22, -D / 2 + 0.24, { rx: -0.14 });
  }
  // Декоративные подушки с защипом по краям.
  part(g, pillowGeometry(0.44, 0.44, 0.15), 'accent', -W / 2 + armW + 0.25, legH + 0.55, -D / 2 + 0.36, { rx: -0.2, rz: 0.12 });
  part(g, pillowGeometry(0.4, 0.4, 0.14), 'upholstery', -W / 2 + armW + 0.5, legH + 0.52, -D / 2 + 0.38, { rx: -0.24, rz: -0.06 });
  part(g, pillowGeometry(0.4, 0.4, 0.14), 'accent', W / 2 - armW - 0.23, legH + 0.53, -D / 2 + 0.37, { rx: -0.22, rz: -0.08 });
  return g;
}

// Обеденный стол 1,20 × 0,75: скруглённая столешница с фаской, царги, ножки.
function tableTopGeometry(w, d, th, r, bevel) {
  const s = new THREE.Shape();
  const hw = w / 2 - bevel;
  const hd = d / 2 - bevel;
  const rr = Math.min(r, hw, hd);
  s.moveTo(-hw + rr, -hd);
  s.lineTo(hw - rr, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + rr);
  s.lineTo(hw, hd - rr);
  s.quadraticCurveTo(hw, hd, hw - rr, hd);
  s.lineTo(-hw + rr, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - rr);
  s.lineTo(-hw, -hd + rr);
  s.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
  const key = `top|${w}|${d}|${th}|${r}|${bevel}`;
  if (!cache.has(key)) {
    const g = new THREE.ExtrudeGeometry(s, { depth: th - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
    g.rotateX(-Math.PI / 2);
    g.translate(0, bevel, 0);
    // Метрические UV сверху (древесина вдоль длинной стороны).
    const pos = g.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = pos.getX(i) / 1.6;
      uv[i * 2 + 1] = pos.getZ(i) / 0.4 + pos.getY(i) * 2;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    cache.set(key, g);
  }
  return cache.get(key);
}

function table(t, { legInset = 0.06, apron = true, top = 0.03, radius = 0.06, objects = false, centerpiece = false, lib = null } = {}) {
  const g = new THREE.Group();
  const W = t.w;
  const D = t.d;
  part(g, tableTopGeometry(W, D, top, radius, 0.004), 'joinery', 0, t.h - top, 0);
  const legH = t.h - top;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      part(g, rbox(0.045, legH, 0.045, 0.006), 'joinery', sx * (W / 2 - legInset), legH / 2, sz * (D / 2 - legInset));
    }
  }
  if (apron) {
    part(g, rbox(W - 2 * legInset - 0.02, 0.08, 0.022, 0.003), 'joinery', 0, legH - 0.04, D / 2 - legInset);
    part(g, rbox(W - 2 * legInset - 0.02, 0.08, 0.022, 0.003), 'joinery', 0, legH - 0.04, -D / 2 + legInset);
    part(g, rbox(0.022, 0.08, D - 2 * legInset - 0.02, 0.003), 'joinery', W / 2 - legInset, legH - 0.04, 0);
    part(g, rbox(0.022, 0.08, D - 2 * legInset - 0.02, 0.003), 'joinery', -W / 2 + legInset, legH - 0.04, 0);
  }
  if (objects && lib) {
    // Журнальный стол: керамическая чаша, стопка книг со свечой, низкая ваза.
    part(g, new THREE.SphereGeometry(0.1, 24, 12, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).scale(1, 0.55, 1), 'ceramic', 0.2, t.h + 0.055, 0.04, { rx: Math.PI });
    const st = add(g, books(lib, { count: 3, seed: 4, w: 0.16, d: 0.22 }), -0.2, t.h, -0.03, 0.3);
    st.geometry.computeBoundingBox();
    add(g, candle(lib), -0.2, t.h + st.geometry.boundingBox.max.y, -0.03);
    add(g, vase(lib, { h: 0.16, profile: [0.04, 0.055, 0.05, 0.03, 0.018, 0.022] }), 0.02, t.h, -0.12);
  }
  if (centerpiece && lib) {
    // Обеденный стол: ваза с ветками эвкалипта по центру.
    add(g, vase(lib, { h: 0.2, profile: [0.04, 0.06, 0.064, 0.05, 0.03, 0.034], mat: 'stoneware' }), 0, t.h, 0);
    add(g, plant(lib, 'branches', { seed: 3, height: 0.42, radius: 0.24 }), 0, t.h + 0.17, 0);
  }
  return g;
}

// Стул 0,48 × 0,50: наклонные ножки, мягкое сиденье, изогнутая деревянная спинка.
function chair(t) {
  const g = new THREE.Group();
  const W = t.w;
  const D = t.d;
  const seatH = 0.45;
  const legR = 0.014;
  // Ножки: от углов footprint у пола к раме сиденья.
  const top = [[-0.19, -0.17], [0.19, -0.17], [-0.19, 0.17], [0.19, 0.17]];
  const bottom = [[-W / 2 + legR, -D / 2 + legR], [W / 2 - legR, -D / 2 + legR], [-W / 2 + legR, D / 2 - legR], [W / 2 - legR, D / 2 - legR]];
  for (let i = 0; i < 4; i++) {
    const a = new THREE.Vector3(bottom[i][0], 0, bottom[i][1]);
    const b = new THREE.Vector3(top[i][0], seatH - 0.05, top[i][1]);
    const len = a.distanceTo(b);
    const m = part(g, cyl(legR * 0.8, legR, len, 12), 'joinery', (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  }
  // Рама сиденья и мягкое сиденье.
  part(g, rbox(0.42, 0.04, 0.4, 0.006), 'joinery', 0, seatH - 0.05, 0);
  part(g, rbox(0.44, 0.05, 0.42, 0.02, 3), 'upholstery', 0, seatH - 0.012, 0.01);
  // Задние стойки к спинке.
  for (const s of [-1, 1]) {
    const m = part(g, rbox(0.024, 0.42, 0.024, 0.006), 'joinery', s * 0.19, seatH + 0.17, -0.2, { rx: -0.12 });
    void m;
  }
  // Изогнутая спинка: дуга гнутой фанеры.
  const key = 'chairBack';
  if (!cache.has(key)) {
    const r = 0.5;
    const ang = 0.9;
    const geo = new THREE.CylinderGeometry(r, r, 0.12, 24, 1, true, Math.PI - ang / 2, ang);
    const inner = new THREE.CylinderGeometry(r - 0.016, r - 0.016, 0.12, 24, 1, true, Math.PI - ang / 2, ang);
    const merged = mergeTwo(geo, inner);
    merged.translate(0, 0, r);
    cache.set(key, merged);
  }
  const back = part(g, cache.get(key), 'joinery', 0, t.h - 0.07, -D / 2 + 0.012 + 0.0, { rx: -0.1 });
  back.material = null;
  return g;
}

function mergeTwo(a, b) {
  const g = new THREE.BufferGeometry();
  const pa = a.attributes.position.array;
  const pb = b.attributes.position.array;
  const na = a.attributes.normal.array;
  const nb = b.attributes.normal.array.map((v) => -v);
  const ua = a.attributes.uv.array;
  const ub = b.attributes.uv.array;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([...pa, ...pb]), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([...na, ...nb]), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([...ua, ...ub]), 2));
  const ia = a.index.array;
  const ib = b.index.array;
  const off = pa.length / 3;
  const idx = [...ia];
  for (let i = 0; i < ib.length; i += 3) idx.push(ib[i] + off, ib[i + 2] + off, ib[i + 1] + off);
  g.setIndex(idx);
  return g;
}

// Журнальный стол 0,80 × 0,50 × 0,43.
function coffee(t, lib) {
  return table(t, { legInset: 0.05, apron: false, top: 0.028, radius: 0.08, objects: true, lib });
}

// Письменный стол 1,20 × 0,60 с ящиком.
function desk(t, lib) {
  const g = table(t, { legInset: 0.04, apron: true, top: 0.028, radius: 0.01 });
  part(g, rbox(0.42, 0.11, 0.48, 0.003), 'joinery', 0.32, t.h - 0.028 - 0.07, 0.0);
  part(g, rbox(0.12, 0.012, 0.012, 0.004), 'metal', 0.32, t.h - 0.1, 0.25);
  if (lib) {
    // Настольная лампа, ряд книг и базилик в горшке.
    add(g, tableLamp(lib), -0.44, t.h, -0.15);
    add(g, books(lib, { count: 5, stand: true, seed: 9, w: 0.15, d: 0.22 }), -0.18, t.h, -0.2);
    add(g, plant(lib, 'herb', { seed: 5, height: 0.17, radius: 0.07, potR: 0.055, potH: 0.07 }), 0.42, t.h, -0.16);
  } else {
    part(g, rbox(0.24, 0.022, 0.17, 0.003), 'accent', -0.3, t.h + 0.011, -0.08, { ry: 0.2 });
  }
  return g;
}

// Тумба 1,80 × 0,42 × 0,55 на ножках, три фасада.
function mediaUnit(t, lib) {
  const g = new THREE.Group();
  const W = t.w;
  const D = t.d;
  const legH = 0.12;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) part(g, cyl(0.014, 0.01, legH, 10), 'metal', sx * (W / 2 - 0.08), legH / 2, sz * (D / 2 - 0.08));
  part(g, rbox(W, t.h - legH, D - 0.012, 0.004), 'joinery', 0, legH + (t.h - legH) / 2, -0.006);
  const fw = (W - 0.02) / 3;
  for (let i = 0; i < 3; i++) {
    const x = -W / 2 + 0.01 + fw * (i + 0.5);
    part(g, rbox(fw - 0.004, t.h - legH - 0.03, 0.012, 0.002), 'joinery', x, legH + (t.h - legH) / 2, D / 2 - 0.006);
  }
  if (lib) {
    // Комнатное растение, ваза и книги на тумбе (в пределах её глубины).
    add(g, plant(lib, 'bush', { seed: 7, height: 0.34, radius: 0.08, pot: 'stoneware', potR: 0.085, potH: 0.12 }), -0.62, t.h, -0.02);
    add(g, vase(lib, { h: 0.3, profile: [0.04, 0.07, 0.075, 0.05, 0.022, 0.026], mat: 'terracotta' }), -0.25, t.h, -0.05);
    add(g, books(lib, { count: 6, stand: true, seed: 11, w: 0.15, d: 0.23 }), 0.5, t.h, -0.06);
  } else {
    part(g, cyl(0.06, 0.045, 0.22, 24), 'ceramic', -0.55, t.h + 0.11, -0.03);
  }
  return g;
}

// Настенный телевизор 55″: тонкая рамка, стеклянный экран, кронштейн, индикатор.
function tv(t, lib) {
  const g = new THREE.Group();
  const W = t.w;
  const H = t.h;
  const D = t.d;
  part(g, rbox(W, H, 0.012, 0.003), lib.blackMetal(), 0, H / 2, D / 2 - 0.006);
  part(g, new THREE.PlaneGeometry(W - 0.016, H - 0.016), lib.tvScreen(), 0, H / 2, D / 2 + 0.0002, { castShadow: false });
  part(g, rbox(W * 0.7, H * 0.66, D - 0.012, 0.01), lib.blackMetal(), 0, H / 2 - 0.02, -0.006);
  // Кронштейн к стене (за задней панелью, в зазоре монтажа).
  part(g, rbox(0.4, 0.3, 0.03, 0.003), lib.blackMetal(), 0, H / 2, -D / 2 - 0.015);
  const led = part(g, new THREE.SphereGeometry(0.0025, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3a2a }), W / 2 - 0.05, 0.006, D / 2 + 0.001, { castShadow: false });
  led.userData.indicator = true;
  return g;
}

export function buildFurniture(type, lib) {
  const t = ITEM_TYPES[type];
  switch (type) {
    case 'bed': return bed(t);
    case 'bedSingle': return bed(t, true);
    case 'wardrobe': return wardrobe(t, lib);
    case 'sofa': return sofa(t);
    case 'dining': return table(t, { centerpiece: true, lib });
    case 'chair': return chair(t);
    case 'coffee': return coffee(t, lib);
    case 'desk': return desk(t, lib);
    case 'mediaUnit': return mediaUnit(t, lib);
    case 'tv': return tv(t, lib);
    default: return null;
  }
}
