// Небо, физическое солнце, заполняющий свет и окружение для отражений (PMREM по кубической съёмке
// реального участка с отложенным пересчётом). Всё локально, без внешних HDR.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { sunState, daylightFactor, lampFactor } from './solar.js';
import { updateWindowLight } from './window-light.js';
import { FOLIAGE } from './forest.js';

function moonTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const halo = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  halo.addColorStop(0, 'rgba(220,226,240,0.35)');
  halo.addColorStop(1, 'rgba(220,226,240,0)');
  g.fillStyle = halo;
  g.fillRect(0, 0, 128, 128);
  g.beginPath();
  g.arc(64, 64, 22, 0, Math.PI * 2);
  g.fillStyle = '#e9e8e2';
  g.fill();
  // Моря — тёмные пятна.
  g.globalAlpha = 0.22;
  g.fillStyle = '#8a8e96';
  for (const [x, y, r] of [[57, 57, 8], [70, 60, 6], [62, 72, 7], [73, 71, 4], [52, 66, 4]]) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Области с тенями: дом с террасой, отмосткой и кустами; мангальная зона с гирляндой.
const SHADOW_BOXES = [[[-8, -0.75, -4.8], [12.6, 4.7, 5.6]], [[9.0, -0.75, 7.4], [15.9, 2.7, 14.6]]];

export class OutdoorEnvironment {
  constructor(renderer, scene, { shadowSize = 4096 } = {}) {
    this.renderer = renderer;
    this.scene = scene;
    this.sky = new Sky();
    this.sky.scale.setScalar(4000);
    this.sky.name = 'sky';
    this.sky.userData.excludeAO = true;
    const u = this.sky.material.uniforms;
    u.turbidity.value = 3.2;
    u.rayleigh.value = 1.1;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);
    // Ночной купол поверх неба (плавно по высоте солнца).
    this.night = new THREE.Mesh(
      new THREE.SphereGeometry(3000, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide, transparent: true, depthWrite: false,
        uniforms: { uAlpha: { value: 0 }, uTop: { value: new THREE.Color(0x0b1424) }, uBottom: { value: new THREE.Color(0x26324a) } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform float uAlpha;\nuniform vec3 uTop;\nuniform vec3 uBottom;\nvarying vec3 vP;\nvoid main(){\n float t = clamp(vP.y*1.6+0.2,0.0,1.0);\n gl_FragColor = vec4(mix(uBottom,uTop,t), uAlpha);\n #include <colorspace_fragment>\n}',
      }),
    );
    this.night.userData.excludeAO = true;
    this.night.renderOrder = -1;
    scene.add(this.night);
    // Луна: диск с морями (процедурная карта) на небе ночью, напротив солнца по азимуту.
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: moonTexture(), fog: false, depthWrite: false, transparent: true, color: new THREE.Color(1.6, 1.6, 1.55) }));
    this.moon.scale.setScalar(15);
    this.moon.renderOrder = -0.5;
    this.moon.userData.excludeAO = true;
    this.moon.visible = false;
    scene.add(this.moon);

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(shadowSize, shadowSize);
    const sc = this.sun.shadow.camera;
    sc.left = -11; sc.right = 11; sc.top = 11; sc.bottom = -11; sc.near = 1; sc.far = 80;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.025;
    this.sun.shadow.radius = 2.5;
    this.sun.shadow.camera.layers.enable(1); // теневая оболочка дома
    this.sunTarget = new THREE.Object3D();
    this.sunTarget.position.set(1.5, 0.5, 0);
    scene.add(this.sunTarget);
    this.sun.target = this.sunTarget;
    scene.add(this.sun);
    this.hemi = new THREE.HemisphereLight(0xbfd6ff, 0x5b6b3a, 0.3);
    scene.add(this.hemi);
    this.fill = new THREE.AmbientLight(0xffffff, 0.06);
    scene.add(this.fill);
    // Воздушная перспектива: дальний лес и край земли растворяются в дымке цвета горизонта.
    scene.fog = new THREE.FogExp2(0xc8d2dc, 0.0032);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    // LDR-захват: значения ограничены 0…1, без NaN/Inf в программном WebGL; блики солнца дают источники света.
    this.cubeRT = new THREE.WebGLCubeRenderTarget(128);
    this.cubeCam = new THREE.CubeCamera(0.5, 600, this.cubeRT);
    this.cubeCam.position.set(1.5, 1.6, 12);
    this.envRT = null;
    this.state = null;
  }

  // Смещение по нормали растёт с размером текселя карты: на 1024 без него на полу появляются полосы.
  updateShadowBias() {
    const sc = this.sun.shadow.camera;
    const extent = Math.max(sc.right - sc.left, sc.top - sc.bottom);
    this.sun.shadow.normalBias = 0.025 * Math.max(1, 2048 / this.sun.shadow.mapSize.x) * Math.max(1, extent / 22);
  }

  setShadowSize(n) {
    if (this.sun.shadow.mapSize.x === n) return;
    this.sun.shadow.mapSize.set(n, n);
    this.sun.shadow.map?.dispose();
    this.sun.shadow.map = null;
    this.updateShadowBias();
  }

  // Применение солнца: направление, цвет, интенсивность, небо, лампы — из одного расчёта.
  update(solar, hour, lampsEnabled) {
    const s = sunState(solar, hour);
    const day = daylightFactor(s.elevation);
    const lamp = lampFactor(s.elevation, lampsEnabled);
    const dir = new THREE.Vector3(...s.dir);
    this.sun.position.copy(this.sunTarget.position).addScaledVector(dir, 40);
    this.fitShadow();
    const el = Math.max(0, s.elevation);
    // Цвет солнца: тёплый у горизонта, нейтральный днём.
    const warm = Math.max(0, Math.min(1, 1 - el / 25));
    const sunColor = new THREE.Color().setRGB(1.0, 0.93 - 0.25 * warm, 0.85 - 0.45 * warm);
    const above = Math.max(0, Math.min(1, (s.elevation + 1) / 4));
    this.sun.color.copy(sunColor);
    this.sun.intensity = 3.1 * above * (0.55 + 0.45 * Math.min(1, el / 20));
    this.sun.castShadow = above > 0.01;
    // Ночью тот же источник — лунный свет: холодный, слабый, с мягкими тенями (высота 38°).
    const moonK = Math.max(0, Math.min(1, (-3 - s.elevation) / 6));
    this.moon.visible = moonK > 0;
    if (moonK > 0) {
      const md = new THREE.Vector3(-dir.x, 0, -dir.z);
      if (md.lengthSq() < 1e-6) md.set(0.3, 0, -1);
      md.normalize();
      md.y = Math.tan(38 * Math.PI / 180);
      md.normalize();
      this.sun.position.copy(this.sunTarget.position).addScaledVector(md, 40);
      this.fitShadow();
      this.sun.color.setRGB(0.6, 0.7, 1.0);
      this.sun.intensity = 0.34 * moonK;
      this.sun.castShadow = true;
      this.moon.position.copy(md).multiplyScalar(820);
      this.moon.material.opacity = moonK;
    }
    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(dir).multiplyScalar(400);
    u.turbidity.value = 3.2 + warm * 3;
    u.rayleigh.value = 1.1 + warm * 1.6;
    this.night.material.uniforms.uAlpha.value = 1 - Math.max(0, Math.min(1, (s.elevation + 9) / 11));
    const skyCol = new THREE.Color().setRGB(0.66, 0.74, 0.86).lerp(new THREE.Color(0.95, 0.72, 0.58), warm * 0.6);
    const nightCol = new THREE.Color(0.16, 0.2, 0.32);
    this.hemi.color.copy(skyCol).lerp(nightCol, 1 - day);
    this.hemi.groundColor.setRGB(0.46, 0.44, 0.40).lerp(new THREE.Color(0.05, 0.05, 0.07), 1 - day);
    this.hemi.intensity = 0.2 + 0.16 * day;
    this.fill.intensity = 0.03 + 0.05 * day;
    this.renderer.toneMappingExposure = this.baseExposure * (0.75 + 0.25 * day + 0.25 * (1 - day));
    // Дымка: светлый горизонт днём, тёплый на закате, тёмно-синий ночью.
    const haze = skyCol.clone().lerp(new THREE.Color(0.9, 0.9, 0.88), 0.45);
    this.scene.fog.color.copy(haze).multiplyScalar(0.25 + 0.75 * day).lerp(new THREE.Color(0.018, 0.024, 0.04), 1 - day);
    // Просвечивание хвои и листвы против солнца.
    FOLIAGE.uSunDir.value.copy(dir);
    FOLIAGE.uSunCol.value.copy(sunColor);
    FOLIAGE.uSunK.value = this.sun.intensity / 3.1;
    // Свет из окна близок к нейтральному: адаптация глаза в помещении убирает синеву неба.
    const winCol = skyCol.clone().lerp(new THREE.Color(1, 0.97, 0.93), 0.7);
    updateWindowLight({ sunDir: s.dir, daylight: day, skyColor: winCol, sunColor, lamp });
    // Костёр: «авто» — горит в сумерках и ночью (как автоматические светильники), «on»/«off» — вручную.
    const fire = this.fireMode === 'on' ? 1 : this.fireMode === 'off' ? 0 : lampFactor(s.elevation, true);
    this.state = { ...s, day, lamp, fire, sunColor, skyCol };
    this.onLight?.(this.state);
    return this.state;
  }

  // Теневая камера по направлению солнца плотно охватывает дом с отмосткой и кустами и мангальную
  // зону: прямоугольник в плоскости света подбирается по углам двух коробок (плотность теней не
  // падает, хотя участок стал больше).
  fitShadow() {
    const sc = this.sun.shadow.camera;
    sc.position.copy(this.sun.position);
    sc.lookAt(this.sunTarget.position);
    sc.updateMatrixWorld(true);
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    const v = new THREE.Vector3();
    for (const [a, b] of SHADOW_BOXES) {
      for (let k = 0; k < 8; k++) {
        v.set(k & 1 ? b[0] : a[0], k & 2 ? b[1] : a[1], k & 4 ? b[2] : a[2]).applyMatrix4(sc.matrixWorldInverse);
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y);
      }
    }
    sc.left = x0 - 0.4; sc.right = x1 + 0.4; sc.bottom = y0 - 0.4; sc.top = y1 + 0.4;
    sc.updateProjectionMatrix();
    this.updateShadowBias();
  }

  // Отражения окружения: кубическая съёмка участка (без дома) → PMREM.
  captureEnvironment(hideList = []) {
    const vis = hideList.map((o) => o.visible);
    hideList.forEach((o) => { o.visible = false; });
    const prevBg = this.scene.background;
    this.cubeCam.update(this.renderer, this.scene);
    hideList.forEach((o, i) => { o.visible = vis[i]; });
    const rt = this.pmrem.fromCubemap(this.cubeRT.texture);
    this.envRT?.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.background = prevBg;
  }
}

OutdoorEnvironment.prototype.baseExposure = 1;
OutdoorEnvironment.prototype.fireMode = 'auto';
