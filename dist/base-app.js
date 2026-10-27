// Связывание сцены, состояния, истории, режимов и интерфейса VSEMDOM.COM.
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
import { SPEC, ROOMS, ROOM_BY_ID, HOUSE_AREA, TERRACE_AREA, ceilingHeight, GROUND_Y } from './plan.js';
import { Store } from './core.js';
import { resolveStartup, safeStorage, STORAGE_KEY, newProject, encodeHash, decodeHash, loadState, HASH_PREFIX } from './project-state.js';
import { MaterialLibrary, setAnisotropy, whenTexturesLoaded, texturesPending } from './materials.js';
import { OutdoorEnvironment } from './outdoor-environment.js';
import { HouseScene } from './house-scene.js';
import { buildLandscape } from './landscape.js';
import { buildForest } from './forest.js';
import { FireZone, BBQ } from './bbq-zone.js';
import { updatePointLights, POINT_LIGHTS } from './point-lights.js';
import { SunBeams } from './sun-beams.js';
import { initialDoorStates } from './walk-geometry.js';
import { SunPath } from './sun-path.js';
import { UI } from './ui.js';
import { Editor } from './editor.js';
import { WalkMode } from './walk-controls.js';

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
  mode: 'exterior',
  activeRoom: null,
  quality: params.get('quality') || 'auto',
  settings: { ao: true, bloom: false, dof: false, exposure: 1 },
  needsRender: true,
  hidden: false,
  doorStates: initialDoorStates(),
  frameTimes: [],
};

// Кадр нужен; карта теней пересчитывается только при изменении сцены (приём sael.net):
// движение камеры и живой огонь тени солнца не меняют.
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
scene.fog = new THREE.Fog(0xc9d6e2, 60, 240);
app.scene = scene;

const camera = new THREE.PerspectiveCamera(33, 1, 0.1, 900);
camera.position.set(17, 3.8, 20);
app.camera = camera;
const controls = new OrbitControls(camera, canvas);
controls.target.set(1, 0.9, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 2.5;
controls.maxDistance = 70;
controls.screenSpacePanning = true;
controls.zoomToCursor = true;
controls.addEventListener('change', invalidateView);
controls.addEventListener('end', () => scheduleEnvCapture());
app.controls = controls;

// ---------- качество ----------
function pixelRatioFor(q) {
  const dpr = window.devicePixelRatio || 1;
  if (q === 'low') return Math.min(1, dpr);
  if (q === 'high') return Math.min(2, Math.max(1.5, dpr));
  return app.autoRatio ?? Math.min(1.5, dpr);
}

const lib = new MaterialLibrary({ invalidate, quality: app.quality === 'low' ? 'low' : 'high' });
app.lib = lib;
const env = new OutdoorEnvironment(renderer, scene, { shadowSize: app.quality === 'low' ? 1024 : app.quality === 'high' ? 4096 : 2048 });
app.env = env;

// ---------- постобработка ----------
// MSAA на видеокарте (геометрические кромки), SMAA — остаточный шум материалов. На программном
// WebGL (SwiftShader, llvmpipe) и в облегчённом качестве MSAA выключено — слишком дорого.
const glInfo = renderer.getContext().getExtension('WEBGL_debug_renderer_info');
const gpuName = glInfo ? String(renderer.getContext().getParameter(glInfo.UNMASKED_RENDERER_WEBGL)) : '';
app.softwareGL = /swiftshader|llvmpipe|software|softpipe/i.test(gpuName);
const msaaFor = (q) => (app.softwareGL || q === 'low' ? 0 : 4);
const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType, samples: msaaFor(app.quality) }));
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
const gtao = new SceneGTAOPass(scene, camera, 256, 256);
gtao.updateGtaoMaterial({ radius: 0.42, distanceExponent: 1.4, thickness: 1.2, scale: 1, samples: 16 });
gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
gtao.blendIntensity = 0.72;
composer.addPass(gtao);
const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.35, 0.6, 0.92);
bloom.enabled = false;
composer.addPass(bloom);
const bokeh = new BokehPass(scene, camera, { focus: 12, aperture: 0.0012, maxblur: 0.006 });
bokeh.enabled = false;
composer.addPass(bokeh);
composer.addPass(new OutputPass());
// Цветокоррекция кадра (после тонального отображения, в sRGB): насыщенность, мягкий контраст,
// виньетка — «фотографическая» подача вместо плоской картинки ACES.
const grade = new ShaderPass({
  uniforms: { tDiffuse: { value: null }, uSat: { value: 1.08 }, uCon: { value: 0.05 }, uVig: { value: 0.2 } },
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
  env.setShadowSize(app.quality === 'low' ? 1024 : app.quality === 'high' ? 4096 : 2048);
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

// Композиция: центр кадра смещается в свободную от панелей область, дом не уходит под интерфейс.
function applyViewOffset(w = canvas.clientWidth, h = canvas.clientHeight) {
  camera.aspect = w / Math.max(1, h);
  if (app.mode === 'walk' || app.hidden || app.exporting) {
    camera.clearViewOffset();
    return;
  }
  const narrow = w <= 760;
  const side = document.getElementById('side-panel');
  const panelW = !narrow && side && side.offsetParent ? side.offsetWidth + 12 : 0;
  const dock = document.getElementById('dock');
  const dockH = dock && dock.offsetParent ? dock.offsetHeight + 12 : 0;
  const top = narrow ? 104 : 60;
  const ox = panelW;
  const oy = Math.max(0, dockH - top);
  // Пропорции считаются для полного «виртуального» кадра — изображение без искажений.
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
let prevState = null;

// ---------- сцена ----------
const house = new HouseScene(lib, scene, invalidate);
app.house = house;
// Плотность растительности по качеству: телефоны и «облегчённое» — меньше травинок и дальних деревьев.
const coarse = window.matchMedia?.('(pointer: coarse)').matches && Math.min(window.innerWidth, window.innerHeight) < 900;
const veg = app.quality === 'low' || coarse ? { grassCount: 1800, farCount: 150, nearDetail: 'far' }
  : app.quality === 'high' ? { grassCount: 15000, farCount: 480 } : { grassCount: 9000, farCount: 360 };
const landscape = buildLandscape(lib, veg);
scene.add(landscape);
app.landscape = landscape;
const forest = buildForest(lib, veg);
scene.add(forest);
app.forest = forest;
const fireZone = new FireZone(lib, { quality: veg.nearDetail === 'far' ? 'low' : 'high' });
scene.add(fireZone.group);
app.fireZone = fireZone;
const sunBeams = new SunBeams(scene);
app.sunBeams = sunBeams;
// Свет участка из одного расчёта солнца: костёр, угли, гирлянда, столбики вдоль дорожек, лучи в окнах.
env.onLight = (st) => {
  fireZone.setLight(st);
  for (const l of landscape.userData.lights) l.k = st.lamp;
  sunBeams.update(st.dir, st.sunColor, st.elevation > 0 ? Math.min(1, env.sun.intensity / 3.1) : 0);
};
const sunPath = new SunPath(scene, invalidate);
app.sunPath = sunPath;

function applySolar() {
  const s = store.get();
  env.fireMode = s.fire;
  const st = env.update(s.solar, s.hour, s.lamps);
  house.setNight(st.lamp, st.day);
  sunPath.update(s.solar, s.hour, s.notes || app.ui?.sunPanelOpen);
  scene.fog.color.copy(env.hemi.color).lerp(new THREE.Color(0xc9d6e2), st.day * 0.6).multiplyScalar(0.35 + 0.65 * st.day);
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
    // Окружение для отражений и рассеянного света: небо, рельеф, забор; растительность не снимается
    // (дорого на слабой графике, на освещение почти не влияет).
    env.captureEnvironment([house.root, sunPath.group, forest, fireZone.group, sunBeams.group, landscape.getObjectByName('grass'), landscape.getObjectByName('shrubs')].filter(Boolean));
    invalidate();
  }, delay);
}
app.scheduleEnvCapture = scheduleEnvCapture;

function onStateChange(state, event) {
  house.sync(state, prevState);
  prevState = JSON.parse(JSON.stringify(state));
  app.editor?.onStateChange(state, event);
  app.ui?.refresh(state, event);
  app.walk?.onItemsChanged(state);
  applySolar();
  if (event?.kind === 'undo' || event?.kind === 'redo') app.ui?.toast(`${event.kind === 'undo' ? 'Отменено' : 'Повторено'}: ${event.label || 'действие'}`);
}

// ---------- режимы и камера ----------
const tween = { active: false };
function flyTo(pos, target, duration = 900) {
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

export function exteriorView() {
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const k = aspect < 1 ? 1.65 / Math.max(0.45, aspect) : 1;
  return { pos: [1.8 + 20.5 * k, 4.4 + (k - 1) * 3, 27 * k], target: [1.6, 0.8, 0] };
}

export function roomView(roomId, top = false) {
  const r = ROOM_BY_ID[roomId];
  const [cx, cz] = r ? r.center : [1.5, 0];
  const xs = r ? r.polygon.map((p) => p[0]) : [-6, 9];
  const zs = r ? r.polygon.map((p) => p[1]) : [-3.4, 3.4];
  const size = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...zs) - Math.min(...zs)) * 1.3, 3);
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const dist = (size * 1.25 + 2) * (aspect < 1 ? 1.5 / Math.max(0.5, aspect) : 1);
  if (top) return { pos: [cx, dist * 1.9 + 3, cz + 0.01], target: [cx, 0, cz] };
  // Камера со стороны наружной стены помещения: фоном служат внутренние перегородки.
  let dx = cx - 1.5;
  let dz = cz * 2.2;
  if (Math.hypot(dx, dz) < 0.5) { dx = 0.45; dz = 0.95; }
  const l = Math.hypot(dx, dz);
  dx = dx / l * 0.75 + 0.25;
  dz = dz / l * 0.9;
  const l2 = Math.hypot(dx, dz) || 1;
  return { pos: [cx + (dx / l2) * dist, dist * 1.05 + 1.5, cz + (dz / l2) * dist], target: [cx, 0.3, cz] };
}

function overviewInterior(top = false) {
  if (app.activeRoom) return roomView(app.activeRoom, top);
  const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const k = aspect < 1 ? 1.7 / Math.max(0.45, aspect) : 1;
  if (top) return { pos: [1.5, 19 * k, 0.01], target: [1.5, 0, 0] };
  return { pos: [2.8, 19.5 * k, 15 * k], target: [1.5, 0, 0.3] };
}

// Разрез: в редакторе все стены понижены до 0,72 м — одинаково для общего обзора и выбранного
// помещения и независимо от положения камеры, поэтому стены не появляются и не исчезают при выборе
// помещения или повороте. Границы выбранного помещения показывает контур на полу.
let cutKey = null;
function applyCut(active) {
  const key = active ? 'cut' : 'off';
  if (key === cutKey) return;
  cutKey = key;
  house.setCut(active ? () => SPEC.walls.cutHeight : () => null, active);
}

function updateCut() {
  applyCut(app.mode === 'interior' && app.cutEnabled);
}
app.updateCut = updateCut;
app.cutEnabled = true;

function setMode(mode, opts = {}) {
  if (mode === app.mode && !opts.force) return;
  const prev = app.mode;
  app.editor?.cancelGesture('mode');
  if (prev === 'walk' && mode !== 'walk') app.walk.exit();
  app.mode = mode;
  document.getElementById('app').className = `mode-${mode}${app.hidden ? ' ui-hidden' : ''}`;
  house.setMode(mode === 'walk' ? 'walk' : mode);
  sunBeams.group.visible = mode === 'walk';
  if (mode === 'walk') {
    app.prevModeForWalk = prev === 'walk' ? 'exterior' : prev;
    applyCut(false);
    app.walk.enter(opts.walk || {});
  } else {
    controls.enabled = true;
    if (mode === 'interior') {
      const v = overviewInterior();
      flyTo(v.pos, v.target);
      updateCut();
    } else {
      applyCut(false);
      if (prev !== 'walk' || opts.reset) {
        const v = exteriorView();
        flyTo(v.pos, v.target);
      }
    }
  }
  applySettings();
  app.ui?.onModeChange(mode);
  requestAnimationFrame(() => { applyViewOffset(); invalidate(); });
  invalidate();
}
app.setMode = setMode;

app.selectRoom = (roomId, { fly = true } = {}) => {
  app.activeRoom = roomId;
  house.setRoomHighlight(roomId);
  app.ui?.onRoomChange(roomId);
  if (app.mode === 'interior') {
    if (fly) {
      const v = overviewInterior();
      flyTo(v.pos, v.target);
    }
    updateCut();
  }
  invalidate();
};

// Вид на мангальную зону: с юго-востока, костёр в центре кадра, дом и терраса на втором плане.
app.showFireZone = () => {
  if (app.mode !== 'exterior') setMode('exterior');
  flyTo([BBQ.x + 5.2, GROUND_Y + 2.3, BBQ.z + 6.2], [BBQ.x - 0.6, GROUND_Y + 0.55, BBQ.z - 0.6], 1100);
};

app.resetView = () => {
  if (app.mode === 'interior') {
    const v = overviewInterior();
    flyTo(v.pos, v.target);
  } else if (app.mode === 'exterior') {
    const v = exteriorView();
    flyTo(v.pos, v.target);
  }
};
app.topView = () => {
  if (app.mode === 'walk') return;
  if (app.mode !== 'interior') setMode('interior');
  const v = overviewInterior(true);
  flyTo(v.pos, v.target);
  updateCut();
};
app.zoom = (k) => {
  const dir = camera.position.clone().sub(controls.target);
  dir.multiplyScalar(k);
  if (dir.length() < controls.minDistance || dir.length() > controls.maxDistance) return;
  flyTo(controls.target.clone().add(dir).toArray(), controls.target.toArray(), 350);
};

// Кинематографический обзор: медленный облёт вокруг дома/помещения.
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
  const a = cinema.angle0 + t * 0.12;
  camera.position.set(controls.target.x + Math.cos(a) * cinema.radius, cinema.height + Math.sin(t * 0.3) * 0.4, controls.target.z + Math.sin(a) * cinema.radius);
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

app.setDoorStates = (states) => {
  app.doorStates = states;
  house.setDoorStates(states);
};

// ---------- цикл отрисовки ----------
let last = performance.now();
let lowFrames = 0;
let lastFire = 0;
// Живой огонь: время анимации; при паузе (снимки, проверки) кадр огня фиксирован.
app.animate = params.get('still') !== '1';
app.fireTime = 2.4;
function frame(now) {
  requestAnimationFrame(frame);
  const dtRaw = Math.min(0.25, (now - last) / 1000);
  const dt = Math.min(0.1, dtRaw);
  last = now;
  let active = false;
  // Прогулка дробит перемещение на шаги ≤ 4 см, поэтому допускает более длинный кадр.
  if (app.mode === 'walk') {
    // Прогулка: двери анимируются — тени обновляются вместе с кадром.
    if (app.walk.update(dtRaw)) { active = true; renderer.shadowMap.needsUpdate = true; }
  } else {
    active = updateTween(now) || active;
    active = updateCinema(now) || active;
    if (!cinema.active && controls.update()) active = true;
  }
  if (app.editor?.update(dt)) { active = true; renderer.shadowMap.needsUpdate = true; }
  // Пламя анимируется ~30 кадров/с, только пока зона в кадре.
  if (app.animate && fireZone.animating(app.activeCamera()) && now - lastFire > 33) {
    lastFire = now;
    app.fireTime = now / 1000;
    app.needsRender = true;
  }
  if (!active && !app.needsRender) return;
  app.needsRender = false;
  renderFrame();
  // Автокачество: снижение pixel ratio при длительной низкой частоте кадров.
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
  fireZone.update(app.fireTime, cam, renderer);
  updatePointLights(app.mode === 'walk' ? cam.position : controls.target, app.fireTime);
  app.renderCount = (app.renderCount || 0) + 1;
  composer.render();
}
app.renderFrame = renderFrame;

// Экспорт реального кадра 1800 × 1120 (PNG).
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
app.ui = new UI(app);
app.editor = new Editor(app);
app.walk = new WalkMode(app);
house.setDoorStates(app.doorStates);
onStateChange(store.get(), { kind: 'init' });
for (const m of startup.messages) app.ui.toast(m, 12000);
app.startupMessages = startup.messages;
app.startupSource = startup.source;
app.linkMessages = [];

// Ссылка, вставленная в адресную строку уже открытой вкладки, меняет только hash —
// конфигурация применяется одним действием истории; непригодная ссылка проект не трогает.
window.addEventListener('hashchange', () => {
  if (!location.hash.startsWith(HASH_PREFIX) || location.hash === encodeHash(store.get())) return;
  let msg;
  try {
    const r = loadState(decodeHash(location.hash));
    if (r.ok) {
      app.editor.cancelGesture('link');
      store.commit((s) => {
        for (const k of Object.keys(s)) delete s[k];
        Object.assign(s, r.state);
      }, 'Конфигурация из ссылки');
      msg = ['Применена конфигурация из ссылки', ...r.notes].join(' · ');
    } else {
      msg = `Конфигурация из ссылки не применена: ${r.errors[0]}. Текущий проект сохранён.`;
    }
  } catch (e) {
    msg = `Ссылка повреждена: ${e.message}. Текущий проект сохранён.`;
  }
  app.linkMessages.push(msg);
  app.ui.toast(msg, 12000);
});
resize();
applySettings();
setMode('exterior', { force: true });
camera.position.set(...exteriorView().pos);
controls.target.set(...exteriorView().target);
requestAnimationFrame(frame);
whenTexturesLoaded(() => {
  document.getElementById('loading').classList.add('done');
  scheduleEnvCapture(50);
  app.ready = true;
  invalidate();
});
setTimeout(() => document.getElementById('loading').classList.add('done'), 6000);

// ---------- диагностический API (чтение состояния для проверок) ----------
window.__vsemdom = {
  app,
  state: () => JSON.parse(JSON.stringify(store.get())),
  camera: () => ({ position: app.activeCamera().position.toArray(), target: controls.target.toArray(), fov: app.activeCamera().fov }),
  mode: () => app.mode,
  activeRoom: () => app.activeRoom,
  selected: () => app.editor?.selectedId ?? null,
  selectedSurface: () => app.editor?.selectedSurface ?? null,
  drag: () => app.editor?.dragInfo() ?? null,
  walk: () => app.walk?.info() ?? null,
  history: () => ({ index: store.history.index, length: store.history.states.length }),
  surfaceMaterials: (slot) => house.meshesForSurface(slot).map((m) => ({ name: m.material.name, color: m.material.color?.getHexString(), visible: m.visible })),
  roofType: () => house.parts.roof?.userData.roofType,
  texturesPending: () => texturesPending(),
  renderCount: () => app.renderCount || 0,
  ready: () => !!app.ready,
  startup: () => ({ source: app.startupSource, messages: app.startupMessages }),
  linkMessages: () => [...app.linkMessages],
  fire: () => ({ k: fireZone.fire, animating: fireZone.animating(app.activeCamera()), stones: fireZone.stoneCount, mode: store.get().fire, flames: fireZone.pit.flames.visible }),
  pointLights: () => POINT_LIGHTS.uPLNum.value,
  beams: () => ({ visible: sunBeams.group.visible, faces: (sunBeams.mesh.geometry.index?.count || 0) / 6 }),
  // Пауза анимации огня (детерминированные снимки и замеры): кадр огня фиксируется.
  pauseAnimation: (on = true, t = 2.4) => { app.animate = !on; if (on) app.fireTime = t; invalidate(); },
  idle: () => !tween.active && !cinema.active && !(app.editor?.drag) && !(app.editor?.anims?.length),
  screenOf: (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(app.activeCamera());
    const r = canvas.getBoundingClientRect();
    return [r.left + (v.x * 0.5 + 0.5) * r.width, r.top + (-v.y * 0.5 + 0.5) * r.height];
  },
  // Экранная точка, в которой луч действительно попадает в предмет (с учётом заслоняющих объектов).
  itemScreen: (id) => {
    const it = store.get().items.find((i) => i.id === id);
    if (!it) return null;
    const o = house.itemObjects.get(id);
    const box = new THREE.Box3().setFromObject(o);
    const c = box.getCenter(new THREE.Vector3());
    const sz = box.getSize(new THREE.Vector3());
    const cands = [];
    for (const fy of [0.5, 0.75, 0.9, 0.3]) for (const fx of [0, -0.25, 0.25]) for (const fz of [0, -0.25, 0.25]) cands.push(new THREE.Vector3(c.x + sz.x * fx, box.min.y + sz.y * fy, c.z + sz.z * fz));
    for (const v of cands) {
      const sp = window.__vsemdom.screenOf(v.x, v.y, v.z);
      const hit = app.editor.pickAt(sp[0], sp[1]);
      if (hit?.kind === 'item' && hit.id === id && document.elementFromPoint(sp[0], sp[1]) === canvas) return sp;
    }
    return window.__vsemdom.screenOf(c.x, c.y, c.z);
  },
  floorAt: (sx, sy, y = 0) => {
    const r = canvas.getBoundingClientRect();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(((sx - r.left) / r.width) * 2 - 1, -((sy - r.top) / r.height) * 2 + 1), app.activeCamera());
    const o = rc.ray.origin;
    const d = rc.ray.direction;
    if (d.y > -1e-4) return null;
    const t = (y - o.y) / d.y;
    return [o.x + d.x * t, o.z + d.z * t];
  },
  onCanvas: (sx, sy) => document.elementFromPoint(sx, sy) === canvas,
  sunInfo: () => ({ ...env.state, dir: env.state?.dir, lightDir: env.sun.position.clone().sub(env.sunTarget.position).normalize().toArray() }),
  encodeHash: () => encodeHash(store.get()),
  newProject,
  ceilingAt: (z) => ceilingHeight(z),
  houseArea: HOUSE_AREA,
  terraceArea: TERRACE_AREA,
  rooms: ROOMS.map((r) => ({ id: r.id, name: r.name, area: r.area })),
};
