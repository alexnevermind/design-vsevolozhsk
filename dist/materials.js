// Библиотека материалов: PBR-карты из Blender (sRGB для цвета, линейные для нормалей и шероховатости),
// метрический масштаб в UV геометрии, кэш материалов по (семейство, оттенок, качество).
import * as THREE from 'three';
import MANIFEST from './data/texture-manifest.js';
import { MATERIALS } from './choices.js';
import { applyWindowLight } from './window-light.js';
import { applyPointLights } from './point-lights.js';

// В автономной сборке ресурсы подставляются как data URI.
export function assetUrl(path) {
  const inline = globalThis.__VSEMDOM_ASSETS__;
  return (inline && inline[path]) || path;
}

const loader = new THREE.TextureLoader();
const textures = new Map();
let maxAniso = 4;
let pending = 0;
let onAllLoaded = null;

export function setAnisotropy(n) {
  maxAniso = n;
  for (const t of textures.values()) { t.anisotropy = n; t.needsUpdate = true; }
}

export function texturesPending() {
  return pending;
}

export function whenTexturesLoaded(cb) {
  if (pending === 0) cb();
  else onAllLoaded = cb;
}

export function texture(name, srgb, invalidate) {
  const key = `${name}|${srgb}`;
  if (textures.has(key)) return textures.get(key);
  pending++;
  const t = loader.load(assetUrl(`assets/textures/${name}.webp`), () => {
    pending--;
    invalidate?.();
    if (pending === 0 && onAllLoaded) { const cb = onAllLoaded; onAllLoaded = null; cb(); }
  }, undefined, () => {
    pending--;
    console.warn('Не загружена карта', name);
  });
  t.name = name;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  textures.set(key, t);
  return t;
}

// Средняя яркость карты альбедо (sRGB) → множитель цвета в линейном пространстве.
function albedoGain(name) {
  const m = MANIFEST.maps[name]?.mean ?? 1;
  return 1 / Math.pow(m, 2.2);
}

export function srgbColor(hex) {
  return new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
}

function tinted(hex, mapName) {
  const c = srgbColor(hex);
  const g = albedoGain(mapName);
  return c.multiplyScalar(g);
}

export class MaterialLibrary {
  constructor({ invalidate, quality = 'high' } = {}) {
    this.invalidate = invalidate || (() => {});
    this.quality = quality;
    this.cache = new Map();
  }

  tex(name, srgb = false) {
    return texture(name, srgb, this.invalidate);
  }

  // Общая фабрика с кэшем. interior=true — материал получает рассеянный оконный свет и лампы помещений;
  // уличные материалы — свет костра, гирлянды и столбиков (дешёвые точечные источники).
  make(key, factory, { interior = false } = {}) {
    if (this.cache.has(key)) return this.cache.get(key);
    const m = factory();
    m.name = key;
    if (interior) applyWindowLight(m);
    else if (m.isMeshStandardMaterial && !m.userData.glass) applyPointLights(m);
    m.userData.interior = interior;
    this.cache.set(key, m);
    return m;
  }

  // Окрашенная архитектурная древесина (имитация бруса стен, фасада, потолка).
  paintedWood(hex, { facade = false, interior = !facade } = {}) {
    return this.make(`paintWood|${hex}|${facade}`, () => new THREE.MeshPhysicalMaterial({
      color: tinted(hex, 'arch_paint_albedo'),
      map: this.tex('arch_paint_albedo', true),
      normalMap: this.tex('arch_normal'),
      normalScale: new THREE.Vector2(facade ? 0.22 : 0.18, facade ? 0.22 : 0.18),
      roughnessMap: this.tex('arch_rough'),
      roughness: 0.94 / 0.86,
      metalness: 0,
      clearcoat: 0.025,
      clearcoatRoughness: 0.6,
      vertexColors: true,
      envMapIntensity: interior ? 0.35 : 0.9,
    }), { interior });
  }

  // Необработанная липа парной.
  naturalWood() {
    return this.make('linden', () => new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(1, 1, 1).multiplyScalar(albedoGain('arch_natural_albedo') * 0.62),
      map: this.tex('arch_natural_albedo', true),
      normalMap: this.tex('arch_normal'),
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughnessMap: this.tex('arch_rough'),
      roughness: 0.9,
      vertexColors: true,
      envMapIntensity: 0.3,
    }), { interior: true });
  }

  floorWood(id) {
    const hex = MATERIALS[id].hex;
    return this.make(`floor|${id}`, () => new THREE.MeshPhysicalMaterial({
      color: tinted(hex, 'floor_albedo'),
      map: this.tex('floor_albedo', true),
      normalMap: this.tex('floor_normal'),
      normalScale: new THREE.Vector2(0.38, 0.38),
      roughnessMap: this.tex('floor_rough'),
      roughness: 0.82 / 0.8,
      clearcoat: 0.1,
      clearcoatRoughness: 0.45,
      vertexColors: true,
      envMapIntensity: 0.45,
    }), { interior: true });
  }

  deckWood(id) {
    const hex = MATERIALS[id].hex;
    return this.make(`deck|${id}`, () => new THREE.MeshPhysicalMaterial({
      color: tinted(hex, 'floor_albedo'),
      map: this.tex('floor_albedo', true),
      normalMap: this.tex('floor_normal'),
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughnessMap: this.tex('floor_rough'),
      roughness: 0.9 / 0.8,
      vertexColors: true,
      envMapIntensity: 0.8,
    }));
  }

  furnitureWood(id) {
    const hex = MATERIALS[id].hex;
    return this.make(`furn|${id}`, () => new THREE.MeshPhysicalMaterial({
      color: tinted(hex, 'furniture_albedo'),
      map: this.tex('furniture_albedo', true),
      normalMap: this.tex('furniture_normal'),
      normalScale: new THREE.Vector2(0.25, 0.25),
      roughness: 0.62,
      clearcoat: 0.12,
      clearcoatRoughness: 0.4,
      envMapIntensity: 0.45,
    }), { interior: true });
  }

  fabric(id) {
    const hex = MATERIALS[id].hex;
    return this.make(`fabric|${id}`, () => new THREE.MeshPhysicalMaterial({
      color: tinted(hex, 'fabric_albedo'),
      map: this.tex('fabric_albedo', true),
      normalMap: this.tex('fabric_normal'),
      normalScale: new THREE.Vector2(0.6, 0.6),
      roughness: 0.92,
      sheen: 0.6,
      sheenRoughness: 0.7,
      sheenColor: srgbColor(hex).lerp(new THREE.Color(1, 1, 1), 0.4),
      envMapIntensity: 0.3,
    }), { interior: true });
  }

  stone(id, { interior = true } = {}) {
    const hex = MATERIALS[id].hex;
    const fam = MATERIALS[id].family;
    return this.make(`stone|${id}`, () => new THREE.MeshPhysicalMaterial({
      color: tinted(hex, `${fam}_albedo`),
      map: this.tex(`${fam}_albedo`, true),
      normalMap: this.tex(`${fam}_normal`),
      normalScale: new THREE.Vector2(0.5, 0.5),
      roughnessMap: this.tex('stone_rough'),
      roughness: fam === 'slate' ? 0.95 : 0.7,
      clearcoat: fam === 'slate' ? 0.05 : 0.25,
      clearcoatRoughness: 0.35,
      vertexColors: true,
      envMapIntensity: 0.5,
    }), { interior });
  }

  // Окрашенный металл (кровля, рамы, отливы, фасадные детали).
  paintedMetal(hex, { interior = false, key = '' } = {}) {
    return this.make(`metal|${hex}|${interior}|${key}`, () => new THREE.MeshPhysicalMaterial({
      color: srgbColor(hex),
      normalMap: this.tex('metal_normal'),
      normalScale: new THREE.Vector2(0.12, 0.12),
      roughnessMap: this.tex('metal_rough'),
      roughness: 0.72 / 0.72,
      metalness: 0.12,
      clearcoat: 0.18,
      clearcoatRoughness: 0.62,
      envMapIntensity: 1.0,
    }), { interior });
  }

  doorPaint(id) {
    const hex = MATERIALS[id].hex;
    return this.make(`door|${id}`, () => new THREE.MeshPhysicalMaterial({
      color: srgbColor(hex),
      normalMap: this.tex('arch_normal'),
      normalScale: new THREE.Vector2(0.03, 0.03),
      roughness: 0.48,
      clearcoat: 0.18,
      clearcoatRoughness: 0.4,
      envMapIntensity: 0.4,
    }), { interior: true });
  }

  stretchCeiling(hex) {
    return this.make(`stretch|${hex}`, () => new THREE.MeshPhysicalMaterial({
      color: srgbColor(hex),
      roughness: 0.93,
      clearcoat: 0.025,
      clearcoatRoughness: 0.5,
      envMapIntensity: 0.25,
    }), { interior: true });
  }

  plain(key, params, opts = {}) {
    return this.make(`plain|${key}`, () => new THREE.MeshPhysicalMaterial(params), opts);
  }

  ceramic() {
    return this.plain('ceramic', { color: srgbColor('#F3F1E9'), roughness: 0.26, clearcoat: 0.6, clearcoatRoughness: 0.06, envMapIntensity: 0.6 }, { interior: true });
  }

  chrome() {
    return this.plain('chrome', { color: new THREE.Color(0.9, 0.9, 0.9), metalness: 1, roughness: 0.14, envMapIntensity: 0.6 }, { interior: true });
  }

  brushed() {
    return this.plain('brushed', { color: new THREE.Color(0.62, 0.62, 0.6), metalness: 1, roughness: 0.34, envMapIntensity: 0.55 }, { interior: true });
  }

  blackMetal(interior = true) {
    return this.plain(`blackMetal|${interior}`, { color: srgbColor('#1d1e20'), metalness: 0.4, roughness: 0.45, clearcoat: 0.2, envMapIntensity: 0.7 }, { interior });
  }

  tvScreen() {
    return this.plain('tvScreen', { color: srgbColor('#101617'), roughness: 0.17, metalness: 0.04, clearcoat: 0.8, clearcoatRoughness: 0.05, envMapIntensity: 0.55 }, { interior: true });
  }

  rubber() {
    return this.plain('rubber', { color: srgbColor('#2a2b2c'), roughness: 0.85, envMapIntensity: 0.2 }, { interior: true });
  }

  mirror() {
    return this.plain('mirror', { color: new THREE.Color(0.95, 0.96, 0.97), metalness: 1, roughness: 0.03, envMapIntensity: 1.2 }, { interior: true });
  }

  whiteAppliance() {
    return this.plain('appliance', { color: srgbColor('#e9e9e6'), roughness: 0.35, clearcoat: 0.4, clearcoatRoughness: 0.2, envMapIntensity: 0.6 }, { interior: true });
  }

  section() {
    return this.plain('section', { color: srgbColor('#cfc9be'), roughness: 0.95, envMapIntensity: 0.2 });
  }

  subfloor() {
    return this.plain('subfloor', { color: srgbColor('#2b2420'), roughness: 1 }, { interior: true });
  }

  grout(hex = '#b8b2a6') {
    return this.plain(`grout|${hex}`, { color: srgbColor(hex), roughness: 0.95, envMapIntensity: 0.2 }, { interior: true });
  }

  concrete() {
    return this.plain('concrete', {
      color: srgbColor('#8f8b84'), roughness: 0.92, normalMap: this.tex('stone_rough'), normalScale: new THREE.Vector2(0.15, 0.15), envMapIntensity: 0.6,
    });
  }

  // Архитектурное стекло: полное качество — пропускание, облегчённое — прозрачность 0,24.
  glass(kind = 'clear') {
    const q = this.quality === 'low' ? 'low' : 'full';
    const tint = kind === 'bronze' ? '#8a6a4a' : '#eef3f2';
    return this.make(`glass|${kind}|${q}`, () => {
      const m = q === 'full'
        ? new THREE.MeshPhysicalMaterial({
          color: srgbColor(tint),
          metalness: 0,
          roughness: 0.012,
          transmission: kind === 'bronze' ? 0.7 : 0.99,
          ior: 1.52,
          thickness: 0.006,
          attenuationColor: srgbColor(kind === 'bronze' ? '#6b4a2c' : '#d8ebe6'),
          attenuationDistance: kind === 'bronze' ? 0.02 : 0.6,
          specularIntensity: 1,
          envMapIntensity: 1,
          transparent: false,
          depthWrite: true,
        })
        : new THREE.MeshPhysicalMaterial({
          color: srgbColor(tint), roughness: 0.02, metalness: 0, transparent: true, opacity: kind === 'bronze' ? 0.55 : 0.24,
          transmission: 0, depthWrite: false, envMapIntensity: 1,
        });
      m.userData.glass = true;
      return m;
    });
  }

  // Ночное свечение окна снаружи (тёплый эмиссивный слой поверх стекла).
  windowGlow() {
    return this.make('windowGlow', () => new THREE.MeshBasicMaterial({
      color: srgbColor('#ffcf8a'), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: true,
    }));
  }

  lampGlow() {
    return this.make('lampGlow', () => new THREE.MeshStandardMaterial({
      color: srgbColor('#f4efe6'), emissive: srgbColor('#ffd29a'), emissiveIntensity: 0, roughness: 0.4, side: THREE.DoubleSide,
    }));
  }

  grass() {
    const m = this.make('grass', () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(1, 1, 1),
      map: this.tex('grass_albedo', true),
      normalMap: this.tex('grass_normal'),
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.96,
      // Рассеянный свет неба уже даёт полусферный источник — окружение лишь слегка добавляет отражение.
      envMapIntensity: 0.1,
    }));
    return m;
  }

  // Кора сосны: карта трещин из Blender, цвет по высоте ствола задают цвета вершин.
  bark() {
    return this.make('bark', () => new THREE.MeshStandardMaterial({
      map: this.tex('bark_albedo', true), normalMap: this.tex('bark_normal'), normalScale: new THREE.Vector2(1.3, 1.3), roughness: 0.95, envMapIntensity: 0.12,
      color: new THREE.Color(1.75, 1.6, 1.5), vertexColors: true,
    }));
  }

  // Листва кустов (самшит): RGBA-карточки, отрендеренные Cycles из объёмных листочков.
  leaves() {
    return this.make('leaves', () => {
      const m = new THREE.MeshStandardMaterial({
        map: this.tex('leaves_rgba', true), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.6, envMapIntensity: 0.1,
        color: new THREE.Color(0.6, 0.7, 0.52),
      });
      m.userData.foliage = true;
      return m;
    });
  }

  needles() {
    return this.make('needles', () => {
      const m = new THREE.MeshStandardMaterial({
        map: this.tex('needles_rgba', true), alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.9, envMapIntensity: 0.06,
        color: new THREE.Color(0.27, 0.33, 0.21),
      });
      m.userData.foliage = true;
      return m;
    });
  }

  // Гравий дорожек и отмостки: гранитные зёрна 5–20 мм (карты Blender, тайл 0,8 м — UV в тайлах).
  gravel(key = 'path', tint = '#ffffff') {
    return this.make(`gravel|${key}`, () => new THREE.MeshStandardMaterial({
      color: srgbColor(tint),
      map: this.tex('gravel_albedo', true),
      normalMap: this.tex('gravel_normal'),
      normalScale: new THREE.Vector2(1.1, 1.1),
      roughnessMap: this.tex('gravel_rough'),
      roughness: 1,
      envMapIntensity: 0.3,
    }));
  }

  // Природный плитняк (песчаник), оттенок каждой плиты — цвет вершин.
  flagstone() {
    return this.make('flagstone', () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(0.86, 0.86, 0.86),
      map: this.tex('flagstone_albedo', true),
      normalMap: this.tex('flagstone_normal'),
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughnessMap: this.tex('flagstone_rough'),
      roughness: 1,
      vertexColors: true,
      envMapIntensity: 0.4,
    }));
  }

  // Колотый камень кострища (та же порода, темнее; копоть — цвет вершин).
  fieldStone() {
    return this.make('fieldStone', () => new THREE.MeshStandardMaterial({
      color: new THREE.Color(1, 1, 1),
      map: this.tex('flagstone_albedo', true),
      normalMap: this.tex('slate_normal'),
      normalScale: new THREE.Vector2(0.8, 0.8),
      roughnessMap: this.tex('flagstone_rough'),
      roughness: 1,
      vertexColors: true,
      envMapIntensity: 0.35,
    }));
  }

  birchBark() {
    return this.make('birchBark', () => new THREE.MeshStandardMaterial({
      map: this.tex('birch_albedo', true), normalMap: this.tex('birch_normal'), normalScale: new THREE.Vector2(0.8, 0.8),
      roughness: 0.78, envMapIntensity: 0.35,
    }));
  }

  endGrain() {
    return this.make('endGrain', () => new THREE.MeshStandardMaterial({
      map: this.tex('endgrain_albedo', true), normalMap: this.tex('endgrain_normal'), normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.92, envMapIntensity: 0.3,
    }));
  }

  // Колотая древесина (свежий скол полена): светлая берёза поперёк волокон.
  splitWood() {
    return this.make('splitWood', () => new THREE.MeshStandardMaterial({
      color: tinted('#d9c3a0', 'furniture_albedo'), map: this.tex('furniture_albedo', true), normalMap: this.tex('furniture_normal'),
      normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.9, envMapIntensity: 0.3,
    }));
  }

  setQuality(q) {
    if (q === this.quality) return;
    this.quality = q;
  }
}
