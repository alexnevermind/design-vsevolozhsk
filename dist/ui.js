// Интерфейс: панели режимов, мини-план, каталог, палитры с превью, солнце, модальные окна,
// клавиатура, экспорт кадра и ссылка. Изменения проекта проходят через store.commit.
import * as THREE from 'three';
import { ITEM_TYPES, CATALOG_ORDER } from './catalog.js';
import {
  INTERIOR_PAINTS, FACADE_PAINTS, DOOR_FINISHES, WOODS, STONES, FABRICS, MATERIALS, SLOT_OPTIONS, labelOf, hexOf,
} from './choices.js';
import { SPEC, ROOMS, ROOM_BY_ID, WALLS, HOUSE_AREA, TERRACE_AREA, ceilingHeight } from './plan.js';
import { sunState, formatHour, phaseLabel, PREVIEW_TIMES, daylightFactor } from './solar.js';
import { encodeHash, newProject, BACKUP_KEY, safeStorage } from './project-state.js';
import { surfaceLabel, surfaceCategory } from './house-scene.js';
import { assetUrl } from './materials.js';

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ICONS = {
  bed: '<svg viewBox="0 0 54 40"><rect x="6" y="4" width="42" height="32" rx="2"/><rect x="10" y="7" width="15" height="8" rx="2"/><rect x="29" y="7" width="15" height="8" rx="2"/><path d="M6 19h42"/></svg>',
  wardrobe: '<svg viewBox="0 0 54 40"><rect x="15" y="3" width="24" height="34" rx="1.5"/><path d="M27 3v34M24 18v5M30 18v5"/></svg>',
  sofa: '<svg viewBox="0 0 54 40"><rect x="5" y="12" width="44" height="20" rx="4"/><rect x="5" y="12" width="7" height="20" rx="3"/><rect x="42" y="12" width="7" height="20" rx="3"/><path d="M12 22h30M27 22v10"/></svg>',
  table: '<svg viewBox="0 0 54 40"><rect x="9" y="9" width="36" height="22" rx="4"/><path d="M13 13h2M39 13h2M13 27h2M39 27h2"/></svg>',
  chair: '<svg viewBox="0 0 54 40"><rect x="17" y="10" width="20" height="20" rx="3"/><path d="M17 8c6-4 14-4 20 0"/></svg>',
  tv: '<svg viewBox="0 0 54 40"><rect x="5" y="7" width="44" height="25" rx="1.5"/><path d="M22 36h10M27 32v4"/></svg>',
};

const DOCK_TABS = {
  exterior: [
    { id: 'facade', label: 'Фасад' },
    { id: 'terrace', label: 'Терраса' },
  ],
  interior: [
    { id: 'catalog', label: 'Мебель' },
    { id: 'wall', label: 'Стены' },
    { id: 'floorWood', label: 'Пол дома' },
    { id: 'floorWet', label: 'Санузел и парная' },
    { id: 'terrace', label: 'Терраса' },
    { id: 'textiles', label: 'Отделка мебели' },
  ],
};

const FURNITURE_SLOTS = [
  { id: 'joinery', label: 'Дерево мебели', options: SLOT_OPTIONS.joinery },
  { id: 'upholstery', label: 'Обивка', options: SLOT_OPTIONS.upholstery },
  { id: 'accent', label: 'Акцент', options: SLOT_OPTIONS.accent },
  { id: 'bedding', label: 'Постель', options: SLOT_OPTIONS.bedding },
  { id: 'counter', label: 'Столешница', options: SLOT_OPTIONS.counter },
];

function paletteFor(category) {
  switch (category) {
    case 'facade': return FACADE_PAINTS;
    case 'wall':
    case 'ceiling': return INTERIOR_PAINTS;
    case 'doors': return DOOR_FINISHES;
    case 'floorWood': return WOODS.filter((w) => SLOT_OPTIONS.floorWood.includes(w.id));
    case 'floorWet': return STONES;
    case 'terrace': return WOODS;
    default: return [];
  }
}

// Фон образца: фактура карты, тонированная оттенком (умножение).
function swatchBackground(id) {
  const m = MATERIALS[id];
  if (!m) return '';
  const fam = m.family;
  let map = null;
  if (fam === 'wood') map = 'floor_albedo';
  else if (fam === 'fabric') map = 'fabric_albedo';
  else if (fam === 'terrazzo' || fam === 'travertine' || fam === 'slate') map = `${fam}_albedo`;
  else if (id.startsWith('tk-') || id.startsWith('ext-')) map = 'arch_normal';
  if (!map) return `background:${m.hex}`;
  const url = assetUrl(`assets/textures/${map}.webp`);
  if (map === 'arch_normal') return `background:linear-gradient(90deg, rgba(0,0,0,.05) 0 2px, transparent 2px 9px) ${m.hex};background-size:9px 100%`;
  return `background-color:${m.hex};background-image:url("${url}");background-size:180% 180%;background-blend-mode:multiply`;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.modalOpen = false;
    this.sunPanelOpen = false;
    this.dockTab = { exterior: 'facade', interior: 'catalog' };
    this.facadeTarget = 'facade:east';
    this.storage = safeStorage(globalThis.localStorage);
    this.bindTop();
    this.bindCamera();
    this.bindItemTools();
    this.bindSun();
    this.bindKeyboard();
    this.bindSheet();
    this.renderPanel();
    this.renderDock();
  }

  get state() {
    return this.app.store.get();
  }

  // ---------- верхняя панель ----------
  bindTop() {
    for (const b of document.querySelectorAll('.modes button')) {
      b.addEventListener('click', () => this.app.setMode(b.dataset.mode));
    }
    $('btn-sun').addEventListener('click', () => this.toggleSun());
    $('btn-doors').addEventListener('click', () => this.openDoorsCeiling());
    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('btn-help').addEventListener('click', () => this.openHelp());
    $('btn-png').addEventListener('click', () => this.savePNG());
    $('btn-link').addEventListener('click', () => this.openLink());
    $('modal-close').addEventListener('click', () => this.closeModal());
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) this.closeModal(); });
    for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => this.toggleSun(false));
  }

  bindSheet() {
    // Высота нижней ленты меняется (вкладки, перенос подсказки) — панель и подсказки стоят над ней.
    const dock = $('dock');
    const setDockH = () => document.documentElement.style.setProperty('--dock-h', `${Math.round(dock.getBoundingClientRect().height)}px`);
    if (window.ResizeObserver) new ResizeObserver(setDockH).observe(dock);
    setDockH();
    $('sheet-toggle').addEventListener('click', () => {
      const p = $('side-panel');
      p.classList.toggle('collapsed');
      $('sheet-toggle').setAttribute('aria-expanded', String(!p.classList.contains('collapsed')));
      this.app.applyViewOffset?.();
      this.app.invalidate();
    });
    if (window.innerWidth <= 760) {
      $('side-panel').classList.add('collapsed');
      $('sheet-toggle').setAttribute('aria-expanded', 'false');
    }
  }

  onModeChange(mode) {
    for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
    this.updateRoomLabel();
    this.renderPanel();
    this.renderDock();
    this.onSelection(this.app.editor?.selectedId ?? null, this.app.editor?.selectedSurface ?? null);
  }

  onRoomChange() {
    this.updateRoomLabel();
    if (this.app.mode === 'interior') {
      this.renderPanel();
      // Подсказка каталога называет помещение, куда добавляется предмет по клику.
      if (!this.app.editor?.drag) this.renderDock();
    }
  }

  updateRoomLabel() {
    const r = this.app.activeRoom && ROOM_BY_ID[this.app.activeRoom];
    // В прогулке текущее помещение показывает подпись внизу экрана.
    $('room-label').textContent = r && this.app.mode === 'interior'
      ? `${r.id} · ${r.name} · ${fmt(r.area)} м²`
      : `Дом ${fmt(HOUSE_AREA)} м² · терраса ${fmt(TERRACE_AREA)} м²`;
  }

  refresh(state, event) {
    $('btn-undo').disabled = !this.app.store.history.canUndo();
    $('btn-redo').disabled = !this.app.store.history.canRedo();
    if (event?.kind !== 'init') {
      this.renderPanel();
      this.renderDock();
    }
    this.syncSunInputs();
    this.onSelection(this.app.editor?.selectedId ?? null, this.app.editor?.selectedSurface ?? null);
  }

  // ---------- левая панель ----------
  renderPanel() {
    const body = $('side-body');
    const s = this.state;
    if (this.app.mode === 'exterior') {
      const sides = [
        ['facade:north', 'Северный'], ['facade:east', 'Торец у террасы'], ['facade:south', 'Южный'], ['facade:west', 'Западный'], ['loggia', 'Навес террасы'], ['all', 'Весь дом одним цветом'],
      ];
      const cur = this.facadeTarget === 'all' ? null : this.facadeTarget === 'loggia' ? s.cladding.loggia : s.mats[this.facadeTarget];
      body.innerHTML = `
        <h2>Фасад</h2>
        <div class="seg" role="group" aria-label="Сторона фасада">${sides.map(([id, l]) => `<button data-facade="${id}" aria-pressed="${this.facadeTarget === id}">${l}</button>`).join('')}</div>
        <div class="surface-card"><span class="sw" style="${cur ? `background:${hexOf(cur)}` : 'background:conic-gradient(#ebebe8,#3c3c3d,#bc8647,#7f93a1,#ebebe8)'}"></span>
          <div><b>${this.facadeTarget === 'all' ? 'Все четыре фасада и навес' : surfaceLabel(this.facadeTarget)}</b>${cur ? esc(labelOf(cur)) : 'Выберите оттенок внизу — одно действие истории'}</div></div>
        <p class="note">Графит кровли и рам сохраняется при любом цвете фасада. Стороны «северный», «южный» и др. — по листу плана; географический север задаётся в панели солнца.</p>
        <h2>Кровля</h2>
        <div class="seg" role="group" aria-label="Тип кровли">
          <button data-roof="standingSeam" aria-pressed="${s.roofType === 'standingSeam'}">Кликфальц</button>
          <button data-roof="metalTile" aria-pressed="${s.roofType === 'metalTile'}">Металлочерепица</button>
        </div>
        <p class="note">Один графитовый цвет; меняется геометрия покрытия (фальцы 25 мм с шагом 430 мм или волна 183 мм с рядами 350 мм).</p>
        <h2>О доме</h2>
        <div class="kv">
          <span>Контур</span><b>12,0 × 6,8 м</b>
          <span>Помещения</span><b>${fmt(HOUSE_AREA)} м² (8 зон)</b>
          <span>Терраса</span><b>${fmt(TERRACE_AREA)} м², крытая часть 1,5 м</b>
          <span>Потолок</span><b>2,30 у стен — 2,70 под коньком</b>
          <span>Пол</span><b>+0,70 м над землёй, ж/б сваи</b>
          <span>Конёк</span><b>вдоль длинной стороны</b>
        </div>`;
      body.querySelectorAll('[data-facade]').forEach((b) => b.addEventListener('click', () => {
        this.facadeTarget = b.dataset.facade;
        if (this.facadeTarget === 'all') {
          // Общая окраска: выбор поверхности сбрасывается, цель — все четыре фасада и навес.
          this.app.editor.selectedId = null;
          this.app.editor.selectedSurface = null;
          this.lastSurface = null;
          this.app.editor.updateSelBox();
        } else {
          this.app.editor.selectSurface(this.facadeTarget);
        }
        this.dockTab.exterior = 'facade';
        this.renderPanel();
        this.renderDock();
      }));
      body.querySelectorAll('[data-roof]').forEach((b) => b.addEventListener('click', () => this.setRoof(b.dataset.roof)));
      return;
    }
    if (this.app.mode === 'interior') {
      const active = this.app.activeRoom;
      const sel = this.app.editor?.selectedSurface;
      body.innerHTML = `
        <h2>Помещения</h2>
        ${this.miniPlan(active)}
        <div class="room-list">
          <button data-room="" aria-pressed="${!active}">Весь дом<span>${fmt(HOUSE_AREA)} м²</span></button>
          ${ROOMS.map((r) => `<button data-room="${r.id}" aria-pressed="${active === r.id}">${r.id} ${esc(r.name)}<span>${fmt(r.area)} м²</span></button>`).join('')}
        </div>
        <h2 style="margin-top:12px">Стены</h2>
        <label class="check"><input type="checkbox" id="cut-toggle" ${this.app.cutEnabled ? 'checked' : ''}> Разрез стен (0,72 м)</label>
        <div class="seg" role="group" aria-label="Облицовка стен">
          <button data-layout="vertical" aria-pressed="${s.wallLayout === 'vertical'}">Вертикальная</button>
          <button data-layout="horizontal" aria-pressed="${s.wallLayout === 'horizontal'}">Горизонтальная</button>
          <button data-layout="smooth" aria-pressed="${s.wallLayout === 'smooth'}">Гладкая</button>
        </div>
        ${sel ? this.surfaceCard(sel) : '<p class="note">Нажмите на стену, пол или потолок, чтобы выбрать поверхность, либо перетащите образец на поверхность.</p>'}
        <button class="primary" id="open-doors" style="width:100%;margin-top:8px">Двери и потолок</button>
        <p class="note">Перетаскивайте мебель; колесо при переносе — поворот 45°, вынос за дом — удаление. Прихожая 004 и парная 007 остаются свободными.</p>`;
      body.querySelectorAll('[data-room]').forEach((b) => b.addEventListener('click', () => this.app.selectRoom(b.dataset.room || null)));
      body.querySelectorAll('.mini-plan .room').forEach((p) => p.addEventListener('click', () => this.app.selectRoom(p.dataset.room)));
      $('cut-toggle').addEventListener('change', (e) => { this.app.cutEnabled = e.target.checked; this.app.updateCut(); });
      body.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => this.setLayout(b.dataset.layout)));
      $('open-doors').addEventListener('click', () => this.openDoorsCeiling());
      body.querySelector('[data-clear-surface]')?.addEventListener('click', () => this.app.editor.deselect());
      return;
    }
    body.innerHTML = '';
  }

  surfaceCard(slot) {
    const s = this.state;
    let id;
    if (slot === 'loggia') id = s.cladding.loggia;
    else if (slot === 'all-facades') id = null;
    else id = s.mats[slot] ?? s.mats[slot.replace(/:\d+$/, ':005')];
    const label = slot === 'all-facades' ? 'Все фасады' : surfaceLabel(slot);
    return `<div class="surface-card"><span class="sw" style="${id ? swatchBackground(id) : ''}"></span><div><b>${esc(label)}</b>${id ? esc(labelOf(id)) : ''}</div>
      <button class="icon-btn small" data-clear-surface title="Сбросить выбор поверхности" aria-label="Сбросить выбор поверхности"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>`;
  }

  miniPlan(active) {
    const o = SPEC.house.outer;
    const t = SPEC.house.terrace;
    const pad = 0.2;
    const vb = `${o.x0 - pad} ${o.z0 - pad} ${t.x1 - o.x0 + 2 * pad} ${o.z1 - o.z0 + 2 * pad}`;
    const rooms = ROOMS.map((r) => `<polygon class="room${active === r.id ? ' active' : ''}" data-room="${r.id}" points="${r.polygon.map((p) => p.join(',')).join(' ')}"><title>${r.id} ${esc(r.name)}</title></polygon>`).join('');
    const walls = WALLS.map((w) => {
      const h = w.t / 2;
      const pts = [[w.a[0] + w.nx * h, w.a[1] + w.nz * h], [w.b[0] + w.nx * h, w.b[1] + w.nz * h], [w.b[0] - w.nx * h, w.b[1] - w.nz * h], [w.a[0] - w.nx * h, w.a[1] - w.nz * h]];
      return `<polygon class="wall" points="${pts.map((p) => p.join(',')).join(' ')}"/>`;
    }).join('');
    const labels = ROOMS.map((r) => `<text x="${r.center[0]}" y="${r.center[1] + 0.1}">${r.id}</text>`).join('');
    return `<svg class="mini-plan" viewBox="${vb}" role="img" aria-label="Мини-план: нажмите на помещение">${rooms}${walls}${labels}</svg>`;
  }

  // ---------- нижний блок: каталог и палитры ----------
  renderDock() {
    const mode = this.app.mode;
    if (mode === 'walk') return;
    const tabs = DOCK_TABS[mode];
    let tab = this.dockTab[mode];
    if (!tabs.some((t) => t.id === tab)) tab = tabs[0].id;
    $('dock-tabs').innerHTML = tabs.map((t) => `<button role="tab" data-tab="${t.id}" aria-selected="${t.id === tab}">${t.label}</button>`).join('');
    $('dock-tabs').querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
      this.dockTab[mode] = b.dataset.tab;
      this.renderDock();
    }));
    const strip = $('dock-strip');
    const hint = $('dock-hint');
    if (tab === 'catalog') {
      hint.textContent = `Клик — добавить в «${ROOM_BY_ID[this.app.editor.targetRoomFor('bed')]?.name ?? 'помещение'}», перенос — на нужное место. Телевизор крепится на стену.`;
      strip.innerHTML = CATALOG_ORDER.map((type) => {
        const t = ITEM_TYPES[type];
        return `<button class="card" data-type="${type}" aria-label="Добавить: ${esc(t.label)}">${ICONS[t.icon]}<b>${esc(t.short)}</b><span>${fmt(t.w, 2)} × ${fmt(t.d, 2)} м</span></button>`;
      }).join('');
      strip.querySelectorAll('.card').forEach((c) => {
        c.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          this.app.editor.beginCatalogDrag(c.dataset.type, e);
        });
        c.addEventListener('click', () => {
          if (this.app.editor.consumeClickSuppression()) return;
          this.app.editor.addByClick(c.dataset.type);
        });
      });
      return;
    }
    if (tab === 'textiles') {
      const item = this.state.items.find((i) => i.id === this.app.editor.selectedId);
      this.textileSlot ??= 'upholstery';
      const slot = FURNITURE_SLOTS.find((f) => f.id === this.textileSlot);
      hint.innerHTML = `${FURNITURE_SLOTS.map((f) => `<button class="chip" data-tslot="${f.id}" aria-pressed="${f.id === this.textileSlot}">${f.label}</button>`).join(' ')} <span>${item ? `· только для: ${esc(ITEM_TYPES[item.type].short)}` : '· для всей мебели'}</span>`;
      hint.querySelectorAll('[data-tslot]').forEach((b) => b.addEventListener('click', () => { this.textileSlot = b.dataset.tslot; this.renderDock(); }));
      const cur = item?.mats?.[slot.id] || this.state.mats[slot.id];
      strip.innerHTML = slot.options.map((id) => this.swatchHtml(id, cur === id, `fur:${slot.id}`)).join('');
      this.bindSwatches(strip, `fur:${slot.id}`);
      return;
    }
    const category = tab;
    const target = this.dockTarget(category);
    const cur = this.currentFor(target);
    const pal = paletteFor(category);
    const hints = {
      facade: this.facadeTarget === 'all' ? 'Оттенок применяется ко всем четырём фасадам и навесу — одно действие.' : `Применяется к: ${surfaceLabel(target)}. Можно перетащить образец на фасад.`,
      terrace: 'Настил террасы и ступени — единый материал.',
      wall: 'Единый цвет внутренних стен всего дома (парная — натуральная липа).',
      floorWood: 'Общий деревянный пол: 001, 002, 003, 004, 005.',
      floorWet: 'Плитка 600 × 600 мм санузла 006 и парной 007.',
    };
    hint.textContent = hints[category] || '';
    strip.innerHTML = pal.map((m) => this.swatchHtml(m.id, cur === m.id, category)).join('');
    this.bindSwatches(strip, category);
  }

  swatchHtml(id, pressed, category) {
    const m = MATERIALS[id];
    return `<button class="swatch" data-mat="${id}" data-cat="${category}" aria-pressed="${pressed}" aria-label="${esc(labelOf(id))}"><span class="chipc" style="${swatchBackground(id)}"></span><span>${esc(m.label)}</span>${m.code ? `<span class="code">${m.code}</span>` : ''}</button>`;
  }

  bindSwatches(strip, category) {
    strip.querySelectorAll('.swatch').forEach((b) => {
      const id = b.dataset.mat;
      b.addEventListener('click', () => {
        if (this.app.editor.consumeClickSuppression()) return;
        this.app.house.clearPreviews();
        this.applyMaterial(this.dockTarget(category), id);
      });
      b.addEventListener('pointerenter', (e) => {
        if (e.pointerType !== 'mouse' || this.app.editor.drag) return;
        this.previewMaterial(this.dockTarget(category), id);
      });
      b.addEventListener('pointerleave', () => { if (!this.app.editor.drag) this.app.house.clearPreviews(); });
      b.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || category.startsWith('fur:')) return;
        this.app.editor.beginSwatchDrag(id, category, e);
      });
    });
  }

  // Целевая группа поверхностей для категории палитры (выбранная поверхность или группа вкладки).
  dockTarget(category) {
    const sel = this.app.editor?.selectedSurface;
    if (category.startsWith('fur:')) return category;
    if (category === 'facade') {
      if (this.facadeTarget === 'all') return 'all-facades';
      if (sel && surfaceCategory(sel) === 'facade') return sel;
      return this.facadeTarget;
    }
    if (sel && surfaceCategory(sel) === category) return sel;
    return { wall: 'wall:005', ceiling: 'ceiling', floorWood: 'floor:005', floorWet: 'floor:006', terrace: 'floor:008', doors: 'interiorDoors' }[category];
  }

  currentFor(target) {
    const s = this.state;
    if (target === 'all-facades') return null;
    if (target === 'loggia') return s.cladding.loggia;
    if (target.startsWith('fur:')) return s.mats[target.slice(4)];
    return s.mats[target];
  }

  // Изменение отделки: одно действие истории на жест.
  mutatorFor(target, id) {
    const sp = SPEC;
    if (target === 'all-facades') return { label: `Весь дом одним цветом: ${labelOf(id)}`, fn: (s) => { for (const side of ['north', 'east', 'south', 'west']) s.mats[`facade:${side}`] = id; s.cladding.loggia = id; } };
    if (target === 'loggia') return { label: `Навес террасы: ${labelOf(id)}`, fn: (s) => { s.cladding.loggia = id; } };
    if (target.startsWith('facade:')) return { label: `${surfaceLabel(target)}: ${labelOf(id)}`, fn: (s) => { s.mats[target] = id; } };
    if (target.startsWith('wall:')) return { label: `Стены: ${labelOf(id)}`, fn: (s) => { for (const r of sp.paintedRooms) s.mats[`wall:${r}`] = id; } };
    if (target === 'ceiling') return { label: `Потолок: ${labelOf(id)}`, fn: (s) => { s.mats.ceiling = id; } };
    if (target === 'interiorDoors') return { label: `Двери: ${labelOf(id)}`, fn: (s) => { s.mats.interiorDoors = id; } };
    if (target.startsWith('floor:')) {
      const room = target.slice(6);
      const group = sp.floorGroups.wet.includes(room) ? sp.floorGroups.wet : sp.floorGroups.terrace.includes(room) ? sp.floorGroups.terrace : sp.floorGroups.wood;
      return { label: `${surfaceLabel(target)}: ${labelOf(id)}`, fn: (s) => { for (const r of group) s.mats[`floor:${r}`] = id; } };
    }
    if (target.startsWith('fur:')) {
      const slot = target.slice(4);
      const itemId = this.app.editor.selectedId;
      return {
        label: `${FURNITURE_SLOTS.find((f) => f.id === slot)?.label}: ${labelOf(id)}`,
        fn: (s) => {
          const it = itemId != null ? s.items.find((i) => i.id === itemId) : null;
          if (it) it.mats = { ...it.mats, [slot]: id };
          else s.mats[slot] = id;
        },
      };
    }
    return null;
  }

  applyMaterial(target, id) {
    const m = this.mutatorFor(target, id);
    if (!m) return;
    this.app.store.commit(m.fn, m.label);
  }

  // Превью: временный материал на совместимой группе; сохранённое состояние не меняется.
  previewMaterial(target, id) {
    const m = this.mutatorFor(target, id);
    if (!m) return;
    const house = this.app.house;
    const fake = JSON.parse(JSON.stringify(this.state));
    m.fn(fake);
    house.previews.clear();
    if (target.startsWith('fur:')) {
      const slot = target.slice(4);
      const itemId = this.app.editor.selectedId;
      const it = fake.items.find((i) => i.id === itemId) || null;
      house.previews.set(`item:${slot}`, house.itemSlotMaterial(slot, it, fake));
    } else {
      const slots = new Set();
      house.root.traverse((o) => { if (o.isMesh && o.userData.surface) slots.add(o.userData.surface); });
      slots.add('interiorDoors');
      for (const slot of slots) {
        const a = house.slotMaterial(slot, this.state);
        const b = house.slotMaterial(slot, fake);
        if (a !== b) house.previews.set(slot, b);
      }
    }
    house.applyMaterials();
  }

  setRoof(type) {
    if (this.state.roofType === type) return;
    this.app.store.commit((s) => { s.roofType = type; }, `Кровля: ${type === 'metalTile' ? 'металлочерепица' : 'кликфальц'}`);
  }

  setLayout(layout) {
    if (this.state.wallLayout === layout) return;
    const labels = { vertical: 'вертикальная', horizontal: 'горизонтальная', smooth: 'гладкая' };
    this.app.store.commit((s) => { s.wallLayout = layout; }, `Облицовка стен: ${labels[layout]}`);
  }

  // ---------- выбор предмета/поверхности ----------
  onSelection(itemId, surface) {
    const tools = $('item-tools');
    const it = this.state.items.find((i) => i.id === itemId);
    if (it && !this.app.editor.drag && this.app.mode !== 'walk') {
      tools.hidden = false;
      $('item-name').textContent = ITEM_TYPES[it.type].label;
      const wall = ITEM_TYPES[it.type].mount === 'wall';
      $('btn-rot-left').disabled = wall;
      $('btn-rot-right').disabled = wall;
    } else tools.hidden = true;
    if (this.app.mode === 'interior' && this.lastSurface !== surface) {
      this.lastSurface = surface;
      const cat = surface ? surfaceCategory(surface) : null;
      if (cat && cat !== 'doors' && cat !== 'ceiling' && cat !== 'facade') this.dockTab.interior = cat;
      this.renderPanel();
      this.renderDock();
      if (cat === 'doors' || cat === 'ceiling') this.openDoorsCeiling();
    } else if (this.app.mode === 'exterior' && this.lastSurface !== surface) {
      this.lastSurface = surface;
      if (surface && surface !== 'all-facades') {
        const cat = surfaceCategory(surface);
        if (cat === 'facade') this.facadeTarget = surface;
        if (cat === 'terrace' || cat === 'facade') this.dockTab.exterior = cat;
      }
      this.renderPanel();
      this.renderDock();
    }
  }

  onDragState(info) {
    const hint = $('drag-hint');
    if (!info || info.kind === 'swatch' && !info.targetSlot) {
      hint.hidden = !info;
      if (info) {
        hint.textContent = 'Перетащите образец на подходящую поверхность';
        hint.className = 'drag-hint ui';
      }
      if (!info) this.onSelection(this.app.editor.selectedId, this.app.editor.selectedSurface);
      return;
    }
    $('item-tools').hidden = true;
    hint.hidden = false;
    if (info.kind === 'swatch') {
      hint.textContent = `${surfaceLabel(info.targetSlot)} · отпустите, чтобы применить`;
      hint.className = 'drag-hint ui ok';
      return;
    }
    hint.textContent = info.deleteZone ? 'Отпустите, чтобы удалить' : info.valid ? `Можно поставить · ${info.reason}` : info.reason || 'Недопустимое место';
    hint.className = `drag-hint ui ${info.valid ? 'ok' : 'bad'}`;
  }

  bindItemTools() {
    $('btn-rot-left').addEventListener('click', () => this.app.editor.rotateSelected(1));
    $('btn-rot-right').addEventListener('click', () => this.app.editor.rotateSelected(-1));
    $('btn-delete').addEventListener('click', () => this.app.editor.deleteSelected());
    $('btn-deselect').addEventListener('click', () => this.app.editor.deselect());
  }

  // ---------- камера и история ----------
  bindCamera() {
    $('btn-undo').addEventListener('click', () => this.app.store.undo());
    $('btn-redo').addEventListener('click', () => this.app.store.redo());
    $('btn-zoom-in').addEventListener('click', () => this.app.zoom(0.8));
    $('btn-zoom-out').addEventListener('click', () => this.app.zoom(1.25));
    $('btn-reset').addEventListener('click', () => this.app.resetView());
    $('btn-top').addEventListener('click', () => this.app.topView());
    $('btn-cinema').addEventListener('click', () => this.app.toggleCinema());
    $('btn-hide').addEventListener('click', () => this.app.toggleUI());
  }

  setCinema(on) {
    $('btn-cinema').classList.toggle('active', on);
  }

  // ---------- клавиатура обзора ----------
  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (this.modalOpen) {
        if (e.key === 'Escape') this.closeModal();
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (mod && (e.code === 'KeyZ' || e.code === 'KeyY')) {
        e.preventDefault();
        if (this.app.mode === 'walk') return;
        if (e.shiftKey || e.code === 'KeyY') this.app.store.redo();
        else this.app.store.undo();
        return;
      }
      if (mod || e.altKey) return;
      if (e.key === '/') { this.app.toggleUI(); e.preventDefault(); return; }
      if (this.app.mode === 'walk') return;
      const cam = this.app.camera;
      const ctl = this.app.controls;
      switch (e.code) {
        case 'KeyC': this.app.toggleCinema(); break;
        case 'KeyR': this.app.stopCinema(); this.app.resetView(); break;
        case 'KeyN': this.app.store.commit((s) => { s.notes = !s.notes; }, 'Траектория солнца'); break;
        case 'BracketLeft':
        case 'BracketRight': {
          const h = (this.state.hour + (e.code === 'BracketLeft' ? -0.25 : 0.25) + 24) % 24;
          this.app.store.commit((s) => { s.hour = Math.round(h * 60) / 60; }, `Время ${formatHour(h)}`);
          break;
        }
        case 'KeyW': case 'KeyS': case 'KeyA': case 'KeyD': {
          if (this.app.editor.drag) return;
          const dir = new THREE.Vector3().subVectors(ctl.target, cam.position).setY(0).normalize();
          const right = new THREE.Vector3(-dir.z, 0, dir.x);
          const step = 0.35;
          const v = e.code === 'KeyW' ? dir : e.code === 'KeyS' ? dir.clone().negate() : e.code === 'KeyD' ? right : right.clone().negate();
          cam.position.addScaledVector(v, step);
          ctl.target.addScaledVector(v, step);
          this.app.invalidate();
          break;
        }
        case 'KeyQ': case 'KeyE': {
          const a = (e.code === 'KeyQ' ? 1 : -1) * 0.07;
          const off = cam.position.clone().sub(ctl.target);
          off.applyAxisAngle(new THREE.Vector3(0, 1, 0), a);
          cam.position.copy(ctl.target).add(off);
          this.app.invalidate();
          break;
        }
        default:
      }
    });
  }

  // ---------- солнце ----------
  bindSun() {
    const commit = (fn, label) => this.app.store.commit(fn, label);
    $('sun-time').addEventListener('input', (e) => {
      const h = Number(e.target.value) / 60;
      this.previewHour(h);
    });
    $('sun-time').addEventListener('change', (e) => {
      const h = Number(e.target.value) / 60;
      this.previewHourValue = null;
      commit((s) => { s.hour = h; }, `Время ${formatHour(h)}`);
    });
    $('sun-date').addEventListener('change', (e) => {
      if (!e.target.value) return;
      commit((s) => { s.solar.date = e.target.value; }, `Дата ${e.target.value}`);
      this.renderPreviews();
    });
    $('sun-north').addEventListener('change', (e) => {
      const v = ((Math.round(Number(e.target.value)) % 360) + 360) % 360;
      if (!Number.isFinite(v)) return;
      commit((s) => { s.solar.northAngle = v; }, `Север ${v}°`);
      this.renderPreviews();
    });
    for (const [id, key, min, max] of [['sun-lat', 'latitude', -89.9, 89.9], ['sun-lon', 'longitude', -180, 180], ['sun-utc', 'utcOffset', -12, 14]]) {
      $(id).addEventListener('change', (e) => {
        const v = Number(e.target.value);
        if (!Number.isFinite(v) || v < min || v > max) { this.syncSunInputs(); return; }
        commit((s) => { s.solar[key] = v; }, 'Координаты участка');
        this.renderPreviews();
      });
    }
    $('sun-confirm').addEventListener('change', (e) => commit((s) => { s.solar.orientationConfirmed = e.target.checked; }, 'Ориентация севера'));
    $('sun-lamps').addEventListener('change', (e) => commit((s) => { s.lamps = e.target.checked; }, e.target.checked ? 'Светильники включены' : 'Светильники выключены'));
    $('sun-notes').addEventListener('change', (e) => commit((s) => { s.notes = e.target.checked; }, 'Траектория солнца'));
    $('sun-fire').addEventListener('change', (e) => commit((s) => { s.fire = e.target.value; }, { auto: 'Костёр: авто', on: 'Костёр горит', off: 'Костёр погашен' }[e.target.value]));
    $('btn-bbq').addEventListener('click', () => this.app.showFireZone());
    // Перетаскивание значка солнца по траектории.
    const canvas = this.app.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.app.sunPath.group.visible || this.app.mode === 'walk') return;
      const rect = canvas.getBoundingClientRect();
      const [ix, iy] = this.app.sunPath.iconScreen(this.app.camera, rect);
      if (Math.hypot(ix - e.clientX, iy - e.clientY) > 26) return;
      e.stopImmediatePropagation();
      this.sunDrag = e.pointerId;
      this.app.controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
    }, { capture: true });
    canvas.addEventListener('pointermove', (e) => {
      if (this.sunDrag !== e.pointerId) return;
      const r = this.app.sunPath.hourAtScreen(this.app.camera, canvas.getBoundingClientRect(), e.clientX, e.clientY);
      if (r) this.previewHour(r.hour);
    });
    const end = (e) => {
      if (this.sunDrag !== e.pointerId) return;
      this.sunDrag = null;
      this.app.controls.enabled = true;
      if (this.previewHourValue != null) {
        const h = this.previewHourValue;
        this.previewHourValue = null;
        commit((s) => { s.hour = h; }, `Время ${formatHour(h)}`);
      }
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
  }

  // Предпросмотр времени без записи истории (ползунок, значок).
  previewHour(h) {
    this.previewHourValue = Math.round(h * 60) / 60;
    const s = this.state;
    const st = this.app.env.update(s.solar, this.previewHourValue, s.lamps);
    this.app.house.setNight(st.lamp, st.day);
    this.app.sunPath.update(s.solar, this.previewHourValue, s.notes || this.sunPanelOpen);
    $('sun-time-out').textContent = formatHour(this.previewHourValue);
    $('sun-time').value = String(Math.round(this.previewHourValue * 60));
    this.updateSunReadout(st);
    this.app.invalidate();
  }

  toggleSun(force) {
    this.sunPanelOpen = force ?? !this.sunPanelOpen;
    $('sun-panel').hidden = !this.sunPanelOpen;
    $('btn-sun').classList.toggle('active', this.sunPanelOpen);
    this.syncSunInputs();
    this.app.applySolar();
    if (this.sunPanelOpen) setTimeout(() => this.renderPreviews(), 50);
  }

  syncSunInputs() {
    const s = this.state;
    if (document.activeElement?.id !== 'sun-time' && this.previewHourValue == null) {
      $('sun-time').value = String(Math.round(s.hour * 60));
      $('sun-time-out').textContent = formatHour(s.hour);
    }
    $('sun-date').value = s.solar.date;
    $('sun-north').value = String(s.solar.northAngle);
    $('sun-lat').value = String(s.solar.latitude);
    $('sun-lon').value = String(s.solar.longitude);
    $('sun-utc').value = String(s.solar.utcOffset);
    $('sun-confirm').checked = s.solar.orientationConfirmed;
    $('sun-lamps').checked = s.lamps;
    $('sun-notes').checked = s.notes;
    $('sun-fire').value = s.fire;
    $('north-note').textContent = s.solar.orientationConfirmed
      ? `Север: ${s.solar.northAngle}° от верха плана (подтверждено для участка).`
      : `Север условный: ${s.solar.northAngle}° от верха плана. Укажите направление для конкретного участка.`;
  }

  updateSunReadout(st) {
    if (!st) return;
    $('sun-readout').innerHTML = `Азимут <b>${fmt(st.azimuth, 0)}°</b> · высота <b>${fmt(st.elevation, 1)}°</b> · ${phaseLabel(st.elevation)}${st.lamp > 0.01 ? ' · светильники' : ''}${st.fire > 0.01 ? ' · костёр' : ''}`;
  }

  // Четыре превью освещения: реальные кадры текущей камеры в разное время.
  renderPreviews() {
    if (!this.sunPanelOpen) return;
    const box = $('sun-previews');
    const app = this.app;
    const w = 160;
    const h = 120;
    const rt = new THREE.WebGLRenderTarget(w, h, { samples: 2 });
    const cam = app.activeCamera().clone();
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    const s = this.state;
    box.innerHTML = '';
    const pixels = new Uint8Array(w * h * 4);
    // В превью 160 × 120 дальний лес и трава не различимы — не рисуем их.
    const light = [];
    app.scene.traverse((o) => { if (o.userData.far || o.name === 'grass') light.push(o); });
    const vis = light.map((o) => o.visible);
    light.forEach((o) => { o.visible = false; });
    for (const p of PREVIEW_TIMES) {
      const st = app.env.update(s.solar, p.hour, s.lamps);
      app.house.setNight(st.lamp, st.day);
      app.renderer.shadowMap.needsUpdate = true;
      app.renderer.setRenderTarget(rt);
      app.renderer.render(app.scene, cam);
      app.renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
      app.renderer.setRenderTarget(null);
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) img.data.set(pixels.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      ctx.putImageData(img, 0, 0);
      const b = document.createElement('button');
      b.title = `${p.label}: ${formatHour(p.hour)}`;
      b.append(c, document.createTextNode(`${p.label} ${formatHour(p.hour)}`));
      b.addEventListener('click', () => this.app.store.commit((st2) => { st2.hour = p.hour; }, `${p.label} ${formatHour(p.hour)}`));
      box.append(b);
    }
    light.forEach((o, i) => { o.visible = vis[i]; });
    rt.dispose();
    app.applySolar();
  }

  // ---------- модальные окна ----------
  openModal(title, html, onClose) {
    $('modal-title').textContent = title;
    $('modal-body').innerHTML = html;
    $('modal').hidden = false;
    this.modalOpen = true;
    this.onModalClose = onClose;
    this.app.editor.cancelGesture('modal');
    setTimeout(() => $('modal-close').focus(), 30);
  }

  closeModal() {
    if (!this.modalOpen) return;
    $('modal').hidden = true;
    this.modalOpen = false;
    const cb = this.onModalClose;
    this.onModalClose = null;
    cb?.();
  }

  // «Двери и потолок»: доступна из редактора, настроек и прогулки; в прогулке ставит паузу.
  openDoorsCeiling() {
    const walk = this.app.mode === 'walk' ? this.app.walk : null;
    const wasPaused = walk?.paused;
    if (walk) walk.setPaused(true);
    const render = () => {
      const s = this.state;
      $('modal-body').innerHTML = `
        <h3>Межкомнатные двери</h3>
        <div class="swatch-row">${DOOR_FINISHES.map((d) => this.swatchHtml(d.id, s.mats.interiorDoors === d.id, 'doors')).join('')}</div>
        <p class="note">Цвет полотен, коробок и наличников всех межкомнатных дверей. Входная дверь и остекление сохраняют графитовое исполнение.</p>
        <h3>Потолок</h3>
        <div class="seg"><button data-ceil="timber" aria-pressed="${s.ceilingType === 'timber'}">Имитация бруса</button><button data-ceil="stretch" aria-pressed="${s.ceilingType === 'stretch'}">Матовый натяжной</button></div>
        <div class="swatch-row" style="margin-top:8px">${INTERIOR_PAINTS.map((p) => this.swatchHtml(p.id, s.mats.ceiling === p.id, 'ceiling')).join('')}</div>
        <p class="note">Оба исполнения повторяют два ската: 2,30 м у продольных стен и 2,70 м под коньком; толщина бруса направлена в конструкцию кровли. Парная — натуральная липа.</p>
        <div class="actions"><button class="ghost" id="dc-inside">Посмотреть изнутри</button><button class="primary" id="dc-done">Готово</button></div>`;
      $('modal-body').querySelectorAll('.swatch').forEach((b) => b.addEventListener('click', () => {
        const cat = b.dataset.cat;
        this.applyMaterial(cat === 'doors' ? 'interiorDoors' : 'ceiling', b.dataset.mat);
        render();
      }));
      $('modal-body').querySelectorAll('[data-ceil]').forEach((b) => b.addEventListener('click', () => {
        if (this.state.ceilingType !== b.dataset.ceil) this.app.store.commit((st) => { st.ceilingType = b.dataset.ceil; }, b.dataset.ceil === 'stretch' ? 'Потолок: матовый натяжной' : 'Потолок: имитация бруса');
        render();
      }));
      $('dc-done').addEventListener('click', () => this.closeModal());
      $('dc-inside').addEventListener('click', () => {
        this.onModalClose = null;
        this.closeModal();
        const room = this.app.activeRoom && ROOM_BY_ID[this.app.activeRoom]?.kind !== 'terrace' ? this.app.activeRoom : '005';
        if (this.app.mode === 'walk') this.app.walk.enter({ room, lookUp: true });
        else this.app.setMode('walk', { walk: { room, lookUp: true } });
      });
    };
    this.openModal('Двери и потолок', '', () => { if (walk && this.app.mode === 'walk') walk.setPaused(!!wasPaused); });
    render();
  }

  openSettings() {
    const a = this.app;
    const backup = this.storage.get(BACKUP_KEY);
    this.openModal('Настройки', `
      <h3>Качество</h3>
      <div class="seg">${[['auto', 'Авто'], ['high', 'Высокое'], ['low', 'Облегчённое']].map(([id, l]) => `<button data-q="${id}" aria-pressed="${a.quality === id}">${l}</button>`).join('')}</div>
      <label class="check"><input type="checkbox" id="set-ao" ${a.settings.ao ? 'checked' : ''}> Контактные тени (GTAO)</label>
      <label class="check"><input type="checkbox" id="set-bloom" ${a.settings.bloom ? 'checked' : ''}> Свечение</label>
      <label class="check"><input type="checkbox" id="set-dof" ${a.settings.dof ? 'checked' : ''}> Глубина резкости</label>
      <label class="field">Экспозиция <output id="exp-out">${fmt(a.settings.exposure, 2)}</output><input type="range" id="set-exp" min="0.5" max="1.8" step="0.05" value="${a.settings.exposure}"></label>
      <h3>Проект</h3>
      <div class="actions" style="justify-content:flex-start">
        <button class="ghost" id="set-doors">Двери и потолок</button>
        <button class="ghost" id="set-new">Новый проект</button>
        ${backup ? '<button class="ghost" id="set-backup">Резервная копия сохранения</button>' : ''}
      </div>
      <p class="note">Изменения сохраняются автоматически в браузере. Ссылка передаёт полный проект.</p>`);
    const body = $('modal-body');
    body.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => {
      a.quality = b.dataset.q;
      a.applySettings();
      body.querySelectorAll('[data-q]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    }));
    $('set-ao').addEventListener('change', (e) => { a.settings.ao = e.target.checked; a.applySettings(); });
    $('set-bloom').addEventListener('change', (e) => { a.settings.bloom = e.target.checked; a.applySettings(); });
    $('set-dof').addEventListener('change', (e) => { a.settings.dof = e.target.checked; a.applySettings(); });
    $('set-exp').addEventListener('input', (e) => { a.settings.exposure = Number(e.target.value); $('exp-out').textContent = fmt(a.settings.exposure, 2); a.applySettings(); });
    $('set-doors').addEventListener('click', () => { this.closeModal(); this.openDoorsCeiling(); });
    $('set-new').addEventListener('click', () => {
      a.store.commit((s) => { Object.assign(s, newProject()); }, 'Новый проект');
      this.closeModal();
      this.toast('Открыт новый проект — вернуть прежний: Ctrl+Z');
    });
    $('set-backup')?.addEventListener('click', () => {
      this.closeModal();
      this.openModal('Резервная копия', `<p>Исходный текст непригодного сохранения:</p><textarea readonly>${esc(backup)}</textarea>`);
    });
  }

  openHelp() {
    this.openModal('Справка', `
      <h3>Управление</h3>
      <ul>
        <li>Обзор: левая кнопка — вращение, колесо — масштаб, правая кнопка / Shift / два пальца — сдвиг.</li>
        <li>Клавиши: C — кинематографический обзор, R — общий вид, N — траектория солнца, [ и ] — время, WASD — смещение, Q/E — поворот, / — скрыть интерфейс.</li>
        <li>Мебель: клик по карточке — добавить, перенос — поставить; при переносе колесо поворачивает на 45°, Esc — отмена. Кнопки у предмета и «,» / «.» — поворот на 90°, Delete — удалить. Вынос за дом — удаление. Ctrl+Z / Ctrl+Shift+Z — отмена и повтор.</li>
        <li>Телевизор крепится на внутренние стены жилых помещений; переносится по стенам и по высоте.</li>
      </ul>
      <h3>Отделка</h3>
      <ul>
        <li>Фасад — четыре стороны и навес; «Весь дом одним цветом» — одно действие истории.</li>
        <li>Стены — единый цвет всех помещений; облицовка вертикальная, горизонтальная или гладкая. Парная — натуральная липа.</li>
        <li>Пол дома (001–005), плитка мокрой зоны (006, 007) и настил террасы (008) меняются независимо.</li>
        <li>Образец можно перетащить на поверхность; наведение показывает превью без записи в историю.</li>
      </ul>
      <h3>Дом</h3>
      <p>12,0 × 6,8 м, ${fmt(HOUSE_AREA)} м² помещений, терраса ${fmt(TERRACE_AREA)} м² (крытая часть 1,5 м). Потолок по скатам 2,30–2,70 м, пол +0,70 м на ж/б сваях. Координаты восстановлены по чертежу (approximate) — не строительный обмер.</p>
      <h3>Сохранение и ссылка</h3>
      <p>Проект сохраняется в браузере автоматически. Кнопка «Ссылка» формирует адрес с полной конфигурацией (#r=1.…); он работает и для автономного файла.</p>
      <h3>Прогулка</h3>
      <p>WASD / стрелки — движение (Shift — быстрее), мышь — взгляд (клик включает захват указателя, перетаскивание — запасной способ), E или «Дверь» — открыть/закрыть ближайшую дверь, Esc — пауза. На сенсорном экране — джойстик и перетаскивание взгляда, короткое касание — дверь.</p>`);
  }

  openLink() {
    const url = `${location.href.split('#')[0]}${encodeHash(this.state)}`;
    this.openModal('Ссылка на конфигурацию', `
      <p>Адрес содержит полный проект: отделку, мебель, удаления, солнце, двери, потолок и кровлю.</p>
      <textarea id="link-text" readonly>${esc(url)}</textarea>
      <div class="actions"><button class="ghost" id="link-apply">Обновить адрес страницы</button><button class="primary" id="link-copy">Копировать</button></div>`);
    $('link-copy').addEventListener('click', async () => {
      const ta = $('link-text');
      try { await navigator.clipboard.writeText(url); this.toast('Ссылка скопирована'); } catch { ta.select(); document.execCommand?.('copy'); this.toast('Ссылка выделена — скопируйте её'); }
    });
    $('link-apply').addEventListener('click', () => {
      history.replaceState(null, '', url);
      this.toast('Адрес страницы обновлён');
    });
  }

  async savePNG() {
    const blob = await this.app.exportPNG();
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vsemdom-${this.app.mode}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    this.lastPng = blob;
    this.toast('Кадр 1800 × 1120 сохранён');
  }

  toast(text, ms = 3200) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    $('toasts').append(t);
    setTimeout(() => t.remove(), ms);
  }
}

export { daylightFactor, sunState, ceilingHeight };
