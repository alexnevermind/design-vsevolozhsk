// Прогулка по участку: ввод как в базе (клавиатура, Pointer Lock, перетаскивание взгляда, сенсорный
// джойстик), высота глаз — по рельефу, дорожкам и настилу обеденной площадки; препятствия — стены
// построек, забор, стволы, пруд, купель, кострище, мангал, кусты, опоры навеса и обеденный стол.
// Внутрь построек — этап 3 (интерьеры): двери пока закрыты.
import * as THREE from 'three';
import { SITE, BUILDING, groundY, floorY, insideSite } from './site-data.js';
import { pointInPolygon, distToSegment } from './geometry.js';

export const WALK = { eyeHeight: 1.62, radius: 0.25, speed: 1.45, fastSpeed: 3.2, fov: 62, near: 0.08 };
const KEYMAP = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r' };
const isTyping = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
const F = SITE.features;

// Ближайшая точка контура многоугольника.
function nearestEdge(x, z, poly) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const r = distToSegment(x, z, a[0], a[1], b[0], b[1]);
    if (!best || r.d < best.d) best = r;
  }
  return best;
}

// Препятствия участка: многоугольники (стены, опоры, стол) и окружности.
export function walkObstacles(extra = {}) {
  const polys = [];
  const circles = [];
  for (const b of SITE.buildings) for (const p of b.footprint) polys.push({ poly: p, id: b.id });
  for (const p of BUILDING.garage.carport.piers) polys.push({ poly: p, id: 'pier' });
  // Обеденный стол со скамьями — прямоугольник 2,6 × 2,1 м по оси площадки.
  {
    const d = BUILDING.grill.dining;
    const n0 = [(d[0][0] + d[1][0]) / 2, (d[0][1] + d[1][1]) / 2];
    const n1 = [(d[2][0] + d[3][0]) / 2, (d[2][1] + d[3][1]) / 2];
    const c = [n0[0] + (n1[0] - n0[0]) * 0.55, n0[1] + (n1[1] - n0[1]) * 0.55];
    const L = Math.hypot(n1[0] - n0[0], n1[1] - n0[1]);
    const u = [(n1[0] - n0[0]) / L, (n1[1] - n0[1]) / L];
    const v = [-u[1], u[0]];
    const hu = 1.3, hv = 1.05;
    polys.push({ id: 'table', poly: [[c[0] - u[0] * hu - v[0] * hv, c[1] - u[1] * hu - v[1] * hv], [c[0] + u[0] * hu - v[0] * hv, c[1] + u[1] * hu - v[1] * hv], [c[0] + u[0] * hu + v[0] * hv, c[1] + u[1] * hu + v[1] * hv], [c[0] - u[0] * hu + v[0] * hv, c[1] - u[1] * hu + v[1] * hv]] });
  }
  for (const t of SITE.trees) if (t.status === 'keep') circles.push({ x: t.pos[0], z: t.pos[1], r: Math.max(0.12, t.dbh / 200 + 0.06), id: t.id });
  circles.push({ x: F.pond.center[0], z: F.pond.center[1], r: F.pond.r - 0.1, id: 'pond' });
  circles.push({ x: F.plungePool.center[0], z: F.plungePool.center[1], r: F.plungePool.r + 0.05, id: 'pool' });
  circles.push({ x: F.firePit.center[0], z: F.firePit.center[1], r: 0.55, id: 'fire' });
  for (const s of extra.shrubs ?? []) circles.push({ x: s.x, z: s.z, r: s.rad * 0.9, id: 'shrub' });
  for (const c of extra.circles ?? []) circles.push(c);
  return { polys, circles };
}

export class SiteWalkWorld {
  constructor(extra) {
    this.obs = walkObstacles(extra);
    this.deck = BUILDING.grill.dining;
    this.paving = [BUILDING.garage.carport.floor];
  }

  // Высота пола под ногами: настил обеденной площадки, иначе рельеф (+3 см на мощении).
  floorAt(x, z) {
    if (pointInPolygon(x, z, this.deck)) return floorY('grill') - 0.05;
    return groundY(x, z) + 0.03;
  }

  blocked(x, z, r = WALK.radius) {
    if (!insideSite(x, z) || nearestEdge(x, z, SITE.boundary).d < r + 0.08) return true;
    for (const o of this.obs.polys) if (pointInPolygon(x, z, o.poly) || nearestEdge(x, z, o.poly).d < r) return true;
    for (const c of this.obs.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    return false;
  }

  // Шаг с выталкиванием из препятствий (до 4 см за итерацию) и скольжением вдоль стен.
  move(pose, dx, dz) {
    const r = WALK.radius;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.04));
    let x = pose.x, z = pose.z;
    for (let s = 0; s < steps; s++) {
      let nx = x + dx / steps, nz = z + dz / steps;
      for (let it = 0; it < 3; it++) {
        // Граница участка (изнутри).
        const e = nearestEdge(nx, nz, SITE.boundary);
        const m = r + 0.08;
        if (!insideSite(nx, nz) || e.d < m) {
          let ux = nx - e.cx, uz = nz - e.cz;
          const l = Math.hypot(ux, uz) || 1;
          ux /= l; uz /= l;
          if (!insideSite(nx, nz)) { ux = -ux; uz = -uz; }
          nx = e.cx + ux * m; nz = e.cz + uz * m;
        }
        for (const o of this.obs.polys) {
          const inside = pointInPolygon(nx, nz, o.poly);
          const q = nearestEdge(nx, nz, o.poly);
          if (!inside && q.d >= r) continue;
          let ux = nx - q.cx, uz = nz - q.cz;
          const l = Math.hypot(ux, uz) || 1;
          ux /= l; uz /= l;
          if (inside) { ux = -ux; uz = -uz; }
          nx = q.cx + ux * r; nz = q.cz + uz * r;
        }
        for (const c of this.obs.circles) {
          const ddx = nx - c.x, ddz = nz - c.z;
          const d = Math.hypot(ddx, ddz);
          if (d >= c.r + r) continue;
          const k = (c.r + r) / (d || 1);
          nx = c.x + (d ? ddx : 1) * k; nz = c.z + (d ? ddz : 0) * k;
        }
      }
      // Ступень выше 0,3 м — препятствие (только у края настила и крутых откосов).
      if (Math.abs(this.floorAt(nx, nz) - this.floorAt(x, z)) > 0.3) break;
      if (this.blocked(nx, nz, r - 0.01)) break;
      x = nx; z = nz;
    }
    return { x, z };
  }

  // Ближайшая свободная точка (по спирали) — старт прогулки.
  safeSpot(x, z) {
    for (let k = 0; k < 400; k++) {
      const a = k * 2.399, d = Math.sqrt(k) * 0.18;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!this.blocked(px, pz)) return { x: px, z: pz };
    }
    return null;
  }
}

// Подписи мест: постройка рядом, площадка, дорожка.
function placeLabel(x, z) {
  const near = (c, r) => Math.hypot(x - c[0], z - c[1]) < r;
  if (pointInPolygon(x, z, BUILDING.grill.dining)) return 'Обеденная площадка под перголой';
  if (pointInPolygon(x, z, BUILDING.garage.carport.floor)) return 'Навес для двух машин';
  if (near(F.firePit.center, F.firePit.r + 1.2)) return 'Кострище';
  if (near(F.grillZone.center, F.grillZone.r + 1.0)) return 'Гриль-зона';
  if (near(F.pond.center, F.pond.r + 1.2)) return 'Пруд';
  if (near(F.plungePool.center, F.plungePool.r + 1.2)) return 'Купель';
  if (pointInPolygon(x, z, F.sport.poly)) return 'Спортивная площадка';
  let best = null;
  for (const b of SITE.buildings) {
    const d = Math.min(...b.footprint.map((p) => nearestEdge(x, z, p).d));
    if (d < 2.5 && (!best || d < best.d)) best = { d, name: b.name };
  }
  if (best) return best.name;
  for (const p of SITE.paths) for (let i = 0; i + 1 < p.pts.length; i++) {
    if (distToSegment(x, z, p.pts[i][0], p.pts[i][1], p.pts[i + 1][0], p.pts[i + 1][1]).d < p.width / 2 + 0.1) return `Дорожка: ${p.name}`;
  }
  return 'Участок';
}

export class SiteWalk {
  constructor(app, extra = {}) {
    this.app = app;
    this.camera = new THREE.PerspectiveCamera(WALK.fov, 1, WALK.near, 1200);
    this.camera.rotation.order = 'YXZ';
    this.world = new SiteWalkWorld(extra);
    this.active = false;
    this.paused = false;
    this.keys = new Set();
    this.fast = false;
    this.pose = this.startPose();
    this.eyeY = null;
    this.joy = { id: null, x: 0, y: 0 };
    this.look = { id: null, x: 0, y: 0, moved: 0, t: 0 };
    this.hud = document.getElementById('walk-hud');
    this.infoEl = document.getElementById('walk-info');
    this.pausedEl = document.getElementById('walk-paused');
    this.bind();
  }

  // Старт — за калиткой, лицом на север (к кострищу и пруду).
  startPose() {
    const w = SITE.gates.wicket;
    const x = (w.x0 + w.x1) / 2;
    return { x, z: 39.6, yaw: 0.12, pitch: -0.04 };
  }

  bind() {
    const canvas = this.app.renderer.domElement;
    document.getElementById('walk-pause').addEventListener('click', () => this.setPaused(!this.paused));
    document.getElementById('walk-resume').addEventListener('click', () => this.setPaused(false));
    document.getElementById('walk-exit').addEventListener('click', () => this.app.setMode('site'));
    window.addEventListener('keydown', (e) => {
      if (!this.active || isTyping(e) || this.app.ui?.modalOpen) return;
      if (e.code === 'Escape') { this.setPaused(true); return; }
      if (this.paused) return;
      if (KEYMAP[e.code]) { this.keys.add(KEYMAP[e.code]); e.preventDefault(); }
      if (e.key === 'Shift') this.fast = true;
    });
    window.addEventListener('keyup', (e) => {
      if (KEYMAP[e.code]) this.keys.delete(KEYMAP[e.code]);
      if (e.key === 'Shift') this.fast = false;
    });
    window.addEventListener('blur', () => { if (this.active) this.setPaused(true); });
    document.addEventListener('visibilitychange', () => { if (this.active && document.hidden) this.setPaused(true); });
    document.addEventListener('pointerlockchange', () => {
      if (!this.active) return;
      if (document.pointerLockElement !== canvas && !this.paused && this.wasLocked) this.setPaused(true);
      this.wasLocked = document.pointerLockElement === canvas;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.active || this.paused || document.pointerLockElement !== canvas) return;
      this.turn(e.movementX, e.movementY, 0.0022);
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || this.paused || this.look.id !== null) return;
      this.look = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0, t: performance.now(), type: e.pointerType };
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.active || e.pointerId !== this.look.id || this.paused) return;
      const dx = e.clientX - this.look.x;
      const dy = e.clientY - this.look.y;
      this.look.x = e.clientX;
      this.look.y = e.clientY;
      this.look.moved += Math.abs(dx) + Math.abs(dy);
      if (document.pointerLockElement !== canvas) this.turn(dx, dy, e.pointerType === 'touch' ? 0.0048 : 0.0036);
    });
    const endLook = (e) => {
      if (e.pointerId !== this.look.id) return;
      const tap = this.look.moved < 8 && performance.now() - this.look.t < 300;
      const type = this.look.type;
      this.look.id = null;
      if (!this.active || this.paused) return;
      if (tap && type === 'mouse' && document.pointerLockElement !== canvas && this.app.lockAllowed !== false) {
        try { const p = canvas.requestPointerLock?.(); p?.catch?.(() => { this.app.lockAllowed = false; }); } catch { this.app.lockAllowed = false; }
      }
    };
    canvas.addEventListener('pointerup', endLook);
    canvas.addEventListener('pointercancel', (e) => { if (e.pointerId === this.look.id) this.look.id = null; });
    const joy = document.getElementById('joystick');
    const stick = document.getElementById('stick');
    const setStick = (x, y) => { stick.style.transform = `translate(${x * 36}px, ${y * 36}px)`; };
    joy.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.joy.id = e.pointerId;
      joy.setPointerCapture(e.pointerId);
      this.joyRect = joy.getBoundingClientRect();
      this.updateJoy(e, setStick);
    });
    joy.addEventListener('pointermove', (e) => { if (e.pointerId === this.joy.id) this.updateJoy(e, setStick); });
    const endJoy = (e) => {
      if (e.pointerId !== this.joy.id) return;
      this.joy = { id: null, x: 0, y: 0 };
      setStick(0, 0);
    };
    joy.addEventListener('pointerup', endJoy);
    joy.addEventListener('pointercancel', endJoy);
  }

  updateJoy(e, setStick) {
    const r = this.joyRect;
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(x, y);
    if (l > 1) { x /= l; y /= l; }
    this.joy.x = x;
    this.joy.y = y;
    setStick(x, y);
  }

  turn(dx, dy, k) {
    this.pose.yaw -= dx * k;
    this.pose.pitch = Math.max(-1.35, Math.min(1.35, this.pose.pitch - dy * k));
    this.app.invalidate();
  }

  // Вход: прежний обзор сохраняется; старт — у калитки или перед выбранной постройкой.
  enter({ pose = null } = {}) {
    const app = this.app;
    this.saved = { position: app.camera.position.clone(), target: app.controls.target.clone() };
    const p = { ...(pose ?? this.startPose()) };
    const safe = this.world.safeSpot(p.x, p.z);
    if (safe) { p.x = safe.x; p.z = safe.z; }
    this.pose = { yaw: 0, pitch: 0, ...p };
    this.eyeY = null;
    this.active = true;
    this.paused = false;
    this.keys.clear();
    this.hud.hidden = false;
    this.pausedEl.hidden = true;
    const c = app.renderer.domElement;
    this.camera.aspect = c.clientWidth / Math.max(1, c.clientHeight);
    this.camera.updateProjectionMatrix();
    app.controls.enabled = false;
    this.apply(1);
    app.invalidate();
  }

  exit() {
    const app = this.app;
    this.active = false;
    this.keys.clear();
    this.joy = { id: null, x: 0, y: 0 };
    this.look.id = null;
    this.hud.hidden = true;
    if (document.pointerLockElement) document.exitPointerLock?.();
    if (this.saved) {
      app.camera.position.copy(this.saved.position);
      app.controls.target.copy(this.saved.target);
    }
    app.controls.enabled = true;
    app.controls.update();
  }

  setPaused(p) {
    if (!this.active) return;
    this.paused = p;
    this.keys.clear();
    this.fast = false;
    this.joy = { id: null, x: 0, y: 0 };
    document.getElementById('stick').style.transform = '';
    this.pausedEl.hidden = !p;
    document.getElementById('walk-pause').textContent = p ? 'Продолжить' : 'Пауза';
    if (p && document.pointerLockElement) document.exitPointerLock?.();
    this.app.invalidate();
  }

  // Высота глаз догоняет пол плавно (ступени, откосы), без рывков.
  apply(dt = 0.016) {
    const target = this.world.floorAt(this.pose.x, this.pose.z) + WALK.eyeHeight;
    this.eyeY = this.eyeY == null ? target : this.eyeY + (target - this.eyeY) * Math.min(1, dt * 10);
    this.camera.position.set(this.pose.x, this.eyeY, this.pose.z);
    this.camera.rotation.set(this.pose.pitch, this.pose.yaw, 0, 'YXZ');
    return Math.abs(target - this.eyeY) > 0.002;
  }

  update(dt) {
    if (!this.active) return false;
    if (this.paused) { this.updateInfo(); return false; }
    let mx = 0;
    let mz = 0;
    if (this.keys.has('f')) mz += 1;
    if (this.keys.has('b')) mz -= 1;
    if (this.keys.has('l')) mx -= 1;
    if (this.keys.has('r')) mx += 1;
    mx += this.joy.x;
    mz -= this.joy.y;
    const len = Math.hypot(mx, mz);
    let changed = false;
    if (len > 0.05) {
      const k = Math.min(1, len) / len;
      const v = (this.fast ? WALK.fastSpeed : WALK.speed) * dt;
      const fx = -Math.sin(this.pose.yaw);
      const fz = -Math.cos(this.pose.yaw);
      const dx = (fx * mz - fz * mx) * k * v;
      const dz = (fz * mz + fx * mx) * k * v;
      const r = this.world.move(this.pose, dx, dz);
      changed = r.x !== this.pose.x || r.z !== this.pose.z;
      this.pose.x = r.x;
      this.pose.z = r.z;
    }
    if (this.apply(dt)) changed = true;
    this.updateInfo();
    return changed || this.look.id !== null;
  }

  updateInfo() {
    const text = placeLabel(this.pose.x, this.pose.z);
    if (this.infoEl.textContent !== text) this.infoEl.textContent = text;
  }

  info() {
    return {
      active: this.active, paused: this.paused, x: this.pose.x, z: this.pose.z, yaw: this.pose.yaw, pitch: this.pose.pitch,
      eyeY: this.camera.position.y, floor: this.world.floorAt(this.pose.x, this.pose.z), place: placeLabel(this.pose.x, this.pose.z), fov: this.camera.fov,
    };
  }
}
