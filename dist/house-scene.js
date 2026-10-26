// Сборка сцены дома по состоянию проекта: архитектура, отделка, двери, кровля, мебель.
// Пересборка только изменившихся частей; устаревшая геометрия освобождается, общие материалы сохраняются.
import * as THREE from 'three';
import { ITEM_TYPES, isWallItem } from './catalog.js';
import { MATERIALS, hexOf } from './choices.js';
import { SPEC, ROOMS, WALL_BY_ID, WALLS } from './plan.js';
import { buildWalls, buildWoodFloor, buildTileFloor, buildBaseboards } from './house-geometry.js';
import { buildCeilings } from './house-ceiling.js';
import { buildRoofBase, buildStandingSeam, buildMetalTile, buildRoofVents } from './roof-covering.js';
import { buildGutters } from './gutters.js';
import { buildCurtains } from './curtains.js';
import { buildWindows, buildGlazing, buildEntryDoor, buildTerrace, buildSkirt, buildGableBand, buildWallLamps, buildThresholds, poseHingedLeaf } from './exterior.js';
import { buildInteriorDoors, poseDoor } from './interior-door.js';
import { buildFurniture } from './furniture-detail.js';
import { buildFixture, buildBuiltins, loadWcModel } from './fixtures.js';
import { buildShadowShell } from './building-envelope.js';
import { wallItemPose } from './house-core.js';
import { DOOR_BY_ID } from './walk-geometry.js';

const SURFACE_LABELS = {
  'facade:north': 'Фасад · северная сторона',
  'facade:south': 'Фасад · южная сторона',
  'facade:east': 'Фасад · торец у террасы',
  'facade:west': 'Фасад · западный торец',
  loggia: 'Облицовка навеса террасы',
  ceiling: 'Потолок',
  interiorDoors: 'Межкомнатные двери',
};

export function surfaceLabel(slot) {
  if (SURFACE_LABELS[slot]) return SURFACE_LABELS[slot];
  const [kind, id] = slot.split(':');
  const room = ROOMS.find((r) => r.id === id);
  if (kind === 'wall') return `Стены · ${room?.name ?? id}`;
  if (kind === 'floor') {
    if (SPEC.floorGroups.wet.includes(id)) return 'Пол мокрой зоны (санузел и парная)';
    if (id === '008') return 'Настил террасы и ступеней';
    return 'Пол дома (общий)';
  }
  return slot;
}

// Категория палитры для слота поверхности.
export function surfaceCategory(slot) {
  if (slot.startsWith('facade:') || slot === 'loggia') return 'facade';
  if (slot.startsWith('wall:')) return 'wall';
  if (slot === 'ceiling') return 'ceiling';
  if (slot === 'interiorDoors') return 'doors';
  if (slot.startsWith('floor:')) {
    const id = slot.slice(6);
    if (SPEC.floorGroups.wet.includes(id)) return 'floorWet';
    if (id === '008') return 'terrace';
    return 'floorWood';
  }
  return null;
}

// Материалы с цветами вершин на геометрии без атрибута color получают нейтральный белый цвет вершин.
export function ensureVertexColors(o) {
  const g = o.geometry;
  if (!o.material?.vertexColors || !g || g.getAttribute('color')) return;
  const n = g.getAttribute('position').count;
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
}

function disposeObject(o) {
  o.traverse((c) => {
    if (c.isMesh && c.geometry && !c.userData.sharedGeometry) c.geometry.dispose();
  });
}

export class HouseScene {
  constructor(lib, scene, invalidate) {
    this.lib = lib;
    this.scene = scene;
    this.invalidate = invalidate;
    this.root = new THREE.Group();
    this.root.name = 'house';
    scene.add(this.root);
    this.parts = {};
    this.itemObjects = new Map();
    this.state = null;
    this.cutFor = () => null;
    this.keepZones = [];
    this.doorStates = {};
    this.previews = new Map();
    this.mode = 'exterior';
    this.ensureColorsAfter = [];
    loadWcModel(() => {
      if (this.state) {
        for (const [id, obj] of this.itemObjects) if (obj.userData.needsWc) this.rebuildItem(id);
        this.invalidate();
      }
    });
  }

  // ---------- материалы слотов ----------
  slotMaterial(slot, state = this.state) {
    const lib = this.lib;
    const m = state.mats;
    if (this.previews.has(slot)) return this.previews.get(slot);
    if (slot.startsWith('wall:')) return lib.paintedWood(hexOf(m[slot] || m['wall:005']));
    if (slot.startsWith('facade:')) return lib.paintedWood(hexOf(m[slot]), { facade: true });
    if (slot === 'loggia' || slot === 'soffit') return lib.paintedWood(hexOf(state.cladding.loggia), { facade: true });
    if (slot === 'sauna') return lib.naturalWood();
    if (slot === 'section') return lib.section();
    if (slot === 'ceiling') return state.ceilingType === 'stretch' ? lib.stretchCeiling(hexOf(m.ceiling)) : lib.paintedWood(hexOf(m.ceiling));
    if (slot === 'interiorDoors') return lib.doorPaint(m.interiorDoors);
    if (slot.startsWith('floor:')) {
      const id = slot.slice(6);
      if (SPEC.floorGroups.wet.includes(id)) return lib.stone(m[slot]);
      if (id === '008') return lib.deckWood(m[slot]);
      return lib.floorWood(m[slot]);
    }
    return lib.section();
  }

  itemSlotMaterial(slot, item, state = this.state) {
    const lib = this.lib;
    const pick = (k) => item?.mats?.[k] || state.mats[k];
    if (this.previews.has(`item:${slot}`)) return this.previews.get(`item:${slot}`);
    switch (slot) {
      case 'joinery': return lib.furnitureWood(pick('joinery'));
      case 'upholstery': return lib.fabric(pick('upholstery'));
      case 'accent': return lib.fabric(pick('accent'));
      case 'bedding': return lib.fabric(pick('bedding'));
      case 'counter': {
        const c = pick('counter');
        return MATERIALS[c]?.family === 'wood' ? lib.furnitureWood(c) : lib.stone(c);
      }
      case 'metal': return lib.brushed();
      case 'ceramic': return lib.ceramic();
      default: return lib.section();
    }
  }

  // Применение материалов ко всем мешам слотов (без пересборки геометрии).
  applyMaterials() {
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      this.ensureColorsAfter.push(o);
      if (o.userData.surface) o.material = this.slotMaterial(o.userData.surface);
      else if (o.userData.slot && o.userData.itemId !== undefined) {
        const item = this.state.items.find((i) => i.id === o.userData.itemId);
        o.material = o.userData.slot === 'interiorDoors' ? this.slotMaterial('interiorDoors') : this.itemSlotMaterial(o.userData.slot, item);
      } else if (o.userData.slot === 'interiorDoors') o.material = this.slotMaterial('interiorDoors');
      else if (o.userData.slot && o.userData.builtin) o.material = this.itemSlotMaterial(o.userData.slot, null);
    });
    for (const o of this.ensureColorsAfter) ensureVertexColors(o);
    this.ensureColorsAfter.length = 0;
    this.invalidate();
  }

  // Временное превью: только отображение, сохранённое состояние не меняется.
  setPreview(slot, material) {
    if (material) this.previews.set(slot, material);
    else this.previews.delete(slot);
    this.applyMaterials();
  }

  clearPreviews() {
    if (this.previews.size === 0) return;
    this.previews.clear();
    this.applyMaterials();
  }

  // ---------- построение ----------
  surfaceMesh(geo, slot, { castShadow = true, receiveShadow = true, name } = {}) {
    const m = new THREE.Mesh(geo, this.slotMaterial(slot));
    m.userData.surface = slot;
    m.castShadow = castShadow;
    m.receiveShadow = receiveShadow;
    m.name = name || slot;
    return m;
  }

  replacePart(key, obj) {
    const old = this.parts[key];
    if (old) {
      this.root.remove(old);
      disposeObject(old);
    }
    this.parts[key] = obj;
    if (obj) this.root.add(obj);
  }

  buildWallsPart() {
    const { groups } = buildWalls({ wallLayout: this.state.wallLayout, cutFor: this.cutFor, keepZones: this.keepZones });
    const g = new THREE.Group();
    g.name = 'walls';
    for (const [slot, builder] of groups) {
      const m = this.surfaceMesh(builder.build(), slot);
      m.castShadow = !this.cutActive;
      g.add(m);
    }
    this.replacePart('walls', g);
    this.applyVisibility();
  }

  buildFloorsPart() {
    const g = new THREE.Group();
    g.name = 'floors';
    for (const r of ROOMS) {
      if (r.kind === 'terrace') continue;
      if (SPEC.floorGroups.wet.includes(r.id)) {
        const { tiles, grout } = buildTileFloor(r);
        g.add(this.surfaceMesh(tiles, `floor:${r.id}`, { castShadow: false }));
        const gm = new THREE.Mesh(grout, this.lib.grout());
        gm.receiveShadow = true;
        gm.userData.pickAs = `floor:${r.id}`;
        g.add(gm);
      } else {
        const { boards, subfloor } = buildWoodFloor(r);
        g.add(this.surfaceMesh(boards, `floor:${r.id}`, { castShadow: false }));
        const sm = new THREE.Mesh(subfloor, this.lib.subfloor());
        sm.userData.pickAs = `floor:${r.id}`;
        g.add(sm);
      }
      if (r.kind !== 'sauna') {
        const bb = buildBaseboards(r.id);
        if (bb) {
          const m = this.surfaceMesh(bb, `wall:${r.id}`, { castShadow: false });
          m.userData.baseboard = true;
          g.add(m);
        }
      }
    }
    this.replacePart('floors', g);
  }

  buildCeilingPart() {
    const { ceiling, sauna, soffit } = buildCeilings(this.state.ceilingType);
    const g = new THREE.Group();
    g.name = 'ceilings';
    g.add(this.surfaceMesh(ceiling, 'ceiling', { castShadow: false }));
    g.add(this.surfaceMesh(sauna, 'sauna', { castShadow: false }));
    const s = this.surfaceMesh(soffit, 'loggia', { castShadow: false });
    s.userData.soffit = true;
    g.add(s);
    this.replacePart('ceilings', g);
    this.applyVisibility();
  }

  buildRoofPart() {
    const g = new THREE.Group();
    g.name = 'roof';
    const metal = this.lib.paintedMetal('#2c2d2f', { key: 'roof' });
    const base = new THREE.Mesh(buildRoofBase(), metal);
    base.castShadow = true;
    base.receiveShadow = true;
    base.userData.roof = 'base';
    g.add(base);
    const cover = new THREE.Mesh(this.state.roofType === 'metalTile' ? buildMetalTile() : buildStandingSeam(), metal);
    cover.castShadow = true;
    cover.receiveShadow = true;
    cover.userData.roof = this.state.roofType;
    g.add(cover);
    const vents = new THREE.Mesh(buildRoofVents(), metal);
    vents.castShadow = true;
    g.add(vents);
    const gutters = new THREE.Mesh(buildGutters(), metal);
    gutters.castShadow = true;
    gutters.receiveShadow = true;
    gutters.name = 'gutters';
    g.add(gutters);
    g.userData.roofType = this.state.roofType;
    this.replacePart('roof', g);
    this.applyVisibility();
  }

  buildStatic() {
    const lib = this.lib;
    // Окна.
    const win = buildWindows(lib);
    const wg = new THREE.Group();
    wg.name = 'windows';
    const frameMat = lib.paintedMetal('#26282a', { key: 'frames' });
    const add = (geo, mat, opts = {}) => {
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = opts.cast ?? true;
      m.receiveShadow = true;
      Object.assign(m.userData, opts.data || {});
      wg.add(m);
      return m;
    };
    add(win.frame, frameMat);
    add(win.seal, lib.rubber(), { cast: false });
    add(win.sill, lib.plain('sillBoard', { color: new THREE.Color().setStyle('#ebe7df', THREE.SRGBColorSpace), roughness: 0.55, clearcoat: 0.2 }, { interior: true }));
    add(win.flashing, frameMat);
    add(win.glass, lib.glass('clear'), { cast: false, data: { excludeAO: true, glassPane: true } });
    const glow = add(win.glow, lib.windowGlow(), { cast: false, data: { excludeAO: true, windowGlow: true } });
    glow.renderOrder = 2;
    this.replacePart('windows', wg);
    this.glazing = buildGlazing(lib);
    this.replacePart('glazing', this.glazing);
    this.entryDoor = buildEntryDoor(lib);
    this.replacePart('entry', this.entryDoor);
    // Межкомнатные двери.
    const dg = new THREE.Group();
    dg.name = 'interior-doors';
    this.interiorDoors = buildInteriorDoors(lib);
    for (const d of this.interiorDoors) dg.add(d);
    this.replacePart('doors', dg);
    // Терраса, обвязка, фронтон, светильники, встроенное.
    const t = buildTerrace();
    const tg = new THREE.Group();
    tg.name = 'terrace';
    tg.add(this.surfaceMesh(t.deck, 'floor:008'));
    const darkBoard = lib.paintedWood('#2b2b2c', { facade: true });
    const fascia = new THREE.Mesh(t.fascia, darkBoard);
    fascia.castShadow = true;
    fascia.receiveShadow = true;
    tg.add(fascia);
    const piles = new THREE.Mesh(t.piles, lib.concrete());
    piles.castShadow = true;
    tg.add(piles);
    this.replacePart('terrace', tg);
    const skirt = new THREE.Mesh(buildSkirt(), darkBoard);
    skirt.castShadow = true;
    skirt.receiveShadow = true;
    skirt.name = 'skirt';
    this.replacePart('skirt', skirt);
    const band = this.surfaceMesh(buildGableBand(), 'loggia');
    this.replacePart('gable', band);
    this.lamps = buildWallLamps(lib);
    this.replacePart('lamps', this.lamps);
    this.replacePart('thresholds', buildThresholds(lib));
    this.replacePart('curtains', buildCurtains(lib));
    const builtins = buildBuiltins(lib);
    builtins.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.userData.slot) o.userData.builtin = true; } });
    this.replacePart('builtins', builtins);
    this.shell = buildShadowShell();
    this.replacePart('shell', this.shell);
  }

  // ---------- предметы ----------
  buildItemObject(item) {
    const type = item.type;
    const obj = buildFurniture(type, this.lib) || buildFixture(type, this.lib) || new THREE.Group();
    obj.userData.itemId = item.id;
    obj.userData.itemType = type;
    obj.traverse((o) => {
      if (o.isMesh) {
        o.userData.itemId = item.id;
        if (o.userData.slot) o.material = this.itemSlotMaterial(o.userData.slot, item);
        if (!o.material) o.material = this.lib.section();
        ensureVertexColors(o);
      }
    });
    if (obj.children.some((c) => c.userData?.needsWc) || obj.userData.needsWc) obj.userData.needsWc = true;
    return obj;
  }

  placeItemObject(obj, item) {
    if (isWallItem(item.type)) {
      const p = wallItemPose(item);
      obj.position.set(p.x, item.y, p.z);
      obj.rotation.set(0, p.ry, 0);
    } else {
      obj.position.set(item.x, item.room === '008' ? SPEC.terrace.topY : 0, item.z);
      obj.rotation.set(0, item.ry, 0);
    }
  }

  rebuildItem(id) {
    const item = this.state.items.find((i) => i.id === id);
    const old = this.itemObjects.get(id);
    if (old) { this.itemsGroup.remove(old); }
    if (!item) { this.itemObjects.delete(id); return; }
    const obj = this.buildItemObject(item);
    this.placeItemObject(obj, item);
    this.itemsGroup.add(obj);
    this.itemObjects.set(id, obj);
    this.applyMountedVisibility(obj);
  }

  syncItems(prev) {
    if (!this.itemsGroup) {
      this.itemsGroup = new THREE.Group();
      this.itemsGroup.name = 'items';
      this.root.add(this.itemsGroup);
    }
    const ids = new Set(this.state.items.map((i) => i.id));
    for (const [id, obj] of this.itemObjects) {
      if (!ids.has(id)) {
        this.itemsGroup.remove(obj);
        this.itemObjects.delete(id);
      }
    }
    const prevById = new Map((prev?.items || []).map((i) => [i.id, i]));
    for (const item of this.state.items) {
      const obj = this.itemObjects.get(item.id);
      const before = prevById.get(item.id);
      if (!obj || !before || before.type !== item.type || JSON.stringify(before.mats) !== JSON.stringify(item.mats)) this.rebuildItem(item.id);
      else this.placeItemObject(obj, item);
    }
  }

  // Участки стен, сохраняемые при разрезе (по заданию): сплошная стена за кухней и основание за ТВ.
  // Остальные навесные детали (зеркальный шкаф, душ, клавиша смыва, вешалка) при разрезе скрываются.
  computeKeepZones() {
    const zones = [];
    for (const it of this.state.items) {
      const t = ITEM_TYPES[it.type];
      if (isWallItem(it.type)) {
        zones.push({ wall: it.wall, room: it.room, u0: it.u - t.w / 2 - 0.02, u1: it.u + t.w / 2 + 0.02 });
        continue;
      }
      if (t.dock !== 'kitchen' || !it.anchor) continue;
      const anchor = WALL_BY_ID[it.anchor.wall];
      // Проекция footprint на все соосные стены линии привязки.
      const half = t.w / 2;
      for (const w of WALLS) {
        if (w.horizontal !== anchor.horizontal) continue;
        const sameLine = anchor.horizontal ? Math.abs(w.a[1] - anchor.a[1]) < 1e-6 : Math.abs(w.a[0] - anchor.a[0]) < 1e-6;
        if (!sameLine) continue;
        const c = (it.x - w.a[0]) * anchor.ux + (it.z - w.a[1]) * anchor.uz;
        const u0 = Math.max(0, c - half - 0.01);
        const u1 = Math.min(w.len, c + half + 0.01);
        if (u1 > u0) zones.push({ wall: w.id, room: it.room, u0, u1 });
      }
    }
    return zones;
  }

  // Навесные детали выше разреза и фасадные светильники скрыты, пока стены срезаны в редакторе.
  applyMountedVisibility(root = null) {
    const hide = !!this.cutActive && this.mode === 'interior';
    const roots = root ? [root] : [...this.itemObjects.values(), this.parts.builtins, this.parts.curtains];
    for (const r of roots) r?.traverse((o) => { if (o.isMesh && o.userData.wallMounted) o.visible = !hide; });
    if (!root && this.parts.lamps) this.parts.lamps.visible = !hide;
  }

  // Контур выбранного помещения на полу (редактор «Внутри»).
  setRoomHighlight(roomId) {
    if (this.highlight) {
      this.root.remove(this.highlight);
      this.highlight.geometry.dispose();
      this.highlight = null;
    }
    const room = roomId && ROOMS.find((r) => r.id === roomId);
    if (!room) { this.invalidate(); return; }
    const poly = room.polygon;
    const w = 0.05;
    const pos = [];
    const idx = [];
    // Лента шириной 5 см внутри контура: смещение каждой вершины по биссектрисе.
    const n = poly.length;
    for (let i = 0; i < n; i++) {
      const p = poly[i];
      const a = poly[(i + n - 1) % n];
      const b = poly[(i + 1) % n];
      const e1 = [p[0] - a[0], p[1] - a[1]];
      const e2 = [b[0] - p[0], b[1] - p[1]];
      const l1 = Math.hypot(...e1);
      const l2 = Math.hypot(...e2);
      // Внутренняя нормаль для обхода по часовой стрелке (z вниз): [-dz, dx].
      const n1 = [-e1[1] / l1, e1[0] / l1];
      const n2 = [-e2[1] / l2, e2[0] / l2];
      const bis = [n1[0] + n2[0], n1[1] + n2[1]];
      const bl = Math.hypot(...bis) || 1;
      const k = w / Math.max(0.3, (bis[0] * n1[0] + bis[1] * n1[1]) / bl);
      pos.push(p[0], 0.006, p[1], p[0] + (bis[0] / bl) * k, 0.006, p[1] + (bis[1] / bl) * k);
      const j = (i + 1) % n;
      idx.push(i * 2, j * 2, i * 2 + 1, j * 2, j * 2 + 1, i * 2 + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({ color: new THREE.Color().setStyle('#3d7a5a', THREE.SRGBColorSpace), transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.highlight = new THREE.Mesh(g, m);
    this.highlight.name = 'roomHighlight';
    this.highlight.userData.excludeAO = true;
    this.highlight.renderOrder = 2;
    this.highlight.visible = this.mode === 'interior';
    this.root.add(this.highlight);
    this.invalidate();
  }

  // ---------- синхронизация с состоянием ----------
  sync(state, prev) {
    this.state = state;
    const first = !prev;
    if (first) {
      this.buildStatic();
      this.keepZones = this.computeKeepZones();
      this.buildWallsPart();
      this.buildFloorsPart();
      this.buildCeilingPart();
      this.buildRoofPart();
    }
    this.syncItems(prev);
    const zones = this.computeKeepZones();
    const zonesChanged = JSON.stringify(zones) !== JSON.stringify(this.keepZones);
    this.keepZones = zones;
    if (!first) {
      if (prev.wallLayout !== state.wallLayout || (zonesChanged && this.cutActive)) this.buildWallsPart();
      if (prev.ceilingType !== state.ceilingType) this.buildCeilingPart();
      if (prev.roofType !== state.roofType) this.buildRoofPart();
    }
    this.applyMaterials();
    this.applyDoorStates();
  }

  setCut(cutFor, active) {
    this.cutFor = cutFor;
    this.cutActive = active;
    this.buildWallsPart();
    this.applyVisibility();
  }

  // Видимость частей по режиму: снаружи — всё; внутри — без кровли и потолка, с разрезом; прогулка — всё.
  setMode(mode) {
    this.mode = mode;
    this.applyVisibility();
  }

  applyVisibility() {
    const interior = this.mode === 'interior';
    if (this.parts.roof) this.parts.roof.visible = !interior;
    if (this.parts.ceilings) {
      for (const c of this.parts.ceilings.children) c.visible = !interior;
    }
    if (this.parts.gable) this.parts.gable.visible = !interior;
    if (this.highlight) this.highlight.visible = interior;
    // Тени: при разрезе солнце использует оболочку настоящего дома.
    if (this.shell) this.shell.castShadow = !!this.cutActive || interior;
    if (this.parts.walls) for (const m of this.parts.walls.children) m.castShadow = !(this.cutActive || interior);
    // Проёмы на разрезанных стенах скрываются вместе с верхом стены.
    const hideOn = (obj, wallId) => {
      if (!obj) return;
      obj.visible = !(this.cutActive && this.cutFor(wallId) != null && interior);
    };
    for (const d of this.interiorDoors || []) hideOn(d, d.userData.wallId);
    if (this.parts.windows) this.parts.windows.visible = !(this.cutActive && interior);
    if (this.glazing) hideOn(this.glazing, 'east-005');
    if (this.entryDoor) hideOn(this.entryDoor, 'east-004');
    this.applyMountedVisibility();
    this.invalidate();
  }

  // Положение створок (общие с прогулкой).
  setDoorStates(states) {
    this.doorStates = states;
    this.applyDoorStates();
  }

  applyDoorStates() {
    for (const d of this.interiorDoors || []) {
      const a = this.doorStates[d.userData.door.id] ?? d.userData.door.max;
      poseDoor(d, a);
    }
    if (this.entryDoor) {
      const door = this.entryDoor.userData.door;
      poseHingedLeaf(this.entryDoor.userData.pivot, door, this.doorStates[door.id] ?? door.max);
    }
    if (this.glazing) this.glazing.userData.update(this.doorStates.G1 ?? 0);
    this.invalidate();
  }

  // Ночное свечение: окна и светильники.
  setNight(lamp, day) {
    const glow = this.lib.windowGlow();
    glow.opacity = Math.min(0.85, lamp * 0.9) * (1 - day * 0.8);
    glow.visible = glow.opacity > 0.01;
    const lg = this.lib.lampGlow();
    lg.emissiveIntensity = lamp * 6;
    for (const l of this.lamps?.userData.lights || []) l.intensity = lamp * 4.5;
  }

  meshesForSurface(slot) {
    const list = [];
    this.root.traverse((o) => {
      if (o.isMesh && (o.userData.surface === slot || o.userData.pickAs === slot || (o.userData.slot === slot && o.userData.itemId === undefined))) list.push(o);
    });
    return list;
  }

  doorById(id) {
    return DOOR_BY_ID[id];
  }
}
