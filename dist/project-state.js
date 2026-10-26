// Сериализуемое состояние проекта: новый проект, миграция, валидация, ссылка #r=1., localStorage.
import INITIAL from './data/initial-state.js';
import SPEC from './data/project-spec.js';
import { ITEM_TYPES, isWallItem } from './catalog.js';
import { SLOT_OPTIONS, WALL_LAYOUTS, CEILING_TYPES, ROOF_TYPES } from './choices.js';
import { WALL_BY_ID, ROOM_BY_ID } from './plan.js';
import { validateLayout } from './house-core.js';

export const MODEL = SPEC.model;
export const REVISION = 2;
export const STORAGE_KEY = 'vsemdom-house-12x68-v1';
export const BACKUP_KEY = `${STORAGE_KEY}-backup`;
export const MAX_ITEMS = 100;
export const MAX_INPUT_CHARS = 200_000;
export const HASH_PREFIX = '#r=1.';
// Костёр в мангальной зоне: auto — горит вечером и ночью (вместе со светильниками), on, off.
export const FIRE_MODES = ['auto', 'on', 'off'];

export function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export function newProject() {
  return clone(INITIAL);
}

// Допустимые значения для каждого слота отделки.
export function slotOptions(slot) {
  if (slot.startsWith('facade:')) return SLOT_OPTIONS.facade;
  if (slot.startsWith('wall:')) return SLOT_OPTIONS.wall;
  if (slot.startsWith('floor:')) {
    const id = slot.slice(6);
    if (SPEC.floorGroups.wet.includes(id)) return SLOT_OPTIONS.floorWet;
    if (SPEC.floorGroups.terrace.includes(id)) return SLOT_OPTIONS.terrace;
    if (SPEC.floorGroups.wood.includes(id)) return SLOT_OPTIONS.floorWood;
    return null;
  }
  return SLOT_OPTIONS[slot] || null;
}

export const SLOTS = Object.keys(INITIAL.mats);

// Миграция ранних версий: недостающие поля получают значения по умолчанию.
export function migrate(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Состояние должно быть объектом');
  if (raw.model && raw.model !== MODEL) {
    // Сохранение другого дома (например, house-plan-v1): переносим только отделку, расстановку не возвращаем.
    const base = newProject();
    const notes = ['Сохранение относится к другой планировке: перенесены отделка и солнце, предметы взяты из нового проекта.'];
    for (const k of ['wallLayout', 'ceilingType', 'roofType', 'hour', 'lamps', 'notes', 'fire']) if (k in raw) base[k] = raw[k];
    if (raw.solar && typeof raw.solar === 'object') base.solar = { ...base.solar, ...raw.solar };
    if (raw.mats && typeof raw.mats === 'object') {
      for (const [k, v] of Object.entries(raw.mats)) {
        if (k.startsWith('facade:') || ['interiorDoors', 'ceiling', 'joinery', 'upholstery', 'accent', 'bedding', 'counter'].includes(k)) base.mats[k] = v;
      }
      const wall = raw.mats['wall:005'];
      if (wall) for (const id of SPEC.paintedRooms) base.mats[`wall:${id}`] = wall;
      const floor = raw.mats['floor:005'];
      if (floor) for (const id of SPEC.floorGroups.wood) base.mats[`floor:${id}`] = floor;
    }
    return { state: base, notes };
  }
  const s = clone(raw);
  const notes = [];
  s.model = MODEL;
  if (!Number.isFinite(s.revision)) s.revision = 1;
  if (s.revision < REVISION) notes.push(`Обновлено с версии ${s.revision}`);
  s.revision = REVISION;
  s.finishRevision = Number.isFinite(s.finishRevision) ? s.finishRevision : 1;
  s.wallLayout ??= 'vertical';
  s.ceilingType ??= 'timber';
  s.roofType ??= 'standingSeam';
  s.solar = { ...INITIAL.solar, ...(s.solar || {}) };
  s.mats = { ...(s.mats || {}) };
  s.mats.interiorDoors ??= 'door-light';
  s.mats.ceiling ??= 'tk-F497';
  for (const [k, v] of Object.entries(INITIAL.mats)) s.mats[k] ??= v;
  s.cladding = { ...INITIAL.cladding, ...(s.cladding || {}) };
  // Отсутствующий список предметов — пустая расстановка, а не исходная: удаления не возвращаются.
  s.items = Array.isArray(s.items) ? s.items : [];
  for (const it of s.items) {
    if (it && typeof it === 'object') {
      it.mats ??= {};
      if (typeof it.ry !== 'number' && !isWallItem(it.type)) it.ry = 0;
    }
  }
  s.hour ??= INITIAL.hour;
  s.lamps ??= true;
  s.notes ??= false;
  s.fire ??= 'auto';
  return { state: s, notes };
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
export function validDate(str) {
  const m = DATE_RE.exec(str || '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3] && +m[1] >= 1900 && +m[1] <= 2200;
}

// Полная проверка состояния. Возвращает список ошибок (пустой — состояние пригодно).
export function validate(s) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (s.model !== MODEL) err('Неизвестная модель дома');
  if (!WALL_LAYOUTS.some((o) => o.id === s.wallLayout)) err(`Недопустимая облицовка стен: ${s.wallLayout}`);
  if (!CEILING_TYPES.some((o) => o.id === s.ceilingType)) err(`Недопустимый тип потолка: ${s.ceilingType}`);
  if (!ROOF_TYPES.some((o) => o.id === s.roofType)) err(`Недопустимый тип кровли: ${s.roofType}`);
  const so = s.solar || {};
  if (!(Number.isFinite(so.latitude) && Math.abs(so.latitude) <= 89.9)) err('Широта вне диапазона');
  if (!(Number.isFinite(so.longitude) && Math.abs(so.longitude) <= 180)) err('Долгота вне диапазона');
  if (!(Number.isFinite(so.utcOffset) && so.utcOffset >= -12 && so.utcOffset <= 14)) err('Часовой пояс вне диапазона');
  if (!validDate(so.date)) err('Некорректная дата');
  if (!(Number.isFinite(so.northAngle) && so.northAngle >= 0 && so.northAngle < 360)) err('Направление севера вне диапазона');
  if (typeof so.orientationConfirmed !== 'boolean') err('orientationConfirmed должно быть логическим');
  if (!(Number.isFinite(s.hour) && s.hour >= 0 && s.hour < 24)) err('Время вне диапазона 00:00–23:59');
  if (typeof s.lamps !== 'boolean') err('lamps должно быть логическим');
  if (typeof s.notes !== 'boolean') err('notes должно быть логическим');
  if (!FIRE_MODES.includes(s.fire)) err(`Недопустимый режим костра: ${s.fire}`);
  for (const slot of SLOTS) {
    const opts = slotOptions(slot);
    if (!opts || !opts.includes(s.mats?.[slot])) err(`Недопустимый материал ${slot}: ${s.mats?.[slot]}`);
  }
  for (const [slot, v] of Object.entries(s.mats || {})) {
    if (!SLOTS.includes(slot)) err(`Неизвестный слот отделки: ${slot}`);
    else if (typeof v !== 'string') err(`Материал ${slot} должен быть строкой`);
  }
  if (!SLOT_OPTIONS.facade.includes(s.cladding?.loggia)) err('Недопустимая облицовка лоджии');
  if (!Array.isArray(s.items)) {
    err('items должен быть массивом');
    return errors;
  }
  if (s.items.length > MAX_ITEMS) err(`Слишком много предметов: ${s.items.length} > ${MAX_ITEMS}`);
  const ids = new Set();
  for (const it of s.items) {
    if (!it || typeof it !== 'object') { err('Предмет должен быть объектом'); continue; }
    if (!Number.isInteger(it.id) || it.id <= 0 || it.id > 1e6) err(`Некорректный ID предмета: ${it.id}`);
    if (ids.has(it.id)) err(`Повторяющийся ID предмета: ${it.id}`);
    ids.add(it.id);
    const t = ITEM_TYPES[it.type];
    if (!t) { err(`Неизвестный тип предмета: ${it.type}`); continue; }
    if (it.mats && typeof it.mats === 'object') {
      for (const [k, v] of Object.entries(it.mats)) {
        const opts = SLOT_OPTIONS[k];
        if (!opts || !opts.includes(v)) err(`Предмет ${it.id}: недопустимый материал ${k}=${v}`);
      }
    } else err(`Предмет ${it.id}: mats должен быть объектом`);
    if (t.mount === 'wall') {
      if (!WALL_BY_ID[it.wall]) err(`Предмет ${it.id}: неизвестная стена ${it.wall}`);
      if (it.side !== 1 && it.side !== -1) err(`Предмет ${it.id}: side должно быть 1 или −1`);
      if (!Number.isFinite(it.u) || !Number.isFinite(it.y)) err(`Предмет ${it.id}: u и y должны быть числами`);
    } else {
      if (![it.x, it.z, it.ry].every(Number.isFinite)) err(`Предмет ${it.id}: координаты должны быть конечными числами`);
      else if (Math.abs(it.x) > 50 || Math.abs(it.z) > 50) err(`Предмет ${it.id}: координаты вне участка`);
      if (it.room !== undefined && !ROOM_BY_ID[it.room]) err(`Предмет ${it.id}: неизвестное помещение ${it.room}`);
      if (it.anchor !== undefined) {
        if (!WALL_BY_ID[it.anchor?.wall] || (it.anchor.side !== 1 && it.anchor.side !== -1)) err(`Предмет ${it.id}: некорректная привязка к стене`);
      }
    }
  }
  if (errors.length === 0) {
    for (const p of validateLayout(s.items)) err(`Предмет ${p.id} (${ITEM_TYPES[p.type].short}): ${p.reason}`);
  }
  return errors;
}

// Нормализация после валидации: помещение предмета берётся из его положения.
export function loadState(raw) {
  const { state, notes } = migrate(raw);
  const errors = validate(state);
  return { state, notes, errors, ok: errors.length === 0 };
}

// --- Ссылка: #r=1.<base64url(UTF-8 JSON)> ---
function bytesToB64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function encodeHash(state) {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  const b64 = bytesToB64(bytes).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return HASH_PREFIX + b64;
}

export function decodeHash(hash) {
  if (!hash || !hash.startsWith(HASH_PREFIX)) return null;
  const body = hash.slice(HASH_PREFIX.length);
  if (body.length > MAX_INPUT_CHARS * 1.4) throw new Error('Ссылка слишком длинная');
  if (!/^[A-Za-z0-9_-]*$/.test(body)) throw new Error('Ссылка содержит недопустимые символы');
  let b64 = body.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) b64 += '=';
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(b64ToBytes(b64));
  } catch {
    throw new Error('данные ссылки обрезаны или искажены');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('в ссылке нет читаемой конфигурации (возможно, она скопирована не полностью)');
  }
}

// --- localStorage с безопасным доступом ---
export function safeStorage(storage) {
  return {
    get(key) {
      try { return storage?.getItem(key) ?? null; } catch { return null; }
    },
    set(key, value) {
      try { storage?.setItem(key, value); return true; } catch { return false; }
    },
    remove(key) {
      try { storage?.removeItem(key); } catch { /* недоступно */ }
    },
  };
}

// Порядок старта: валидная ссылка → локальное сохранение → новый проект.
export function resolveStartup({ hash, storage }) {
  const messages = [];
  if (hash && hash.startsWith(HASH_PREFIX)) {
    try {
      const raw = decodeHash(hash);
      const r = loadState(raw);
      if (r.ok) return { state: r.state, source: 'link', messages: [...messages, ...r.notes] };
      messages.push(`Конфигурация из ссылки не применена: ${r.errors[0]}`);
    } catch (e) {
      messages.push(`Ссылка повреждена: ${e.message}`);
    }
  }
  const text = storage?.get(STORAGE_KEY);
  if (text) {
    if (text.length > MAX_INPUT_CHARS) {
      messages.push('Сохранение слишком большое — открыт новый проект, исходный текст сохранён отдельно.');
      storage.set(BACKUP_KEY, text.slice(0, MAX_INPUT_CHARS));
    } else {
      try {
        const r = loadState(JSON.parse(text));
        if (r.ok) return { state: r.state, source: 'local', messages: [...messages, ...r.notes] };
        messages.push(`Сохранение непригодно (${r.errors[0]}) — открыт новый проект, исходный текст сохранён для восстановления.`);
      } catch (e) {
        messages.push(`Сохранение повреждено (${e.message}) — открыт новый проект, исходный текст сохранён для восстановления.`);
      }
      storage.set(BACKUP_KEY, text);
    }
  }
  return { state: newProject(), source: 'new', messages };
}

export function nextItemId(state) {
  return state.items.reduce((m, it) => Math.max(m, it.id), 0) + 1;
}
