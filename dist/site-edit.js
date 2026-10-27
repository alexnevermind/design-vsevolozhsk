// Перестановка мебели в режиме «Внутри»: нажать на предмет и тянуть по полу (в пределах помещения),
// колесо при переносе или кнопки — поворот на 45°/90°, «На место» — исходная расстановка по листу.
// Положения хранятся в состоянии участка: items['постройка:id'] = [x, z, поворот°] (локальные метры).
import * as THREE from 'three';
import { SRC } from './site-data.js';
import { pointInPolygon } from './geometry.js';

const DEG = Math.PI / 180;
const mm = (v) => v / 1000;

// Контуры помещений в локальных метрах постройки: id → { poly, level }.
export function roomPolygons() {
  const out = {};
  for (const r of SRC.guest.rooms) {
    const poly = r.rect ? [[r.rect[0], r.rect[1]], [r.rect[2], r.rect[1]], [r.rect[2], r.rect[3]], [r.rect[0], r.rect[3]]] : r.polygon;
    out[`guest:${r.id}`] = { poly: poly.map(([x, z]) => [mm(x), mm(z)]), level: r.level === 2 ? 1 : 0, name: r.name, area: r.area };
  }
  const K = SRC.grill;
  const ri = mm(K.hexagon.innerFace) / Math.cos(30 * DEG);
  out['grill:K01'] = { poly: [0, 1, 2, 3, 4, 5].map((k) => [ri * Math.cos((-90 + 60 * k) * DEG), ri * Math.sin((-90 + 60 * k) * DEG)]), level: 0, name: K.rooms[0].name, area: K.rooms[0].area };
  const sh = SRC.garage.shed;
  const t = mm(sh.wall);
  const [x0, z0, x1, z1] = sh.rect.map(mm);
  out['garage:H01'] = { poly: [[x0 + t, z0 + t], [x1 - t, z0 + t], [x1 - t, z1 - t], [x0 + t, z1 - t]], level: 0, name: sh.name, area: sh.area };
  return out;
}
export const ROOMS = roomPolygons();

// Допустимое положение: все четыре угла повёрнутого габарита (с допуском 2 см) внутри помещения.
// Поворот — как у группы three.js вокруг Y: локальные (x, z) → (x·cos + z·sin, −x·sin + z·cos).
export function fitsRoom(item, x, z, rot) {
  const room = ROOMS[`${item.building}:${item.room}`];
  if (!room) return true;
  const c = Math.cos(rot * DEG), s = Math.sin(rot * DEG);
  const hw = item.w / 2 - 0.02, hd = item.d / 2 - 0.02;
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].every(([sx, sz]) => {
    const lx = sx * hw, lz = sz * hd;
    return pointInPolygon(x + lx * c + lz * s, z - lx * s + lz * c, room.poly);
  });
}

export class FurnitureEditor {
  constructor(app) {
    this.app = app;
    this.selected = null;
    this.drag = null;
    this.ray = new THREE.Raycaster();
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.4, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x2f6b4f, transparent: true, opacity: 0.85, depthTest: false }));
    this.ring.renderOrder = 12;
    this.ring.visible = false;
    this.ring.userData.excludeAO = true;
    app.scene.add(this.ring);
    const canvas = app.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => this.down(e), { capture: true });
    canvas.addEventListener('pointermove', (e) => this.move(e));
    canvas.addEventListener('pointerup', (e) => this.up(e));
    canvas.addEventListener('pointercancel', (e) => this.up(e, true));
    canvas.addEventListener('wheel', (e) => {
      if (!this.drag) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.rotate(e.deltaY > 0 ? 45 : -45, false);
    }, { capture: true, passive: false });
  }

  get active() {
    return this.app.mode === 'interior';
  }

  items() {
    const bid = this.app.interior?.bid;
    return this.app.furniture.filter((h) => h.userData.item.building === bid && (h.userData.item.yLevel > 1 ? 1 : 0) === (this.app.interior?.level ?? 0));
  }

  pick(e) {
    const r = this.app.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.app.camera);
    const list = this.items();
    // Тени-заменители разреза — только в слое 1, луч их не видит (слой 0).
    const hits = this.ray.intersectObjects(list, true).filter((h) => h.object.visible);
    for (const h of hits) {
      let o = h.object;
      while (o && !o.userData.item) o = o.parent;
      if (o) return { holder: o, point: h.point };
    }
    return null;
  }

  down(e) {
    if (!this.active || e.button > 0) return;
    const hit = this.pick(e);
    if (!hit) { this.select(null); return; }
    e.stopImmediatePropagation();
    this.select(hit.holder);
    const it = hit.holder.userData.item;
    if (it.fixed) { this.app.ui?.toast(`${it.label}: встроено, не переставляется`); return; }
    const group = hit.holder.parent;
    const local = group.worldToLocal(hit.point.clone());
    this.drag = { id: e.pointerId, holder: hit.holder, dx: hit.holder.position.x - local.x, dz: hit.holder.position.z - local.z, start: [hit.holder.position.x, hit.holder.position.z, hit.holder.rotation.y / DEG], moved: false };
    this.app.controls.enabled = false;
    this.app.renderer.domElement.setPointerCapture?.(e.pointerId);
  }

  move(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const holder = d.holder;
    const group = holder.parent;
    const r = this.app.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.app.camera);
    // Плоскость пола этажа предмета (в мировых координатах).
    const floorW = group.localToWorld(new THREE.Vector3(holder.position.x, holder.userData.item.yLevel, holder.position.z));
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -floorW.y);
    const p = this.ray.ray.intersectPlane(plane, new THREE.Vector3());
    if (!p) return;
    const l = group.worldToLocal(p);
    const x = l.x + d.dx, z = l.z + d.dz;
    const rot = holder.rotation.y / DEG;
    const it = holder.userData.item;
    if (fitsRoom(it, x, z, rot)) {
      holder.position.x = x;
      holder.position.z = z;
    } else if (fitsRoom(it, x, holder.position.z, rot)) holder.position.x = x;
    else if (fitsRoom(it, holder.position.x, z, rot)) holder.position.z = z;
    d.moved = true;
    this.placeRing();
    this.app.invalidate();
  }

  up(e, cancel = false) {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    this.app.controls.enabled = true;
    if (cancel) {
      d.holder.position.x = d.start[0];
      d.holder.position.z = d.start[1];
      this.app.invalidate();
      return;
    }
    if (d.moved) this.commit(d.holder, 'Перенос');
  }

  // Поворот выбранного предмета (шаг в градусах); при недопустимом положении — отказ.
  rotate(step, commit = true) {
    const h = this.drag?.holder ?? this.selected;
    if (!h) return false;
    const it = h.userData.item;
    if (it.fixed) return false;
    const rot = Math.round((h.rotation.y / DEG + step) / 15) * 15;
    if (!fitsRoom(it, h.position.x, h.position.z, rot)) { this.app.ui?.toast('Не помещается при повороте'); return false; }
    h.rotation.y = rot * DEG;
    this.placeRing();
    this.app.invalidate();
    if (commit) this.commit(h, 'Поворот');
    return true;
  }

  reset() {
    const h = this.selected;
    if (!h) return;
    const key = `${h.userData.item.building}:${h.userData.item.id}`;
    this.app.store.commit((s) => { delete s.items[key]; }, `${h.userData.item.label}: на место`);
  }

  commit(h, label) {
    const it = h.userData.item;
    const key = `${it.building}:${it.id}`;
    const v = [Math.round(h.position.x * 1000) / 1000, Math.round(h.position.z * 1000) / 1000, Math.round(h.rotation.y / DEG)];
    this.app.store.commit((s) => { s.items[key] = v; }, `${label}: ${it.label}`);
  }

  select(h) {
    this.selected = h;
    this.placeRing();
    this.app.ui?.onItemSelect?.(h ? h.userData.item : null);
    this.app.invalidate();
  }

  placeRing() {
    const h = this.selected;
    this.ring.visible = !!h && this.active;
    if (!h) return;
    const it = h.userData.item;
    const r = Math.max(it.w, it.d) / 2 + 0.08;
    this.ring.scale.setScalar(r / 0.4);
    const p = h.parent.localToWorld(new THREE.Vector3(h.position.x, it.yLevel + 0.02, h.position.z));
    this.ring.position.copy(p);
  }

  // Положения из состояния: переопределение или исходная расстановка.
  applyState(state) {
    for (const h of this.app.furniture) {
      const it = h.userData.item;
      const v = state.items?.[`${it.building}:${it.id}`];
      const [x, z, rot] = v ?? it.base;
      h.position.x = x;
      h.position.z = z;
      h.rotation.y = rot * DEG;
    }
    this.placeRing();
  }
}
