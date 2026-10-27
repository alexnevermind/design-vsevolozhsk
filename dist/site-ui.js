// Интерфейс участка: режимы, список построек с перелётом камеры, виды, солнце (время, дата, превью),
// светильники и костёр, качество, кадр PNG, ссылка, справка, клавиатура обзора. Отделка фиксирована
// (по рендерам владельца) — палитр и каталога нет.
import * as THREE from 'three';
import { formatHour, phaseLabel, PREVIEW_TIMES } from './solar.js';
import { encodeHash, newSite } from './site-state.js';
import { SITE, BUILDING } from './site-data.js';

const $ = (id) => document.getElementById(id);
const fmt = (v, d = 1) => v.toFixed(d).replace('.', ',');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const ICONS = {
  site: '<svg viewBox="0 0 34 34"><path d="M5 6l23 1-1 22-23-1z"/><circle cx="12" cy="13" r="3"/><path d="M19 22h6v4h-6zM18 11h6v5h-6z"/></svg>',
  guest: '<svg viewBox="0 0 34 34"><path d="M4 16 13 8l9 8v12H4z"/><path d="M22 18h8v10h-8zM10 28v-6h5v6"/></svg>',
  grill: '<svg viewBox="0 0 34 34"><path d="M17 4 28 10v13L17 30 6 23V10z"/><path d="M14 30v-7h6v7M17 4v7"/></svg>',
  garage: '<svg viewBox="0 0 34 34"><path d="M3 15 10 9l7 6v13H3z"/><path d="M17 12h14v16H17M6 28v-7h8v7"/></svg>',
};

const AREA = Object.fromEntries(SITE.buildings.map((b) => [b.id, b.rooms.reduce((s, r) => s + (r.area || 0), 0)]));
const ENTRIES = [
  { id: 'site', name: 'Весь участок', sub: `${fmt(SITE.site.area / 100, 1)} сотки · общий вид` },
  { id: 'guest', name: BUILDING.guest.name, sub: `${fmt(AREA.guest, 1)} м² · мансарда, баня` },
  { id: 'grill', name: BUILDING.grill.name, sub: `${fmt(BUILDING.grill.rooms[0].area, 1)} м² · пергола, обеденная площадка` },
  { id: 'garage', name: BUILDING.garage.name, sub: `хоз.блок ${fmt(BUILDING.garage.rooms[0].area, 1)} м² · навес на 2 машины` },
];
const SPOTS = [
  { id: 'entry', label: 'От ворот' },
  { id: 'fire', label: 'Кострище' },
  { id: 'pond', label: 'Пруд и купель' },
  { id: 'dining', label: 'Обеденная площадка' },
];

export class SiteUI {
  constructor(app) {
    this.app = app;
    this.modalOpen = false;
    this.sunPanelOpen = false;
    this.focus = 'site';
    this.bindTop();
    this.bindCamera();
    this.bindSun();
    this.bindKeyboard();
    this.bindSheet();
    this.renderPanel();
  }

  get state() {
    return this.app.store.get();
  }

  bindTop() {
    for (const b of document.querySelectorAll('.modes button')) b.addEventListener('click', () => { if (!b.disabled) this.app.setMode(b.dataset.mode); });
    $('btn-sun').addEventListener('click', () => this.toggleSun());
    $('btn-settings').addEventListener('click', () => this.openSettings());
    $('btn-help').addEventListener('click', () => this.openHelp());
    $('btn-png').addEventListener('click', () => this.savePNG());
    $('btn-link').addEventListener('click', () => this.openLink());
    $('modal-close').addEventListener('click', () => this.closeModal());
    $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) this.closeModal(); });
    for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => this.toggleSun(false));
  }

  bindSheet() {
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

  renderPanel() {
    const body = $('side-body');
    body.innerHTML = `
      <div class="bld-list" role="list">
        ${ENTRIES.map((e) => `<button class="bld" role="listitem" data-focus="${e.id}" aria-pressed="${this.focus === e.id}">${ICONS[e.id]}<strong>${esc(e.name)}</strong><span>${esc(e.sub)}</span></button>`).join('')}
      </div>
      <label class="check clear-view"><input type="checkbox" id="clear-view" ${this.app.settings.clearView ? 'checked' : ''}> Не заслонять постройки деревьями</label>
      <div class="views" aria-label="Виды">${SPOTS.map((s) => `<button data-spot="${s.id}">${esc(s.label)}</button>`).join('')}<button data-walk="1">Прогулка от калитки</button></div>
      <p class="site-facts">Север — вверх плана, солнце — для Всеволожска (60,0° с. ш.). Все постройки на ж/б сваях, пол на <b>0,25 м</b> выше спланированной земли. Деревья — по плану, высоты по диаметру ствола. Интерьеры — следующий этап.</p>`;
    body.querySelectorAll('[data-focus]').forEach((b) => b.addEventListener('click', () => this.app.focusOn(b.dataset.focus)));
    body.querySelectorAll('[data-spot]').forEach((b) => b.addEventListener('click', () => this.app.showSpot(b.dataset.spot)));
    body.querySelector('[data-walk]').addEventListener('click', () => this.app.setMode('walk'));
    $('clear-view').addEventListener('change', (e) => { this.app.settings.clearView = e.target.checked; this.app.updateTreeClearance(); this.app.invalidate(); });
  }

  onFocus(id) {
    this.focus = id;
    document.querySelectorAll('[data-focus]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.focus === id)));
    const e = ENTRIES.find((x) => x.id === id);
    $('place-label').textContent = id === 'site' ? '≈12 соток · три постройки' : e.name;
  }

  onModeChange(mode) {
    for (const b of document.querySelectorAll('.modes button')) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
  }

  refresh() {
    this.syncSunInputs();
  }

  bindCamera() {
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
        case 'KeyT': this.app.topView(); break;
        case 'KeyN': this.app.store.commit((s) => { s.notes = !s.notes; }, 'Траектория солнца'); break;
        case 'Digit1': this.app.focusOn('site'); break;
        case 'Digit2': this.app.focusOn('guest'); break;
        case 'Digit3': this.app.focusOn('grill'); break;
        case 'Digit4': this.app.focusOn('garage'); break;
        case 'BracketLeft':
        case 'BracketRight': {
          const h = (this.state.hour + (e.code === 'BracketLeft' ? -0.25 : 0.25) + 24) % 24;
          this.app.store.commit((s) => { s.hour = Math.round(h * 60) / 60; }, `Время ${formatHour(h)}`);
          break;
        }
        case 'KeyW': case 'KeyS': case 'KeyA': case 'KeyD': {
          const dir = new THREE.Vector3().subVectors(ctl.target, cam.position).setY(0).normalize();
          const right = new THREE.Vector3(-dir.z, 0, dir.x);
          const step = 0.6;
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
    $('sun-time').addEventListener('input', (e) => this.previewHour(Number(e.target.value) / 60));
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
    $('sun-lamps').addEventListener('change', (e) => commit((s) => { s.lamps = e.target.checked; }, e.target.checked ? 'Светильники включены' : 'Светильники выключены'));
    $('sun-notes').addEventListener('change', (e) => commit((s) => { s.notes = e.target.checked; }, 'Траектория солнца'));
    $('sun-fire').addEventListener('change', (e) => commit((s) => { s.fire = e.target.value; }, { auto: 'Костёр: авто', on: 'Костёр горит', off: 'Костёр погашен' }[e.target.value]));
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

  previewHour(h) {
    this.previewHourValue = Math.round(h * 60) / 60;
    const s = this.state;
    const st = this.app.env.update(s.solar, this.previewHourValue, s.lamps);
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
    $('sun-lamps').checked = s.lamps;
    $('sun-notes').checked = s.notes;
    $('sun-fire').value = s.fire;
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
    const light = [];
    app.scene.traverse((o) => { if (o.userData.far || o.name === 'grass') light.push(o); });
    const vis = light.map((o) => o.visible);
    light.forEach((o) => { o.visible = false; });
    for (const p of PREVIEW_TIMES) {
      app.env.update(s.solar, p.hour, s.lamps);
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
    if (this.app.mode === 'walk') this.app.walk.setPaused(true);
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

  openSettings() {
    const a = this.app;
    this.openModal('Качество изображения', `
      <div class="seg">${[['auto', 'Авто'], ['high', 'Высокое'], ['low', 'Облегчённое']].map(([id, l]) => `<button data-q="${id}" aria-pressed="${a.quality === id}">${l}</button>`).join('')}</div>
      <label class="check"><input type="checkbox" id="set-ao" ${a.settings.ao ? 'checked' : ''}> Контактные тени (GTAO)</label>
      <label class="check"><input type="checkbox" id="set-bloom" ${a.settings.bloom ? 'checked' : ''}> Свечение</label>
      <label class="check"><input type="checkbox" id="set-dof" ${a.settings.dof ? 'checked' : ''}> Глубина резкости</label>
      <label class="field">Экспозиция <output id="exp-out">${fmt(a.settings.exposure, 2)}</output><input type="range" id="set-exp" min="0.5" max="1.8" step="0.05" value="${a.settings.exposure}"></label>
      <div class="actions" style="justify-content:flex-start"><button class="ghost" id="set-reset">Сбросить солнце и время</button></div>
      <p class="note">Отделка построек фиксирована — по фотореалистичным рендерам. Солнце, время, светильники и костёр сохраняются в браузере; ссылка передаёт их вместе с видом.</p>`);
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
    $('set-reset').addEventListener('click', () => {
      a.store.commit((s) => { Object.assign(s, newSite()); }, 'Солнце по умолчанию');
      this.closeModal();
      this.toast('Солнце и время сброшены — вернуть: Ctrl+Z');
    });
  }

  openHelp() {
    const lv = SITE.levels;
    this.openModal('Справка', `
      <h3>Управление</h3>
      <ul>
        <li>Обзор: левая кнопка — вращение, колесо — масштаб, правая кнопка / Shift / два пальца — сдвиг.</li>
        <li>Клавиши: 1–4 — участок и постройки, R — общий вид, T — сверху, C — облёт, N — траектория солнца, [ и ] — время, WASD — смещение, Q/E — поворот, / — скрыть интерфейс.</li>
        <li>Прогулка: WASD / стрелки (Shift — быстрее), мышь — взгляд (клик включает захват указателя), Esc — пауза. На сенсорном экране — джойстик и перетаскивание взгляда.</li>
      </ul>
      <h3>Участок</h3>
      <p>${fmt(SITE.site.area, 0)} м² по границе плана. Рельеф — по отметкам съёмки (Балтийская система), у построек — планировка: гостевой дом ${fmt(lv.guest.floor, 2)}, гриль-дом ${fmt(lv.grill.floor, 2)}, хоз.блок ${fmt(lv.garage.floor, 2)} (чистый пол). Деревья — по плану: подпись «Б-25» — береза, ствол 25 см на высоте 1,3 м.</p>
      <h3>Постройки</h3>
      <p>Геометрия — по листам планов, внешний вид — по рендерам: светло-серая вертикальная доска, белые угловые доски и наличники, графитовая металлочерепица, цоколь из штукатурки по ж/б сваям.</p>
      <h3>Сохранение и ссылка</h3>
      <p>Солнце, время, светильники и костёр сохраняются в браузере. Кнопка «Ссылка» формирует адрес с этими настройками (#s=1.…).</p>`);
  }

  openLink() {
    const url = `${location.href.split('#')[0]}${encodeHash(this.state)}`;
    this.openModal('Ссылка на вид', `
      <p>Адрес содержит дату, время, светильники и режим костра.</p>
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
    a.download = `vsevolozhsk-${this.app.mode}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
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
