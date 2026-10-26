// Режим «Прогулка»: ввод (клавиатура, Pointer Lock, перетаскивание взгляда, сенсорный джойстик),
// пауза, взаимодействие с дверями, возврат к прежнему обзору. Коллизии — walk-geometry.js.
import * as THREE from 'three';
import { WalkWorld, WALK, startPose, DOOR_BY_ID } from './walk-geometry.js';
import { ROOM_BY_ID, roomAt, floorYAt } from './plan.js';

const KEYMAP = {
  KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r',
};

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export class WalkMode {
  constructor(app) {
    this.app = app;
    this.camera = new THREE.PerspectiveCamera(WALK.fov, 1, WALK.near, 400);
    this.camera.rotation.order = 'YXZ';
    this.world = new WalkWorld(app.store.get().items, app.doorStates);
    this.active = false;
    this.paused = false;
    this.keys = new Set();
    this.fast = false;
    this.pose = startPose();
    this.joy = { id: null, x: 0, y: 0 };
    this.look = { id: null, x: 0, y: 0, moved: 0, t: 0 };
    this.doorAnims = new Map();
    this.hud = document.getElementById('walk-hud');
    this.infoEl = document.getElementById('walk-info');
    this.pausedEl = document.getElementById('walk-paused');
    this.bind();
  }

  bind() {
    const canvas = this.app.renderer.domElement;
    document.getElementById('walk-pause').addEventListener('click', () => this.setPaused(!this.paused));
    document.getElementById('walk-resume').addEventListener('click', () => this.setPaused(false));
    document.getElementById('walk-door').addEventListener('click', () => this.interact());
    document.getElementById('walk-exit').addEventListener('click', () => this.app.setMode(this.saved?.mode || 'exterior'));
    document.getElementById('walk-finish').addEventListener('click', () => this.app.ui.openDoorsCeiling());
    window.addEventListener('keydown', (e) => {
      if (!this.active || isTyping(e) || this.app.ui.modalOpen) return;
      if (e.code === 'Escape') { this.setPaused(true); return; }
      if (e.code === 'KeyE') { this.interact(); e.preventDefault(); return; }
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
    // Взгляд перетаскиванием (мышь без Pointer Lock и касание), короткое касание — дверь.
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active || this.paused) return;
      if (this.look.id !== null) return;
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
      if (tap && type === 'touch') this.interact();
      else if (tap && type === 'mouse' && document.pointerLockElement !== canvas && this.app.lockAllowed !== false) {
        try { const p = canvas.requestPointerLock?.(); p?.catch?.(() => { this.app.lockAllowed = false; }); } catch { this.app.lockAllowed = false; }
      }
    };
    canvas.addEventListener('pointerup', endLook);
    canvas.addEventListener('pointercancel', (e) => { if (e.pointerId === this.look.id) this.look.id = null; });
    // Сенсорный джойстик.
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

  // Вход: сохраняется прежний обзор; старт у свободной прихожей или в выбранной комнате.
  enter({ room = null, lookUp = false } = {}) {
    const app = this.app;
    this.saved = {
      mode: app.prevModeForWalk || 'exterior',
      position: app.camera.position.clone(),
      target: app.controls.target.clone(),
      activeRoom: app.activeRoom,
      selected: app.editor?.selectedId ?? null,
      surface: app.editor?.selectedSurface ?? null,
    };
    this.world = new WalkWorld(app.store.get().items, app.doorStates);
    let pose = startPose();
    if (room && ROOM_BY_ID[room] && room !== '008') {
      const r = ROOM_BY_ID[room];
      pose = { x: r.center[0], z: r.center[1], yaw: pose.yaw, pitch: 0 };
    }
    const safe = this.world.safeSpot(pose.x, pose.z, room && room !== '008' ? room : null) || this.world.safeSpot(pose.x, pose.z);
    if (safe) { pose.x = safe.x; pose.z = safe.z; }
    if (lookUp) pose.pitch = 0.62;
    this.pose = pose;
    this.active = true;
    this.paused = false;
    this.keys.clear();
    this.hud.hidden = false;
    this.pausedEl.hidden = true;
    const c = app.renderer.domElement;
    this.camera.aspect = c.clientWidth / Math.max(1, c.clientHeight);
    this.camera.updateProjectionMatrix();
    app.controls.enabled = false;
    this.apply();
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
      app.activeRoom = this.saved.activeRoom;
      app.ui?.onRoomChange(app.activeRoom);
      if (this.saved.selected != null) app.editor?.select(this.saved.selected);
      else if (this.saved.surface) app.editor?.selectSurface(this.saved.surface);
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

  onItemsChanged(state) {
    this.world.setItems(state.items);
  }

  // Открыть/закрыть ближайшую дверь (с учётом направления взгляда).
  interact() {
    if (!this.active || this.paused) return;
    const fx = -Math.sin(this.pose.yaw);
    const fz = -Math.cos(this.pose.yaw);
    const door = this.world.nearestDoor(this.pose.x, this.pose.z, fx, fz);
    if (!door) {
      this.flash('Рядом нет двери');
      return;
    }
    const cur = this.world.doorStates[door.id] ?? 0;
    const target = cur > door.max / 2 ? 0 : door.max;
    this.doorAnims.set(door.id, target);
    this.app.invalidate();
  }

  flash(text) {
    this.flashText = text;
    this.flashUntil = performance.now() + 1500;
  }

  apply() {
    const y = floorYAt(this.pose.x, this.pose.z) + WALK.eyeHeight;
    this.camera.position.set(this.pose.x, y, this.pose.z);
    this.camera.rotation.set(this.pose.pitch, this.pose.yaw, 0, 'YXZ');
  }

  update(dt) {
    if (!this.active) return false;
    let changed = false;
    // Анимация дверей вокруг петли — со стопом у человека.
    for (const [id, target] of [...this.doorAnims]) {
      const r = this.world.stepDoor(id, target, dt, this.pose);
      if (r.done) {
        this.doorAnims.delete(id);
        if (r.blocked) this.flash('Отойдите от двери');
      }
      changed = true;
    }
    if (changed) this.app.setDoorStates({ ...this.world.doorStates });
    if (this.paused) { this.updateInfo(); return changed; }
    let mx = 0;
    let mz = 0;
    if (this.keys.has('f')) mz += 1;
    if (this.keys.has('b')) mz -= 1;
    if (this.keys.has('l')) mx -= 1;
    if (this.keys.has('r')) mx += 1;
    mx += this.joy.x;
    mz -= this.joy.y;
    const len = Math.hypot(mx, mz);
    if (len > 0.05) {
      const k = Math.min(1, len) / len; // диагональ нормализуется
      const v = (this.fast ? WALK.fastSpeed : WALK.speed) * dt;
      const fx = -Math.sin(this.pose.yaw);
      const fz = -Math.cos(this.pose.yaw);
      const rx = -fz;
      const rz = fx;
      const dx = (fx * mz + rx * mx) * k * v;
      const dz = (fz * mz + rz * mx) * k * v;
      const r = this.world.move(this.pose, dx, dz);
      this.pose.x = r.x;
      this.pose.z = r.z;
      changed = true;
    }
    this.apply();
    this.updateInfo();
    return changed || this.look.id !== null;
  }

  updateInfo() {
    const room = roomAt(this.pose.x, this.pose.z);
    const fx = -Math.sin(this.pose.yaw);
    const fz = -Math.cos(this.pose.yaw);
    const door = this.world.nearestDoor(this.pose.x, this.pose.z, fx, fz);
    let text = room ? `${room.id} · ${room.name}` : 'Проём';
    if (door) text += ' · E — дверь';
    if (this.flashText && performance.now() < this.flashUntil) text = this.flashText;
    if (this.infoEl.textContent !== text) this.infoEl.textContent = text;
  }

  info() {
    return {
      active: this.active,
      paused: this.paused,
      x: this.pose.x,
      z: this.pose.z,
      yaw: this.pose.yaw,
      pitch: this.pose.pitch,
      eyeY: this.camera.position.y,
      room: roomAt(this.pose.x, this.pose.z)?.id ?? null,
      doors: { ...this.world.doorStates },
      fov: this.camera.fov,
      near: this.camera.near,
    };
  }
}

export { DOOR_BY_ID };
