// Редактор сцены: выбор и перенос мебели, добавление из каталога, телевизор на стене,
// выбор поверхностей и превью материалов. Один жест — один владеющий pointerId.
import * as THREE from 'three';
import { ITEM_TYPES, isWallItem } from './catalog.js';
import { SPEC, ROOM_BY_ID, roomAt, floorYAt, TERRACE_Y } from './plan.js';
import { placeFloorItem, rotateItem, findSpotInRoom } from './placement.js';
import { checkFloorPlacement, checkWallPlacement, wallItemPose, itemObb } from './house-core.js';
import { hitMountFace, wallPoseFromHit, nearestValidWallPose, defaultWallSpot } from './wall-placement.js';
import { Gesture, WheelAccumulator, rayToFloor, grabOffset, isDeleteZone, LIFT_HEIGHT } from './editor-input.js';
import { obbCorners, normAngle } from './geometry.js';
import { nextItemId } from './project-state.js';
import { roomAllowsType } from './catalog.js';
import { surfaceCategory } from './house-scene.js';

const OUTER = [SPEC.house.outer.x0, SPEC.house.outer.z0, SPEC.house.terrace.x1, SPEC.house.outer.z1];

export class Editor {
  constructor(app) {
    this.app = app;
    this.canvas = app.renderer.domElement;
    this.gesture = new Gesture();
    this.wheel = new WheelAccumulator();
    this.raycaster = new THREE.Raycaster();
    this.pointers = new Map();
    this.selectedId = null;
    this.selectedSurface = null;
    this.drag = null;
    this.anims = [];
    this.outline = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x2f7d4a, depthTest: false, transparent: true }));
    this.outline.renderOrder = 20;
    this.outline.visible = false;
    this.outline.userData.excludeAO = true;
    app.scene.add(this.outline);
    this.selBox = new THREE.LineLoop(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x23432f, depthTest: false, transparent: true, opacity: 0.8 }));
    this.selBox.renderOrder = 19;
    this.selBox.visible = false;
    this.selBox.userData.excludeAO = true;
    app.scene.add(this.selBox);
    this.bind();
  }

  get state() {
    return this.app.store.get();
  }

  // ---------- луч ----------
  ray(clientX, clientY) {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.app.activeCamera());
    return this.raycaster.ray;
  }

  pickAt(clientX, clientY) {
    this.ray(clientX, clientY);
    const hits = this.raycaster.intersectObject(this.app.house.root, true).filter((h) => h.object.visible && this.visibleChain(h.object) && !h.object.userData.windowGlow && !h.object.userData.glassPane);
    for (const h of hits) {
      const o = h.object;
      if (o.userData.itemId !== undefined) return { kind: 'item', id: o.userData.itemId, point: h.point };
      if (o.userData.surface || o.userData.pickAs) return { kind: 'surface', slot: o.userData.pickAs || o.userData.surface, point: h.point };
      if (o.userData.slot === 'interiorDoors') return { kind: 'surface', slot: 'interiorDoors', point: h.point };
      return { kind: 'other', point: h.point };
    }
    return null;
  }

  visibleChain(o) {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  overCanvas(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    return el === this.canvas;
  }

  // ---------- события ----------
  bind() {
    const c = this.canvas;
    // Все активные указатели: второй палец в любом месте отменяет редактирование.
    window.addEventListener('pointerdown', (e) => {
      this.pointers.set(e.pointerId, e.pointerType);
      if (this.pointers.size >= 2 && (this.gesture.active || this.drag)) {
        this.cancelGesture('multitouch');
        this.app.controls.enabled = this.app.mode !== 'walk';
      }
    }, { capture: true });
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      if (this.gesture.owns(e.pointerId)) this.cancelGesture('pointercancel');
    });
    c.addEventListener('lostpointercapture', (e) => {
      if (this.gesture.owns(e.pointerId) && this.drag && this.drag.kind !== 'new' && this.drag.kind !== 'swatch') this.cancelGesture('capture');
    });
    window.addEventListener('blur', () => this.cancelGesture('blur'));
    // Колесо при переносе поворачивает предмет и не масштабирует камеру.
    document.getElementById('app').addEventListener('wheel', (e) => {
      if (!this.drag || this.drag.kind === 'swatch') return;
      e.preventDefault();
      e.stopPropagation();
      const t = ITEM_TYPES[this.drag.item.type];
      if (isWallItem(this.drag.item.type) || t.snap === 'back') return;
      const steps = this.wheel.add(e.deltaY, e.deltaMode);
      if (steps) {
        this.drag.ry = normAngle(this.drag.ry + (steps * Math.PI) / 4);
        this.updateDrag(this.drag.lastX, this.drag.lastY);
      }
    }, { capture: true, passive: false });
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (this.app.mode === 'walk' || this.app.ui.modalOpen) return;
      if (e.key === 'Escape') {
        if (this.drag || this.gesture.active) { this.cancelGesture('escape'); e.preventDefault(); return; }
        if (this.selectedId != null || this.selectedSurface) { this.deselect(); e.preventDefault(); }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && this.selectedId != null && !this.drag) { this.deleteSelected(); e.preventDefault(); return; }
      if ((e.key === ',' || e.key === '.' || e.key === 'б' || e.key === 'ю') && this.selectedId != null && !this.drag) {
        this.rotateSelected(e.key === ',' || e.key === 'б' ? 1 : -1);
        e.preventDefault();
      }
    });
  }

  onDown(e) {
    if (this.app.mode === 'walk') return;
    if (this.pointers.size >= 2) {
      // Второй палец: перенос отменяется, управление возвращается камере.
      this.cancelGesture('multitouch');
      this.app.controls.enabled = true;
      return;
    }
    if (e.button !== 0) return;
    this.app.stopCinema();
    const hit = this.pickAt(e.clientX, e.clientY);
    if (hit?.kind === 'item' && this.app.mode !== 'walk') {
      const item = this.state.items.find((i) => i.id === hit.id);
      if (!item) return;
      let grab;
      if (isWallItem(item.type)) {
        const r = this.ray(e.clientX, e.clientY);
        const mh = hitMountFace(r.origin.toArray(), r.direction.toArray(), {});
        grab = mh && mh.wall === item.wall ? { du: item.u - mh.u, dy: item.y - mh.y } : { du: 0, dy: -ITEM_TYPES.tv.h / 2 };
      } else {
        const r = this.ray(e.clientX, e.clientY);
        const fh = rayToFloor(r.origin.toArray(), r.direction.toArray(), floorYAt(item.x, item.z));
        grab = fh ? grabOffset(item, fh) : [0, 0];
      }
      this.gesture.begin(e.pointerId, e.clientX, e.clientY, { kind: 'item', id: item.id, grab });
      this.app.controls.enabled = false;
      this.canvas.setPointerCapture?.(e.pointerId);
    } else {
      this.gesture.begin(e.pointerId, e.clientX, e.clientY, { kind: 'scene', hit });
    }
  }

  onMove(e) {
    if (!this.gesture.owns(e.pointerId)) return;
    const p = this.gesture.payload;
    const res = this.gesture.move(e.pointerId, e.clientX, e.clientY, { requireUpward: p.kind === 'new' && p.pointerType === 'touch' });
    if (res === 'scroll') {
      // Движение вдоль ленты — прокрутка каталога: жест отпускается браузеру.
      this.gesture.reset();
      this.app.controls.enabled = this.app.mode !== 'walk';
      return;
    }
    if (p.kind === 'scene') {
      // Обычное вращение камеры — жест сцены не переносит предметы.
      if (res === 'drag-start') this.gesture.state = 'orbit';
      return;
    }
    if (res === 'drag-start') this.startDrag(p, e);
    if (this.drag) this.updateDrag(e.clientX, e.clientY);
  }

  onUp(e) {
    this.pointers.delete(e.pointerId);
    if (!this.gesture.owns(e.pointerId)) return;
    const p = this.gesture.payload;
    const res = this.gesture.end(e.pointerId);
    this.app.controls.enabled = this.app.mode !== 'walk';
    if (res === 'click') {
      if (p.kind === 'item') this.select(p.id);
      else if (p.kind === 'scene') {
        if (p.hit?.kind === 'surface') this.selectSurface(p.hit.slot);
        else if (p.hit?.kind === 'item') this.select(p.hit.id);
        else this.deselect();
      }
      // Клик по карточке/образцу без переноса обрабатывается событием click.
      return;
    }
    if (res === 'drop' && this.drag) this.finishDrag(e.clientX, e.clientY);
  }

  // ---------- перенос ----------
  startDrag(p, e) {
    if (p.kind === 'item') {
      const item = this.state.items.find((i) => i.id === p.id);
      const obj = this.app.house.itemObjects.get(p.id);
      this.select(p.id, { silent: true });
      this.drag = { kind: 'item', item: { ...item }, original: { ...item }, obj, grab: p.grab, ry: item.ry ?? 0, valid: true, lift: 0, lastX: e.clientX, lastY: e.clientY };
    } else if (p.kind === 'new') {
      const item = { id: nextItemId(this.state), type: p.type, mats: {}, ry: 0, x: 0, z: 0 };
      if (isWallItem(p.type)) Object.assign(item, { wall: null, side: 1, u: 0, y: ITEM_TYPES[p.type].defaultY });
      const obj = this.app.house.buildItemObject(item);
      obj.visible = false;
      this.app.house.root.add(obj);
      this.drag = { kind: 'new', item, obj, grab: isWallItem(p.type) ? { du: 0, dy: -ITEM_TYPES[p.type].h / 2 } : [0, 0], ry: this.defaultRyFor(p.type), valid: false, lift: 0, lastX: e.clientX, lastY: e.clientY };
    } else if (p.kind === 'swatch') {
      this.drag = { kind: 'swatch', materialId: p.materialId, category: p.category, item: null };
    }
    this.wheel.reset();
    this.app.ui.onDragState(this.dragInfo());
  }

  defaultRyFor(type) {
    return type === 'bed' ? 0 : 0;
  }

  updateDrag(clientX, clientY) {
    const d = this.drag;
    if (!d) return;
    d.lastX = clientX;
    d.lastY = clientY;
    if (d.kind === 'swatch') {
      this.updateSwatchDrag(clientX, clientY);
      return;
    }
    const overScene = this.overCanvas(clientX, clientY);
    const items = this.state.items;
    const r = this.ray(clientX, clientY);
    const type = d.item.type;
    d.deleteZone = false;
    if (!overScene) {
      d.valid = false;
      d.reason = 'Над интерфейсом — отпустите над сценой';
      d.hasPos = d.kind === 'item' ? d.hasPos : false;
      this.showDrag();
      return;
    }
    if (isWallItem(type)) {
      const hit = hitMountFace(r.origin.toArray(), r.direction.toArray());
      if (!hit) {
        d.valid = false;
        d.reason = 'Наведите на стену жилого помещения';
        this.showDrag();
        return;
      }
      const pose = wallPoseFromHit(type, hit, d.grab);
      // Небольшой поиск допустимого места рядом с указателем (по стене и высоте).
      const near = nearestValidWallPose(items, { ...d.item, ...pose });
      const res = near.ok ? near : checkWallPlacement(items, { ...d.item, ...pose });
      if (near.ok) Object.assign(pose, { u: near.u, y: near.y });
      Object.assign(d.item, pose);
      d.valid = res.ok;
      d.reason = res.ok ? `Стена помещения ${ROOM_BY_ID[pose.room]?.name ?? ''}` : res.reason;
      d.hasPos = true;
      this.showDrag();
      return;
    }
    const planeY = d.item.room === '008' ? TERRACE_Y : 0;
    const fh = rayToFloor(r.origin.toArray(), r.direction.toArray(), planeY);
    if (!fh) {
      d.valid = false;
      d.reason = 'Луч не попадает на пол';
      this.showDrag();
      return;
    }
    const px = fh[0] + d.grab[0];
    const pz = fh[2] + d.grab[1];
    if (d.kind === 'item' && isDeleteZone(px, pz, OUTER)) {
      d.deleteZone = true;
      d.valid = false;
      d.reason = 'Отпустите, чтобы удалить предмет';
      d.raw = [px, pz];
      d.hasPos = true;
      this.showDrag();
      return;
    }
    const cand = placeFloorItem(items, d.item, px, pz, d.ry);
    d.cand = cand;
    d.raw = [px, pz];
    d.valid = !!cand.ok;
    d.reason = cand.ok ? `${ROOM_BY_ID[cand.room]?.name ?? ''}${cand.docked ? ' · стыковка' : ''}${cand.anchor ? ' · у стены' : ''}` : cand.reason;
    if (cand.ok) {
      d.item.x = cand.x;
      d.item.z = cand.z;
      d.item.ry = cand.ry;
      d.item.room = cand.room;
      if (cand.anchor) d.item.anchor = cand.anchor;
      else delete d.item.anchor;
    } else {
      d.item.x = px;
      d.item.z = pz;
      d.item.ry = cand.ry ?? d.ry;
    }
    d.hasPos = true;
    this.showDrag();
  }

  // Визуальное состояние переноса: подъём 14 см, контур основания, цвет допустимости.
  showDrag() {
    const d = this.drag;
    if (!d || !d.obj) { this.app.ui.onDragState(this.dragInfo()); return; }
    const obj = d.obj;
    const t = ITEM_TYPES[d.item.type];
    if (d.hasPos) {
      obj.visible = true;
      if (isWallItem(d.item.type)) {
        if (d.item.wall) {
          const p = wallItemPose(d.item);
          d.target = new THREE.Vector3(p.x, d.item.y, p.z);
          d.targetRy = p.ry;
        }
      } else {
        const fy = floorYAt(d.item.x, d.item.z);
        d.target = new THREE.Vector3(d.item.x, fy + LIFT_HEIGHT, d.item.z);
        d.targetRy = d.item.ry;
      }
      if (!d.started && d.target) {
        obj.position.copy(d.kind === 'new' ? d.target : obj.position);
        d.started = true;
      }
    }
    // Контур footprint.
    if (!isWallItem(d.item.type) && d.hasPos) {
      const o = itemObb({ ...d.item });
      const fy = floorYAt(d.item.x, d.item.z) + 0.012;
      const pts = obbCorners(o).map(([x, z]) => new THREE.Vector3(x, fy, z));
      this.outline.geometry.dispose();
      this.outline.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      this.outline.material.color.set(d.deleteZone ? 0xb3402f : d.valid ? 0x2f7d4a : 0xc0392b);
      this.outline.visible = true;
    } else {
      this.outline.visible = false;
    }
    void t;
    this.selBox.visible = false;
    this.app.ui.onDragState(this.dragInfo());
    this.app.invalidate();
  }

  finishDrag(clientX, clientY) {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'swatch') { this.finishSwatchDrag(clientX, clientY); return; }
    this.updateDrag(clientX, clientY);
    const store = this.app.store;
    const label = ITEM_TYPES[d.item.type].short;
    if (d.kind === 'item' && d.deleteZone) {
      this.endDragVisuals();
      store.commit((s) => { s.items = s.items.filter((i) => i.id !== d.item.id); }, `Удалён: ${label}`);
      this.selectedId = null;
      this.app.ui.toast(`${label} удалён — вернуть: Ctrl+Z`);
      this.afterSelection();
      return;
    }
    if (d.valid && d.hasPos) {
      const item = this.cleanItem(d.item);
      const obj = d.obj;
      const from = obj.position.clone();
      this.drag = null;
      this.outline.visible = false;
      if (d.kind === 'new') {
        this.app.house.root.remove(obj);
        store.commit((s) => { s.items.push(item); }, `Добавлен: ${label}`);
        this.select(item.id);
      } else {
        store.commit((s) => { const i = s.items.findIndex((q) => q.id === item.id); s.items[i] = item; }, `Перенос: ${label}`);
        this.select(item.id);
      }
      // Мягкое опускание после фиксации (настенный предмет — без анимации).
      const newObj = this.app.house.itemObjects.get(item.id);
      if (newObj && !isWallItem(item.type)) {
        const to = newObj.position.clone();
        newObj.position.copy(from);
        this.anims.push({ obj: newObj, from, to, t: 0, dur: 0.22 });
      }
      this.app.ui.onDragState(null);
      this.app.invalidate();
      return;
    }
    // Недопустимый сброс: прежняя конфигурация, новый предмет не добавляется.
    const reason = d.reason;
    this.cancelGesture('invalid');
    if (reason) this.app.ui.toast(`Не размещено: ${reason}`);
  }

  cleanItem(it) {
    const t = ITEM_TYPES[it.type];
    if (t.mount === 'wall') return { id: it.id, type: it.type, wall: it.wall, side: it.side, u: round(it.u), y: round(it.y), mats: it.mats || {} };
    const out = { id: it.id, type: it.type, x: round(it.x), z: round(it.z), ry: Math.abs(it.ry) < 1e-9 ? 0 : it.ry, room: it.room, mats: it.mats || {} };
    if (it.anchor) out.anchor = { ...it.anchor };
    return out;
  }

  endDragVisuals() {
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'new' && d.obj) this.app.house.root.remove(d.obj);
    if (d.kind === 'item' && d.obj) {
      // Возврат исходной конфигурации.
      this.app.house.placeItemObject(d.obj, d.original);
    }
    this.app.house.clearPreviews();
    this.drag = null;
    this.outline.visible = false;
    this.app.ui.onDragState(null);
    this.updateSelBox();
    this.app.invalidate();
  }

  // Escape, pointercancel, потеря фокуса/захвата, второй палец, смена режима, undo/redo.
  cancelGesture(why) {
    const had = this.gesture.active || !!this.drag;
    this.gesture.cancel();
    if (this.drag) this.endDragVisuals();
    this.app.controls.enabled = this.app.mode !== 'walk';
    return had && why;
  }

  // ---------- каталог ----------
  beginCatalogDrag(type, e) {
    if (this.gesture.active && !this.drag) this.gesture.reset();
    this.gesture.begin(e.pointerId, e.clientX, e.clientY, { kind: 'new', type, pointerType: e.pointerType });
    this.app.controls.enabled = false;
  }

  consumeClickSuppression() {
    return this.gesture.consumeClickSuppression();
  }

  targetRoomFor(type) {
    const prefer = this.app.activeRoom;
    const room = prefer && ROOM_BY_ID[prefer];
    if (room && roomAllowsType(room, type)) return prefer;
    return '005';
  }

  // Клик или Enter по карточке: ровно один предмет в допустимом месте выбранного помещения.
  addByClick(type) {
    const roomId = this.targetRoomFor(type);
    const items = this.state.items;
    const label = ITEM_TYPES[type].short;
    const id = nextItemId(this.state);
    let item;
    if (isWallItem(type)) {
      const spot = defaultWallSpot(items, type, roomId) || defaultWallSpot(items, type, '005');
      if (!spot) { this.app.ui.toast('Нет свободного участка стены для телевизора'); return null; }
      item = { id, type, wall: spot.wall, side: spot.side, u: spot.u, y: spot.y, mats: {} };
    } else {
      const spot = findSpotInRoom(items, type, roomId);
      if (!spot) { this.app.ui.toast(`В помещении «${ROOM_BY_ID[roomId].name}» нет места: ${label}`); return null; }
      item = this.cleanItem({ ...spot, id, type, mats: {} });
    }
    this.app.store.commit((s) => { s.items.push(item); }, `Добавлен: ${label}`);
    this.select(id);
    if (isWallItem(type)) this.showWallItem(item);
    return item;
  }

  // Камера показывает установленный телевизор.
  showWallItem(item) {
    const p = wallItemPose(item);
    const nx = Math.sin(p.ry);
    const nz = Math.cos(p.ry);
    const cy = item.y + ITEM_TYPES[item.type].h / 2;
    if (this.app.mode !== 'interior') this.app.setMode('interior');
    this.app.flyTo([p.x + nx * 4.2, cy + 3.2, p.z + nz * 4.2], [p.x, cy - 0.2, p.z], 1000);
    setTimeout(() => this.app.updateCut(), 1050);
  }

  // ---------- выбор ----------
  select(id, { silent = false } = {}) {
    this.selectedId = id;
    this.selectedSurface = null;
    this.updateSelBox();
    if (!silent) this.afterSelection();
  }

  selectSurface(slot) {
    this.selectedId = null;
    this.selectedSurface = slot;
    this.updateSelBox();
    this.afterSelection();
  }

  deselect() {
    this.selectedId = null;
    this.selectedSurface = null;
    this.updateSelBox();
    this.afterSelection();
  }

  afterSelection() {
    this.app.ui.onSelection(this.selectedId, this.selectedSurface);
    this.app.invalidate();
  }

  updateSelBox() {
    const it = this.state.items.find((i) => i.id === this.selectedId);
    if (!it || isWallItem(it.type)) { this.selBox.visible = false; return; }
    const fy = floorYAt(it.x, it.z) + 0.01;
    const pts = obbCorners(itemObb(it)).map(([x, z]) => new THREE.Vector3(x, fy, z));
    this.selBox.geometry.dispose();
    this.selBox.geometry = new THREE.BufferGeometry().setFromPoints(pts);
    this.selBox.visible = true;
  }

  rotateSelected(dir) {
    const it = this.state.items.find((i) => i.id === this.selectedId);
    if (!it) return;
    if (isWallItem(it.type)) { this.app.ui.toast('Настенный предмет следует плоскости стены'); return; }
    const r = rotateItem(this.state.items, it, dir);
    if (!r) { this.app.ui.toast('Поворот здесь невозможен — не хватает места'); return; }
    const item = this.cleanItem({ ...it, ...r });
    this.app.store.commit((s) => { const i = s.items.findIndex((q) => q.id === it.id); s.items[i] = item; }, `Поворот: ${ITEM_TYPES[it.type].short}`);
    this.updateSelBox();
  }

  deleteSelected() {
    const it = this.state.items.find((i) => i.id === this.selectedId);
    if (!it) return;
    this.app.store.commit((s) => { s.items = s.items.filter((i) => i.id !== it.id); }, `Удалён: ${ITEM_TYPES[it.type].short}`);
    this.selectedId = null;
    this.updateSelBox();
    this.afterSelection();
    this.app.ui.toast(`${ITEM_TYPES[it.type].short} удалён — вернуть: Ctrl+Z`);
  }

  // ---------- материалы ----------
  beginSwatchDrag(materialId, category, e) {
    this.gesture.begin(e.pointerId, e.clientX, e.clientY, { kind: 'swatch', materialId, category, pointerType: e.pointerType });
  }

  updateSwatchDrag(clientX, clientY) {
    const d = this.drag;
    this.app.house.clearPreviews();
    d.targetSlot = null;
    if (!this.overCanvas(clientX, clientY)) { this.app.ui.onDragState(this.dragInfo()); return; }
    const hit = this.pickAt(clientX, clientY);
    if (hit?.kind === 'surface' && surfaceCategory(hit.slot) === d.category) {
      d.targetSlot = hit.slot;
      this.app.ui.previewMaterial(hit.slot, d.materialId);
    }
    this.app.ui.onDragState(this.dragInfo());
  }

  finishSwatchDrag() {
    const d = this.drag;
    this.drag = null;
    this.app.house.clearPreviews();
    if (d?.targetSlot) this.app.ui.applyMaterial(d.targetSlot, d.materialId);
    this.app.ui.onDragState(null);
  }

  // ---------- кадр ----------
  update(dt) {
    let active = false;
    const d = this.drag;
    if (d && d.obj && d.target) {
      // Плавное следование за указателем.
      const k = 1 - Math.exp(-dt * 18);
      d.obj.position.lerp(d.target, k);
      let dr = normAngle(d.targetRy - d.obj.rotation.y);
      d.obj.rotation.y += dr * k;
      active = d.obj.position.distanceTo(d.target) > 0.0005 || Math.abs(dr) > 0.001;
    }
    for (const a of this.anims) {
      a.t += dt;
      const k = Math.min(1, a.t / a.dur);
      const e = 1 - (1 - k) ** 3;
      a.obj.position.lerpVectors(a.from, a.to, e);
      active = true;
    }
    this.anims = this.anims.filter((a) => a.t < a.dur);
    return active;
  }

  onStateChange(state, event) {
    if (event?.kind === 'undo' || event?.kind === 'redo') this.cancelGesture('history');
    if (this.selectedId != null && !state.items.some((i) => i.id === this.selectedId)) this.selectedId = null;
    this.updateSelBox();
  }

  dragInfo() {
    const d = this.drag;
    if (!d) return null;
    return {
      kind: d.kind,
      itemId: d.item?.id ?? null,
      type: d.item?.type ?? null,
      x: d.item?.x,
      z: d.item?.z,
      ry: d.item?.ry,
      wall: d.item?.wall,
      u: d.item?.u,
      y: d.item?.y,
      valid: !!d.valid,
      reason: d.reason || '',
      deleteZone: !!d.deleteZone,
      lifted: d.obj ? d.obj.position.y - floorYAt(d.obj.position.x, d.obj.position.z) : 0,
      targetSlot: d.targetSlot || null,
      materialId: d.materialId || null,
    };
  }
}

function round(v) {
  return Math.round(v * 10000) / 10000;
}
