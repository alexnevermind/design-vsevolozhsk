// Участок во Всеволожске: рельеф по отметкам, три постройки по листам, деревья по плану, благоустройство,
// солнце и тени для широты участка, обзор и прогулка. Рендер и постобработка — как в базе
// (base-app.js): PCF-тени по требованию, GTAO, SMAA, цветокоррекция, окружение по съёмке участка.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Store } from './core.js';
import { resolveStartup, safeStorage, STORAGE_KEY, encodeHash, decodeHash, loadState, HASH_PREFIX, newSite } from './site-state.js';
import { MaterialLibrary, setAnisotropy, whenTexturesLoaded, texturesPending } from './materials.js';
import { OutdoorEnvironment } from './outdoor-environment.js';
import { updatePointLights, POINT_LIGHTS } from './point-lights.js';
import { SunPath } from './sun-path.js';
import { SITE, BUILDING, SITE_CENTER, SITE_BOX, groundY, floorY } from './site-data.js';
import { buildTerrain, lawnMaterial, litterMask } from './site-ground.js';
import { buildSiteBuildings } from './site-buildings.js';
import { buildSiteTrees } from './site-trees.js';
import { buildSiteLandscape } from './site-landscape.js';
import { SiteUI } from './site-ui.js';
import { SiteWalk } from './site-walk.js';

// GTAO без прозрачного стекла и карточек хвои; видимость возвращается после прохода.
class SceneGTAOPass extends GTAOPass {
  _overrideVisibility() {
    super._overrideVisibility();
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      if (o.visible && (o.userData.excludeAO || o.material?.userData?.glass || o.material?.userData?.foliage)) {
        o.visible = false;
        cache.push(o);
      }
    });
  }
}

const params = new URLSearchParams(location.search);
const storage = safeStorage(globalThis.localStorage);

export const app = {
  mode: 'site',
  focus: 'site',
  quality: params.get('quality') || 'auto',
  settings: { ao: true, bloom: false, dof: false, exposure: 1, clearView: true },
  needsRender: true,
  hidden: false,
};

function invalidate() {
  app.needsRender = true;
  if (app.renderer) app.renderer.shadowMap.needsUpdate = true;
}
function invalidateView() {
  app.needsRender = true;
}
app.invalidate = invalidate;

// ---------- рендерер ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
app.renderer = renderer;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xc9d6e2);
app.scene = scene;

const [CX, CZ] = SITE_CENTER;
const CY = groundY(CX, CZ);
const camera = new THREE.PerspectiveCamera(33, 1, 0.2, 1500);
app.camera = camera;
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.49;
controls.minDistance = 3;
controls.maxDistance = 140;
controls.screenSpacePanning = true;
controls.zoomToCursor = true;
controls.addEventListener('change', invalidateView);
controls.addEventListener('end', () => scheduleEnvCapture());
app.controls = controls;

function pixelRatioFor(q) {
  const dpr = window.devicePixelRatio || 1;
  if (q === 'low') return Math.min(1, dpr);
  if (q === 'high') return Math.min(2, Math.max(1.5, dpr));
  return app.autoRatio ?? Math.min(1.5, dpr);
}

const lib = new MaterialLibrary({ invalidate, quality: app.quality === 'low' ? 'low' : 'high' });
app.lib = lib;
// Тени: вся территория до верхушек деревьев; солнце смотрит в центр участка.
const SHADOW_BOXES = [[[SITE_BOX.x0 - 2, -1, SITE_BOX.z0 - 2], [SITE_BOX.x1 + 2, 22, SITE_BOX.z1 + 2]]];
const shadowFor = (q) => (q === 'low' ? 2048 : 4096);
const env = new OutdoorEnvironment(renderer, scene, {
  shadowSize: shadowFor(app.quality), shadowBoxes: SHADOW_BOXES, center: [CX, CY + 0.5, CZ], probe: [14.5, CY + 1.8, 25.5], sunDistance: 90,
});
env.sun.shadow.radius = 2;
app.env = env;

// ---------- постобработка ----------
const glInfo = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
const gpuName = glInfo ? String(renderer.getContext().getParameter(glInfo.UNMASKED_RENDERER_WEBGL)) : '';
app.softwareGL = /swiftshader|llvmpipe|software|softpipe/i.test(gpuName);
const msaaFor = (q) => (app.softwareGL || q === 'low' ? 0 : 4);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType, samples: msaaFor(app.quality) }));
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const gtao = new SceneGTAOPass(scene, camera, 256, 256);
gtao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 16 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
gtao.blendIntensity = 0.7;
composer.addPass(gtao);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.6, 0.92);
bloom.enabled = false;
composer.addPass(bloom);
const bokeh = new BokehPass(scene, camera, { focus: 30, aperture: 0.0006, maxblur: 0.005 });
bokeh.enabled = false;
composer.addPass(bokeh);
composer.addPass(new OutputPass());
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.06 }, uCon: { value: 0.05 }, uVig: { value: 0.18 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uSat; uniform float uCon; uniform float uVig; varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSat);
      c.rgb = clamp((c.rgb - 0.5) * (1.0 + uCon) + 0.5, 0.0, 1.0);
      vec2 d = (vUv - 0.5) * vec2(1.0, 0.8);
      c.rgb *= 1.0 - uVig * smoothstep(0.2, 0.75, length(d) * 1.4);
      gl_FragColor = c;
    }`,
});
composer.addPass(grade);
const smaa = new SMAAPass(256, 256);
composer.addPass(smaa);
app.composer = composer;
app.passes = { gtao, bloom, bokeh, smaa, renderPass, grade };

function setMSAA(n) {
  for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
    if (rt.samples === n) continue;
    rt.samples = n;
    rt.dispose();
  }
}

function applySettings() {
  gtao.enabled = app.settings.ao;
  bloom.enabled = app.settings.bloom;
  bokeh.enabled = app.settings.dof && app.mode !== 'walk';
  env.baseExposure = app.settings.exposure;
  env.setShadowSize(shadowFor(app.quality));
  lib.setQuality(app.quality === 'low' ? 'low' : 'high');
  setMSAA(msaaFor(app.quality));
  resize();
  applySolar();
}
app.applySettings = applySettings;

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  const pr = pixelRatioFor(app.quality);
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(pr);
  composer.setSize(w, h);
  const cam = app.activeCamera();
  cam.aspect = w / h;
  applyViewOffset(w, h);
  cam.updateProjectionMatrix();
  invalidate();
}

// Центр кадра смещается в свободную от боковой панели область.
function applyViewOffset(w = canvas.clientWidth, h = canvas.clientHeight) {
  camera.aspect = w / Math.max(1, h);
  if (app.mode === 'walk' || app.hidden || app.exporting) {
    camera.clearViewOffset();
    return;
  }
  const narrow = w <= 760;
  const side = document.getElementById('side-panel');
  const panelW = !narrow && side && side.offsetParent && !side.classList.contains('collapsed') ? side.offsetWidth + 12 : 0;
  const top = narrow ? 104 : 60;
  const ox = panelW;
  const oy = narrow ? 0 : Math.max(0, 0 - top);
  camera.aspect = (w + ox) / Math.max(1, h + oy);
  camera.setViewOffset(w + ox, h + oy, 0, oy, w, h);
  camera.updateProjectionMatrix();
}
app.applyViewOffset = applyViewOffset;
app.activeCamera = () => (app.mode === 'walk' && app.walk?.camera) || camera;
window.addEventListener('resize', resize);

// ---------- состояние ----------
const startup = resolveStartup({ hash: location.hash, storage });
const store = new Store(startup.state, {
  persist: (s) => storage.set(STORAGE_KEY, JSON.stringify(s)),
  onChange: (s, e) => onStateChange(s, e),
});
app.store = store;

// ---------- сцена ----------
const coarse = window.matchMedia?.('(pointer: coarse)').matches && Math.min(window.innerWidth, window.innerHeight) < 900;
const veg = app.quality === 'low' || coarse ? { grassCount: 2500, backdrop: 160, detail: 'far' }
  : app.quality === 'high' ? { grassCount: 9000, backdrop: 420, detail: 'near' } : { grassCount: 6000, backdrop: 320, detail: 'near' };
app.veg = veg;

const buildings = buildSiteBuildings(lib, { quality: veg.detail === 'far' ? 'low' : 'high' });
scene.add(buildings);
app.buildings = buildings;
const trees = buildSiteTrees(lib, { backdrop: veg.backdrop, detail: veg.detail });
scene.add(trees);
app.trees = trees;
const openings = Object.values(buildings.userData.parts).flatMap((p) => p.openings);
const landscape = buildSiteLandscape(lib, { quality: veg.detail === 'far' ? 'low' : 'high', grassCount: veg.grassCount, openings });
scene.add(landscape);
app.landscape = landscape;
const fires = landscape.userData.fires;
app.fires = fires;
// Газон с хвойной подстилкой под кронами (деревья участка и фоновый лес).
const litter = [
  ...trees.userData.planned.map((t) => ({ x: t.x, z: t.z, rad: Math.max(1.1, t.crown * 0.5), k: t.species === 'birch' ? 0.2 : 0.45 })),
  ...trees.userData.backdrop.map((t) => ({ x: t.x, z: t.z, rad: t.h * 0.28, k: 0.6 })),
];
const ground = buildTerrain(lawnMaterial(lib, litterMask(litter, SITE_CENTER), SITE_CENTER), { step: veg.detail === 'far' ? 0.6 : 0.4 });
scene.add(ground);
app.ground = ground;

// Деревья, заслоняющие постройку на виде камеры, скрываются (тени остаются): лучи от камеры к углам
// габарита выбранной постройки (на общем виде — к центрам всех построек) проверяются на пересечение
// со стволом и кроной каждого дерева участка.
const CROWN_BASE = { pine: 0.6, spruce: 0.12, birch: 0.35 };
const treeList = trees.userData.planned.map((t) => ({ id: t.id, x: t.x, z: t.z, yb: groundY(t.x, t.z), h: t.h, rc: (t.crown / 2) * 0.92, rt: t.dbh / 200 + 0.12, cb: CROWN_BASE[t.species] ?? 0.3 }));
const boxes = Object.fromEntries(Object.keys(BUILDING).map((id) => [id, new THREE.Box3().setFromObject(buildings.userData.parts[id].group)]));
function pointsOfInterest() {
  if (app.focus !== 'site' && boxes[app.focus]) {
    const b = boxes[app.focus];
    const pts = [];
    for (const fx of [0, 0.5, 1]) for (const fy of [0.08, 0.5, 0.85]) for (const fz of [0, 0.5, 1]) pts.push(new THREE.Vector3(b.min.x + (b.max.x - b.min.x) * fx, b.min.y + (b.max.y - b.min.y) * fy, b.min.z + (b.max.z - b.min.z) * fz));
    return pts;
  }
  if (app.spotPois) return app.spotPois.map((p) => new THREE.Vector3(...p));
  if (app.spot) {
    const t = controls.target;
    const pts = [t.clone()];
    for (let k = 0; k < 8; k++) for (const dy of [-0.3, 0.9]) pts.push(new THREE.Vector3(t.x + Math.cos(k * 0.785) * 2.2, t.y + dy, t.z + Math.sin(k * 0.785) * 2.2));
    return pts;
  }
  return [controls.target.clone(), ...Object.values(boxes).map((b) => b.getCenter(new THREE.Vector3()))];
}
function updateTreeClearance() {
  const hidden = new Set();
  if (app.mode !== 'walk' && app.settings.clearView) {
    const C = camera.position;
    for (const P of pointsOfInterest()) {
      const len = C.distanceTo(P);
      const n = Math.ceil(len / 0.25);
      for (let k = 1; k < n; k++) {
        const t = (k / n) * 0.97;
        const x = C.x + (P.x - C.x) * t, y = C.y + (P.y - C.y) * t, z = C.z + (P.z - C.z) * t;
        for (const tr of treeList) {
          if (hidden.has(tr.id)) continue;
          const dy = y - tr.yb;
          if (dy < 0 || dy > tr.h) continue;
          const r = dy > tr.cb * tr.h ? tr.rc : tr.rt;
          if ((x - tr.x) ** 2 + (z - tr.z) ** 2 < r * r) hidden.add(tr.id);
        }
      }
    }
  }
  app.hiddenTrees = hidden;
  return trees.userData.setHidden(hidden);
}
app.updateTreeClearance = updateTreeClearance;

// Ночью интерьеры светятся тёплым светом сквозь стекло (внутренняя отделка — этап 3).
const mats = buildings.userData.materials;
const warm = new THREE.Color().setStyle('#ffcf96', THREE.SRGBColorSpace);
mats.inner.emissive = warm.clone();
mats.inner.emissiveIntensity = 0;
env.onLight = (st) => {
  for (const f of fires) f.setLight(st);
  mats.inner.emissiveIntensity = 0.32 * st.lamp;
  mats.floor.emissive = warm;
  mats.floor.emissiveIntensity = 0.12 * st.lamp;
};
const sunPath = new SunPath(scene, invalidate, { center: [CX, CY - 0.5, CZ], radius: 26 });
app.sunPath = sunPath;

function applySolar() {
  const s = store.get();
  env.fireMode = s.fire;
  const st = env.update(s.solar, s.hour, s.lamps);
  sunPath.update(s.solar, s.hour, s.notes || app.ui?.sunPanelOpen);
  scene.background = scene.fog.color;
  app.ui?.updateSunReadout(st);
  scheduleEnvCapture();
  invalidate();
}
app.applySolar = applySolar;

let envTimer = null;
function scheduleEnvCapture(delay = 400) {
  clearTimeout(envTimer);
  envTimer = setTimeout(() => {
    env.captureEnvironment([sunPath.group, landscape.getObjectByName('grass'), landscape.getObjectByName('shrubs'), ...fires.map((f) => f.group)].filter(Boolean));
    invalidate();
  }, delay);
}
app.scheduleEnvCapture = scheduleEnvCapture;

function onStateChange(state, event) {
  app.ui?.refresh(state, event);
  applySolar();
  if (event?.kind === 'undo' || event?.kind === 'redo') app.ui?.toast(`${event.kind === 'undo' ? 'Отменено' : 'Повторено'}: ${event.label || 'действие'}`);
}

// ---------- камера ----------
const tween = { active: false };
function flyTo(pos, target, duration = 1000) {
  tween.active = true;
  tween.t0 = performance.now();
  tween.duration = duration;
  tween.fromPos = camera.position.clone();
  tween.fromTarget = controls.target.clone();
  tween.toPos = new THREE.Vector3(...pos);
  tween.toTarget = new THREE.Vector3(...target);
  invalidate();
}
app.flyTo = flyTo;

function updateTween(now) {
  if (!tween.active) return false;
  const k = Math.min(1, (now - tween.t0) / tween.duration);
  const e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
  camera.position.lerpVectors(tween.fromPos, tween.toPos, e);
  controls.target.lerpVectors(tween.fromTarget, tween.toTarget, e);
  if (k >= 1) {
    tween.active = false;
    scheduleEnvCapture();
  }
  return true;
}

const aspectK = () => {
  const a = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  return a < 1 ? 1.55 / Math.max(0.45, a) : 1;
};

// Виды: общий — с юго-востока над воротами; постройки — с сторон главных фасадов по рендерам.
const VIEWS = {
  site: { dir: [0.42, 0.9], dist: 60, h: 0.46, target: [CX - 1, CY + 0.5, CZ + 1] },
  guest: { dir: [-1, 0.14], dist: 22, h: 0.16 },
  grill: { dir: [0.45, 0.89], dist: 17.5, h: 0.2 },
  garage: { dir: [0.8, -0.6], dist: 19, h: 0.2 },
};
function buildingBox(id) {
  return new THREE.Box3().setFromObject(buildings.userData.parts[id].group);
}
export function viewFor(id) {
  let v = VIEWS[id] ?? VIEWS.site;
  let k = aspectK();
  // Узкий экран: участок — круче сверху и ближе (иначе камера уходит за фоновый лес).
  if (k > 1 && (id === 'site' || !VIEWS[id])) {
    v = { ...v, h: 0.78 };
    k = Math.min(k, 1.9);
  } else k = Math.min(k, 2.4);
  let target = v.target;
  if (!target) {
    const b = buildingBox(id);
    const c = b.getCenter(new THREE.Vector3());
    target = [c.x, b.min.y + (b.max.y - b.min.y) * 0.38, c.z];
  }
  const l = Math.hypot(...v.dir);
  const d = v.dist * k;
  const horiz = d * Math.cos(Math.asin(v.h));
  return { pos: [target[0] + (v.dir[0] / l) * horiz, target[1] + d * v.h, target[2] + (v.dir[1] / l) * horiz], target };
}
app.viewFor = viewFor;

// Точки интереса: от ворот, кострище, пруд с купелью, обеденная площадка.
function spotView(id) {
  const F = SITE.features;
  const y = (x, z) => groundY(x, z);
  switch (id) {
    case 'entry': {
      const g = SITE.gates.wicket;
      const x = (g.x0 + g.x1) / 2;
      return { pos: [x + 0.6, y(x, 39.4) + 2.4, 39.4], target: [x - 2.2, y(x - 2, 30) + 1.0, 29] };
    }
    case 'fire': {
      const [fx, fz] = F.firePit.center;
      return { pos: [fx + 5.6, y(fx, fz) + 2.6, fz + 5.2], target: [fx - 0.4, y(fx, fz) + 0.5, fz - 0.6] };
    }
    case 'pond': {
      // Пруд и купель в одном кадре: с юга, от забора над спортплощадкой; деревья на линии пруд — купель
      // не заслоняют.
      const [px, pz] = F.pond.center;
      const [qx, qz] = F.plungePool.center;
      const pois = [];
      for (let k = 0; k <= 6; k++) {
        const x = px + ((qx - px) * k) / 6, z = pz + ((qz - pz) * k) / 6;
        for (const dy of [0.2, 1.2]) pois.push([x, y(x, z) + dy, z]);
      }
      return { pos: [13.2, y(13.2, 39.8) + 5.2, 39.8], target: [15.0, y(15, 24.5) + 0.2, 24.5], pois };
    }
    case 'dining': {
      const d = BUILDING.grill.dining;
      const far = [(d[2][0] + d[3][0]) / 2, (d[2][1] + d[3][1]) / 2];
      const near = [(d[0][0] + d[1][0]) / 2, (d[0][1] + d[1][1]) / 2];
      const u = [far[0] - near[0], far[1] - near[1]];
      const l = Math.hypot(...u);
      const fy = floorY('grill');
      return { pos: [far[0] + (u[0] / l) * 4.6 + 2.2, fy + 2.1, far[1] + (u[1] / l) * 4.6 + 0.8], target: [near[0], fy + 1.0, near[1]] };
    }
    default: return viewFor('site');
  }
}

app.focusOn = (id) => {
  if (app.mode === 'walk') setMode('site');
  app.stopCinema();
  app.focus = id;
  app.spot = null;
  app.spotPois = null;
  const v = viewFor(id);
  flyTo(v.pos, v.target, 1100);
  app.ui?.onFocus(id);
};
app.showSpot = (id) => {
  if (app.mode === 'walk') setMode('site');
  app.stopCinema();
  app.focus = 'site';
  app.spot = id;
  app.ui?.onFocus('site');
  const v = spotView(id);
  app.spotPois = v.pois ?? null;
  flyTo(v.pos, v.target, 1100);
};
app.resetView = () => app.focusOn(app.focus === 'site' ? 'site' : app.focus);
app.topView = () => {
  if (app.mode === 'walk') return;
  const k = aspectK();
  app.spot = null;
  app.spotPois = null;
  flyTo([CX, CY + 68 * k, CZ + 0.5], [CX, CY, CZ], 1000);
};
app.zoom = (k) => {
  const dir = camera.position.clone().sub(controls.target);
  dir.multiplyScalar(k);
  if (dir.length() < controls.minDistance || dir.length() > controls.maxDistance) return;
  flyTo(controls.target.clone().add(dir).toArray(), controls.target.toArray(), 350);
};

const cinema = { active: false };
app.toggleCinema = () => {
  cinema.active = !cinema.active;
  cinema.t0 = performance.now();
  cinema.radius = Math.hypot(camera.position.x - controls.target.x, camera.position.z - controls.target.z);
  cinema.angle0 = Math.atan2(camera.position.z - controls.target.z, camera.position.x - controls.target.x);
  cinema.height = camera.position.y;
  app.ui?.setCinema(cinema.active);
  invalidate();
};
function updateCinema(now) {
  if (!cinema.active) return false;
  const t = (now - cinema.t0) / 1000;
  const a = cinema.angle0 + t * 0.07;
  camera.position.set(controls.target.x + Math.cos(a) * cinema.radius, cinema.height + Math.sin(t * 0.25) * 0.6, controls.target.z + Math.sin(a) * cinema.radius);
  camera.lookAt(controls.target);
  return true;
}
app.stopCinema = () => { if (cinema.active) app.toggleCinema(); };

app.toggleUI = () => {
  app.hidden = !app.hidden;
  document.getElementById('app').classList.toggle('ui-hidden', app.hidden);
  applyViewOffset();
  invalidate();
};

function setMode(mode, opts = {}) {
  if (mode === 'interior') return;
  if (mode === app.mode && !opts.force) return;
  const prev = app.mode;
  if (prev === 'walk' && mode !== 'walk') app.walk.exit();
  app.mode = mode;
  document.getElementById('app').className = `mode-${mode}${app.hidden ? ' ui-hidden' : ''}`;
  if (mode === 'walk') {
    app.stopCinema();
    app.walk.enter(opts.walk || {});
  } else {
    controls.enabled = true;
  }
  applySettings();
  app.ui?.onModeChange(mode);
  requestAnimationFrame(() => { applyViewOffset(); invalidate(); });
  invalidate();
}
app.setMode = setMode;

// ---------- цикл отрисовки ----------
let last = performance.now();
let lowFrames = 0;
let lastFire = 0;
app.animate = params.get('still') !== '1';
app.fireTime = 2.4;
function frame(now) {
  requestAnimationFrame(frame);
  const dtRaw = Math.min(0.25, (now - last) / 1000);
  const dt = Math.min(0.1, dtRaw);
  last = now;
  let active = false;
  if (app.mode === 'walk') {
    if (app.walk.update(dtRaw)) active = true;
  } else {
    active = updateTween(now) || active;
    active = updateCinema(now) || active;
    if (!cinema.active && controls.update()) active = true;
  }
  if (app.animate && fires.some((f) => f.animating(app.activeCamera())) && now - lastFire > 33) {
    lastFire = now;
    app.fireTime = now / 1000;
    app.needsRender = true;
  }
  if (!active && !app.needsRender) return;
  app.needsRender = false;
  updateTreeClearance();
  renderFrame();
  if (app.quality === 'auto' && active) {
    if (dt > 1 / 24) lowFrames++;
    else lowFrames = Math.max(0, lowFrames - 1);
    if (lowFrames > 90 && (app.autoRatio ?? 1.5) > 0.75) {
      app.autoRatio = Math.max(0.75, (app.autoRatio ?? Math.min(1.5, window.devicePixelRatio || 1)) - 0.25);
      lowFrames = 0;
      resize();
    }
  }
}

function renderFrame() {
  const cam = app.activeCamera();
  renderPass.camera = cam;
  gtao.camera = cam;
  bokeh.camera = cam;
  bokeh.uniforms.focus.value = cam.position.distanceTo(controls.target);
  bokeh.uniforms.aspect.value = cam.aspect;
  for (const f of fires) f.update(app.fireTime, cam, renderer);
  updatePointLights(app.mode === 'walk' ? cam.position : controls.target, app.fireTime);
  app.renderCount = (app.renderCount || 0) + 1;
  composer.render();
}
app.renderFrame = renderFrame;

app.exportPNG = async (w = 1800, h = 1120) => {
  const cam = app.activeCamera();
  const prev = { w: canvas.clientWidth, h: canvas.clientHeight, pr: renderer.getPixelRatio(), aspect: cam.aspect };
  app.exporting = true;
  if (cam === camera) camera.clearViewOffset();
  renderer.setPixelRatio(1);
  renderer.setSize(w, h, false);
  composer.setPixelRatio(1);
  composer.setSize(w, h);
  cam.aspect = w / h;
  cam.updateProjectionMatrix();
  renderFrame();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  renderer.setPixelRatio(prev.pr);
  renderer.setSize(prev.w, prev.h, false);
  composer.setPixelRatio(prev.pr);
  composer.setSize(prev.w, prev.h);
  app.exporting = false;
  cam.aspect = prev.aspect;
  cam.updateProjectionMatrix();
  if (cam === camera) applyViewOffset();
  invalidate();
  return blob;
};

// ---------- запуск ----------
app.ui = new SiteUI(app);
app.walk = new SiteWalk(app, { shrubs: landscape.getObjectByName('shrubs')?.userData.spots ?? [] });
onStateChange(store.get(), { kind: 'init' });
app.startupSource = startup.source;
app.linkMessages = [];
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith(HASH_PREFIX) || location.hash === encodeHash(store.get())) return;
  let msg;
  try {
    const r = loadState(decodeHash(location.hash));
    if (r.ok) {
      store.commit((s) => {
        for (const k of Object.keys(s)) delete s[k];
        Object.assign(s, r.state);
      }, 'Настройки из ссылки');
      msg = 'Применены настройки из ссылки';
    } else msg = `Ссылка не применена: ${r.errors[0]}`;
  } catch (e) {
    msg = `Ссылка повреждена: ${e.message}`;
  }
  app.linkMessages.push(msg);
  app.ui.toast(msg, 8000);
});
resize();
applySettings();
setMode('site', { force: true });
{
  const start = params.get('view');
  const v = start && VIEWS[start] ? viewFor(start) : start ? spotView(start) : viewFor('site');
  camera.position.set(...v.pos);
  controls.target.set(...v.target);
  if (start && VIEWS[start]) { app.focus = start; app.ui.onFocus(start); } else if (start) { app.spot = start; app.spotPois = v.pois ?? null; }
}
requestAnimationFrame(frame);
whenTexturesLoaded(() => {
  document.getElementById('loading').classList.add('done');
  scheduleEnvCapture(50);
  app.ready = true;
  invalidate();
});
setTimeout(() => document.getElementById('loading').classList.add('done'), 8000);

// ---------- диагностический API ----------
window.__site = {
  app,
  THREE,
  state: () => JSON.parse(JSON.stringify(store.get())),
  camera: () => ({ position: app.activeCamera().position.toArray(), target: controls.target.toArray(), fov: app.activeCamera().fov }),
  setCamera: (pos, target) => { tween.active = false; camera.position.set(...pos); controls.target.set(...target); controls.update(); invalidate(); },
  view: (id) => viewFor(id),
  spot: (id) => spotView(id),
  mode: () => app.mode,
  focus: () => app.focus,
  walk: () => app.walk?.info() ?? null,
  ready: () => !!app.ready,
  texturesPending: () => texturesPending(),
  renderCount: () => app.renderCount || 0,
  idle: () => !tween.active && !cinema.active,
  pauseAnimation: (on = true, t = 2.4) => { app.animate = !on; if (on) app.fireTime = t; invalidate(); },
  hiddenTrees: () => [...(app.hiddenTrees ?? [])],
  fire: () => fires.map((f) => ({ name: f.group.name, k: f.fire, animating: f.animating(app.activeCamera()), flames: f.pit?.flames.visible ?? null })),
  pointLights: () => POINT_LIGHTS.uPLNum.value,
  sunInfo: () => ({ ...env.state, lightDir: env.sun.position.clone().sub(env.sunTarget.position).normalize().toArray() }),
  buildings: () => Object.fromEntries(Object.entries(buildings.userData.parts).map(([id, p]) => {
    const b = new THREE.Box3().setFromObject(p.group);
    return [id, { min: b.min.toArray(), max: b.max.toArray(), floorY: floorY(id), openings: p.openings.length }];
  })),
  groundY,
  encodeHash: () => encodeHash(store.get()),
  newSite,
  stats: () => {
    let tris = 0, meshes = 0;
    scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      meshes++;
      const n = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
      tris += n * (o.isInstancedMesh ? o.count : 1);
    });
    return { meshes, tris: Math.round(tris), calls: renderer.info.render.calls };
  },
};
