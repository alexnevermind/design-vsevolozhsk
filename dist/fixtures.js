// Кухонные модули, холодильник, сантехника (подвесной унитаз из Blender, тумба с раковиной,
// душевая, стиральная машина) и встроенное оборудование парной и прихожей.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { ITEM_TYPES } from './catalog.js';
import { SPEC } from './plan.js';
import { rbox, cyl, part } from './furniture-detail.js';
import { assetUrl } from './materials.js';

// ---------- кухня ----------
// Габарит 0,68: корпус 0,60 у стены, фасад 18 мм, ручки; столешница 40 мм на 0,86–0,90; верхние шкафы до 2,08.
function kitchenModule(type, lib) {
  const t = ITEM_TYPES[type];
  const g = new THREE.Group();
  const W = t.w;
  const D = t.d;
  const back = -D / 2;
  const carcD = 0.6;
  const plinth = 0.1;
  const counterY = 0.9;
  const ct = 0.04;
  const front = back + carcD;
  // Цоколь и корпус.
  part(g, rbox(W - 0.004, plinth, carcD - 0.06, 0.002), lib.blackMetal(), 0, plinth / 2, back + (carcD - 0.06) / 2);
  part(g, rbox(W - 0.004, counterY - ct - plinth, carcD, 0.002), 'joinery', 0, plinth + (counterY - ct - plinth) / 2, back + carcD / 2);
  // Столешница с выносом.
  part(g, rbox(W, ct, 0.64, 0.003), 'counter', 0, counterY - ct / 2, back + 0.32);
  const doorZ = front + 0.009;
  const handleZ = D / 2 - 0.006;
  // Ручка-скоба на двух стойках от фасада до габарита 0,68.
  const bar = (x, y, len, vertical = false) => {
    part(g, vertical ? rbox(0.012, len, 0.012, 0.005) : rbox(len, 0.012, 0.012, 0.005), lib.brushed(), x, y, handleZ);
    const standL = handleZ - (doorZ + 0.009) - 0.006;
    for (const s of [-1, 1]) {
      const dx = vertical ? 0 : s * (len / 2 - 0.02);
      const dy = vertical ? s * (len / 2 - 0.02) : 0;
      part(g, rbox(0.01, 0.01, standL, 0.003), lib.brushed(), x + dx, y + dy, doorZ + 0.009 + standL / 2);
    }
  };
  const lowerH = counterY - ct - plinth - 0.006;
  if (type === 'kitchenHob') {
    // Духовка: тёмное стекло и ручка; ящик под ней.
    part(g, rbox(W - 0.03, 0.58, 0.02, 0.003), lib.tvScreen(), 0, plinth + 0.2 + 0.29, doorZ + 0.002);
    bar(0, plinth + 0.2 + 0.54, W - 0.18);
    part(g, rbox(W - 0.006, 0.18, 0.018, 0.0025), 'joinery', 0, plinth + 0.093, doorZ);
    bar(0, plinth + 0.15, 0.28);
    // Индукционная панель с конфорками.
    part(g, rbox(0.6, 0.006, 0.52, 0.004), lib.tvScreen(), 0, counterY + 0.003, back + 0.32);
    for (const [x, z, r] of [[-0.14, -0.1, 0.09], [0.14, -0.1, 0.075], [-0.14, 0.12, 0.075], [0.14, 0.12, 0.09]]) {
      part(g, new THREE.RingGeometry(r - 0.004, r, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x5c5f63 }), x, counterY + 0.0065, back + 0.32 + z, { castShadow: false });
    }
  } else {
    // Два фасада с зазором и горизонтальными ручками.
    const n = type === 'kitchenSink' ? 2 : 1;
    const fw = (W - 0.006 * (n + 1)) / n;
    for (let i = 0; i < n; i++) {
      const x = -W / 2 + 0.006 + fw * (i + 0.5) + 0.006 * i;
      part(g, rbox(fw, lowerH, 0.018, 0.0025), 'joinery', x, plinth + 0.003 + lowerH / 2, doorZ);
      bar(x, counterY - ct - 0.06, Math.min(0.3, fw - 0.12));
    }
  }
  if (type === 'kitchenSink') {
    // Мойка из нержавеющей стали и смеситель.
    const steel = lib.brushed();
    part(g, rbox(0.5, 0.012, 0.42, 0.01), steel, 0, counterY + 0.001, back + 0.33);
    part(g, rbox(0.44, 0.17, 0.36, 0.03), lib.plain('sinkBasin', { color: new THREE.Color(0.3, 0.3, 0.31), metalness: 1, roughness: 0.42, envMapIntensity: 0.35 }, { interior: true }), 0, counterY - 0.085, back + 0.33);
    const tap = lib.chrome();
    part(g, cyl(0.022, 0.025, 0.06, 20), tap, 0, counterY + 0.03, back + 0.08);
    part(g, cyl(0.011, 0.011, 0.24, 14), tap, 0, counterY + 0.17, back + 0.08);
    part(g, new THREE.TorusGeometry(0.09, 0.011, 10, 24, Math.PI), tap, 0, counterY + 0.29, back + 0.17, { ry: Math.PI / 2 });
    part(g, cyl(0.013, 0.011, 0.05, 14), tap, 0, counterY + 0.27, back + 0.26);
    part(g, rbox(0.012, 0.012, 0.07, 0.005), tap, 0.03, counterY + 0.07, back + 0.08);
  }
  // Верхние шкафы глубиной 0,35 от 1,45 до 2,08 (фартук между ними и столешницей — стена).
  const upperY0 = 1.45;
  const upperH = t.h - upperY0;
  part(g, rbox(W - 0.004, upperH, 0.33, 0.002), 'joinery', 0, upperY0 + upperH / 2, back + 0.165);
  const un = W > 0.9 ? 2 : 1;
  const uw = (W - 0.006 * (un + 1)) / un;
  for (let i = 0; i < un; i++) {
    const x = -W / 2 + 0.006 + uw * (i + 0.5) + 0.006 * i;
    part(g, rbox(uw, upperH - 0.006, 0.018, 0.0025), 'joinery', x, upperY0 + upperH / 2, back + 0.339);
    part(g, rbox(Math.min(0.26, uw - 0.12), 0.012, 0.012, 0.005), lib.brushed(), x, upperY0 + 0.05, back + 0.354);
  }
  if (type === 'kitchenHob') {
    // Встроенная вытяжка под верхним модулем.
    part(g, rbox(W - 0.06, 0.05, 0.3, 0.004), lib.brushed(), 0, upperY0 - 0.025, back + 0.16);
    part(g, rbox(W - 0.1, 0.004, 0.24, 0.002), lib.tvScreen(), 0, upperY0 - 0.052, back + 0.16);
  }
  return g;
}

function fridge(t, lib) {
  const g = new THREE.Group();
  const W = t.w;
  const D = t.d;
  const body = lib.whiteAppliance();
  const handleD = 0.035;
  part(g, rbox(W, t.h - 0.02, D - handleD - 0.02, 0.012), body, 0, 0.01 + (t.h - 0.02) / 2, -D / 2 + (D - handleD - 0.02) / 2);
  const split = 1.22;
  const dz = D / 2 - handleD - 0.01;
  part(g, rbox(W - 0.004, split - 0.03, 0.02, 0.012), body, 0, 0.02 + (split - 0.03) / 2, dz);
  part(g, rbox(W - 0.004, t.h - split - 0.02, 0.02, 0.012), body, 0, split + (t.h - split - 0.02) / 2, dz);
  for (const [y0, y1] of [[0.6, 1.1], [split + 0.05, split + 0.4]]) {
    part(g, rbox(0.018, y1 - y0, 0.018, 0.008), lib.brushed(), -W / 2 + 0.05, (y0 + y1) / 2, D / 2 - 0.009);
    for (const y of [y0 + 0.02, y1 - 0.02]) part(g, rbox(0.012, 0.012, handleD - 0.012, 0.004), lib.brushed(), -W / 2 + 0.05, y, D / 2 - handleD / 2 - 0.006);
  }
  part(g, rbox(W - 0.06, 0.03, 0.03, 0.004), lib.blackMetal(), 0, 0.015, D / 2 - handleD - 0.035);
  return g;
}

// ---------- санузел ----------
let wcTemplate = null;
let wcPromise = null;
export function loadWcModel(onReady) {
  if (wcTemplate) return Promise.resolve(wcTemplate);
  if (!wcPromise) {
    wcPromise = new GLTFLoader().loadAsync(assetUrl('assets/models/wall-hung-wc.glb')).then((gltf) => {
      wcTemplate = gltf.scene;
      wcTemplate.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          const n = o.material?.name || '';
          if (n.startsWith('ceramic')) o.userData.fixedMaterial = 'ceramic';
          else if (n.startsWith('seat')) o.userData.fixedMaterial = 'seat';
          else if (n.startsWith('chrome')) o.userData.fixedMaterial = 'chrome';
          else if (n.startsWith('flush')) o.userData.fixedMaterial = 'flushPlate';
          if (o.name.startsWith('installation') || o.parent?.name?.startsWith('installation')) o.userData.installation = true;
        }
      });
      onReady?.();
      return wcTemplate;
    }).catch((e) => {
      console.warn('Модель унитаза не загружена', e);
      return null;
    });
  }
  return wcPromise;
}

function toilet(t, lib) {
  const g = new THREE.Group();
  if (wcTemplate) {
    const m = wcTemplate.clone(true);
    m.traverse((o) => {
      if (!o.isMesh) return;
      const f = o.userData.fixedMaterial;
      if (f === 'ceramic') o.material = lib.ceramic();
      else if (f === 'seat') o.material = lib.plain('seat', { color: new THREE.Color().setStyle('#F6F5F1', THREE.SRGBColorSpace), roughness: 0.32, clearcoat: 0.3 }, { interior: true });
      else if (f === 'chrome') o.material = lib.chrome();
      else if (f === 'flushPlate') o.material = lib.plain('flush', { color: new THREE.Color().setStyle('#F4F4F2', THREE.SRGBColorSpace), roughness: 0.18, clearcoat: 0.5 }, { interior: true });
      // Клавиша смыва (1,08 м) и скрытая в стене инсталляция при разрезе стены не видны.
      if (f === 'flushPlate' || o.userData.installation) o.userData.wallMounted = true;
    });
    g.add(m);
  } else {
    // Временная форма до загрузки модели.
    part(g, rbox(t.w * 0.95, 0.2, t.d * 0.92, 0.08, 3), lib.ceramic(), 0, 0.3, -0.01);
  }
  g.userData.needsWc = !wcTemplate;
  return g;
}

function vanity(t, lib) {
  const g = new THREE.Group();
  const W = t.w;
  const D = t.d;
  const back = -D / 2;
  // Подвесная тумба 0,46 глубиной, керамическая раковина-столешница, смеситель, зеркало.
  part(g, rbox(W - 0.004, 0.42, 0.44, 0.004), 'joinery', 0, 0.42 / 2 + 0.36, back + 0.22);
  part(g, rbox(W - 0.01, 0.4, 0.018, 0.003), 'joinery', 0, 0.36 + 0.21, back + 0.449);
  part(g, rbox(0.3, 0.012, 0.012, 0.005), lib.brushed(), 0, 0.36 + 0.36, back + 0.464);
  part(g, rbox(W, 0.05, D, 0.012), lib.ceramic(), 0, 0.805, back + D / 2);
  part(g, new THREE.CylinderGeometry(0.19, 0.17, 0.04, 40, 1, true), lib.ceramic(), 0, 0.81, back + 0.25);
  part(g, new THREE.CircleGeometry(0.17, 40).rotateX(-Math.PI / 2), lib.ceramic(), 0, 0.792, back + 0.25, { castShadow: false });
  const tap = lib.chrome();
  part(g, cyl(0.018, 0.02, 0.12, 20), tap, 0, 0.89, back + 0.06);
  part(g, rbox(0.022, 0.022, 0.13, 0.008), tap, 0, 0.94, back + 0.11);
  part(g, rbox(0.012, 0.04, 0.012, 0.004), tap, 0, 0.98, back + 0.05);
  // Зеркальный шкаф до 1,73.
  part(g, rbox(W - 0.02, 0.62, 0.12, 0.004), 'joinery', 0, 1.73 - 0.31, back + 0.06, { wallMounted: true });
  part(g, new THREE.PlaneGeometry(W - 0.05, 0.58), lib.mirror(), 0, 1.73 - 0.31, back + 0.1205, { castShadow: false, wallMounted: true });
  return g;
}

function shower(t, lib) {
  const g = new THREE.Group();
  const W = t.w;
  const D = t.d;
  const trayH = 0.045;
  part(g, rbox(W, trayH, D, 0.01), lib.ceramic(), 0, trayH / 2, 0);
  part(g, cyl(0.04, 0.04, 0.004, 24), lib.chrome(), 0.15, trayH + 0.001, -0.1);
  const H = t.h;
  const profile = lib.chrome();
  const glassH = H - trayH - 0.02;
  // Стекло спереди (+Z) и сбоку (−X), алюминиевые профили; задняя и правая стороны — стены.
  const front = part(g, rbox(W - 0.03, glassH, 0.008, 0.002), lib.glass('clear'), -0.01, trayH + glassH / 2, D / 2 - 0.02, { castShadow: false });
  front.userData.excludeAO = true;
  const side = part(g, rbox(0.008, glassH, D - 0.03, 0.002), lib.glass('clear'), -W / 2 + 0.01, trayH + glassH / 2, -0.01, { castShadow: false });
  side.userData.excludeAO = true;
  part(g, rbox(0.02, glassH, 0.02, 0.004), profile, -W / 2 + 0.01, trayH + glassH / 2, D / 2 - 0.02);
  part(g, rbox(W - 0.02, 0.02, 0.02, 0.004), profile, 0, H - 0.01, D / 2 - 0.02);
  part(g, rbox(0.02, 0.02, D - 0.02, 0.004), profile, -W / 2 + 0.01, H - 0.01, 0);
  part(g, rbox(0.02, 0.5, 0.025, 0.008), profile, 0.0, 1.05, D / 2 - 0.0125);
  // Тропический душ и смеситель на стене.
  part(g, cyl(0.01, 0.01, 0.4, 12), profile, 0.25, 1.55, -D / 2 + 0.03, { wallMounted: true });
  part(g, rbox(0.02, 0.02, 0.32, 0.008), profile, 0.25, 1.95, -D / 2 + 0.18, { wallMounted: true });
  part(g, cyl(0.12, 0.12, 0.012, 32), profile, 0.25, 1.935, -D / 2 + 0.32, { wallMounted: true });
  part(g, rbox(0.14, 0.05, 0.05, 0.015), profile, 0.25, 1.1, -D / 2 + 0.025, { wallMounted: true });
  return g;
}

function washer(t, lib) {
  const g = new THREE.Group();
  const W = t.w;
  const D = t.d;
  const body = lib.whiteAppliance();
  part(g, rbox(W, t.h - 0.01, D - 0.04, 0.01), body, 0, 0.005 + (t.h - 0.01) / 2, -0.02);
  part(g, new THREE.TorusGeometry(0.18, 0.025, 14, 40), lib.chrome(), 0, 0.42, D / 2 - 0.035);
  part(g, new THREE.CircleGeometry(0.17, 40), lib.tvScreen(), 0, 0.42, D / 2 - 0.03, { castShadow: false });
  part(g, rbox(W - 0.04, 0.1, 0.01, 0.003), lib.blackMetal(), 0, t.h - 0.07, D / 2 - 0.035);
  part(g, cyl(0.025, 0.025, 0.02, 20), lib.brushed(), 0.18, t.h - 0.07, D / 2 - 0.02, { rx: Math.PI / 2 });
  part(g, rbox(0.12, 0.04, 0.02, 0.006), lib.chrome(), -0.12, 0.42, D / 2 - 0.01);
  return g;
}

export function buildFixture(type, lib) {
  const t = ITEM_TYPES[type];
  switch (type) {
    case 'kitchenSink':
    case 'kitchenHob':
    case 'kitchenCabinet': return kitchenModule(type, lib);
    case 'fridge': return fridge(t, lib);
    case 'toilet': return toilet(t, lib);
    case 'vanity': return vanity(t, lib);
    case 'shower': return shower(t, lib);
    case 'washer': return washer(t, lib);
    default: return null;
  }
}

// ---------- встроенное оборудование ----------
export function buildBuiltins(lib) {
  const group = new THREE.Group();
  group.name = 'builtins';
  const wood = lib.naturalWood();
  for (const b of SPEC.builtins) {
    const [x0, z0, x1, z1] = b.rect;
    const g = new THREE.Group();
    g.userData.builtin = b.id;
    if (b.type === 'saunaBench') {
      // Полок: рейки 90 мм с зазором 10 мм на опорах.
      const alongZ = z1 - z0 > x1 - x0;
      const len = alongZ ? z1 - z0 : x1 - x0;
      const depth = alongZ ? x1 - x0 : z1 - z0;
      const n = Math.floor(depth / 0.1);
      for (let i = 0; i < n; i++) {
        const off = 0.05 + i * 0.1 - depth / 2;
        const geo = alongZ ? rbox(0.09, 0.028, len - 0.01, 0.006) : rbox(len - 0.01, 0.028, 0.09, 0.006);
        part(g, geo, wood, alongZ ? (x0 + x1) / 2 + off : (x0 + x1) / 2, b.top - 0.014, alongZ ? (z0 + z1) / 2 : (z0 + z1) / 2 + off);
      }
      // Опоры и фронтальная доска.
      const legs = alongZ ? [[x0 + 0.06, z0 + 0.1], [x1 - 0.06, z0 + 0.1], [x0 + 0.06, z1 - 0.1], [x1 - 0.06, z1 - 0.1], [x1 - 0.06, (z0 + z1) / 2]] : [[x0 + 0.1, z0 + 0.06], [x1 - 0.1, z0 + 0.06], [x0 + 0.1, z1 - 0.06], [x1 - 0.1, z1 - 0.06]];
      for (const [lx, lz] of legs) part(g, rbox(0.045, b.top - 0.028, 0.045, 0.004), wood, lx, (b.top - 0.028) / 2, lz);
      if (alongZ) part(g, rbox(0.022, 0.12, len - 0.02, 0.004), wood, x1 - 0.011, b.top - 0.088, (z0 + z1) / 2);
      else part(g, rbox(len - 0.02, 0.12, 0.022, 0.004), wood, (x0 + x1) / 2, b.top - 0.088, z0 + 0.011);
    } else if (b.type === 'saunaStove') {
      const cx = (x0 + x1) / 2;
      const cz = (z0 + z1) / 2;
      const w = x1 - x0;
      const d = z1 - z0;
      part(g, rbox(w, b.top - 0.12, d, 0.01), lib.blackMetal(), cx, (b.top - 0.12) / 2 + 0.06, cz);
      // Сетчатая корзина с камнями.
      const stones = new THREE.DodecahedronGeometry(0.045, 0);
      const stoneMat = lib.plain('stones', { color: new THREE.Color().setStyle('#6b6862', THREE.SRGBColorSpace), roughness: 0.9 });
      for (let i = 0; i < 26; i++) {
        const a = (i * 2.399) % (Math.PI * 2);
        const r = 0.04 + ((i * 37) % 13) / 13 * (Math.min(w, d) / 2 - 0.07);
        part(g, stones, stoneMat, cx + Math.cos(a) * r, b.top - 0.1 + (i % 3) * 0.03, cz + Math.sin(a) * r, { ry: i, rx: i * 0.7, scale: [1, 0.75, 0.9] });
      }
      part(g, rbox(w - 0.02, 0.08, 0.012, 0.004), lib.blackMetal(), cx, 0.25, z1 + 0.004);
      for (const [lx, lz] of [[x0 + 0.03, z0 + 0.03], [x1 - 0.03, z0 + 0.03], [x0 + 0.03, z1 - 0.03], [x1 - 0.03, z1 - 0.03]]) part(g, rbox(0.03, 0.06, 0.03, 0.004), lib.blackMetal(), lx, 0.03, lz);
    } else if (b.type === 'coatNiche') {
      // Вешалка: полка для головных уборов и штанга с крючками.
      const cx = (x0 + x1) / 2;
      const wm = { wallMounted: true };
      part(g, rbox(x1 - x0 - 0.01, 0.022, z1 - z0 - 0.04, 0.004), 'joinery', cx, b.top, (z0 + z1) / 2 - 0.01, wm);
      part(g, cyl(0.013, 0.013, x1 - x0 - 0.02, 16), lib.brushed(), cx, b.top - 0.1, (z0 + z1) / 2, { rz: Math.PI / 2, ...wm });
      for (let i = 0; i < 4; i++) {
        const hx = x0 + 0.25 + i * 0.28;
        part(g, rbox(0.02, 0.06, 0.008, 0.003), lib.brushed(), hx, b.top - 0.18, z0 + 0.008, wm);
        // Плечики.
        part(g, new THREE.TorusGeometry(0.17, 0.006, 6, 18, Math.PI * 0.7), 'joinery', hx, b.top - 0.14, (z0 + z1) / 2, { rz: Math.PI * 1.15, ...wm });
      }
    }
    group.add(g);
  }
  return group;
}
