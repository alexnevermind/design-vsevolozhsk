// Прогулка по участку и постройкам: ввод как в базе (клавиатура, Pointer Lock, перетаскивание взгляда,
// сенсорный джойстик), высота глаз — по рельефу, полам этажей, лестнице и настилу обеденной площадки;
// препятствия — стены с проёмами дверей (двери открываются при подходе), ограждения, мебель, забор,
// стволы, пруд, купель, кострище, кусты, опоры навеса.
import * as THREE from 'three';
import { SITE, BUILDING, groundY, floorY, insideSite, placer } from './site-data.js';
import { pointInPolygon, distToSegment, circleObbPush, obb } from './geometry.js';
import { ROOMS } from './site-edit.js';

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

// Препятствия участка: многоугольники (опоры, стол), окружности. Постройки: с данными стен (walkData) —
// стены с проёмами дверей; без них — пятна построек целиком (как снаружи).
export function walkObstacles(extra = {}, withBuildings = true) {
  const polys = [];
  const circles = [];
  if (withBuildings) for (const b of SITE.buildings) for (const p of b.footprint) polys.push({ poly: p, id: b.id });
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

// Отрезок толщиной 2h как повёрнутый прямоугольник с плоскими торцами (проём между стенами — полной ширины).
function segObb(a, b, h, id) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1e-6;
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  return { a, b, h, id, obb: obb((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, L, 2 * h, Math.atan2(-u[1], u[0])) };
}

// Данные построек в координатах участка: отрезки стен (осевые, полутолщина), полы этажей, лестницы,
// ограждения, стойки.
function buildingWorld(data) {
  const walls = [], surfaces = [], rails = [], circles = [];
  for (const [id, d] of Object.entries(data)) {
    const at = placer(BUILDING[id]);
    const W = (x, z) => at(x * 1000, z * 1000);
    const fy = floorY(id);
    for (const w of d.walls) {
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      const u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
      const off = [-w.n[0] * w.t / 2, -w.n[1] * w.t / 2];
      const gaps = [...w.gaps].sort((p, q) => p[0] - q[0]);
      let s0 = 0;
      const pieces = [];
      for (const [g0, g1] of gaps) { if (g0 > s0 + 0.01) pieces.push([s0, g0]); s0 = Math.max(s0, g1); }
      if (L > s0 + 0.01) pieces.push([s0, L]);
      for (const [p0, p1] of pieces) {
        const A = W(w.a[0] + u[0] * p0 + off[0], w.a[1] + u[1] * p0 + off[1]);
        const B = W(w.a[0] + u[0] * p1 + off[0], w.a[1] + u[1] * p1 + off[1]);
        walls.push(segObb(A, B, w.t / 2, id));
      }
    }
    for (const sf of d.surfaces) surfaces.push({ poly: sf.poly.map(([x, z]) => W(x, z)), y: fy + sf.y, solid: !!sf.solid, id });
    for (const r of d.rails) rails.push({ ...segObb(W(...r.a), W(...r.b), 0.04, id), y0: fy + r.y0, y1: fy + r.y1 });
    for (const p of d.posts) { const c = W(p.x, p.z); circles.push({ x: c[0], z: c[1], r: p.r, id: `${id}-post` }); }
  }
  return { walls, surfaces, rails, circles };
}

export class SiteWalkWorld {
  // extra — кусты; data — walkData() построек (стены, лестницы); items() — мебель: [{ obb, y }] на кадр.
  constructor(extra = {}, data = null, items = null) {
    this.obs = walkObstacles(extra, !data);
    this.deck = BUILDING.grill.dining;
    this.bw = data ? buildingWorld(data) : null;
    if (this.bw) this.obs.circles.push(...this.bw.circles);
    this.items = items ?? (() => []);
  }

  buildingAt(x, z) {
    for (const b of SITE.buildings) if (b.footprint.some((p) => pointInPolygon(x, z, p))) return b.id;
    return null;
  }

  // Высота пола под ногами при текущей высоте cur: пол постройки, лестница, мансарда (выше cur не более
  // чем на 0,4 м), настил обеденной площадки, иначе рельеф (+3 см на мощении).
  floorAt(x, z, cur = null) {
    let base;
    const bid = this.bw ? this.buildingAt(x, z) : null;
    if (bid) base = floorY(bid);
    else if (pointInPolygon(x, z, this.deck)) base = floorY('grill') - 0.05;
    else base = groundY(x, z) + 0.03;
    if (!this.bw || cur === null) return base;
    let best = base <= cur + 0.4 ? base : null;
    for (const sf of this.bw.surfaces) {
      if (sf.y > cur + 0.4 || (best !== null && sf.y <= best)) continue;
      if (pointInPolygon(x, z, sf.poly)) best = sf.y;
    }
    return best ?? base;
  }

  // Подъём выше 0,4 м по сплошной ступени или низкая голова под маршем/перекрытием — препятствие
  // (под открытым маршем просвет считается от подшивки — на 0,3 м ниже проступи).
  stepBlocked(x, z, cur) {
    if (!this.bw) return false;
    for (const sf of this.bw.surfaces) {
      if (!pointInPolygon(x, z, sf.poly)) continue;
      const d = sf.y - cur;
      if (sf.solid && d > 0.4) return true;
      if (!sf.solid && d > 0.4 && d - 0.3 < 1.95) return true;
    }
    return false;
  }

  blocked(x, z, r = WALK.radius, cur = null) {
    if (!insideSite(x, z) || nearestEdge(x, z, SITE.boundary).d < r + 0.08) return true;
    for (const o of this.obs.polys) if (pointInPolygon(x, z, o.poly) || nearestEdge(x, z, o.poly).d < r) return true;
    for (const c of this.obs.circles) if (Math.hypot(x - c.x, z - c.z) < c.r + r) return true;
    if (this.bw) {
      for (const w of this.bw.walls) if (circleObbPush(x, z, r - 0.01, w.obb).hit) return true;
      const y = cur ?? this.floorAt(x, z);
      for (const it of this.items()) if (Math.abs(it.y - y) < 1.2 && circleObbPush(x, z, r - 0.02, it.obb).hit) return true;
      if (this.stepBlocked(x, z, y)) return true;
    }
    return false;
  }

  // Шаг с выталкиванием из препятствий (до 4 см за итерацию) и скольжением вдоль стен.
  move(pose, dx, dz) {
    const r = WALK.radius;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 0.04));
    let x = pose.x, z = pose.z;
    let y = pose.y ?? this.floorAt(x, z);
    const items = this.bw ? this.items().filter((it) => Math.abs(it.y - y) < 1.2) : [];
    const rails = this.bw ? this.bw.rails : [];
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
        if (this.bw) {
          const segs = [...this.bw.walls, ...rails.filter((q) => y > Math.min(q.y0, q.y1) - 0.6 && y < Math.max(q.y0, q.y1) + 0.6)];
          for (const w of segs) {
            const p = circleObbPush(nx, nz, r, w.obb);
            if (p.hit) { nx += p.nx * p.depth; nz += p.nz * p.depth; }
          }
          for (const itm of items) {
            const p = circleObbPush(nx, nz, r, itm.obb);
            if (p.hit) { nx += p.nx * p.depth; nz += p.nz * p.depth; }
          }
        }
      }
      const ny = this.floorAt(nx, nz, y);
      // Ступень выше 0,4 м (снаружи — 0,3 м у края настила и откосов) — препятствие.
      if (Math.abs(ny - y) > (this.bw ? 0.42 : 0.3) && !(this.bw && ny < y)) break;
      if (this.bw && ny < y - 0.42 && !this.buildingAt(nx, nz)) break;
      if (this.blocked(nx, nz, r - 0.01, ny)) break;
      x = nx; z = nz; y = ny;
    }
    return { x, z, y };
  }

  // Ближайшая свободная точка (по спирали) — старт прогулки.
  safeSpot(x, z, y = null) {
    for (let k = 0; k < 400; k++) {
      const a = k * 2.399, d = Math.sqrt(k) * 0.18;
      const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
      if (!this.blocked(px, pz, WALK.radius, y)) return { x: px, z: pz };
    }
    return null;
  }
}

// Подписи мест: постройка рядом, площадка, дорожка.
function placeLabel(x, z, y = null) {
  const near = (c, r) => Math.hypot(x - c[0], z - c[1]) < r;
  for (const b of SITE.buildings) {
    if (!b.footprint.some((p) => pointInPolygon(x, z, p))) continue;
    const at = placer(b);
    // Локальные координаты постройки (обратный поворот).
    const dx = x - b.origin[0], dz = z - b.origin[1];
    const lx = dx * at.dirU[0] + dz * at.dirU[1], lz = dx * at.dirV[0] + dz * at.dirV[1];
    const level = y !== null && y - floorY(b.id) > 1.5 ? 1 : 0;
    const room = Object.entries(ROOMS).find(([k, r]) => k.startsWith(`${b.id}:`) && r.level === level && pointInPolygon(lx, lz, r.poly));
    return room ? `${b.name} · ${room[1].name}` : b.name;
  }
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
  constructor(app, extra = {}, data = null) {
    this.app = app;
    this.camera = new THREE.PerspectiveCamera(WALK.fov, 1, WALK.near, 1200);
    this.camera.rotation.order = 'YXZ';
    // Мебель — повёрнутые прямоугольники по текущему положению (переставляется в режиме «Внутри»).
    const items = () => (app.furniture ?? []).filter((h) => !['tv'].includes(h.userData.item.type)).map((h) => {
      const it = h.userData.item;
      const p = h.parent.localToWorld(new THREE.Vector3(h.position.x, it.yLevel, h.position.z));
      const ry = h.rotation.y + (h.parent.parent?.rotation.y ?? 0);
      return { obb: obb(p.x, p.z, it.w, it.d, ry), y: p.y };
    });
    this.world = new SiteWalkWorld(extra, data, items);
    this.doors = [];
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
  // Старт внутри постройки: центр помещения (или постройки), этаж level; взгляд — к центру постройки.
  insidePose(bid, level = 0, room = null) {
    const part = this.app.buildings.userData.parts[bid];
    // Без помещения — у входной двери изнутри, лицом в постройку.
    const ENTRY = { guest: 'GD2', grill: 'KD2', garage: 'HD2' };
    const door = !room && level === 0 ? part.openings.find((o) => o.id === ENTRY[bid]) : null;
    if (door) {
      const x = door.x - door.n[0] * 1.2, z = door.z - door.n[1] * 1.2, y = floorY(bid);
      return { x, z, y, yaw: this.openYaw(x, z, y, Math.atan2(door.n[0], door.n[1])), pitch: -0.04 };
    }
    const key = room ? `${bid}:${room}` : Object.keys(ROOMS).find((k) => k.startsWith(`${bid}:`) && ROOMS[k].level === level);
    const poly = ROOMS[key]?.poly ?? [[0, 0]];
    const cx = poly.reduce((m, q) => m + q[0], 0) / poly.length, cz = poly.reduce((m, q) => m + q[1], 0) / poly.length;
    const w = part.group.localToWorld(new THREE.Vector3(cx, 0, cz));
    const y = floorY(bid) + (part.levels[level] ?? 0);
    const b = BUILDING[bid].footprint.flat();
    const bx = b.reduce((m, q) => m + q[0], 0) / b.length, bz = b.reduce((m, q) => m + q[1], 0) / b.length;
    const yaw = Math.atan2(-(bx - w.x), -(bz - w.z));
    return { x: w.x, z: w.z, y, yaw: Number.isFinite(yaw) ? yaw : 0, pitch: -0.05 };
  }

  // Направление взгляда с наибольшим свободным обзором (до 8 м) с предпочтением prefer: чтобы на входе
  // в небольшой холл камера смотрела вглубь постройки, а не в стену или центральный столб.
  openYaw(x, z, y, prefer) {
    let best = prefer, score = -Infinity;
    for (let k = 0; k < 32; k++) {
      const yaw = prefer + (k / 32) * Math.PI * 2;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      let d = 0;
      while (d < 8 && !this.world.blocked(x + fx * (d + 0.1), z + fz * (d + 0.1), 0.12, y)) d += 0.1;
      const s = Math.min(d, 6) + 1.2 * Math.cos(yaw - prefer);
      if (s > score) { score = s; best = yaw; }
    }
    return Math.atan2(Math.sin(best), Math.cos(best));
  }

  enter({ pose = null, inside = null, level = 0, room = null } = {}) {
    const app = this.app;
    this.saved = { position: app.camera.position.clone(), target: app.controls.target.clone() };
    const p = { ...(pose ?? (inside ? this.insidePose(inside, level, room) : this.startPose())) };
    if (p.y === undefined) p.y = this.world.floorAt(p.x, p.z);
    const safe = this.world.safeSpot(p.x, p.z, p.y);
    if (safe) { p.x = safe.x; p.z = safe.z; }
    this.pose = { yaw: 0, pitch: 0, ...p };
    this.doors = Object.values(app.buildings.userData.parts).flatMap((pt) => pt.doors);
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
    this.closeDoors();
    app.exposureBoost = 1;
    app.renderer.shadowMap.needsUpdate = true;
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
    if (this.pose.y === undefined) this.pose.y = this.world.floorAt(this.pose.x, this.pose.z);
    const target = this.pose.y + WALK.eyeHeight;
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
      this.pose.y = r.y;
    }
    if (this.updateDoors(dt)) changed = true;
    if (this.apply(dt)) changed = true;
    // Внутри постройки — экспозиция выше (глаз адаптируется к помещению).
    const inside = this.world.buildingAt(this.pose.x, this.pose.z);
    const want = inside ? 1.6 : 1;
    const prevBoost = this.app.exposureBoost ?? 1;
    this.app.exposureBoost = prevBoost + (want - prevBoost) * Math.min(1, dt * 3);
    if (Math.abs(this.app.exposureBoost - want) > 0.01) changed = true;
    this.inside = inside;
    this.updateInfo();
    return changed || this.look.id !== null;
  }

  // Двери открываются, когда до середины створки меньше 1,7 м, и закрываются после ухода.
  updateDoors(dt) {
    let moved = false;
    for (const d of this.doors) {
      const st = d.userData.door;
      const mid = d.parent.localToWorld(new THREE.Vector3(st.mid[0], d.position.y, st.mid[1]));
      const near = Math.hypot(mid.x - this.pose.x, mid.z - this.pose.z) < 1.7 && Math.abs(mid.y - (this.pose.y ?? mid.y)) < 1.2;
      const target = this.active && near ? st.max : 0;
      if (Math.abs(st.angle - target) < 1e-3) continue;
      st.angle += Math.sign(target - st.angle) * Math.min(Math.abs(target - st.angle), dt * 2.6);
      d.rotation.y = st.sign * st.angle;
      moved = true;
    }
    if (moved) this.app.renderer.shadowMap.needsUpdate = true;
    return moved;
  }

  closeDoors() {
    for (const d of this.doors) { d.userData.door.angle = 0; d.rotation.y = 0; }
  }

  updateInfo() {
    const text = placeLabel(this.pose.x, this.pose.z, this.pose.y);
    if (this.infoEl.textContent !== text) this.infoEl.textContent = text;
  }

  info() {
    return {
      active: this.active, paused: this.paused, x: this.pose.x, z: this.pose.z, yaw: this.pose.yaw, pitch: this.pose.pitch,
      eyeY: this.camera.position.y, floor: this.pose.y ?? this.world.floorAt(this.pose.x, this.pose.z), place: placeLabel(this.pose.x, this.pose.z, this.pose.y), fov: this.camera.fov, inside: this.inside ?? null,
      doors: this.doors.filter((d) => d.userData.door.angle > 0.5).map((d) => d.userData.door.id),
    };
  }
}
